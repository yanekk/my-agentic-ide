// cockpit-bitbucket-model -- the pure heart of the dashboard (DESIGN 3.1, 3.3).
//
// Everything here is a function of its arguments and nothing else: no clock, no
// filesystem, no network, no environment. `now` and `width` arrive as parameters
// where a later function needs them. spikes/bitbucket-test/run.sh greps this file
// for Node's fs / http / https / child_process modules, for the fetch call, for the
// clock (both the millisecond form and a bare zero-argument Date), and for the env,
// and fails on a hit. IF THAT CHECK FAILS THE FIX IS TO MOVE THE CODE, never to
// relax the check -- every rule that leaks across this line becomes one only a
// person can verify in a live pane. (This comment names those tokens obliquely on
// purpose: spelling them literally would trip the grep it describes.)
//
// This is the ONE place the "which PRs show, in what order" judgement lives
// (DESIGN 2.3), kept as one swappable pure function so trying an inclusion or sort
// idea is a one-line change with a test, not a refactor.
//
// T03 fills normalizePR / classify / paginate. The renderer (renderDashboard) and
// its click hit-zones live here too but arrive with T06; this file deliberately
// does not draw anything yet.

// --- normalize --------------------------------------------------------------

/**
 * A raw BitBucket PR (a `values[]` entry from the client, DESIGN 2.9) into the row
 * shape the dashboard reasons about. `meUuid` is who the token belongs to (from the
 * client's getUser); `repo` is the watched slug the PR was fetched under -- the raw
 * PR does not reliably carry it, and the click verbs need it (bb-open:{slug}/{id}),
 * so the caller (which iterates the cache per repo) passes it in, falling back to
 * the PR's own destination repository.
 *
 * Every non-comment field below was confirmed against the public API (FINDINGS
 * 2026-09-03). The unresolved-thread counts are the one part read from data the
 * cheap list call does NOT carry: the fetch layer attaches each PR's comments to
 * `raw.comments` (decision A, DESIGN 2.9), and this reduces them. The exact
 * comment-object field names are isolated in the accessors below and verified
 * against real PRs before they are trusted (T03 note, FINDINGS 2026-09-05).
 */
export function normalizePR(raw, { meUuid = "", repo = "" } = {}) {
  const r = raw || {};
  const participants = Array.isArray(r.participants) ? r.participants : [];
  const reviewers = Array.isArray(r.reviewers) ? r.reviewers : [];
  const comments = Array.isArray(r.comments) ? r.comments : [];

  const approvals = participants.filter((p) => p && p.approved === true).length;
  // approvedByMe drives the "already approved -> off my plate" exclusion (DESIGN 2.3).
  const approvedByMe =
    !!meUuid &&
    participants.some((p) => p && p.approved === true && p.user && p.user.uuid === meUuid);

  // An unresolved inline THREAD is a top-level inline comment (no parent), not
  // deleted, whose thread is not resolved. A reply belongs to its root's thread and
  // must not be counted again; a general (non-inline) comment carries no resolution
  // state, so it never counts (DESIGN 2.3, "inline threads only").
  const threadRoots = comments.filter(isInlineThreadRoot);
  const unresolvedRoots = threadRoots.filter((c) => !isResolved(c));
  const unresolved = unresolvedRoots.length;
  const myUnresolved = !meUuid
    ? 0
    : unresolvedRoots.filter((c) => commentAuthorUuid(c) === meUuid).length;

  const author = r.author || {};
  return {
    repo: String(repo || r?.destination?.repository?.name || ""),
    id: r.id,
    title: String(r.title ?? ""),
    // author.nickname is BitBucket's human handle, matched against the pick-list
    // (the user calls these "usernames"; the API has no `username` field -- see
    // classify and FINDINGS). uuid is stable, for the authored-by-me test.
    author: { uuid: String(author.uuid ?? ""), nickname: String(author.nickname ?? "") },
    updatedOn: String(r.updated_on ?? ""),
    approvals,
    approvedByMe,
    comments: Number.isFinite(r.comment_count) ? r.comment_count : 0,
    unresolved,
    myUnresolved,
    // Requested reviewers, as uuids, so the "assigned to me" rule is a uuid match.
    reviewers: reviewers.map((rv) => String((rv && rv.uuid) ?? "")).filter(Boolean),
    draft: r.draft === true,
    htmlUrl: String(r?.links?.html?.href ?? ""),
    sourceBranch: String(r?.source?.branch?.name ?? ""),
    destBranch: String(r?.destination?.branch?.name ?? ""),
  };
}

