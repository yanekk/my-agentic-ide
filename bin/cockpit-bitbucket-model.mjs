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
// T03 fills normalizePR / classify / paginate. T06 adds the drawing half:
// renderDashboard and its click hit-zones, below classify/paginate.
//
// The four terminal-drawing primitives (visibleLen, pad, clip, safeText) come from
// the agenda model, where they already live and where cockpit-welcome imports them
// too -- a shared home for "measure/clip a styled line identically everywhere", not
// an agenda dependency. That module is on the same PURE side of the boundary (its
// own grep enforces it), so importing it keeps this file pure: the impurity grep
// runs on THIS file and finds nothing, and nothing impure rides in transitively.
import { visibleLen, pad, clip, safeText } from "./cockpit-agenda-model.mjs";

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
    // created_on drives the age (2.1) and [NEW] (2.2). Kept as both the raw string
    // and the parsed instant: Date.parse of a string is NOT a clock read, so purity
    // holds (DESIGN 5). An absent field parses to NaN, which every downstream reader
    // (ageLabel, activityTags) treats as "no age" rather than throwing.
    createdOn: String(r.created_on ?? ""),
    createdAtMs: Date.parse(r.created_on),
    // Each comment's timestamp, for the [ACTIVE] "3+ comments in 24h" count (2.2).
    // The comments are already attached for the unresolved-thread sort, so this is
    // free -- it reduces data in the cache, no extra call. An unparseable stamp is
    // dropped rather than carried as NaN, so the count only ever sees real times.
    commentTimesMs: comments
      .map((c) => Date.parse(c && c.created_on))
      .filter((t) => Number.isFinite(t)),
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
    // The diffstat triple the daemon summed and cached on the PR (T01, DESIGN 2.4),
    // passed straight through. `null` when the PR was never fetched (an unshown PR
    // carries no summary) -- deliberately NOT a zeroed object, so T03 can tell an
    // empty diff ("0 files") from an unfetched one (draw nothing).
    diff:
      r.diffstatSummary && typeof r.diffstatSummary === "object"
        ? {
            files: Number(r.diffstatSummary.files) || 0,
            added: Number(r.diffstatSummary.added) || 0,
            removed: Number(r.diffstatSummary.removed) || 0,
          }
        : null,
  };
}

