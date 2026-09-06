// The pure model: normalize a raw PR, classify into the two tabs, sort, paginate
// (DESIGN 2.3, 2.5, settled 2026-09-05). Pure functions of their arguments, so a
// full sweep of the behaviour runs in milliseconds off fixtures -- no clock, no
// network, no state dir touched. The bash run.sh separately greps the module for
// anything impure.

import { normalizePR, classify, concernsMe, paginate, summarizeDiffstat, ageLabel, activityTags } from "../../bin/cockpit-bitbucket-model.mjs";
import { ok, eq, section, done } from "./harness.mjs";

// A raw BitBucket PR, only the fields the model reads. The comments array is what
// the fetch layer attaches (decision A, DESIGN 2.9); a case sets only what it needs.
function rawPR({
  id = 1,
  title = "a title",
  authorUuid = "{author}",
  authorNick = "someone",
  created = "2020-01-01T00:00:00.000000+00:00",
  updated = "2020-01-01T00:00:00.000000+00:00",
  participants,
  reviewers,
  commentCount = 0,
  comments = [],
  diffstatSummary,
  draft = false,
  repoName = "web",
} = {}) {
  const pr = {
    id,
    title,
    author: { uuid: authorUuid, nickname: authorNick },
    created_on: created,
    updated_on: updated,
    comment_count: commentCount,
    comments,
    draft,
    links: { html: { href: `https://bitbucket.org/acme/${repoName}/pull-requests/${id}` } },
    source: { branch: { name: "feat" }, repository: { name: repoName } },
    destination: { branch: { name: "main" }, repository: { name: repoName } },
  };
  // Left undefined when a case wants to prove tolerance of a missing array.
  if (participants !== undefined) pr.participants = participants;
  if (reviewers !== undefined) pr.reviewers = reviewers;
  // Absent by default: an unfetched PR carries no diffstat (DESIGN 2.4). A case that
  // wants the triple passes it; the field then rides on the raw PR exactly as the
  // daemon stores it (T01).
  if (diffstatSummary !== undefined) pr.diffstatSummary = diffstatSummary;
  return pr;
}

// Comment fixtures for the unresolved-thread reduction.
const inlineOpen = (uuid) => ({ inline: { path: "a.js" }, user: { uuid }, resolution: null });
const inlineResolved = (uuid) => ({ inline: { path: "a.js" }, user: { uuid }, resolution: { type: "x" } });
const general = (uuid) => ({ user: { uuid } }); // no `inline` -> never counts
const reply = (uuid) => ({ inline: { path: "a.js" }, user: { uuid }, parent: { id: 99 } }); // a reply, not a root
// A comment carrying only a timestamp, for the commentTimesMs / [ACTIVE] cases.
const commentAt = (iso) => ({ user: { uuid: "{c}" }, created_on: iso });

// A normalized PR built directly, for the classify/sort/paginate cases (they take
// the model's output, not raw). Only the fields those functions read.
function nPR({
  repo = "web",
  id = 1,
  authorUuid = "{author}",
  authorNick = "leon",
  updatedOn = "2020-01-01T00:00:00+00:00",
  approvedByMe = false,
  reviewers = [],
  unresolved = 0,
  myUnresolved = 0,
  draft = false,
} = {}) {
  return {
    repo, id, title: `pr${id}`,
    author: { uuid: authorUuid, nickname: authorNick },
    updatedOn, approvals: 0, approvedByMe, comments: 0,
    unresolved, myUnresolved, reviewers, draft,
    htmlUrl: "", sourceBranch: "", destBranch: "",
  };
}

const ids = (list) => list.map((p) => p.id);