// --- comment-thread accessors ----------------------------------------------
// The ONLY place BitBucket's comment-object field names are read. Isolated so the
// real names -- verified against a real PR next round (FINDINGS 2026-09-05) -- are
// a three-line fix, not a hunt through the reducer. Assumed shape, from BitBucket
// Cloud's documented PR-comment object:
//   inline    : { path, ... }  present on an on-a-line comment; absent on a general one
//   parent    : { id }         present on a REPLY; absent on a thread's root comment
//   resolution: object         present when the thread is resolved; absent/null when open
//   user.uuid : the comment's author
function isInlineThreadRoot(c) {
  return !!c && !!c.inline && !c.parent && c.deleted !== true;
}
function isResolved(c) {
  return !!(c && c.resolution);
}
function commentAuthorUuid(c) {
  return String((c && c.user && c.user.uuid) ?? "");
}

// --- classify ---------------------------------------------------------------

/**
 * Split normalized PRs into the two tabs and order each (DESIGN 2.3, settled
 * 2026-09-05). `meUuid` is me; `team` is the pick-list (bitbucket-team) of author
 * handles, matched case-insensitively against author.nickname.
 *
 *   toReview = open PRs where I am a requested reviewer, OR authored by a pick-list
 *              member -- minus drafts, minus ones I have already approved. Deduped
 *              (a PR I both review and follow matches twice). Sorted by my own
 *              unresolved threads ASCENDING: a PR I have barely touched rises,
 *              because it is the one still needing my review.
 *   mine     = open PRs I authored, drafts INCLUDED (a draft is my own to-finish
 *              reminder). Sorted by all unresolved threads DESCENDING: the most
 *              feedback to address rises.
 *
 * Both tie-break on most-recently-updated (updatedOn desc), which is common because
 * most PRs have zero relevant threads.
 */
export function classify(prs, { meUuid = "", team = [] } = {}) {
  const list = Array.isArray(prs) ? prs : [];
  const teamSet = new Set(
    (Array.isArray(team) ? team : [])
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean),
  );

  const iReview = (pr) => !!meUuid && pr.reviewers.includes(meUuid);
  const onPickList = (pr) => teamSet.has(String(pr.author.nickname).trim().toLowerCase());
  const authoredByMe = (pr) => !!meUuid && pr.author.uuid === meUuid;

  const toReview = dedupe(
    list.filter((pr) => !pr.draft && !pr.approvedByMe && (iReview(pr) || onPickList(pr))),
  );
  const mine = dedupe(list.filter(authoredByMe));

  toReview.sort(byCount((pr) => pr.myUnresolved, "asc"));
  mine.sort(byCount((pr) => pr.unresolved, "desc"));
  return { toReview, mine };
}

// A PR is identified by repo + id, so the same PR reached by two inclusion rules
// collapses to one row. First occurrence wins; order is preserved for the sort that
// follows (Array.sort is stable).
function dedupe(prs) {
  const seen = new Set();
  const out = [];
  for (const pr of prs) {
    const key = `${pr.repo}/${pr.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pr);
  }
  return out;
}

// Sort by a numeric key in the given direction, then break ties on updatedOn
// descending REGARDLESS of that direction (DESIGN 2.3). A full tie (same key, same
// updatedOn) returns 0, so the stable sort keeps input order.
function byCount(key, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return (ka - kb) * sign;
    if (a.updatedOn > b.updatedOn) return -1;
    if (a.updatedOn < b.updatedOn) return 1;
    return 0;
  };
}

// --- paginate ---------------------------------------------------------------

/**
 * One page of a list (DESIGN 2.5). Rows are a fixed height (single-line titles,
 * DESIGN 2.2), so perPage is a plain count. A remembered page past the end -- the
 * list SHRANK since it was stored -- falls back to page 1; clamping a next/prev
 * CLICK to [1, pages] is the daemon's job (T08), so this never has to tell "shrank"
 * from "clicked past the end". An empty list is page 1 of 1.
 */
export function paginate(list, { page = 1, perPage = 10 } = {}) {
  const rows = Array.isArray(list) ? list : [];
  const pp = Math.max(1, Math.floor(perPage) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / pp));
  let p = Math.floor(page) || 1;
  if (p < 1 || p > pages) p = 1;
  const start = (p - 1) * pp;
  return { rows: rows.slice(start, start + pp), page: p, pages };
}
