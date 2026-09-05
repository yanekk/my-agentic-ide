// cockpit-bitbucket-client -- the only thing in the dashboard that opens a socket
// to BitBucket Cloud (DESIGN 3.1, 3.2). Three calls, all GET:
//
//   getUser        GET /2.0/user                         -> who the token belongs to
//   listOpenPRs    GET .../pullrequests?state=OPEN        -> one repo's open PRs, all pages
//   listPRComments GET .../pullrequests/{id}/comments     -> one PR's comments, all pages
//
// It fetches and paginates; it does not decide what a PR MEANS. Normalising a raw
// PR into a row, classifying it into a tab, sorting and paging are the pure model's
// job (T03), where they are testable from fixtures. This module hands the raw
// `values[]` straight through -- PRs and comments alike.
//
// READ-ONLY BY CONSTRUCTION (DESIGN 5.2). There is no method here that POSTs, PUTs,
// patches or removes anything -- every request is a GET -- so the dashboard cannot
// comment, approve or merge a PR even by mistake. spikes/bitbucket-test/run.sh
// greps this file for a mutating verb and fails on a hit, so keep those words out
// of the source, comments included.
//
// Failures are CLASSIFIED, not thrown raw, so the daemon can tell "you must act on
// this" from "wait and it heals" (DESIGN 2.n): a 401/403 is `auth` (the token is
// dead or wrong -- the pane says `config bitbucket-key`), everything else -- any
// other HTTP status, a dropped socket, a timeout, an unparseable body -- is
// `transient` (offline; keep the last cache, add a dim staleness line). getUser and
// listOpenPRs return `{ error: { kind } }` rather than rejecting, so a caller reads
// one shape.
//
// The origin is injectable (DESIGN 5.2): every endpoint is built from a base so a
// test re-points the client at a loopback stub and never reaches api.bitbucket.org.

const DEFAULT_ORIGIN = "https://api.bitbucket.org";

// 10s per call: a hung BitBucket request must not wedge the daemon's 60s tick, and
// a shortened budget is also the only way a test could prove the timeout without
// waiting ten real seconds for it.
const HTTP_TIMEOUT_MS = 10_000;

// A repo with more than 50 open PRs is rare (DESIGN 2.9), but an uncapped `next`
// loop is a hang waiting to happen, so the follow is bounded. 50 pages is 2500 PRs
// -- far past anything realistic -- so the cap only ever catches a misbehaving
// server, never a real workspace.
const MAX_PAGES = 50;

// --- errors ----------------------------------------------------------------

// `kind` is the daemon-facing meaning, decided once here so callers never read a
// status code themselves: "auth" (act on it) vs "transient" (wait).
class BitBucketError extends Error {
  constructor(kind, status = 0) {
    super(`bitbucket request failed (${kind}${status ? ` ${status}` : ""})`);
    this.name = "BitBucketError";
    this.kind = kind;
    this.status = status;
  }
}

// 401 and 403 are the only "you must act on it" outcomes: the credential is missing
// scope, wrong, or expired. Every other status heals itself or is out of the user's
// hands, so it is drawn as offline rather than shouting a command that would not
// help.
function kindFor(status) {
  return status === 401 || status === 403 ? "auth" : "transient";
}

// --- http ------------------------------------------------------------------

function baseOrigin(origin) {
  // Explicit arg wins (the unit tests pass a loopback stub); then the env seam the
  // cockpit integration test sets to a dead port so an accidental real fetch fails
  // loudly; then the real API. Trailing slashes trimmed so the join is clean.
  const chosen = origin || process.env.BITBUCKET_ORIGIN || DEFAULT_ORIGIN;
  return String(chosen).replace(/\/+$/, "");
}

// The credential is a BitBucket Cloud ACCESS TOKEN, sent as a bearer credential
// (DESIGN 2.6, revised 2026-09-05). It is one opaque string with no halves to split:
// the whole value is the token, so the header is the raw key after `Bearer `. This
// replaced a Basic scheme that base64'd an `email:api-token` pair -- the real
// read-only key is an access token, not that pair, and the Basic header was rejected
// by the live API with a 400, `Invalid Authorization header` (FINDINGS 2026-09-05).
function authHeader(key) {
  return `Bearer ${String(key ?? "")}`;
}

