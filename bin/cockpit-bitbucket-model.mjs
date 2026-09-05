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
  const btnOpenLabel = "[Open]";
  const buttonsW = visibleLen(btnPrimaryLabel) + 1 + visibleLen(btnOpenLabel);

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

  return { review, repoW, numW, authorW, apW, cmW, titleW, buttonsW,
           dropAuthor, dropCounts, dropRepo, btnPrimaryLabel, btnOpenLabel };
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

// One PR row: the fixed columns, then the two buttons whose exact x-positions are
// tracked so a click lands on them (DESIGN 3.4 -- the verb carries slug/id, so the
// daemon finds the PR without agreeing with the pane on row order). Every styled
// cell is clipped to its width BEFORE padding, so `col` stays in step with what is
// drawn; a title/repo/author is passed through safeText first, because it is text
// from the wire and a raw newline or ESC would break the row (agenda's rule).
function buildRow(p, L, tab) {
  const zones = [];
  let line = "";
  let col = 1;
  let first = true;
  const cell = (styled, width) => {
    if (!first) { line += " ".repeat(GAP); col += GAP; }
    first = false;
    line += pad(styled, width);
    col += width;
  };

  if (!L.dropRepo) cell(dim(clip(safeText(p.repo), L.repoW)), L.repoW);
  cell(clip(`#${p.id}`, L.numW), L.numW);
  cell(clip(safeText(p.title), L.titleW), L.titleW);
  if (!L.dropAuthor) cell(dim(clip(safeText(p.author?.nickname ?? ""), L.authorW)), L.authorW);
  if (!L.dropCounts) {
    cell(lpad(countCell(p.approvals), L.apW), L.apW);
    cell(lpad(countCell(p.comments), L.cmW), L.cmW);
  }

  // Buttons. `cell` cannot place them: their zones need the un-padded start column.
  if (!first) { line += " ".repeat(GAP); col += GAP; }
  const key = `${p.repo}/${p.id}`;
  const primaryVerb = tab === "toReview" ? "bb-review" : "bb-address";
  let x0 = col;
  line += bold(L.btnPrimaryLabel);
  col += visibleLen(L.btnPrimaryLabel);
  zones.push({ verb: `${primaryVerb}:${key}`, x0, x1: col - 1 });
  line += " ";
  col += 1;
  x0 = col;
  line += bold(L.btnOpenLabel);
  col += visibleLen(L.btnOpenLabel);
  zones.push({ verb: `bb-open:${key}`, x0, x1: col - 1 });

  return { line, zones };
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
 * Returns EXACTLY `rows` lines, each at most `width` visible columns, matching the
 * agenda's contract: more corrupts what is drawn below, fewer leaves stale paint.
 *
 * State order (DESIGN 2.n): unconfigured -> whole-dashboard auth (expired) ->
 * the active tab's table with its empty state, per-repo/offline footnotes and pager.
 */
export function renderDashboard({ width, rows, cache, view, now, config } = {}) {
  const w = Math.max(1, Math.floor(width) || 0);
  const n = Math.max(0, Math.floor(rows) || 0);

  const lines = [];
  const hitZones = [];
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
    };
  };

  if (n === 0) return { lines: [], hitZones: [] };

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
    // Budget: tabs (1) + header (1) reserved above the rows; the pager, only when
    // the list overflows one page, costs one more row.
    const avail = Math.max(0, n - 2 - trailer.length);
    let perPage = Math.max(1, avail);
    let paged = paginate(list, { page, perPage });
    if (paged.pages > 1) {
      perPage = Math.max(1, avail - 1);
      paged = paginate(list, { page, perPage });
    }
    const pager = paged.pages > 1;

    const L = computeLayout(w, tab, paged.rows);
    push(buildHeader(L));
    for (const p of paged.rows) {
      const r = buildRow(p, L, tab);
      push(r.line);
      zonesAt(r.zones);
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