function main() {
  const ME = "{me}";

  section("normalizePR maps every field, approvals and approvedByMe");
  {
    const raw = rawPR({
      id: 7,
      title: "fix the thing",
      authorUuid: "{leon}",
      authorNick: "leon",
      updated: "2021-05-05T10:00:00.000000+00:00",
      commentCount: 4,
      participants: [
        { approved: true, user: { uuid: ME } },
        { approved: true, user: { uuid: "{x}" } },
        { approved: false, user: { uuid: "{y}" } },
      ],
      reviewers: [{ uuid: "{r1}" }, { uuid: ME }],
      draft: true,
      repoName: "api",
    });
    const n = normalizePR(raw, { meUuid: ME, repo: "api" });
    eq("repo", n.repo, "api");
    eq("id", n.id, 7);
    eq("title", n.title, "fix the thing");
    eq("author uuid+nickname", n.author, { uuid: "{leon}", nickname: "leon" });
    eq("updatedOn", n.updatedOn, "2021-05-05T10:00:00.000000+00:00");
    eq("approvals counts approved===true regardless of role", n.approvals, 2);
    ok("approvedByMe true when I am an approver", n.approvedByMe === true);
    eq("comments is comment_count", n.comments, 4);
    eq("reviewers are uuids", n.reviewers, ["{r1}", ME]);
    ok("draft passes through", n.draft === true);
    eq("htmlUrl from links.html.href", n.htmlUrl, "https://bitbucket.org/acme/api/pull-requests/7");
    eq("sourceBranch", n.sourceBranch, "feat");
    eq("destBranch", n.destBranch, "main");
  }

  section("normalizePR computes unresolved / myUnresolved from attached comments");
  {
    const raw = rawPR({
      comments: [
        inlineOpen(ME),        // counts, and is mine
        inlineOpen("{other}"), // counts, not mine
        inlineResolved(ME),    // resolved -> not counted
        general(ME),           // no inline -> not counted
        reply(ME),             // a reply -> not a thread root
      ],
    });
    const n = normalizePR(raw, { meUuid: ME });
    eq("unresolved = open inline thread roots (all authors)", n.unresolved, 2);
    eq("myUnresolved = open inline roots authored by me", n.myUnresolved, 1);
  }

  section("normalizePR: no comments attached yields zero, never throws");
  {
    const n = normalizePR(rawPR({ comments: [] }), { meUuid: ME });
    eq("unresolved 0", n.unresolved, 0);
    eq("myUnresolved 0", n.myUnresolved, 0);
    // A raw PR with no `comments` field at all (the fetch layer attached none).
    const raw = rawPR();
    delete raw.comments;
    const n2 = normalizePR(raw, { meUuid: ME });
    eq("missing comments array -> 0", n2.unresolved, 0);
  }

  section("normalizePR tolerates missing participants / reviewers");
  {
    // rawPR leaves both undefined unless asked.
    const n = normalizePR(rawPR(), { meUuid: ME });
    eq("no participants -> approvals 0", n.approvals, 0);
    ok("no participants -> approvedByMe false", n.approvedByMe === false);
    eq("no reviewers -> []", n.reviewers, []);
  }

  section("normalizePR: created_on, comment times and the diffstat triple (T02)");
  {
    const raw = rawPR({
      created: "2021-05-05T10:00:00.000000+00:00",
      comments: [
        commentAt("2021-05-05T11:00:00.000000+00:00"),
        commentAt("2021-05-06T09:30:00.000000+00:00"),
      ],
      diffstatSummary: { files: 3, added: 15, removed: 9 },
    });
    const n = normalizePR(raw, { meUuid: ME });
    eq("createdOn is the raw string", n.createdOn, "2021-05-05T10:00:00.000000+00:00");
    eq("createdAtMs is Date.parse of it", n.createdAtMs, Date.parse("2021-05-05T10:00:00.000000+00:00"));
    eq("commentTimesMs parses each comment's created_on", n.commentTimesMs, [
      Date.parse("2021-05-05T11:00:00.000000+00:00"),
      Date.parse("2021-05-06T09:30:00.000000+00:00"),
    ]);
    eq("diff passes the cached triple through", n.diff, { files: 3, added: 15, removed: 9 });
  }

  section("normalizePR: absent created_on/diffstat and a garbage comment time");
  {
    // A never-fetched PR carries no diffstatSummary; created_on absent -> NaN, not a throw.
    const raw = rawPR({
      comments: [commentAt("not-a-date"), commentAt("2021-05-05T11:00:00.000000+00:00")],
    });
    delete raw.created_on;
    const n = normalizePR(raw, { meUuid: ME });
    ok("missing created_on -> createdAtMs NaN", Number.isNaN(n.createdAtMs));
    eq("createdOn empty string when absent", n.createdOn, "");
    eq("unparseable comment time is dropped", n.commentTimesMs, [
      Date.parse("2021-05-05T11:00:00.000000+00:00"),
    ]);
    // Absent summary -> null, distinguishable from an empty diff; never {0,0,0}.
    eq("no diffstat -> diff is null (not a zeroed object)", n.diff, null);
  }

  section("classify: a PR I review lands in toReview; one I authored lands in mine");
  {
    const p1 = nPR({ id: 1, authorUuid: "{other}", authorNick: "magda", reviewers: [ME] });
    const p2 = nPR({ id: 2, authorUuid: ME, authorNick: "me" });
    const { toReview, mine } = classify([p1, p2], { meUuid: ME, team: [] });
    eq("toReview has the one I review", ids(toReview), [1]);
    eq("mine has the one I authored", ids(mine), [2]);
  }

  section("classify: a pick-list author's PR lands in toReview; a stranger's nowhere");
  {
    const p3 = nPR({ id: 3, authorUuid: "{leon}", authorNick: "Leon", reviewers: [] }); // case-insensitive
    const p4 = nPR({ id: 4, authorUuid: "{stranger}", authorNick: "stranger", reviewers: [] });
    const { toReview, mine } = classify([p3, p4], { meUuid: ME, team: ["leon"] });
    eq("pick-list author is in toReview", ids(toReview), [3]);
    ok("stranger is in neither tab", !ids(toReview).includes(4) && !ids(mine).includes(4));
  }

  section("classify dedup: a pick-list author's PR I also review appears once");
  {
    const p5 = nPR({ id: 5, authorUuid: "{leon}", authorNick: "leon", reviewers: [ME] });
    const { toReview } = classify([p5], { meUuid: ME, team: ["leon"] });
    eq("appears exactly once", ids(toReview), [5]);
  }

  section("classify excludes drafts from toReview but keeps my own drafts in mine");
  {
    const other = nPR({ id: 6, authorUuid: "{other}", reviewers: [ME], draft: true });
    const myDraft = nPR({ id: 7, authorUuid: ME, authorNick: "me", draft: true });
    const { toReview, mine } = classify([other, myDraft], { meUuid: ME, team: [] });
    ok("someone else's draft is not in toReview", !ids(toReview).includes(6));
    eq("my own draft stays in mine", ids(mine), [7]);
  }

  section("classify excludes a PR I have already approved from toReview");
  {
    const p8 = nPR({ id: 8, authorUuid: "{other}", reviewers: [ME], approvedByMe: true });
    const { toReview } = classify([p8], { meUuid: ME, team: [] });
    eq("approved-by-me is filtered out", ids(toReview), []);
  }

  // concernsMe is the daemon's "is this worth a comment fetch" gate, and it MUST
  // agree with classify's membership exactly (DESIGN 2.3, FINDINGS 2026-09-05) --
  // else the sort would rank a PR whose comments were never fetched, or the daemon
  // would waste a fetch on a PR that never shows.
  section("concernsMe agrees with classify membership, comment-free");
  {
    const opts = { meUuid: ME, team: ["leon"] };
    ok("a PR I review concerns me",
      concernsMe(nPR({ authorUuid: "{other}", authorNick: "magda", reviewers: [ME] }), opts) === true);
    ok("a PR I authored concerns me",
      concernsMe(nPR({ authorUuid: ME, authorNick: "me" }), opts) === true);
    ok("a pick-list author's PR concerns me",
      concernsMe(nPR({ authorUuid: "{leon}", authorNick: "Leon" }), opts) === true);
    ok("a stranger's PR does not",
      concernsMe(nPR({ authorUuid: "{s}", authorNick: "stranger" }), opts) === false);
    ok("someone else's draft I review does not (excluded like classify)",
      concernsMe(nPR({ authorUuid: "{other}", reviewers: [ME], draft: true }), opts) === false);
    ok("my own draft concerns me (it is mine)",
      concernsMe(nPR({ authorUuid: ME, authorNick: "me", draft: true }), opts) === true);
    ok("a PR I already approved does not",
      concernsMe(nPR({ authorUuid: "{other}", reviewers: [ME], approvedByMe: true }), opts) === false);
    ok("with no meUuid and no pick-list, nothing concerns me",
      concernsMe(nPR({ authorUuid: "{leon}", authorNick: "leon", reviewers: [] }), { meUuid: "", team: [] }) === false);
    ok("but a pick-list author concerns me even with no meUuid",
      concernsMe(nPR({ authorUuid: "{leon}", authorNick: "leon" }), { meUuid: "", team: ["leon"] }) === true);
  }

  section("sort: toReview by myUnresolved asc, mine by unresolved desc, updatedOn tiebreak");
  {
    const jan = "2020-01-01T00:00:00+00:00";
    const feb = "2020-02-01T00:00:00+00:00";
    const may = "2020-05-01T00:00:00+00:00";

    const a = nPR({ id: "a", authorUuid: "{o}", reviewers: [ME], myUnresolved: 5, updatedOn: jan });
    const b = nPR({ id: "b", authorUuid: "{o}", reviewers: [ME], myUnresolved: 0, updatedOn: jan });
    const c = nPR({ id: "c", authorUuid: "{o}", reviewers: [ME], myUnresolved: 0, updatedOn: feb });
    // asc by myUnresolved: b,c (0) before a (5); the 0-tie breaks on updatedOn desc -> c(feb) then b(jan).
    const { toReview } = classify([a, b, c], { meUuid: ME, team: [] });
    eq("toReview ascending, newest-first on ties", ids(toReview), ["c", "b", "a"]);

    const d = nPR({ id: "d", authorUuid: ME, unresolved: 0, updatedOn: jan });
    const e = nPR({ id: "e", authorUuid: ME, unresolved: 3, updatedOn: jan });
    const f = nPR({ id: "f", authorUuid: ME, unresolved: 3, updatedOn: may });
    // desc by unresolved: e,f (3) before d (0); the 3-tie breaks on updatedOn desc -> f(may) then e(jan).
    const { mine } = classify([d, e, f], { meUuid: ME, team: [] });
    eq("mine descending, newest-first on ties", ids(mine), ["f", "e", "d"]);
  }

  section("sort is stable when the key and updatedOn both tie");
  {
    const same = "2020-01-01T00:00:00+00:00";
    const g = nPR({ id: "g", authorUuid: ME, unresolved: 1, updatedOn: same });
    const h = nPR({ id: "h", authorUuid: ME, unresolved: 1, updatedOn: same });
    const { mine } = classify([g, h], { meUuid: ME, team: [] });
    eq("full tie keeps input order", ids(mine), ["g", "h"]);
  }

  section("paginate: exactly-full, one-over, empty, page 1 of 1");
  {
    const four = [1, 2, 3, 4];
    const full1 = paginate(four, { page: 1, perPage: 2 });
    eq("exactly-full: two pages", full1.pages, 2);
    eq("page 1 rows", full1.rows, [1, 2]);
    eq("page 2 rows", paginate(four, { page: 2, perPage: 2 }).rows, [3, 4]);

    const three = [1, 2, 3];
    const over = paginate(three, { page: 2, perPage: 2 });
    eq("one-over: still two pages", over.pages, 2);
    eq("the spill is one row on page 2", over.rows, [3]);

    const empty = paginate([], { page: 1, perPage: 2 });
    eq("empty list -> page 1 of 1, no rows", empty, { rows: [], page: 1, pages: 1 });

    const one = paginate([1, 2], { page: 1, perPage: 2 });
    eq("page 1 of 1", { page: one.page, pages: one.pages }, { page: 1, pages: 1 });
  }

  section("paginate: a remembered page past the end of a shrunk list falls back to page 1");
  {
    // The list had 3 pages when page 3 was remembered; it shrank to one page.
    const r = paginate([1, 2], { page: 3, perPage: 2 });
    eq("clamped to page 1", r.page, 1);
    eq("shows page 1's rows", r.rows, [1, 2]);
  }

  section("summarizeDiffstat sums files, added and removed across entries");
  {
    const r = summarizeDiffstat([
      { lines_added: 10, lines_removed: 2 },
      { lines_added: 5, lines_removed: 0 },
      { lines_added: 0, lines_removed: 7 },
    ]);
    eq("files is the entry count", r.files, 3);
    eq("added is the sum of lines_added", r.added, 15);
    eq("removed is the sum of lines_removed", r.removed, 9);
  }

  section("summarizeDiffstat: a file with only additions or only deletions");
  {
    // A new file is all additions; a deleted file is all deletions. Each still counts
    // as one changed file.
    const r = summarizeDiffstat([{ lines_added: 40 }, { lines_removed: 12 }]);
    eq("two files", r.files, 2);
    eq("their additions", r.added, 40);
    eq("their deletions", r.removed, 12);
  }

  section("summarizeDiffstat: missing / non-numeric line counts are treated as 0");
  {
    // A pure-rename entry carries neither line field (DESIGN 2.4); null, undefined
    // and a non-numeric value must not turn the total into NaN.
    const r = summarizeDiffstat([
      {},                                             // neither field
      { lines_added: null, lines_removed: undefined },
      { lines_added: "x", lines_removed: "y" },
      { lines_added: 3, lines_removed: 4 },
    ]);
    eq("four changed files", r.files, 4);
    eq("only the numeric addition counts", r.added, 3);
    eq("only the numeric deletion counts", r.removed, 4);
  }

  section("summarizeDiffstat: an empty or missing list is all zeros");
  {
    const empty = summarizeDiffstat([]);
    eq("empty -> zero files", empty.files, 0);
    eq("empty -> zero added", empty.added, 0);
    eq("empty -> zero removed", empty.removed, 0);
    // A non-array (never fetched, garbage) collapses to the same zero triple rather
    // than throwing -- the daemon leaves the field absent for "not fetched", but the
    // reducer itself must be total.
    const nul = summarizeDiffstat(null);
    eq("null -> zero files", nul.files, 0);
    eq("null -> zero added", nul.added, 0);
  }

  // Millisecond constants for the age/tag cases, matching the model's own.
  const MIN = 60000, HR = 60 * MIN, DAY = 24 * HR;

  section("ageLabel: the four forms at their boundaries, NaN and future");
  {
    const now = Date.parse("2020-08-27T16:00:00.000Z");
    eq("0m", ageLabel(now, now), "0m");
    eq("59m stays minutes", ageLabel(now - 59 * MIN, now), "59m");
    eq("60m rolls to 1h", ageLabel(now - 60 * MIN, now), "1h");
    eq("23h stays hours", ageLabel(now - 23 * HR, now), "23h");
    eq("24h rolls to 1d", ageLabel(now - 24 * HR, now), "1d");
    eq("6d stays days", ageLabel(now - 6 * DAY, now), "6d");
    eq("NaN (absent created_on) -> ''", ageLabel(NaN, now), "");
    eq("future -> ''", ageLabel(now + HR, now), "");
  }

  section("ageLabel: >=7d is a Mon DD date, read in the machine's local zone (TZ pinned)");
  {
    // Deriving a calendar day from an instant always depends on a timezone (parent
    // CLAUDE.md truths table). Pin a NON-UTC zone and use an instant near midnight
    // UTC, so a UTC-accessor bug would read a day off: the assertion only holds if
    // ageLabel uses LOCAL getMonth/getDate.
    process.env.TZ = "America/New_York";
    const now = Date.parse("2020-08-27T16:00:00.000Z");     // Aug 27 12:00 in NY
    eq("exactly 7d ago -> the date form", ageLabel(now - 7 * DAY, now), "Aug 20");
    // 02:00Z is the previous evening (22:00) in NY: local day 19, UTC day 20.
    const nearMidnight = Date.parse("2020-08-20T02:00:00.000Z");
    eq("a multi-week PR near midnight UTC -> the LOCAL day", ageLabel(nearMidnight, now), "Aug 19");
  }

  section("activityTags: NEW only, ACTIVE at the 3-comment threshold, STALE only");
  {
    const now = Date.parse("2020-08-27T16:00:00.000Z");
    const recent = (n) => Array.from({ length: n }, (_, i) => now - i * HR); // n comments in the last few hours
    const naTimes = [];

    // NEW only: opened 2h ago, no recent comments, updated just now.
    eq("NEW only", activityTags({ createdAtMs: now - 2 * HR, commentTimesMs: naTimes, updatedOn: new Date(now).toISOString() }, now), ["NEW"]);

    // ACTIVE needs 3+; created long ago and recently updated so neither NEW nor STALE.
    const oldCreated = now - 30 * DAY;
    const freshUpdated = new Date(now - 1 * HR).toISOString();
    eq("exactly 3 recent comments -> ACTIVE", activityTags({ createdAtMs: oldCreated, commentTimesMs: recent(3), updatedOn: freshUpdated }, now), ["ACTIVE"]);
    eq("exactly 2 recent comments -> not ACTIVE", activityTags({ createdAtMs: oldCreated, commentTimesMs: recent(2), updatedOn: freshUpdated }, now), []);

    // STALE only: created and last updated 20 days ago, no recent comments.
    const staleUpdated = new Date(now - 20 * DAY).toISOString();
    eq("STALE only", activityTags({ createdAtMs: now - 20 * DAY, commentTimesMs: naTimes, updatedOn: staleUpdated }, now), ["STALE"]);
  }

  section("activityTags: NEW+ACTIVE co-occur; the 24h comment boundary; the none case");
  {
    const now = Date.parse("2020-08-27T16:00:00.000Z");
    // A brand-new PR already buzzing: opened 3h ago with 3 recent comments.
    eq("NEW and ACTIVE together, in order", activityTags({ createdAtMs: now - 3 * HR, commentTimesMs: [now - 1 * HR, now - 2 * HR, now - 3 * HR], updatedOn: new Date(now).toISOString() }, now), ["NEW", "ACTIVE"]);

    // A comment exactly 24h old sits ON the inclusive [now-24h, now] boundary and counts.
    const boundary = [now - DAY, now - 1 * HR, now - 2 * HR];   // three, one exactly 24h old
    eq("a comment exactly 24h old counts (inclusive window)", activityTags({ createdAtMs: now - 30 * DAY, commentTimesMs: boundary, updatedOn: new Date(now - 1 * HR).toISOString() }, now), ["ACTIVE"]);
    // One tick older than 24h falls outside, dropping the count to 2 -> not ACTIVE.
    const justOutside = [now - DAY - 1, now - 1 * HR, now - 2 * HR];
    eq("a comment 24h+1ms old is outside the window", activityTags({ createdAtMs: now - 30 * DAY, commentTimesMs: justOutside, updatedOn: new Date(now - 1 * HR).toISOString() }, now), []);

    // None: middle-aged PR, quiet but not stale, no recent comments.
    eq("no tags", activityTags({ createdAtMs: now - 5 * DAY, commentTimesMs: [now - 5 * DAY], updatedOn: new Date(now - 5 * DAY).toISOString() }, now), []);
  }

  section("activityTags tolerates a missing/garbage PR without throwing");
  {
    const now = Date.parse("2020-08-27T16:00:00.000Z");
    eq("no fields -> no tags", activityTags({}, now), []);
    eq("undefined pr -> no tags", activityTags(undefined, now), []);
    eq("NaN createdAtMs is not NEW, garbage updatedOn is not STALE",
      activityTags({ createdAtMs: NaN, commentTimesMs: [], updatedOn: "nope" }, now), []);
  }

  done();
}

main();