// One GET, classified. Throws a BitBucketError; the public functions catch it and
// return `{ error: { kind } }`. `url` is a full URL so `next` (an absolute URL from
// BitBucket) is followed verbatim.
async function getJson(url, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let res, text;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader(key), Accept: "application/json" },
      signal: controller.signal,
    });
    // Read inside the timeout too: headers can arrive and the body never, which
    // would otherwise hang for as long as the socket stays open.
    text = await res.text();
  } catch {
    // DNS failure, connection refused, a dropped socket, or our own abort -- all
    // heal themselves, so all are transient. No URL is named: none of these carries
    // a secret, but the habit is cheap.
    throw new BitBucketError("transient");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new BitBucketError(kindFor(res.status), res.status);

  try {
    return text && text.trim() ? JSON.parse(text) : {};
  } catch {
    // A malformed 200 is nothing the user can act on: treat it as offline, not as a
    // dead credential.
    throw new BitBucketError("transient", res.status);
  }
}

// --- endpoints -------------------------------------------------------------

function userUrl(origin) {
  return `${baseOrigin(origin)}/2.0/user`;
}

function prsUrl(origin, workspace, repo) {
  const u = new URL(
    `${baseOrigin(origin)}/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/pullrequests`,
  );
  // Native `state` filter over a `q=state="OPEN"` query -- both work (FINDINGS
  // 2026-09-03), this one is simpler. The field expansion is what makes one call
  // enough: `participants` (approvals) and `reviewers` are absent from the default
  // list response (DESIGN 2.4, 2.9). URLSearchParams encodes the leading `+` as
  // `%2B`, which is required -- a literal `+` would be read as a space and drop the
  // expansion.
  u.searchParams.set("state", "OPEN");
  u.searchParams.set("fields", "+values.participants,+values.reviewers");
  u.searchParams.set("pagelen", "50");
  return u.toString();
}

// --- the two calls ---------------------------------------------------------

/**
 * Who the token belongs to (DESIGN 2.6). "Me" is resolved from the credential, not
 * configured, so the person the dashboard is about is whoever the token is -- there
 * is nothing to keep in sync. The uuid is what the model matches PRs against.
 *
 * -> { uuid, nickname, accountId }  |  { error: { kind } }
 */
export async function getUser({ key, origin } = {}) {
  try {
    const data = await getJson(userUrl(origin), key);
    return {
      uuid: String(data.uuid ?? ""),
      nickname: String(data.nickname ?? ""),
      accountId: String(data.account_id ?? ""),
    };
  } catch (e) {
    return { error: { kind: e.kind || "transient" } };
  }
}

/**
 * One repository's open PRs, every page, raw (DESIGN 2.9). Follows BitBucket's
 * `next` link to completion; each `values[]` entry is a RawPR handed to the model
 * untouched. The auth header is re-sent on every page.
 *
 * -> { prs: RawPR[] }  |  { error: { kind } }
 */
export async function listOpenPRs({ key, workspace, repo, origin } = {}) {
  try {
    const prs = [];
    let url = prsUrl(origin, workspace, repo);
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const data = await getJson(url, key);
      if (Array.isArray(data.values)) prs.push(...data.values);
      url = typeof data.next === "string" ? data.next : "";
    }
    return { prs };
  } catch (e) {
    return { error: { kind: e.kind || "transient" } };
  }
}

function prCommentsUrl(origin, workspace, repo, prId) {
  const u = new URL(
    `${baseOrigin(origin)}/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/pullrequests/${encodeURIComponent(prId)}/comments`,
  );
  // The sort ranks by UNRESOLVED INLINE THREADS (DESIGN 2.3), which the cheap PR-list
  // call does not carry -- it has only a total comment_count. So each open PR costs
  // one GET here for its comments (decision A, DESIGN 2.9). pagelen 100 (the
  // endpoint's max) keeps a chatty PR to as few pages as possible. No field
  // expansion: `inline`, `parent`, `resolution`, `deleted` and `user.uuid` -- every
  // field the model reduces -- are in the default comment object, verified against
  // real PRs (FINDINGS 2026-09-05).
  u.searchParams.set("pagelen", "100");
  return u.toString();
}

/**
 * One pull request's comments, every page, raw (DESIGN 2.3, 2.9). The model reduces
 * these to the unresolved-inline-thread counts the sort needs; the client only
 * fetches and paginates, handing each `values[]` entry through untouched, exactly as
 * listOpenPRs does for PRs. `prId` is a PR's numeric id from the list call.
 *
 * -> { comments: RawComment[] }  |  { error: { kind } }
 */
export async function listPRComments({ key, workspace, repo, prId, origin } = {}) {
  try {
    const comments = [];
    let url = prCommentsUrl(origin, workspace, repo, prId);
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const data = await getJson(url, key);
      if (Array.isArray(data.values)) comments.push(...data.values);
      url = typeof data.next === "string" ? data.next : "";
    }
    return { comments };
  } catch (e) {
    return { error: { kind: e.kind || "transient" } };
  }
}
