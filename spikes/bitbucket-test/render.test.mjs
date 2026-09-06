// The pure renderer (DESIGN 2.2/2.4/2.5/2.n/3.3, extended by the two-line-rows plan
// bitbucket-dashboard-ux T03): the cache + view-state + a width + a row budget + `now`
// (+ an optional emphasis) in, the exact lines to paint and the click hit-zones out.
// Every display rule is a millisecond test here rather than something only a person can
// confirm in a live WezTerm pane; run.sh separately greps the module for anything
// impure and asserts the coordinate/width contracts hold at several widths.

import { renderDashboard, verbAt } from "../../bin/cockpit-bitbucket-model.mjs";
import { visibleLen } from "../../bin/cockpit-agenda-model.mjs";
import { ok, eq, section, done } from "./harness.mjs";

const ME = "{me}";
const NOW = 1_600_000_000_000;
const ESC = "\x1b[";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

// --- fixtures ---------------------------------------------------------------

// A raw BitBucket PR, only the fields the model reads (matches model.test.mjs). Line
// two's inputs are opt-in: `created` (age + [NEW]), `commentTimes` (an ISO per comment,
// for [ACTIVE]), `sourceBranch`/`destBranch` (the branch group), `diffstat` (the file
// and +/- counts). Left off, a row draws an empty second line -- exactly the unfetched
// case. `updated` defaults RECENT so a default row is not spuriously [STALE].
function raw({
  id = 1,
  title = "a title",
  authorUuid = "{author}",
  authorNick = "alice",
  updated = iso(NOW - HOUR),
  created = null,
  commentTimes = [],
  commentCount = 0,
  participants = [],
  reviewers = [],
  draft = false,
  repoName = "web",
  sourceBranch = null,
  destBranch = null,
  diffstat = null,
} = {}) {
  const pr = {
    id, title,
    author: { uuid: authorUuid, nickname: authorNick },
    updated_on: updated,
    comment_count: commentCount,
    comments: commentTimes.map((t) => ({ user: { uuid: "{c}" }, created_on: t })),
    participants,
    reviewers,
    draft,
    links: { html: { href: `https://bitbucket.org/acme/${repoName}/pull-requests/${id}` } },
    destination: { repository: { name: repoName } },
  };
  if (created) pr.created_on = created;
  if (sourceBranch != null || destBranch != null) {
    pr.source = { branch: { name: sourceBranch || "" } };
    pr.destination.branch = { name: destBranch || "" };
  }
  if (diffstat) pr.diffstatSummary = diffstat;
  return pr;
}

const cfg = (over = {}) => ({ key: "e:tok", workspace: "acme", repos: ["web"], team: [], ...over });
const view = (over = {}) => ({ tab: "toReview", page: { toReview: 1, mine: 1 }, ...over });

// A cache of one repo. `error`/`fetchedAt` let a case exercise the unhappy paths.
function cacheOf(prs, { meUuid = ME, slug = "web", fetchedAt = NOW, error = null } = {}) {
  return { meUuid, repos: { [slug]: { fetchedAt, prs, error } } };
}

// The plain text a line draws, with the ANSI stripped.
const plain = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");

