// The pure renderer (T06, DESIGN 2.2/2.4/2.5/2.n/3.3): the cache + view-state + a
// width + a row budget + `now` in, the exact lines to paint and the click hit-zones
// out. Every display rule is a millisecond test here rather than something only a
// person can confirm in a live WezTerm pane; run.sh separately greps the module for
// anything impure and asserts the coordinate/width contracts hold at several widths.

import { renderDashboard } from "../../bin/cockpit-bitbucket-model.mjs";
import { visibleLen } from "../../bin/cockpit-agenda-model.mjs";
import { ok, eq, section, done } from "./harness.mjs";

const ME = "{me}";
const NOW = 1_600_000_000_000;
const ESC = "\x1b[";

// --- fixtures ---------------------------------------------------------------

// A raw BitBucket PR, only the fields the model reads (matches model.test.mjs).
function raw({
  id = 1,
  title = "a title",
  authorUuid = "{author}",
  authorNick = "alice",
  updated = "2020-01-01T00:00:00+00:00",
  commentCount = 0,
  participants = [],
  reviewers = [],
  draft = false,
  repoName = "web",
} = {}) {
  return {
    id, title,
    author: { uuid: authorUuid, nickname: authorNick },
    updated_on: updated,
    comment_count: commentCount,
    participants,
    reviewers,
    draft,
    links: { html: { href: `https://bitbucket.org/acme/${repoName}/pull-requests/${id}` } },
    destination: { repository: { name: repoName } },
  };
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

const rowWith = (lines, needle) => lines.find((l) => plain(l).includes(needle));
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

  section("populated To-review row: repo, #, title, author, approvals, comments, buttons");
  {
    const pr = raw({
      id: 311, title: "Move the address form to the new hook",
      authorUuid: "{bob}", authorNick: "bob",
      reviewers: [{ uuid: ME }],
      participants: [{ approved: true, user: { uuid: "{carol}" } }],
      commentCount: 2,
    });
    const out = renderDashboard({
      width: 90, rows: 10, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg(),
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
    ok("Open button shown", t.includes("[Open]"));
    contracts("populated", out, 90, 10);
    zonesInBounds("populated", out, 90, 10);
  }

  section("a title too long for the column is truncated with an ellipsis, one line");
  {
    const long = "x".repeat(400);
    const pr = raw({ id: 7, title: long, reviewers: [{ uuid: ME }], authorUuid: "{o}" });
    const out = renderDashboard({
      width: 60, rows: 8, cache: cacheOf([pr]), view: view(), now: NOW, config: cfg(),
    });
    const row = rowWith(out.lines, "#7");
    ok("row is a single line, not wrapped", out.lines.filter((l) => plain(l).includes("xxxx")).length === 1);
    ok("title cut with an ellipsis", plain(row).includes("…"));
    contracts("long-title", out, 60, 8);
  }

  section("Mine tab: no author column, an Address button");
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
    ok("Mine row still has Open", plain(row).includes("[Open]"));
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

  section("overflow: the pager shows, only one page of rows, prev/next have zones");
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

    // Page 2 shows the remainder and clamps within range.
    const p2 = renderDashboard({
      width: 90, rows: 7, cache: cacheOf(prs),
      view: view({ page: { toReview: 2, mine: 1 } }), now: NOW, config: cfg(),
    });
    ok("page 2 shows a later PR", !!rowWith(p2.lines, `#${prs.length}`));
  }

  section("every tab and button in the output has a matching hit-zone at its coordinates");
  {
    const prs = [
      raw({ id: 10, reviewers: [{ uuid: ME }], authorUuid: "{o}", authorNick: "otto" }),
      raw({ id: 11, reviewers: [{ uuid: ME }], authorUuid: "{p}", authorNick: "pia" }),
    ];
    const out = renderDashboard({
      width: 100, rows: 10, cache: cacheOf(prs), view: view(), now: NOW, config: cfg(),
    });
    // Tabs.
    const tr = zoneFor(out.hitZones, "bb-tab:toReview");
    const mn = zoneFor(out.hitZones, "bb-tab:mine");
    ok("toReview tab zone sits on its label",
      !!tr && visibleAt(out.lines[tr.y - 1], tr.x0, tr.x1) === "To review · 2");
    ok("mine tab zone sits on its label",
      !!mn && visibleAt(out.lines[mn.y - 1], mn.x0, mn.x1) === "Mine · 0");
    // Buttons, per PR.
    for (const id of [10, 11]) {
      const rev = zoneFor(out.hitZones, `bb-review:web/${id}`);
      const open = zoneFor(out.hitZones, `bb-open:web/${id}`);
      ok(`#${id} Review zone sits on [Review]`,
        !!rev && visibleAt(out.lines[rev.y - 1], rev.x0, rev.x1) === "[Review]");
      ok(`#${id} Open zone sits on [Open]`,
        !!open && visibleAt(out.lines[open.y - 1], open.x0, open.x1) === "[Open]");
    }
    zonesInBounds("zones-coord", out, 100, 10);
  }

  section("Mine buttons carry the address verb, coordinates matched");
  {
    const pr = raw({ id: 20, authorUuid: ME, authorNick: "me" });
    const out = renderDashboard({
      width: 100, rows: 8, cache: cacheOf([pr]), view: view({ tab: "mine" }), now: NOW, config: cfg(),
    });
    const addr = zoneFor(out.hitZones, "bb-address:web/20");
    ok("address zone sits on [Address]",
      !!addr && visibleAt(out.lines[addr.y - 1], addr.x0, addr.x1) === "[Address]");
    ok("no review verb on the Mine tab", !zoneFor(out.hitZones, "bb-review:web/20"));
  }

  section("output is exactly `rows` lines and within width at several widths");
  {
    const prs = [];
    for (let i = 1; i <= 6; i++) prs.push(raw({ id: i, reviewers: [{ uuid: ME }], authorUuid: "{o}", title: "a reasonably long pull request title here" }));
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
    // The daemon never prunes a removed repo's entry (FINDINGS 2026-09-05); the
    // renderer must key off the config, so `gone` never surfaces.
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

  done();
}

main();