// --- age and activity tags --------------------------------------------------
// The second row's time signals (DESIGN 2.1, 2.2). Both are pure functions of a PR
// and `now`: the model never reaches for a clock, so the NEW/ACTIVE/STALE judgement
// and the age string are proven from fixtures in milliseconds. Plain millisecond
// constants, no date library.

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Time since a PR was opened (DESIGN 2.1):
 *   <60m -> "Nm"   (a just-opened PR must not read as 0h)
 *   <24h -> "Nh"
 *   <7d  -> "Nd"
 *   >=7d -> "Mon DD"   (past a week the day count stops meaning anything)
 *   NaN or future -> ""
 *
 * `now` is a parameter -- nothing here reads a clock. The "Mon DD" form is the day
 * in the MACHINE's local zone (getMonth/getDate, never the UTC accessors), matching
 * every other local time the cockpit shows: deriving a calendar day from an instant
 * always depends on a zone, and the user reasons about the day they perceive the PR
 * opened. (Parent CLAUDE.md truths table: an offset-less instant is not in the
 * machine's zone -- so the test pins TZ rather than asserting a shiftable string.)
 */
export function ageLabel(createdAtMs, now) {
  const age = now - createdAtMs;
  if (!Number.isFinite(age) || age < 0) return "";   // NaN (absent) or future
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d`;
  const dt = new Date(createdAtMs);                   // argument form: not a clock read
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

/**
 * The activity tags that apply, in draw order NEW, ACTIVE, STALE (DESIGN 2.2). Bare
 * names -- the renderer (T03) adds the brackets and colour. A pure function of the
 * PR and `now`.
 *
 *   NEW    : opened within the last 24h. A future or absent created_on is not "opened
 *            within the last 24h", so it does not qualify (matches ageLabel).
 *   ACTIVE : 3+ comments within [now-24h, now], inclusive at both ends. Any comment
 *            counts (2.2) -- commentTimesMs is every comment, not the thread filter.
 *   STALE  : no activity for more than 14d, read off updated_on (silence, not birth).
 *
 * In practice only NEW and ACTIVE co-occur; STALE excludes them by construction (a
 * PR touched in the last day is neither silent for two weeks nor quiet).
 */
export function activityTags(pr, now) {
  const tags = [];
  const p = pr || {};

  const age = now - p.createdAtMs;
  if (Number.isFinite(age) && age >= 0 && age < DAY) tags.push("NEW");

  const from = now - DAY;
  const recent = (Array.isArray(p.commentTimesMs) ? p.commentTimesMs : [])
    .filter((t) => t >= from && t <= now).length;
  if (recent >= 3) tags.push("ACTIVE");

  const updated = Date.parse(p.updatedOn);
  if (Number.isFinite(updated) && now - updated > 14 * DAY) tags.push("STALE");

  return tags;
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

// --- diffstat summary -------------------------------------------------------

/**
 * Reduce a PR's raw diffstat entries (a `values[]` list from the client, DESIGN 2.4)
 * to the three numbers the second row shows:
 *
 *   files   = the number of changed files (entries.length)
 *   added   = the sum of every entry's lines_added
 *   removed = the sum of every entry's lines_removed
 *
 * PURE, like everything in this file: no clock, no I/O. The daemon calls this once
 * per shown PR and caches only the triple, so the 2s repaint never re-sums hundreds
 * of entries (DESIGN 2.4, 5).
 *
 * Tolerant of a ragged entry: a missing, null or non-numeric lines_added/lines_removed
 * counts as 0 (a pure-rename entry legitimately carries neither), and a non-array or
 * empty input returns all zeros. This is the "0 files changed" value; a PR that was
 * never FETCHED carries no summary at all (the daemon leaves the field absent, DESIGN
 * 2.4), which is how T02/T03 tell an empty diff from an unfetched one.
 */
export function summarizeDiffstat(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let added = 0;
  let removed = 0;
  for (const e of list) {
    const a = Number(e && e.lines_added);
    const r = Number(e && e.lines_removed);
    if (Number.isFinite(a)) added += a;
    if (Number.isFinite(r)) removed += r;
  }
  return { files: list.length, added, removed };
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
  const teamSet = teamSetOf(team);

  const toReview = dedupe(list.filter((pr) => inToReview(pr, meUuid, teamSet)));
  const mine = dedupe(list.filter((pr) => inMine(pr, meUuid)));

  toReview.sort(byCount((pr) => pr.myUnresolved, "asc"));
  mine.sort(byCount((pr) => pr.unresolved, "desc"));
  return { toReview, mine };
}

// The membership half of classify, factored out so the same three rules decide both
// what SHOWS (classify) and what is worth a comment fetch (concernsMe) -- kept beside
// each other so they cannot drift. All read only the cheap list fields (reviewers,
// author, draft, participants-derived approvedByMe); NONE reads a comment.
function teamSetOf(team) {
  return new Set(
    (Array.isArray(team) ? team : [])
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean),
  );
}
function inToReview(pr, meUuid, teamSet) {
  const iReview = !!meUuid && pr.reviewers.includes(meUuid);
  const onPickList = teamSet.has(String(pr.author.nickname).trim().toLowerCase());
  return !pr.draft && !pr.approvedByMe && (iReview || onPickList);
}
function inMine(pr, meUuid) {
  return !!meUuid && pr.author.uuid === meUuid;
}

/**
 * Does this normalized PR belong on EITHER tab for this user -- i.e. is it worth a
 * comment fetch (DESIGN 2.3 membership, without the sort)? The DAEMON calls this to
 * decide which PRs to read comments for, so a repo with hundreds of open PRs (cribl:
 * 739, FINDINGS 2026-09-05) costs a comment GET only for the handful that actually
 * show, not one per open PR. It is the SAME rule classify applies, on the same
 * comment-free fields, which is the whole point of sharing it: what is fetched and
 * what is shown are decided by one function, so they cannot disagree.
 */
export function concernsMe(pr, { meUuid = "", team = [] } = {}) {
  const teamSet = teamSetOf(team);
  return inToReview(pr, meUuid, teamSet) || inMine(pr, meUuid);
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

// --- render -----------------------------------------------------------------
// DESIGN 2.2, 2.4, 2.5, 2.n, 3.3. Draw the whole dashboard as terminal lines and
// say where every clickable thing is, given the cache, the view-state, a width, a
// row budget and `now`. Pure: no drawing rule here needs a live pane to check, so
// every state is a millisecond test. T07 wires this to cockpit-welcome (which reads
// the files and forwards them); T08 maps a click's coordinates to a zone's verb.

const ESC = "\x1b[";
const dim = (s) => `${ESC}2m${s}${ESC}0m`;
const bold = (s) => `${ESC}1m${s}${ESC}0m`;

// Line-two colour helpers (DESIGN 2.7, binding), named by role against the 16-colour
// palette so the exact shade follows the user's theme. Like dim/bold they close with
// 0m, which resets EVERY attribute -- fine for a self-contained segment, but see
// reopen() for why line two cannot just wrap coloured segments in one underline.
const cyan = (s) => `${ESC}36m${s}${ESC}0m`;    // #id, the primary button, the link cue
const green = (s) => `${ESC}32m${s}${ESC}0m`;   // additions, [NEW]
const red = (s) => `${ESC}31m${s}${ESC}0m`;     // deletions
const amber = (s) => `${ESC}33m${s}${ESC}0m`;   // [ACTIVE]
const reverse = (s) => `${ESC}7m${s}${ESC}0m`;  // a press flash (a self-contained label)

// U+2212 MINUS SIGN, the deletions marker (DESIGN 2.3 "+A −R"): a real minus glyph
// paired with the "+" of additions, both one column wide.
const MINUS = "−";

// Wrap a string so an SGR attribute stays ON across every inner reset. dim/bold/the
// colour helpers all close with 0m, which clears ALL attributes -- so a line whose
// underline (or press-reverse) must survive past a coloured segment cannot simply be
// wrapped once: the first inner 0m would kill it mid-line (FINDINGS 2026-09-06). This
// re-asserts `sgr` immediately after each 0m, then closes the whole run once.
function reopen(s, sgr) {
  return sgr + String(s).replace(/\x1b\[0m/g, `${ESC}0m${sgr}`) + `${ESC}0m`;
}

// The three activity tags, each a coloured [LABEL] (DESIGN 2.2, 2.7). STALE is drawn
// dim (a quiet PR reads quietly); NEW green, ACTIVE amber.
function renderTag(name) {
  const label = `[${name}]`;
  if (name === "NEW") return green(label);
  if (name === "ACTIVE") return amber(label);
  return dim(label);   // STALE
}

// "src → dst" for line two, both names run through safeText (they are wire text). ""
// when neither branch is known, so the whole branch group drops rather than drawing a
// dangling arrow.
function branchText(p) {
  const s = safeText(p.sourceBranch ?? "");
  const d = safeText(p.destBranch ?? "");
  if (!s && !d) return "";
  return `${s} → ${d}`;
}

// Left-pad to a VISIBLE width (agenda's `pad` only right-pads). Counts read as a
// column when right-aligned, the way a table's numbers do.
const lpad = (s, w) => " ".repeat(Math.max(0, w - visibleLen(s))) + s;

const GAP = 2;                 // columns between every table column, matching agenda
const MIN_TITLE_W = 8;         // below this the title is useless, so a column is dropped

// "22m ago" for the offline footnote. `ms` is always now - fetchedAt, both computed
// by the caller from the passed `now`; this only formats. A never-fetched entry is
// handled by the caller (it passes the word, not a number), so a non-finite or
// negative span here is a clock that jumped and reads as current.
function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// A zero count is a dim `·`, a non-zero is the number (DESIGN 2.4): the eye skips
// the dot, so a row that actually has approvals or comments stands out.
const countCell = (n) => (n > 0 ? String(n) : dim("·"));

// The dashboard is "on" only with a credential, a workspace and at least one repo
// (DESIGN 2.6); `bitbucket-team` may be empty. Mirrors store.isConfigured, which
// this pure module cannot import (it pulls in the filesystem); the rule is a stable
// three-field check, and the store's own tests hold the authoritative copy.
function configured(config) {
  return Boolean(
    config && config.key && config.workspace &&
    Array.isArray(config.repos) && config.repos.length,
  );
}

// The setup greeting (DESIGN 2.n). Replaces the old fleet-view greeting, so a
// first-time user still learns what this is and the exact commands that turn it on.
// The `bitbucket-key` hint spells the DESIGN 2.6 credential shape: a BitBucket
// access token, sent as a bearer credential (revised 2026-09-05).
function greetingLines() {
  return [
    bold("BITBUCKET"),
    "",
    dim("Set these in any cockpit terminal to begin:"),
    `  ${bold("config bitbucket-key")} ${dim("‹access-token›")}`,
    `  ${bold("config bitbucket-workspace")} ${dim("‹slug›")}`,
    `  ${bold("config bitbucket-repos")} ${dim("‹repo,slugs›")}`,
    "",
    dim("  optional: config bitbucket-team ‹teammates›"),
  ];
}

// The tab strip (DESIGN 2.2). Active tab bold, the other dim; each carries its
// total count so "what needs me" is answered at a glance. Returns the line and the
// click zones (x-only; the caller stamps y once it knows the line's position).
function buildTabs(tab, counts) {
  const items = [
    { verb: "bb-tab:toReview", label: `To review · ${counts.toReview}`, active: tab === "toReview" },
    { verb: "bb-tab:mine", label: `Mine · ${counts.mine}`, active: tab === "mine" },
  ];
  const SEP = "   ";
  let line = "";
  let col = 1;               // 1-indexed pane-local column of the next glyph
  const zones = [];
  items.forEach((it, i) => {
    if (i) { line += SEP; col += SEP.length; }
    const x0 = col;
    line += it.active ? bold(it.label) : dim(it.label);
    col += visibleLen(it.label);
    zones.push({ verb: it.verb, x0, x1: col - 1 });
  });
  return { line, zones };
}

// The pager (DESIGN 2.5), centred. Both prev and next always emit a zone -- the
// daemon clamps a click to [1, pages] (T08), so this never has to tell "no earlier
// page" from a real move -- but the unavailable direction is drawn dim.
function buildPager(page, pages, w) {
  const prev = "‹ prev";
  const next = "next ›";
  const mid = ` · ${page}/${pages} · `;
  const full = prev + mid + next;
  const left = Math.max(0, Math.floor((w - visibleLen(full)) / 2));
  let line = " ".repeat(left);
  let col = 1 + left;
  const zones = [];
  let x0 = col;
  line += page > 1 ? bold(prev) : dim(prev);
  col += visibleLen(prev);
  zones.push({ verb: "bb-page:prev", x0, x1: col - 1 });
  line += dim(mid);
  col += visibleLen(mid);
  x0 = col;
  line += page < pages ? bold(next) : dim(next);
  col += visibleLen(next);
  zones.push({ verb: "bb-page:next", x0, x1: col - 1 });
  return { line, zones };
}

// The offline / per-repo error footnotes (DESIGN 2.n). Two DESIGN bullets, and the
// client cannot tell them apart by error kind (a 404 typo and a network blip are
// both "transient"), so the split is by BREADTH instead: every fetched repo failing
// transiently is the whole-dashboard "offline" case -> ONE aggregate line with the
// stalest age; a subset failing is the "one repo fails, others succeed" case -> a
// per-repo line each, so a typo in bitbucket-repos is visible against repos that
// still draw their rows. A per-repo AUTH error (a lone 403 while the token is
// otherwise fine; the ALL-auth case is the expired state handled before this) names
// the fixing command on its own line.
function buildTrailer(cfgRepos, cacheRepos, now, w) {
  const errored = cfgRepos
    .map((slug) => ({ slug, e: cacheRepos[slug] }))
    .filter((x) => x.e && x.e.error);
  if (!errored.length) return [];

  const withEntry = cfgRepos.filter((slug) => cacheRepos[slug]).length;
  const allTransient = errored.every((x) => x.e.error.kind === "transient");
  if (allTransient && errored.length === withEntry) {
    let stalest = 0;
    let never = false;
    for (const { e } of errored) {
      if (!(Number(e.fetchedAt) > 0)) { never = true; continue; }
      const age = now - e.fetchedAt;      // now is a param; nothing reads a clock here
      if (age > stalest) stalest = age;
    }
    const when = never ? "never" : ageText(stalest);
    return [clip(dim(`last updated ${when} · offline`), w)];
  }

  return errored.map(({ slug, e }) => {
    const msg = e.error.kind === "auth"
      ? "sign-in expired · config bitbucket-key"
      : "couldn't fetch · offline";
    return clip(dim(`${safeText(slug)}  ${msg}`), w);
  });
}

// The column widths for the active tab's current page, computed ONCE so the header
// and every row line up (DESIGN 2.2 -- fixed columns, single-line titles). Columns
// are dropped as the pane narrows, in order of least value: the author (To review
// only), then the counts, then the repo -- the buttons and the #id+title never drop,
// because acting on a row and identifying it are the whole point. The title takes
// whatever is left, floored at one column; an even narrower pane is caught by the
// final clip on each line and by dropping zones that fall off the edge.
function computeLayout(w, tab, pageRows) {
  const review = tab === "toReview";
  const btnPrimaryLabel = review ? "[Review]" : "[Address]";
  // The [Open] button is gone (DESIGN 3): the whole top line but the primary button is
  // the click-to-open target now, so line one carries only the one primary button.
  const buttonsW = visibleLen(btnPrimaryLabel);

  // "repo"/"author"/"title" headers need 4/6/5 columns, so the natural widths start
  // there; a column never renders narrower than its own header.
  const maxRepo = pageRows.reduce((m, p) => Math.max(m, safeText(p.repo).length), 4);
  const maxId = pageRows.reduce((m, p) => Math.max(m, String(p.id).length), 1);
  const maxAuthor = review
    ? pageRows.reduce((m, p) => Math.max(m, safeText(p.author?.nickname ?? "").length), 6)
    : 0;
  const maxAp = pageRows.reduce((m, p) => Math.max(m, String(p.approvals).length), 1);
  const maxCm = pageRows.reduce((m, p) => Math.max(m, String(p.comments).length), 1);

  const numW = 1 + maxId;                                  // "#" + digits
  const apW = Math.max(1, maxAp);                          // header "✓" is one column
  const cmW = Math.max(1, maxCm);                          // header "✎" is one column
  // Cap repo/author so a long one cannot crush the title; clipped, not wrapped.
  let repoW = Math.min(maxRepo, Math.max(6, Math.floor(w / 5)));
  let authorW = review ? Math.min(maxAuthor, Math.max(6, Math.floor(w / 6))) : 0;

  let dropAuthor = !review;   // "mine" has no author column at all (DESIGN 2.2)
  let dropCounts = false;
  let dropRepo = false;

  const titleWidth = () => {
    let cols = 3;             // #id, title, buttons: always present
    let fixed = numW + buttonsW;
    if (!dropRepo) { cols += 1; fixed += repoW; }
    if (!dropAuthor) { cols += 1; fixed += authorW; }
    if (!dropCounts) { cols += 2; fixed += apW + cmW; }
    return w - fixed - GAP * (cols - 1);
  };

  let titleW = titleWidth();
  if (titleW < MIN_TITLE_W && !dropAuthor) { dropAuthor = true; titleW = titleWidth(); }
  if (titleW < MIN_TITLE_W && !dropCounts) { dropCounts = true; titleW = titleWidth(); }
  if (titleW < MIN_TITLE_W && !dropRepo) { dropRepo = true; titleW = titleWidth(); }
  titleW = Math.max(1, titleW);

  // Where the title cell begins (1-indexed), so line two indents under it: repo (when
  // shown) + its gap, then #id + its gap. Fixed order, so it is arithmetic, not a
  // mid-build capture.
  const titleX0 = 1 + (dropRepo ? 0 : repoW + GAP) + numW + GAP;

  return { review, repoW, numW, authorW, apW, cmW, titleW, buttonsW, titleX0,
           dropAuthor, dropCounts, dropRepo, btnPrimaryLabel };
}

// The dim column-header row, using the same widths as the rows so they align.
function buildHeader(L) {
  const cells = [];
  if (!L.dropRepo) cells.push(pad(clip("repo", L.repoW), L.repoW));
  cells.push(pad(clip("#", L.numW), L.numW));
  cells.push(pad(clip("title", L.titleW), L.titleW));
  if (!L.dropAuthor) cells.push(pad(clip("author", L.authorW), L.authorW));
  if (!L.dropCounts) { cells.push(lpad("✓", L.apW)); cells.push(lpad("✎", L.cmW)); }
  return dim(cells.join(" ".repeat(GAP)));
}

// Line ONE: the fixed columns (the open zone), then the single primary button. Two
// hit-zones, both on this line (DESIGN 3): an OPEN zone spanning col 1 to just before
// the button (a click anywhere but the button opens the PR, firing bb-open) and the
// primary button's spawn verb. The verbs carry slug/id, so the daemon finds the PR
// without agreeing with the pane on row order. Every styled cell is clipped to its
// width BEFORE padding, so `col` stays in step with what is drawn; a title/repo/author
// is passed through safeText first (wire text -- a raw newline or ESC would break the
// row, agenda's rule).
//
// `emphasis` = { verb, state:"hover"|"press" } | null (DESIGN 3): the zone whose verb
// matches is drawn emphasised, everything else at rest. It is a pure RENDERING input
// -- the model never decides a button is hovered, only how it looks when told (the
// pane reads the mouse, T04). No emphasis reproduces the rest bytes exactly.
function buildRow(p, L, tab, emphasis) {
  const key = `${p.repo}/${p.id}`;
  const primaryVerb = `${tab === "toReview" ? "bb-review" : "bb-address"}:${key}`;
  const openVerb = `bb-open:${key}`;
  const em = emphasis && typeof emphasis === "object" ? emphasis : null;
  const primaryState = em && em.verb === primaryVerb ? em.state : "rest";
  const openState = em && em.verb === openVerb ? em.state : "rest";

  let span = "";      // the open-zone content: every column, up to but not the button
  let col = 1;
  let first = true;
  const cell = (styled, width) => {
    if (!first) { span += " ".repeat(GAP); col += GAP; }
    first = false;
    span += pad(styled, width);
    col += width;
  };

  if (!L.dropRepo) cell(dim(clip(safeText(p.repo), L.repoW)), L.repoW);
  cell(cyan(clip(`#${p.id}`, L.numW)), L.numW);
  // Title: default text, or the cyan-underline link cue while the open zone is hovered
  // (DESIGN 2.7). titleText carries no inner reset, so the cue survives trivially.
  const titleText = clip(safeText(p.title), L.titleW);
  cell(openState === "hover" ? `${ESC}4m${ESC}36m${titleText}${ESC}0m` : titleText, L.titleW);
  if (!L.dropAuthor) cell(dim(clip(safeText(p.author?.nickname ?? ""), L.authorW)), L.authorW);
  if (!L.dropCounts) {
    cell(lpad(countCell(p.approvals), L.apW), L.apW);
    cell(lpad(countCell(p.comments), L.cmW), L.cmW);
  }

  // The gap before the button belongs to the open zone: clicking that blank still
  // opens the PR (DESIGN 3, "the whole line but the button").
  span += " ".repeat(GAP);
  const openX1 = col + GAP - 1;
  const primaryX0 = col + GAP;

  // Press reverse-videos the whole open span (which holds coloured segments, so the
  // reverse is re-asserted after each reset); hover is the title cue placed above.
  const openStr = openState === "press" ? reopen(span, `${ESC}7m`) : span;

  const label = L.btnPrimaryLabel;
  const btn =
    primaryState === "press" ? reverse(label)                    // reverse flash
    : primaryState === "hover" ? `${ESC}1m${ESC}36m${label}${ESC}0m` // bright + fill
    : cyan(label);                                               // rest
  const primaryX1 = primaryX0 + visibleLen(label) - 1;

  return {
    line: openStr + btn,
    zones: [
      { verb: openVerb, x0: 1, x1: openX1 },
      { verb: primaryVerb, x0: primaryX0, x1: primaryX1 },
    ],
  };
}

// Line TWO, indented under the title (DESIGN 2, 2.1-2.3, 2.6, 2.7). Left, joined by a
// dim " · ": the activity tags (a space-separated group), the age, the branch → target.
// Right, flush to the edge: the changed-file count and the +A −R pair. A drop order
// frees space as the pane narrows -- branch first, then +A −R, then N files -- always
// keeping the age and the tags. The whole line is underlined so it reads as the row
// separator (a hairline at no vertical cost, DESIGN 2.6); reopen() keeps the underline
// alive across the coloured segments' resets. Carries NO hit-zones. Pure: `now` is a
// parameter, and the tags/age are pure functions of the PR and it.
function buildLineTwo(p, L, w, now) {
  const indent = Math.max(0, (L.titleX0 || 1) - 1);

  const tags = activityTags(p, now);
  const tagPiece = tags.length
    ? { w: visibleLen(tags.map((t) => `[${t}]`).join(" ")), styled: tags.map(renderTag).join(" ") }
    : null;
  const age = ageLabel(p.createdAtMs, now);
  const agePiece = age ? { w: visibleLen(age), styled: dim(age) } : null;
  const br = branchText(p);
  let branchPiece = br ? { w: visibleLen(br), styled: dim(br) } : null;

  // The diff items exist only when the PR was fetched (DESIGN 2.4): a null `diff` draws
  // nothing here, never a "0 files" -- an absent fetch must not read as an empty PR.
  let filesPiece = null;
  let pmPiece = null;
  if (p.diff) {
    const files = `${p.diff.files} files`;
    filesPiece = { w: visibleLen(files), styled: dim(files) };
    const plus = `+${p.diff.added}`;
    const minus = `${MINUS}${p.diff.removed}`;
    pmPiece = { w: visibleLen(`${plus} ${minus}`), styled: `${green(plus)} ${red(minus)}` };
  }

  const SEPW = 3;    // dim " · " between the left groups
  const RSEP = 2;    // two spaces between the right diff items
  const MIDGAP = 2;  // the minimum blank gap between the left block and the right diff
  const leftWidth = (l) => l.reduce((a, x) => a + x.w, 0) + SEPW * Math.max(0, l.length - 1);
  const rightWidth = (r) => r.reduce((a, x) => a + x.w, 0) + RSEP * Math.max(0, r.length - 1);

  // Drop order (DESIGN 2): branch, then the +A −R pair, then the file count; age and
  // the tags never drop (the user's first ask). Each dropped item frees its space.
  while (true) {
    const left = [tagPiece, agePiece, branchPiece].filter(Boolean);
    const right = [filesPiece, pmPiece].filter(Boolean);
    const rw = rightWidth(right);
    if (indent + leftWidth(left) + (rw ? MIDGAP + rw : 0) <= w) break;
    if (branchPiece) { branchPiece = null; continue; }
    if (pmPiece) { pmPiece = null; continue; }
    if (filesPiece) { filesPiece = null; continue; }
    break;   // only age + tags left; the final clip guards a still-too-narrow pane
  }

  const left = [tagPiece, agePiece, branchPiece].filter(Boolean);
  const right = [filesPiece, pmPiece].filter(Boolean);
  const lw = leftWidth(left);
  const rw = rightWidth(right);

  let content = " ".repeat(indent) + left.map((x) => x.styled).join(dim(" · "));
  if (rw) {
    const gap = Math.max(MIDGAP, w - indent - lw - rw);
    content += " ".repeat(gap) + right.map((x) => x.styled).join("  ");
  }
  const vis = visibleLen(content);
  if (vis < w) content += " ".repeat(w - vis);   // pad so the hairline runs full width
  // The underline is the row separator (DESIGN 2.6). Its glyph takes the FOREGROUND
  // colour, so under the plain padding/gaps that is the default foreground -- a bright
  // white line. SGR 58 sets the underline's own colour: palette index 8 (bright black /
  // grey), so the hairline reads as a calm dark-grey rule and still follows the theme,
  // while the coloured text above it (tags, diff numbers) is untouched. WezTerm supports
  // coloured underlines; the host is always WezTerm (CLAUDE.md).
  return reopen(content, `${ESC}4m${ESC}58;5;8m`);
}

/**
 * THE render decision function (DESIGN 3.3). A function of its arguments and
 * nothing else: the fetched-PR cache, the session view-state, a width, a row budget
 * and a millisecond `now` in; the exact lines to paint and the click hit-zones out.
 *
 *   { lines: string[], hitZones: Zone[] }
 *   Zone = { verb, x0, x1, y }   1-indexed, pane-local; y is the line
 *
 * `config` is the four settings (store.readConfig's shape): it is what tells a pure
 * function whether the dashboard is configured at all and carries the `team`
 * pick-list classify needs, neither of which is in the cache. The task doc's
 * interface omitted it -- a pure renderer cannot decide the unconfigured state
 * without it -- so it is added here and the pane (T07) forwards it; only the
 * PRESENCE of the key is ever read, never its value, and it is never drawn.
 *
 * `emphasis` = { verb, state:"hover"|"press" } | null (DESIGN 3): the hit-zone whose
 * verb matches draws emphasised (the primary button, or the open zone), everything
 * else at rest. The pane reads the mouse and repaints (T04); the model only decides
 * how a target LOOKS when told. Absent, the output is byte-identical to the rest state.
 *
 * Returns EXACTLY `rows` lines, each at most `width` visible columns, matching the
 * agenda's contract: more corrupts what is drawn below, fewer leaves stale paint.
 *
 * State order (DESIGN 2.n): unconfigured -> whole-dashboard auth (expired) ->
 * the active tab's table with its empty state, per-repo/offline footnotes and pager.
 */
export function renderDashboard({ width, rows, cache, view, now, config, emphasis } = {}) {
  const w = Math.max(1, Math.floor(width) || 0);
  const n = Math.max(0, Math.floor(rows) || 0);

  const lines = [];
  const hitZones = [];
  // The active tab's page count, for the daemon's paging clamp (T08). It is decided
  // HERE, where perPage is (below), so the pane's pager and the daemon's clamp read
  // the same number and cannot disagree about how many pages there are. Default 1: no
  // table, an empty tab, or a single page is one page, so a next/prev click there is a
  // no-op rather than a jump past the end.
  let pageCount = 1;
  const push = (line) => lines.push(clip(line, w));
  // Stamp the x-only zones a builder returned with the line's final y, now known.
  const zonesAt = (zs) => { const y = lines.length; for (const z of zs) hitZones.push({ ...z, y }); };
  const finish = () => {
    while (lines.length < n) lines.push("");
    return {
      lines: lines.slice(0, n),
      // Drop zones off the visible area: a button clipped away is not "in the
      // output", so it needs no zone (and a click there would hit nothing).
      hitZones: hitZones.filter((z) => z.y <= n && z.x0 >= 1 && z.x1 <= w && z.x1 >= z.x0),
      pages: pageCount,
    };
  };

  if (n === 0) return { lines: [], hitZones: [], pages: 1 };

  // 1. Unconfigured -> the setup greeting, no table.
  if (!configured(config)) {
    for (const l of greetingLines()) push(l);
    return finish();
  }

  const cfgRepos = config.repos;
  const cacheRepos = (cache && typeof cache.repos === "object" && cache.repos) || {};
  const entries = cfgRepos.map((slug) => cacheRepos[slug]).filter(Boolean);

  // 2. Whole-dashboard auth -> the expired instruction. Every fetched repo carrying
  // an auth error means the token is bad for everything (getUser failed, or every
  // repo 401'd); a lone per-repo auth error while others work is NOT this, and falls
  // through to a per-repo footnote below.
  if (entries.length > 0 && entries.every((e) => e.error && e.error.kind === "auth")) {
    push(bold("BITBUCKET"));
    push(`${dim("sign-in expired")} ${dim("·")} ${bold("config bitbucket-key")}`);
    return finish();
  }

  // 3. The table. Normalize every cached raw PR (iterating the CONFIG's repos, not
  // the cache's keys, so a de-watched repo whose cache entry lingers is not drawn --
  // the daemon never prunes it, FINDINGS 2026-09-05), then classify into the tabs.
  const meUuid = cache && typeof cache.meUuid === "string" ? cache.meUuid : "";
  const all = [];
  for (const slug of cfgRepos) {
    const e = cacheRepos[slug];
    if (!e || !Array.isArray(e.prs)) continue;
    for (const raw of e.prs) all.push(normalizePR(raw, { meUuid, repo: slug }));
  }
  const { toReview, mine } = classify(all, { meUuid, team: config.team || [] });
  const tab = view && view.tab === "mine" ? "mine" : "toReview";
  const list = tab === "mine" ? mine : toReview;
  const page = view && view.page && Number.isInteger(view.page[tab]) ? view.page[tab] : 1;

  // Footnotes are known before pagination and are reserved before the rows, so the
  // one line you can act on is not the first pushed off the bottom.
  const trailer = buildTrailer(cfgRepos, cacheRepos, now, w);

  const tabs = buildTabs(tab, { toReview: toReview.length, mine: mine.length });
  push(tabs.line);
  zonesAt(tabs.zones);

  if (list.length === 0) {
    // A one-line "checked, all clear" beats an empty table reading as broken (2.n).
    push(dim(tab === "mine" ? "nothing of yours open" : "nothing waiting on you"));
  } else {
    // Budget: tabs (1) + header (1) reserved above the rows; the pager, only when the
    // list overflows one page, costs one more row. Each PR is now TWO lines (DESIGN 2),
    // so the remaining lines / 2 (floored, min 1) is PRs-per-page; paginate still takes
    // and returns a PR count.
    const avail = Math.max(0, n - 2 - trailer.length);
    let perPage = Math.max(1, Math.floor(avail / 2));
    let paged = paginate(list, { page, perPage });
    if (paged.pages > 1) {
      perPage = Math.max(1, Math.floor((avail - 1) / 2));
      paged = paginate(list, { page, perPage });
    }
    const pager = paged.pages > 1;
    pageCount = paged.pages;   // what the daemon clamps a page click against (T08)

    const L = computeLayout(w, tab, paged.rows);
    push(buildHeader(L));
    for (const p of paged.rows) {
      const r = buildRow(p, L, tab, emphasis);
      push(r.line);
      zonesAt(r.zones);        // both zones stamp line one's y, just pushed
      push(buildLineTwo(p, L, w, now));
    }
    if (pager) {
      const pg = buildPager(paged.page, paged.pages, w);
      push(pg.line);
      zonesAt(pg.zones);
    }
  }

  for (const t of trailer) push(t);
  return finish();
}

/**
 * The verb a click at pane-local (x, y) lands on, or null if it hit no zone (T08,
 * DESIGN 3.4). Both coordinates are 1-indexed, matching a zone's { x0, x1, y } and
 * WezTerm's SGR mouse report. Kept here beside renderDashboard so the pane that
 * captures the click and the test that checks the mapping read the SAME lookup --
 * the pane stays a thin "parse the click, look up the verb, append it" and every
 * hit/miss is a millisecond test rather than something only a live mouse can prove.
 */
export function verbAt(hitZones, x, y) {
  const z = (Array.isArray(hitZones) ? hitZones : []).find(
    (z) => z.y === y && x >= z.x0 && x <= z.x1,
  );
  return z ? z.verb : null;
}