// The plain text drawn in the 1-indexed visible column range [x0, x1] of a line --
// what a click at those columns would be sitting on. Escapes are skipped and do not
// advance the column, so this counts exactly what `visibleLen`/`pad`/`clip` count.
function visibleAt(line, x0, x1) {
  let out = "";
  let col = 1;
  for (let i = 0; i < line.length; ) {
    const esc = /^\x1b\[[0-9;]*m/.exec(line.slice(i));
    if (esc) { i += esc[0].length; continue; }
    if (col >= x0 && col <= x1) out += line[i];
    col++; i++;
  }
  return out;
}

// Whether the SGR underline attribute (4) is active over EVERY visible column of a
// line. This is the real separator check (DESIGN 2.6, FINDINGS 2026-09-06): the model's
// helpers close with 0m, which clears underline, so a naive single wrap would go dark
// after the first coloured segment. Walk the SGR state and demand underline never lapses
// under a visible glyph.
function underlineHoldsThroughout(line) {
  let underline = false;
  for (let i = 0; i < line.length; ) {
    const esc = /^\x1b\[([0-9;]*)m/.exec(line.slice(i));
    if (esc) {
      const codes = esc[1] === "" ? [0] : esc[1].split(";").map(Number);
      for (const c of codes) {
        if (c === 0 || c === 24) underline = false;
        else if (c === 4) underline = true;
      }
      i += esc[0].length;
      continue;
    }
    if (!underline) return false;   // a visible glyph with no underline under it
    i++;
  }
  return true;
}

const rowWith = (lines, needle) => lines.find((l) => plain(l).includes(needle));
const rowIndex = (lines, needle) => lines.findIndex((l) => plain(l).includes(needle));
const zoneFor = (zones, verb) => zones.find((z) => z.verb === verb);

// Every render must honour the two contracts, whatever the state: exactly `rows`
// lines, and no line wider than `width`. Asserted on each call so no case forgets.
function contracts(name, out, w, n) {
  eq(`${name}: exactly ${n} lines`, out.lines.length, n);
  const overrun = out.lines.filter((l) => visibleLen(l) > w).length;
  ok(`${name}: no line exceeds width ${w}`, overrun === 0, `${overrun} line(s) too wide`);
}

// Every zone points at a slot that is actually inside the returned frame.
function zonesInBounds(name, out, w, n) {
  const bad = out.hitZones.filter((z) =>
    !(z.y >= 1 && z.y <= n && z.x0 >= 1 && z.x1 <= w && z.x1 >= z.x0));
  ok(`${name}: all zones in bounds`, bad.length === 0, JSON.stringify(bad));
}

// The second line of the PR whose line one holds `needle` (the next line down).
function lineTwoOf(lines, needle) {
  const i = rowIndex(lines, needle);
  return i >= 0 && i + 1 < lines.length ? lines[i + 1] : "";
}

function main() {
  section("unconfigured: any missing setting shows the greeting, no table");
  {
    for (const missing of [{ key: null }, { workspace: null }, { repos: [] }]) {
      const out = renderDashboard({
        width: 90, rows: 12, cache: cacheOf([]), view: view(),
        now: NOW, config: cfg(missing),
      });
      const text = out.lines.map(plain).join("\n");
      ok(`missing ${Object.keys(missing)[0]}: greeting names config bitbucket-key`,
        text.includes("config bitbucket-key"));
      ok(`missing ${Object.keys(missing)[0]}: no table drawn`,
        !text.includes("To review ·") && !text.includes("[Review]") && !text.includes("[Address]"));
      contracts(`unconfigured/${Object.keys(missing)[0]}`, out, 90, 12);
    }
    // No config object at all is unconfigured, not a throw.
    const out = renderDashboard({ width: 90, rows: 6, cache: cacheOf([]), view: view(), now: NOW });
    ok("undefined config -> greeting", out.lines.map(plain).join("\n").includes("config bitbucket-key"));
  }

  section("whole-dashboard auth error renders the expired instruction");
  {
    const out = renderDashboard({
      width: 90, rows: 10,
      cache: cacheOf([], { error: { kind: "auth" } }),
      view: view(), now: NOW, config: cfg(),
    });
    ok("expired line present",
      out.lines.some((l) => plain(l).includes("sign-in expired · config bitbucket-key")));
    ok("no table under an expired token",
      !out.lines.some((l) => plain(l).includes("[Review]")));
    contracts("expired", out, 90, 10);
  }

  section("populated To-review row: line one columns + primary button, no [Open] button");
  {
    const pr = raw({
      id: 311, title: "Move the address form to the new hook",
      authorUuid: "{bob}", authorNick: "bob",
      reviewers: [{ uuid: ME }],
      participants: [{ approved: true, user: { uuid: "{carol}" } }],
      commentCount: 2,
      created: iso(NOW - 3 * HOUR),
      sourceBranch: "fix/address-hook", destBranch: "main",
      diffstat: { files: 4, added: 62, removed: 9 },
    });
    const out = renderDashboard({
      width: 100, rows: 10, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg(),
    });
    const row = rowWith(out.lines, "#311");
    ok("row exists", !!row);
    const t = plain(row);
    ok("repo slug shown", t.includes("web"));
    ok("PR number shown", t.includes("#311"));
    ok("title shown", t.includes("Move the address form"));
    ok("author shown (To review has an author column)", t.includes("bob"));
    ok("approval count (1) shown", t.includes("1"));
    ok("comment count (2) shown", t.includes("2"));
    ok("Review button shown", t.includes("[Review]"));
    ok("the [Open] button is gone (DESIGN 3)", !out.lines.some((l) => plain(l).includes("[Open]")));
    // Line two: age, branch, diff size.
    const l2 = plain(lineTwoOf(out.lines, "#311"));
    ok("line two shows the age", l2.includes("3h"));
    ok("line two shows the [NEW] tag", l2.includes("[NEW]"));
    ok("line two shows the branch", l2.includes("fix/address-hook → main"));
    ok("line two shows the file count", l2.includes("4 files"));
    ok("line two shows the additions", l2.includes("+62"));
    ok("line two shows the deletions", l2.includes("−9"));
    contracts("populated", out, 100, 10);
    zonesInBounds("populated", out, 100, 10);
  }

  section("a title too long for the column is truncated with an ellipsis, one line");
  {
    const long = "x".repeat(400);
    const pr = raw({ id: 7, title: long, reviewers: [{ uuid: ME }], authorUuid: "{o}" });
    const out = renderDashboard({
      width: 60, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg(),
    });
    const row = rowWith(out.lines, "#7");
    ok("title is on a single line, not wrapped", out.lines.filter((l) => plain(l).includes("xxxx")).length === 1);
    ok("title cut with an ellipsis", plain(row).includes("…"));
    contracts("long-title", out, 60, 8);
  }

  section("Mine tab: no author column, an Address button, no [Open]");
  {
    const pr = raw({ id: 5, authorUuid: ME, authorNick: "me", title: "my own change" });
    const out = renderDashboard({
      width: 90, rows: 10, cache: cacheOf([pr]), view: view({ tab: "mine" }),
      now: NOW, config: cfg(),
    });
    const header = out.lines.map(plain).find((l) => l.includes("title"));
    ok("Mine header has no author column", !!header && !header.includes("author"));
    const row = rowWith(out.lines, "#5");
    ok("Mine row has an Address button", plain(row).includes("[Address]"));
    ok("Mine row has no [Open] button", !out.lines.some((l) => plain(l).includes("[Open]")));
    ok("Mine row has no Review button", !plain(row).includes("[Review]"));
    contracts("mine", out, 90, 10);
  }

  section("a zero count is a dim · , a non-zero is the number");
  {
    const pr = raw({ id: 9, reviewers: [{ uuid: ME }], authorUuid: "{o}", commentCount: 5 });
    // approvals 0 (no approved participants), comments 5.
    const out = renderDashboard({
      width: 90, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg(),
    });
    const row = rowWith(out.lines, "#9");
    ok("a lone zero count renders as a dim ·", row.includes(`${ESC}2m·${ESC}0m`));
    ok("a non-zero count renders as its number", plain(row).includes("5"));
  }

  section("an empty tab renders the 'nothing waiting' line, not a bare header");
  {
    const out = renderDashboard({
      width: 90, rows: 8, cache: cacheOf([]), view: view(), now: NOW, config: cfg(),
    });
    const text = out.lines.map(plain).join("\n");
    ok("empty To-review shows the reassuring line", text.includes("nothing waiting on you"));
    ok("no column header over an empty tab", !text.includes("title"));
    ok("no button rows", !text.includes("[Review]"));
    contracts("empty", out, 90, 8);

    const mineOut = renderDashboard({
      width: 90, rows: 8, cache: cacheOf([]), view: view({ tab: "mine" }), now: NOW, config: cfg(),
    });
    ok("empty Mine has its own line", mineOut.lines.map(plain).join("\n").includes("nothing of yours open"));
  }

  section("an offline/stale cache adds exactly one 'last updated' line and still draws rows");
  {
    const pr = raw({ id: 40, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "kept from last fetch" });
    const out = renderDashboard({
      width: 90, rows: 10,
      cache: cacheOf([pr], { fetchedAt: NOW - 22 * 60000, error: { kind: "transient" } }),
      view: view(), now: NOW, config: cfg(),
    });
    const stale = out.lines.filter((l) => /last updated .*offline/.test(plain(l)));
    eq("exactly one offline line", stale.length, 1);
    ok("age reads 22m ago", plain(stale[0]).includes("22m ago"));
    ok("the last good rows are still drawn", !!rowWith(out.lines, "#40"));
    contracts("offline", out, 90, 10);
  }

  section("a per-repo error adds a per-repo line without blanking the others");
  {
    const good = raw({ id: 1, reviewers: [{ uuid: ME }], authorUuid: "{o}", repoName: "web" });
    const cache = {
      meUuid: ME,
      repos: {
        web: { fetchedAt: NOW, prs: [good], error: null },
        api: { fetchedAt: NOW - 60000, prs: [], error: { kind: "transient" } },
      },
    };
    const out = renderDashboard({
      width: 90, rows: 12, cache, view: view(), now: NOW, config: cfg({ repos: ["web", "api"] }),
    });
    ok("the failing repo names itself", out.lines.some((l) => /api\b.*couldn't fetch/.test(plain(l))));
    ok("the healthy repo's rows still draw", !!rowWith(out.lines, "#1"));
    ok("not the whole-dashboard aggregate line",
      !out.lines.some((l) => /last updated .*offline/.test(plain(l))));
    contracts("per-repo", out, 90, 12);
  }

  section("overflow: the pager shows, only one page of two-line rows, prev/next have zones");
  {
    const prs = [];
    for (let i = 1; i <= 8; i++) prs.push(raw({ id: i, reviewers: [{ uuid: ME }], authorUuid: "{o}" }));
    const out = renderDashboard({
      width: 90, rows: 7, cache: cacheOf(prs), view: view(), now: NOW, config: cfg(),
    });
    const shown = out.lines.filter((l) => /#\d/.test(plain(l))).length;
    ok("fewer than all 8 rows on one page", shown < 8 && shown > 0);
    ok("a pager line is drawn", out.lines.some((l) => /\d\/\d/.test(plain(l))));
    ok("prev has a zone", !!zoneFor(out.hitZones, "bb-page:prev"));
    ok("next has a zone", !!zoneFor(out.hitZones, "bb-page:next"));
    contracts("overflow", out, 90, 7);
    zonesInBounds("overflow", out, 90, 7);

    // Two lines per row -> two PRs a page here; page 2 shows the 3rd, not the 1st.
    const p2 = renderDashboard({
      width: 90, rows: 7, cache: cacheOf(prs),
      view: view({ page: { toReview: 2, mine: 1 } }), now: NOW, config: cfg(),
    });
    ok("page 2 shows the 3rd PR", !!rowWith(p2.lines, "#3"));
    ok("page 2 has dropped the 1st PR", !rowWith(p2.lines, "#1"));
  }

  section("every tab and the primary button in the output has a matching hit-zone");
  {
    const prs = [
      raw({ id: 10, reviewers: [{ uuid: ME }], authorUuid: "{o}", authorNick: "otto" }),
      raw({ id: 11, reviewers: [{ uuid: ME }], authorUuid: "{p}", authorNick: "pia" }),
    ];
    const out = renderDashboard({
      width: 100, rows: 12, cache: cacheOf(prs), view: view(), now: NOW, config: cfg(),
    });
    // Tabs.
    const tr = zoneFor(out.hitZones, "bb-tab:toReview");
    const mn = zoneFor(out.hitZones, "bb-tab:mine");
    ok("toReview tab zone sits on its label",
      !!tr && visibleAt(out.lines[tr.y - 1], tr.x0, tr.x1) === "To review · 2");
    ok("mine tab zone sits on its label",
      !!mn && visibleAt(out.lines[mn.y - 1], mn.x0, mn.x1) === "Mine · 0");
    // Per PR: the primary button sits on [Review]; the open zone spans line one from
    // column 1 to just before the button, on the SAME line.
    for (const id of [10, 11]) {
      const rev = zoneFor(out.hitZones, `bb-review:web/${id}`);
      const open = zoneFor(out.hitZones, `bb-open:web/${id}`);
      ok(`#${id} Review zone sits on [Review]`,
        !!rev && visibleAt(out.lines[rev.y - 1], rev.x0, rev.x1) === "[Review]");
      ok(`#${id} open zone shares line one with the button`, !!open && open.y === rev.y);
      eq(`#${id} open zone starts at column 1`, open.x0, 1);
      eq(`#${id} open zone stops just before the button`, open.x1, rev.x0 - 1);
      ok(`#${id} open zone covers the number and title`,
        visibleAt(out.lines[open.y - 1], open.x0, open.x1).includes(`#${id}`));
    }
    zonesInBounds("zones-coord", out, 100, 12);
  }

  section("Mine buttons carry the address verb; the open zone opens the PR");
  {
    const pr = raw({ id: 20, authorUuid: ME, authorNick: "me" });
    const out = renderDashboard({
      width: 100, rows: 8, cache: cacheOf([pr]), view: view({ tab: "mine" }), now: NOW, config: cfg(),
    });
    const addr = zoneFor(out.hitZones, "bb-address:web/20");
    ok("address zone sits on [Address]",
      !!addr && visibleAt(out.lines[addr.y - 1], addr.x0, addr.x1) === "[Address]");
    ok("open zone still present on the Mine tab", !!zoneFor(out.hitZones, "bb-open:web/20"));
    ok("no review verb on the Mine tab", !zoneFor(out.hitZones, "bb-review:web/20"));
  }

  section("output is exactly `rows` lines and within width at several widths");
  {
    const prs = [];
    for (let i = 1; i <= 6; i++) prs.push(raw({
      id: i, reviewers: [{ uuid: ME }], authorUuid: "{o}",
      title: "a reasonably long pull request title here",
      created: iso(NOW - 3 * HOUR), sourceBranch: "feat/x", destBranch: "main",
      diffstat: { files: 3, added: 20, removed: 4 },
    }));
    // 30 is the narrow 75%-of-a-small-window case; 45/60/90/120 span up to a wide pane.
    for (const w of [30, 45, 60, 90, 120]) {
      for (const n of [4, 8, 14]) {
        const out = renderDashboard({
          width: w, rows: n, cache: cacheOf(prs), view: view(), now: NOW, config: cfg(),
        });
        contracts(`w=${w} n=${n}`, out, w, n);
        zonesInBounds(`w=${w} n=${n}`, out, w, n);
      }
    }
    // n=0 is a valid empty frame, not a throw.
    const zero = renderDashboard({ width: 90, rows: 0, cache: cacheOf(prs), view: view(), now: NOW, config: cfg() });
    eq("rows:0 -> no lines", zero.lines.length, 0);
    eq("rows:0 -> no zones", zero.hitZones.length, 0);
  }

  section("a de-watched repo's lingering cache entry is not drawn (iterate config.repos)");
  {
    const cache = {
      meUuid: ME,
      repos: {
        web: { fetchedAt: NOW, prs: [raw({ id: 1, reviewers: [{ uuid: ME }], authorUuid: "{o}" })], error: null },
        gone: { fetchedAt: NOW, prs: [raw({ id: 999, reviewers: [{ uuid: ME }], authorUuid: "{o}", repoName: "gone" })], error: null },
      },
    };
    const out = renderDashboard({
      width: 90, rows: 10, cache, view: view(), now: NOW, config: cfg({ repos: ["web"] }),
    });
    ok("watched repo's PR shows", !!rowWith(out.lines, "#1"));
    ok("de-watched repo's PR is absent", !rowWith(out.lines, "#999"));
  }

  section("renderDashboard reports the active tab's page count for the daemon's clamp");
  {
    const one = renderDashboard({ width: 90, rows: 10, cache: cacheOf([
      raw({ id: 1, reviewers: [{ uuid: ME }], authorUuid: "{o}" }),
    ]), view: view(), now: NOW, config: cfg() });
    eq("a tab that fits one page reports pages=1", one.pages, 1);

    const prs = [];
    for (let i = 1; i <= 8; i++) prs.push(raw({ id: i, reviewers: [{ uuid: ME }], authorUuid: "{o}" }));
    const many = renderDashboard({ width: 90, rows: 7, cache: cacheOf(prs), view: view(), now: NOW, config: cfg() });
    ok("an overflowing tab reports pages>1", many.pages > 1);
    ok("...matching the pager it drew", rowWith(many.lines, `1/${many.pages}`) !== undefined);

    const mine = renderDashboard({ width: 90, rows: 7, cache: cacheOf(prs), view: view({ tab: "mine" }), now: NOW, config: cfg() });
    eq("the empty active tab reports pages=1", mine.pages, 1);

    const off = renderDashboard({ width: 90, rows: 8, cache: cacheOf([]), view: view(), now: NOW, config: cfg({ key: null }) });
    eq("unconfigured -> pages=1", off.pages, 1);
  }

  // === the two-line-rows plan (T03) ==========================================

  section("line two draws tags · age · branch, diff on the right, in order");
  {
    const pr = raw({
      id: 50, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "a change",
      created: iso(NOW - 3 * HOUR),                    // -> 3h, and [NEW]
      sourceBranch: "feat/telemetry", destBranch: "main",
      diffstat: { files: 3, added: 20, removed: 4 },
    });
    const out = renderDashboard({ width: 120, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    const l2 = plain(lineTwoOf(out.lines, "#50"));
    // Order on the left: the tag, then the age, then the branch.
    const iTag = l2.indexOf("[NEW]");
    const iAge = l2.indexOf("3h");
    const iBranch = l2.indexOf("feat/telemetry → main");
    ok("tags before age before branch", iTag >= 0 && iTag < iAge && iAge < iBranch);
    ok("the left groups are joined by ·", /\[NEW\]\s+·\s+3h\s+·\s+feat\/telemetry → main/.test(l2));
    ok("the diff sits to the right of the branch", l2.indexOf("3 files") > iBranch);
    ok("additions then deletions", l2.indexOf("+20") < l2.indexOf("−4"));
  }

  section("line two: an unfetched diff draws no file/line items (no zeros)");
  {
    const pr = raw({
      id: 51, reviewers: [{ uuid: ME }], authorUuid: "{o}",
      created: iso(NOW - 5 * HOUR), sourceBranch: "feat/x", destBranch: "main",
      // no diffstat -> diff is null
    });
    const out = renderDashboard({ width: 120, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    const l2 = plain(lineTwoOf(out.lines, "#51"));
    ok("no 'files' when the diff was never fetched", !l2.includes("files"));
    ok("no zeroed +/- either", !l2.includes("+0") && !l2.includes("−0") && !l2.includes("+") && !l2.includes("−"));
    ok("age and branch still draw", l2.includes("5h") && l2.includes("feat/x → main"));
  }

  section("line two: no leading · when there are no tags");
  {
    // Old PR (no [NEW]), quiet (no [ACTIVE]), recently touched (no [STALE]) -> zero tags.
    const pr = raw({
      id: 52, reviewers: [{ uuid: ME }], authorUuid: "{o}",
      created: iso(NOW - 30 * DAY), updated: iso(NOW - 2 * DAY),
      sourceBranch: "chore/y", destBranch: "main",
    });
    const out = renderDashboard({ width: 120, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    const l2 = plain(lineTwoOf(out.lines, "#52")).replace(/\s+$/, "");
    ok("no tag was drawn", !l2.includes("["));
    ok("line two does not start with a dangling ·", !l2.trimStart().startsWith("·"));
    ok("it opens with the age (a date), then the branch",
      /^\s*[A-Z][a-z]{2} \d+\s+·\s+chore\/y → main$/.test(l2));
  }

  section("line two: an empty age (absent created_on) makes no doubled/leading separator");
  {
    // 3 recent comments -> [ACTIVE]; no created_on -> age "". Left = [ACTIVE] · branch.
    const pr = raw({
      id: 53, reviewers: [{ uuid: ME }], authorUuid: "{o}",
      commentTimes: [iso(NOW - HOUR), iso(NOW - 2 * HOUR), iso(NOW - 3 * HOUR)],
      sourceBranch: "fix/z", destBranch: "main",
    });
    const out = renderDashboard({ width: 120, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    const l2 = plain(lineTwoOf(out.lines, "#53")).replace(/\s+$/, "");
    ok("the ACTIVE tag drew", l2.includes("[ACTIVE]"));
    ok("no doubled separator around a missing age", !/·\s+·/.test(l2));
    ok("tag joins straight to the branch", /\[ACTIVE\]\s+·\s+fix\/z → main/.test(l2));
  }

  section("drop order: branch, then +/-, then file count; age + tags survive");
  {
    const pr = raw({
      id: 60, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "t",
      created: iso(NOW - 3 * HOUR),                         // [NEW] + "3h"
      sourceBranch: "feature/a-deliberately-long-branch-name", destBranch: "main",
      diffstat: { files: 7, added: 123, removed: 45 },
    });
    const at = (w) => plain(lineTwoOf(
      renderDashboard({ width: w, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() }).lines,
      "#60"));
    const has = (s, needle) => s.includes(needle);

    // Widest: everything present.
    const wide = at(120);
    ok("wide: branch, +/-, files all present",
      has(wide, "→ main") && has(wide, "+123") && has(wide, "7 files"));

    // Across a shrinking sweep the invariants must hold: a present item implies every
    // later-dropped item is also present (branch drops first, then +/-, then files),
    // and the age + the tag never drop.
    for (const w of [120, 100, 90, 80, 72, 64, 56, 50, 46, 42]) {
      const s = at(w);
      const branch = has(s, "→ main");
      const pm = has(s, "+123");
      const files = has(s, "7 files");
      ok(`w=${w}: age + tag kept`, has(s, "3h") && has(s, "[NEW]"));
      ok(`w=${w}: branch present => +/- present`, !branch || pm);
      ok(`w=${w}: +/- present => files present`, !pm || files);
    }

    // A width just wide enough for the indent + "[NEW] · 3h" drops all three diff/branch
    // items but keeps the age and tag whole (no final clip).
    const probe = renderDashboard({ width: 120, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    const indent = plain(lineTwoOf(probe.lines, "#60")).match(/^ */)[0].length;
    const narrow = indent + visibleLen("[NEW]") + 3 + visibleLen("3h");   // "[NEW] · 3h"
    const s = at(narrow);
    ok(`narrow (${narrow}): tags + age survive`, s.includes("[NEW]") && s.includes("3h"));
    ok(`narrow (${narrow}): branch/+-/files all dropped`,
      !s.includes("→ main") && !s.includes("+123") && !s.includes("7 files"));

    // A very narrow pane still returns the frame and clips cleanly.
    const tiny = renderDashboard({ width: 16, rows: 6, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    contracts("drop-order-tiny", tiny, 16, 6);
    zonesInBounds("drop-order-tiny", tiny, 16, 6);
  }

  section("the row separator is a dim underline that spans line two and adds no line");
  {
    const pr = raw({
      id: 70, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "sep",
      created: iso(NOW - 3 * HOUR), sourceBranch: "feat/x", destBranch: "main",
      diffstat: { files: 2, added: 9, removed: 1 },
    });
    const out = renderDashboard({ width: 90, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    const i = rowIndex(out.lines, "#70");
    const l2 = out.lines[i + 1];
    ok("line two carries an underline (a 4m appears)", l2.includes(`${ESC}4m`));
    ok("the underline holds under every visible glyph, past the coloured segments",
      underlineHoldsThroughout(l2));
    ok("line two draws no PR number (it is the second line, not a new row)", !plain(l2).includes("#70"));
    // Exactly two lines for one PR: tabs (1) + header (1) + line one (1) + line two (1),
    // then blanks. The separator steals no vertical room.
    eq("one PR occupies line one then line two, nothing more", i, 2);   // 0:tabs 1:header 2:l1 3:l2
    for (let k = 4; k < out.lines.length; k++) eq(`line ${k} is blank padding`, plain(out.lines[k]), "");
  }

  section("pagination: two-line rows halve the page; the pager steals exactly one line");
  {
    const prs = [];
    for (let i = 1; i <= 20; i++) prs.push(raw({ id: i, reviewers: [{ uuid: ME }], authorUuid: "{o}" }));
    // rows 12 -> avail 10 -> 5 PRs, but overflow adds a pager -> avail-1=9 -> 4 PRs/page.
    const out = renderDashboard({ width: 90, rows: 12, cache: cacheOf(prs), view: view(), now: NOW, config: cfg() });
    const shown = out.lines.filter((l) => /#\d/.test(plain(l))).length;
    eq("four two-line PRs fit a 12-row pane with a pager", shown, 4);
    ok("a pager is drawn", out.lines.some((l) => /\d\/\d/.test(plain(l))));
    eq("five pages of twenty", out.pages, 5);
    contracts("pagination-20", out, 90, 12);

    // Page 2 shows PRs 5..8.
    const p2 = renderDashboard({ width: 90, rows: 12, cache: cacheOf(prs), view: view({ page: { toReview: 2, mine: 1 } }), now: NOW, config: cfg() });
    ok("page 2 opens at #5", !!rowWith(p2.lines, "#5"));
    ok("page 2 has dropped #1", !rowWith(p2.lines, "#1"));

    // A remembered page far past the shrunk end falls back to page 1.
    const p99 = renderDashboard({ width: 90, rows: 12, cache: cacheOf(prs), view: view({ page: { toReview: 99, mine: 1 } }), now: NOW, config: cfg() });
    ok("an out-of-range page falls back to page 1", !!rowWith(p99.lines, "#1"));
  }

  section("verbAt: the primary button and the open zone resolve on line one, line two is null");
  {
    const pr = raw({ id: 80, reviewers: [{ uuid: ME }], authorUuid: "{o}", authorNick: "otto",
      created: iso(NOW - 3 * HOUR), sourceBranch: "feat/x", destBranch: "main" });
    const out = renderDashboard({ width: 100, rows: 10, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    const rev = zoneFor(out.hitZones, "bb-review:web/80");
    const open = zoneFor(out.hitZones, "bb-open:web/80");

    eq("a click on the button -> the spawn verb", verbAt(out.hitZones, rev.x0, rev.y), "bb-review:web/80");
    eq("...anywhere across the button label", verbAt(out.hitZones, rev.x1, rev.y), "bb-review:web/80");
    eq("a click on column 1 of line one -> bb-open", verbAt(out.hitZones, 1, rev.y), "bb-open:web/80");
    eq("the column just before the button -> bb-open (the gap opens too)",
      verbAt(out.hitZones, rev.x0 - 1, rev.y), "bb-open:web/80");
    eq("the column past the button -> null", verbAt(out.hitZones, rev.x1 + 1, rev.y), null);
    eq("line two carries no hit-zone", verbAt(out.hitZones, 1, rev.y + 1), null);
    eq("the open zone stops right before the button", open.x1, rev.x0 - 1);
  }

  section("a hit-zone clipped off a narrow pane is dropped");
  {
    // 12 columns cannot hold #id + title + [Review]: the button overruns the edge and
    // its zone must not survive; the open zone (col 1..just before it) still can.
    const pr = raw({ id: 5, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "some title" });
    const out = renderDashboard({ width: 12, rows: 6, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() });
    ok("the off-edge primary button zone is dropped", !zoneFor(out.hitZones, "bb-review:web/5"));
    zonesInBounds("clipped", out, 12, 6);
    contracts("clipped", out, 12, 6);
  }

  section("emphasis: press reverse-videos the button; hover brightens it");
  {
    const pr = raw({ id: 90, reviewers: [{ uuid: ME }], authorUuid: "{o}", created: iso(NOW - 3 * HOUR) });
    const base = { width: 100, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() };

    const press = renderDashboard({ ...base, emphasis: { verb: "bb-review:web/90", state: "press" } });
    ok("press wraps [Review] in reverse video (7m)",
      rowWith(press.lines, "#90").includes(`${ESC}7m[Review]`));

    const hover = renderDashboard({ ...base, emphasis: { verb: "bb-review:web/90", state: "hover" } });
    ok("hover brightens [Review] (bold + cyan)",
      rowWith(hover.lines, "#90").includes(`${ESC}1m${ESC}36m[Review]`));
  }

  section("emphasis: the open zone reacts like a link (press reverses the span, hover underlines the title)");
  {
    const pr = raw({ id: 91, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "linky", created: iso(NOW - 3 * HOUR) });
    const base = { width: 100, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() };

    const press = renderDashboard({ ...base, emphasis: { verb: "bb-open:web/91", state: "press" } });
    const pl = rowWith(press.lines, "#91");
    ok("press opens the line-one span with reverse video", pl.startsWith(`${ESC}7m`));
    ok("...and the button after it is not reversed (still cyan)", pl.includes(`${ESC}36m[Review]`));

    const hover = renderDashboard({ ...base, emphasis: { verb: "bb-open:web/91", state: "hover" } });
    ok("hover underlines the title in cyan (the link cue)",
      rowWith(hover.lines, "#91").includes(`${ESC}4m${ESC}36mlinky`));
  }

  section("emphasis: an off-page verb is a no-op; no emphasis reproduces the rest bytes");
  {
    const pr = raw({ id: 92, reviewers: [{ uuid: ME }], authorUuid: "{o}", created: iso(NOW - 3 * HOUR),
      sourceBranch: "feat/x", destBranch: "main", diffstat: { files: 1, added: 2, removed: 3 } });
    const base = { width: 100, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg() };

    const rest = renderDashboard({ ...base });
    const none = renderDashboard({ ...base, emphasis: null });
    eq("emphasis:null is byte-identical to no emphasis", none.lines.join("\n"), rest.lines.join("\n"));

    const offPage = renderDashboard({ ...base, emphasis: { verb: "bb-open:web/999", state: "press" } });
    eq("an emphasis verb that matches no zone changes nothing",
      offPage.lines.join("\n"), rest.lines.join("\n"));
  }

  section("colours are pinned to the prototype (DESIGN 2.7): each element's SGR code");
  {
    // A NEW + ACTIVE PR (both tags co-occur), with a branch and a diff.
    const busy = raw({
      id: 100, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "busy",
      created: iso(NOW - 3 * HOUR),
      commentTimes: [iso(NOW - HOUR), iso(NOW - 2 * HOUR), iso(NOW - 3 * HOUR)],
      sourceBranch: "feat/x", destBranch: "main",
      diffstat: { files: 3, added: 15, removed: 9 },
    });
    const out = renderDashboard({ width: 120, rows: 8, cache: cacheOf([busy]), view: view(), now: NOW, config: cfg() });
    const l1 = rowWith(out.lines, "#100");
    const l2 = lineTwoOf(out.lines, "#100");
    ok("#id is cyan (36)", l1.includes(`${ESC}36m#100`));
    ok("the primary button is cyan (36)", l1.includes(`${ESC}36m[Review]`));
    ok("[NEW] is green (32)", l2.includes(`${ESC}32m[NEW]`));
    ok("[ACTIVE] is amber (33)", l2.includes(`${ESC}33m[ACTIVE]`));
    ok("additions are green (32)", l2.includes(`${ESC}32m+15`));
    ok("deletions are red (31)", l2.includes(`${ESC}31m−9`));
    ok("the age is dim (2)", l2.includes(`${ESC}2m3h`));
    ok("the branch is dim (2)", l2.includes(`${ESC}2mfeat/x → main`));
    ok("the file count is dim (2)", l2.includes(`${ESC}2m3 files`));

    // [STALE] is grey/dim, on its own PR (STALE excludes NEW/ACTIVE by construction).
    const stale = raw({
      id: 101, reviewers: [{ uuid: ME }], authorUuid: "{o}",
      created: iso(NOW - 30 * DAY), updated: iso(NOW - 20 * DAY),
    });
    const so = renderDashboard({ width: 120, rows: 8, cache: cacheOf([stale]), view: view(), now: NOW, config: cfg() });
    ok("[STALE] is dim (2)", lineTwoOf(so.lines, "#101").includes(`${ESC}2m[STALE]`));
  }

  done();
}

main();
