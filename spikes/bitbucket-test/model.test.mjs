// The pure model: normalize a raw PR, classify into the two tabs, sort, paginate
// (DESIGN 2.3, 2.5, settled 2026-09-05). Pure functions of their arguments, so a
// full sweep of the behaviour runs in milliseconds off fixtures -- no clock, no
// network, no state dir touched. The bash run.sh separately greps the module for
// anything impure.

import { normalizePR, classify, paginate } from "../../bin/cockpit-bitbucket-model.mjs";
import { ok, eq, section, done } from "./harness.mjs";

// A raw BitBucket PR, only the fields the model reads. The comments array is what
// the fetch layer attaches (decision A, DESIGN 2.9); a case sets only what it needs.
function rawPR({
  id = 1,
  title = "a title",
  authorUuid = "{author}",
  authorNick = "someone",
  updated = "2020-01-01T00:00:00.000000+00:00",
  participants,
  reviewers,
  commentCount = 0,
  comments = [],
  draft = false,
  repoName = "web",
} = {}) {
  const pr = {
    id,
    title,
    author: { uuid: authorUuid, nickname: authorNick },
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
  return pr;
}

// Comment fixtures for the unresolved-thread reduction.
const inlineOpen = (uuid) => ({ inline: { path: "a.js" }, user: { uuid }, resolution: null });
const inlineResolved = (uuid) => ({ inline: { path: "a.js" }, user: { uuid }, resolution: { type: "x" } });
const general = (uuid) => ({ user: { uuid } }); // no `inline` -> never counts
const reply = (uuid) => ({ inline: { path: "a.js" }, user: { uuid }, parent: { id: 99 } }); // a reply, not a root

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

  done();
}

main();
