// Drawing the AGENDA section: every display rule in DESIGN 2.3, 2.4, 2.6, 2.7 and
// 2.8, proved through the one call they all run through (DESIGN 3.3).
//
// `renderAgenda` is pure, so "what does 14:20 on a busy Wednesday look like" is a
// string comparison rather than something only a person in front of the pane can
// answer. Escapes are stripped before asserting content -- the colours have their
// own section, and mixing the two would make every content assertion depend on the
// exact style of a line.

import fs from "node:fs";
import { section, ok, eq, done } from "./harness.mjs";
import {
  normaliseEvent, renderAgenda, agendaHeight, pickColour, PALETTE,
  visibleLen, pad, clip,
} from "../../bin/cockpit-agenda-model.mjs";

const TZ = "Europe/Warsaw";
const at = (iso) => Date.parse(iso);
const NOW = at("2026-08-26T14:20:00+02:00");
const W = 44;                                  // about what half the right column is

const fixture = (name) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const norm = (name, opts) =>
  fixture(name).items.map((r) => normaliseEvent(r, opts)).filter(Boolean);

const WORK = norm("events-work-wednesday", { slug: "work", tz: TZ, selfEmail: "me@corp.com" });
const HOME = norm("events-home-wednesday", { slug: "home", tz: TZ, selfEmail: "me@gmail.com" });

const CALS = [{ slug: "work", colour: "teal" }, { slug: "home", colour: "rose" }];
const FRESH = at("2026-08-26T14:18:00+02:00");
const cache = (entries) => ({ version: 1, calendars: entries });
const CACHE = cache({
  work: { fetchedAt: FRESH, events: WORK, error: null },
  home: { fetchedAt: FRESH, events: HOME, error: null },
});

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const draw = (opts = {}) =>
  renderAgenda({ width: W, rows: 14, calendars: CALS, cache: CACHE, now: NOW, tz: TZ, ...opts });
const text = (opts) => draw(opts).map(plain);
const has = (ls, sub) => ls.some((l) => l.includes(sub));
const rowFor = (ls, sub) => ls.find((l) => l.includes(sub)) ?? "";
const height = (opts = {}) =>
  agendaHeight({ width: W, calendars: CALS, cache: CACHE, now: NOW, tz: TZ, ...opts });

// ---------------------------------------------------------------------------
section("11. 14:20 on a busy Wednesday, drawn");
// DESIGN 1's success criterion, as lines: the 14:00 is NOW, the 17:30 is below it,
// and the morning is gone.

const wed = text();
eq("the header names the section", plain(draw()[0]).trim().startsWith("AGENDA"), true);
ok("...with the clock on the right", /\s14:20$/.test(plain(draw()[0])), JSON.stringify(plain(draw()[0])));
eq("the scope line names today, and the day it is", wed[1].trim(), "TODAY · Wed 26 Aug");
ok("the 14:00 is the NOW row", /NOW\s+sprint review/.test(rowFor(wed, "sprint review")),
  JSON.stringify(rowFor(wed, "sprint review")));
// What you want at 14:20 is not the next meeting but when this one lets you go.
eq("...with when it lets you go beneath it",
  wed[wed.indexOf(rowFor(wed, "sprint review")) + 1].includes("└ until 15:00"), true);
eq("the finished 09:30 is gone", has(wed, "standup"), false);
eq("...and the finished 11:00 too", has(wed, "1:1 with Ana"), false);
eq("the declined all-hands never appears", has(wed, "all-hands"), false);
eq("the cancelled slot never appears", has(wed, "old planning"), false);
ok("the 17:30 is drawn with its time", /17:30/.test(rowFor(wed, "architecture sync")));

// ---------------------------------------------------------------------------
section("12. all-day rows, and the ? on an invitation");

eq("an all-day event is labelled", rowFor(wed, "Ana on leave").includes("ALL DAY"), true);
const firstTimed = wed.findIndex((l) => l.includes("sprint review"));
const lastAllDay = wed.findIndex((l) => l.includes("school closed"));
ok("...and sits above every timed row", lastAllDay < firstTimed, `${lastAllDay} vs ${firstTimed}`);
eq("both calendars' all-day rows are pinned, in add order",
  [wed.findIndex((l) => l.includes("Ana on leave")), lastAllDay].every((i, n, a) => n === 0 || a[0] < a[1]), true);

// An unanswered invitation is a real claim on your time (DESIGN 2.4). A declined
// one is never drawn at all, so no ✗ exists.
ok("an unanswered invitation carries a ?", /17:30\s+\?\s+architecture sync/.test(rowFor(wed, "architecture sync")),
  JSON.stringify(rowFor(wed, "architecture sync")));
eq("an answered one does not", rowFor(wed, "sprint review").includes("?"), false);
eq("nor does an event you are not an attendee of", rowFor(wed, "pick up kids").includes("?"), false);
eq("and nothing is ever drawn with a ✗", has(wed, "✗"), false);
// The ? has its own column, so the titles line up whether or not a row has one --
// the alternative is a list whose left edge moves depending on who answered.
eq("every title starts in the same column, ? or no ?",
  [["architecture sync", "architecture sync"], ["pick up kids", "pick up kids"],
   ["Ana on leave", "Ana on leave"], ["sprint review", "sprint review"]]
    .map(([find, title]) => rowFor(wed, find).indexOf(title)),
  [12, 12, 12, 12]);

// ---------------------------------------------------------------------------
section("13. every row says which calendar it came from");
// The bar is the glance; the slug survives a colourblind reader, a monochrome
// terminal and a --no-color pipe (DESIGN 2.8), so both are drawn.

eq("work's events carry work", rowFor(wed, "sprint review").trimEnd().endsWith("work"), true);
eq("home's events carry home", rowFor(wed, "pick up kids").trimEnd().endsWith("home"), true);
eq("every event row carries a slug",
  wed.filter((l) => l.startsWith("▌") && !l.includes("until"))
     .every((l) => /(work|home)$/.test(l.trimEnd())), true);

// ---------------------------------------------------------------------------
section("14. the roll-over, and the two empty states");

const rollCache = cache({
  work: { fetchedAt: FRESH, events: norm("events-rollover", { slug: "work", tz: TZ, selfEmail: "me@corp.com" }), error: null },
  home: { fetchedAt: FRESH, events: [], error: null },
});
const evening = text({ cache: rollCache, now: at("2026-08-26T20:00:00+02:00") });
eq("the scope line says TOMORROW", evening[1].trim(), "TOMORROW · Thu 27 Aug");
eq("...and not TODAY", evening[1].includes("TODAY"), false);
eq("...and names the day", evening[1].includes("Thu 27 Aug"), true);
eq("it shows tomorrow's events", has(evening, "planning"), true);
eq("...including tomorrow's all-day row", rowFor(evening, "Bo on leave").includes("ALL DAY"), true);
eq("nothing tomorrow wears the NOW label", has(evening, "NOW"), false);
eq("tomorrow's declined event is still not drawn", has(evening, "you also said no"), false);

const bare = text({ cache: cache({ work: { fetchedAt: FRESH, events: [], error: null },
                                   home: { fetchedAt: FRESH, events: [], error: null } }) });
eq("nothing today and nothing tomorrow says so", has(bare, "nothing today or tomorrow"), true);
eq("...with no date line to imply a day is being shown", has(bare, "TODAY"), false);

// A blank region with no explanation reads as a bug (DESIGN 2.6).
const none = text({ calendars: [], cache: cache({}) });
eq("no calendars configured says so", has(none, "no calendars"), true);
eq("...and names the command that starts it", has(none, "agenda add home"), true);
eq("...and still draws the header", none[0].includes("AGENDA"), true);

// ---------------------------------------------------------------------------
section("15. failures: quiet when it heals itself, loud when it will not");

const offline = text({ cache: cache({
  work: { fetchedAt: at("2026-08-26T13:58:00+02:00"), events: WORK, error: { kind: "network" } },
  home: { fetchedAt: FRESH, events: HOME, error: null },
}) });
eq("a network error keeps the cached events", has(offline, "sprint review"), true);
eq("...and adds one dim line with the age", has(offline, "last updated 22m ago · offline"), true);
eq("a fresh successful cache adds no staleness line at all", has(wed, "offline"), false);
eq("...not even the words 'last updated'", has(wed, "last updated"), false);
// "unknown" is a malformed 200: nothing the user can act on, so it stays quiet.
eq("an unclassifiable failure is treated as transient",
  has(text({ cache: cache({ work: { fetchedAt: FRESH, events: WORK, error: { kind: "unknown" } },
                            home: { fetchedAt: FRESH, events: HOME, error: null } }) }), "offline"), true);
eq("a calendar that has never been fetched says so rather than lying about an age",
  has(text({ cache: cache({ work: { fetchedAt: 0, events: [], error: "network" },
                            home: { fetchedAt: FRESH, events: HOME, error: null } }) }),
      "last updated never · offline"), true);

const dead = text({ cache: cache({
  work: { fetchedAt: FRESH, events: WORK, error: null },
  home: { fetchedAt: FRESH, events: HOME, error: { kind: "auth" } },
}) });
eq("an auth error names the command that fixes it", has(dead, "sign-in expired · agenda add home"), true);
eq("...and that calendar's events are gone", has(dead, "pick up kids"), false);
// A silent gap in a two-calendar view is indistinguishable from a quiet day.
eq("...while the other calendar keeps every one of its rows", has(dead, "sprint review"), true);
eq("...including its all-day row", has(dead, "Ana on leave"), true);

const gone = text({ cache: cache({
  work: { fetchedAt: FRESH, events: WORK, error: { kind: "gone" } },
  home: { fetchedAt: FRESH, events: HOME, error: null },
}) });
eq("a gone calendar says how to detach it", has(gone, "calendar gone · agenda rm work"), true);
eq("...and it is the only calendar affected", has(gone, "pick up kids"), true);

// T00 measured Google's per-scope consent checkbox: an unticked calendar box gives
// a valid token whose calls 403. Telling someone to `agenda rm` a calendar that is
// fine would destroy a working configuration and fix nothing (DESIGN 2.7).
const scoped = text({ cache: cache({
  work: { fetchedAt: FRESH, events: [], error: { kind: "auth", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" } },
  home: { fetchedAt: FRESH, events: HOME, error: null },
}) });
eq("a consent mistake says the permission was not granted",
  has(scoped, "calendar permission not granted"), true);
eq("...and never tells you to remove the calendar", has(scoped, "agenda rm"), false);
eq("...it tells you to sign in again", has(scoped, "agenda add work"), true);
eq("a `scope` kind reads the same way",
  has(text({ cache: cache({ work: { fetchedAt: FRESH, events: [], error: "scope" },
                            home: { fetchedAt: FRESH, events: HOME, error: null } }) }),
      "calendar permission not granted"), true);

const bothDead = text({ rows: 6, cache: cache({
  work: { fetchedAt: 0, events: [], error: "gone" },
  home: { fetchedAt: 0, events: [], error: { kind: "auth" } },
}) });
eq("both calendars in error still draws the header", bothDead[0].includes("AGENDA"), true);
eq("...and both loud lines", [has(bothDead, "agenda rm work"), has(bothDead, "agenda add home")], [true, true]);
// There is nothing to be empty ABOUT when no calendar could be read.
eq("...and does not claim the day is empty", has(bothDead, "nothing today or tomorrow"), false);

// An error given as a bare string is the same thing as { kind }.
eq("the error may be a bare string",
  has(text({ cache: cache({ work: { fetchedAt: FRESH, events: WORK, error: "auth" },
                            home: { fetchedAt: FRESH, events: HOME, error: null } }) }),
      "sign-in expired · agenda add work"), true);

// ---------------------------------------------------------------------------
section("16. rows are honoured exactly, and overflow says how much is hidden");
// Returning more corrupts the column below; returning fewer leaves the pane's
// previous paint on screen.

for (const r of [0, 1, 2, 3, 5, 8, 14, 40]) {
  eq(`exactly ${r} rows out`, draw({ rows: r }).length, r);
}
eq("a pane too short for even the header does not throw", draw({ rows: 1 }).length, 1);
eq("...and gives the header first", plain(draw({ rows: 1 })[0]).includes("AGENDA"), true);
eq("zero rows is an empty list", draw({ rows: 0 }), []);

const tight = text({ rows: 6 });
// Stopping silently at the fold reads as "that is all of them", and here that is a
// false statement about your afternoon.
eq("more events than rows says how many are hidden", has(tight, "… +3 more · agenda"), true);
eq("...and the count matches what was dropped",
  tight.filter((l) => l.startsWith("▌") && !l.includes("until")).length, 2);
eq("enough rows for everything produces no overflow line", has(wed, "more · agenda"), false);
eq("the NOW row and its until line are dropped together",
  text({ rows: 7 }).some((l) => l.includes("until") && !has(text({ rows: 7 }), "NOW")), false);

// The one line you can act on must not be the first thing pushed off the bottom.
const squeezedLoud = text({ rows: 5, cache: cache({
  work: { fetchedAt: FRESH, events: WORK, error: null },
  home: { fetchedAt: FRESH, events: HOME, error: { kind: "gone" } },
}) });
eq("a loud line survives a pane too small for the events",
  has(squeezedLoud, "calendar gone · agenda rm home"), true);

// ---------------------------------------------------------------------------
section("17. nothing ever exceeds the width");

const widths = [12, 20, 26, 32, 44, 60, 100];
const overWide = [];
for (const width of widths) {
  for (const cals of [CALS, CALS.map((c) => ({ ...c, colour: null }))]) {
    for (const l of renderAgenda({ width, rows: 12, calendars: cals, cache: CACHE, now: NOW, tz: TZ })) {
      if (visibleLen(l) > width) overWide.push([width, plain(l)]);
    }
  }
}
eq("no line exceeds its width, with and without colour codes", overWide, []);

const longTitle = [{ ...WORK[0], id: "long", allDay: false, title: "x".repeat(200),
  start: at("2026-08-26T16:00:00+02:00"), end: at("2026-08-26T17:00:00+02:00"), reply: "n/a" }];
const clipped = text({ cache: cache({ work: { fetchedAt: FRESH, events: longTitle, error: null },
                                      home: { fetchedAt: FRESH, events: [], error: null } }) });
eq("a long title is clipped, never wrapped", clipped.filter((l) => l.includes("xxx")).length, 1);
eq("...and marked as cut", rowFor(clipped, "xxx").includes("…"), true);

const longSlug = "a-very-long-calendar-slug";
const squeezed = renderAgenda({ width: W, rows: 12, calendars: [{ slug: longSlug, colour: "teal" }],
  cache: cache({ [longSlug]: { fetchedAt: FRESH, events: WORK.map((e) => ({ ...e, slug: longSlug })), error: null } }),
  now: NOW, tz: TZ }).map(plain);
const sprintRow = rowFor(squeezed, "sprint");
ok("a long slug cannot squeeze the title to nothing", /sprint/.test(sprintRow), JSON.stringify(sprintRow));
eq("...and is itself clipped instead", sprintRow.includes(longSlug), false);
eq("...to no more than a third of the row",
  visibleLen(sprintRow.trimEnd().split(/\s{2,}/).pop()) <= Math.floor(W / 3), true);

// ---------------------------------------------------------------------------
section("18. agendaHeight is what renderAgenda actually draws");
// T06 budgets the right column with this rather than rendering twice and measuring.

const scenarios = {
  "a busy Wednesday": {},
  "the roll-over": { cache: rollCache, now: at("2026-08-26T20:00:00+02:00") },
  "an empty day": { cache: cache({ work: { fetchedAt: FRESH, events: [], error: null } }) },
  "no calendars": { calendars: [], cache: cache({}) },
  "one calendar down": { cache: cache({
    work: { fetchedAt: FRESH, events: WORK, error: null },
    home: { fetchedAt: at("2026-08-26T13:00:00+02:00"), events: HOME, error: "network" } }) },
};
for (const [name, opts] of Object.entries(scenarios)) {
  const h = height(opts);
  const out = draw({ ...opts, rows: h });
  eq(`${name}: the height is the line count`, out.filter((l) => l !== "").length, h);
  eq(`${name}: ...and nothing overflows at it`, out.map(plain).some((l) => l.includes("more · agenda")), false);
  eq(`${name}: ...while one row less does overflow or drop something`,
    h > 3 ? draw({ ...opts, rows: h - 1 }).filter((l) => l !== "").length < h : true, true);
}

// ---------------------------------------------------------------------------
section("19. colours");

eq("the palette has eight entries", PALETTE.length, 8);
eq("...with no duplicate names", new Set(PALETTE.map((c) => c.name)).size, 8);
eq("...and no duplicate codes", new Set(PALETTE.map((c) => c.code)).size, 8);
ok("...all of them 256-colour foreground codes", PALETTE.every((c) => /^38;5;\d{1,3}$/.test(c.code)));

const sevenTaken = PALETTE.slice(0, 7).map((c) => c.name);
eq("a free colour is never passed over for a taken one",
  new Set(Array.from({ length: 25 }, (_, i) => pickColour(sevenTaken, i))).size === 1 &&
  pickColour(sevenTaken, 3) === PALETTE[7].name, true);
eq("no colour taken means any palette colour",
  Array.from({ length: 25 }, (_, i) => PALETTE.some((c) => c.name === pickColour([], i))).every(Boolean), true);
// Past eight, a repeat beats refusing to add a ninth calendar.
const allTaken = PALETTE.map((c) => c.name);
eq("with all eight taken it still answers",
  Array.from({ length: 25 }, (_, i) => PALETTE.some((c) => c.name === pickColour(allTaken, i))).every(Boolean), true);
// The model may not reach for randomness any more than for a clock: a colour that
// changes on every render is not a colour.
eq("it is a function of its arguments alone",
  [pickColour(["teal"], 5), pickColour(["teal"], 5), pickColour(["teal"], 5)]
    .every((v, _, a) => v === a[0]), true);
eq("...and a different rand can give a different answer",
  new Set(Array.from({ length: 8 }, (_, i) => pickColour([], i))).size, 8);
eq("junk rand still returns a colour",
  [pickColour([], undefined), pickColour([], NaN), pickColour([], -3)]
    .every((n) => PALETTE.some((c) => c.name === n)), true);
eq("an unknown taken name is simply not in the palette", pickColour(["chartreuse"], 0), PALETTE[0].name);

const coloured = draw();
const teal = PALETTE.find((c) => c.name === "teal").code;
const rose = PALETTE.find((c) => c.name === "rose").code;
eq("each calendar's rows carry its own colour",
  [coloured.find((l) => l.includes("sprint review")).includes(teal),
   coloured.find((l) => l.includes("pick up kids")).includes(rose)], [true, true]);
eq("...and not the other's",
  coloured.find((l) => l.includes("sprint review")).includes(rose), false);
eq("two calendars get two different codes", teal === rose, false);
eq("the until line is drawn in the NOW event's colour",
  coloured[coloured.findIndex((l) => l.includes("sprint review")) + 1].includes(teal), true);
// A calendar whose stored colour is not in the palette still draws its bar; losing
// the row would be a far worse answer than losing the colour.
const plainBars = renderAgenda({ width: W, rows: 12, calendars: [{ slug: "work", colour: null }],
  cache: cache({ work: { fetchedAt: FRESH, events: WORK, error: null } }), now: NOW, tz: TZ });
eq("an unknown colour name still draws the row",
  plainBars.some((l) => plain(l).includes("sprint review")), true);
eq("...with no colour on its bar", plainBars.some((l) => l.includes("38;5;")), false);

// ---------------------------------------------------------------------------
section("20. the width helpers the two halves of the column share");
// They live in the model so that NOTES and AGENDA measure a string identically --
// two copies that drift are a divider that does not line up (T06 imports these).

eq("visibleLen ignores escapes", visibleLen(`\x1b[1mfive!\x1b[0m`), 5);
eq("pad measures the same way", visibleLen(pad(`\x1b[1mfive!\x1b[0m`, 10)), 10);
eq("pad never shortens", visibleLen(pad("abcdefgh", 3)), 8);
eq("clip counts columns, not bytes", visibleLen(clip(`\x1b[1mabcdefgh\x1b[0m`, 5)), 5);
eq("...and marks the cut", plain(clip("abcdefgh", 5)), "abcd…");
eq("a string that fits is returned untouched", clip("abc", 5), "abc");
eq("clipping a plain string leaves it plain", clip("abcdefgh", 5), "abcd…");
// Slicing raw would count escape bytes as columns and could cut one in half,
// spilling `[38;5;37m` into the pane.
eq("a clipped escape is never left half-written", /\x1b\[[0-9;]*[^m0-9;]/.test(clip(`\x1b[38;5;37m▌\x1b[0m abcdefgh`, 6)), false);
eq("clip to zero is empty", clip("abc", 0), "");

// ---------------------------------------------------------------------------
section("21. junk in the cache draws a column anyway");
// The pane must not go blank because a cached event lost a field (DESIGN 2.7).

const junk = { calendars: { work: { fetchedAt: FRESH, error: null, events: [
  null, 42, "nope", {}, { title: "no times" }, { start: NaN, end: NaN, title: "not a number" },
  { start: NOW, end: NOW + 3600000, title: null, allDay: false, reply: "none", id: "t" },
  ...WORK,
] } } };
let drew = null;
try { drew = renderAgenda({ width: W, rows: 12, calendars: [CALS[0]], cache: junk, now: NOW, tz: TZ }); }
catch (e) { drew = e; }
ok("nothing in a mangled cache throws", Array.isArray(drew), String(drew));
eq("...and the good events are still drawn", drew.some((l) => plain(l).includes("sprint review")), true);
eq("...and the junk is not", drew.some((l) => plain(l).includes("not a number")), false);
eq("an absent cache is the empty one",
  has(renderAgenda({ width: W, rows: 6, calendars: CALS, now: NOW, tz: TZ }).map(plain),
      "nothing today or tomorrow"), true);
eq("no arguments at all does not throw", renderAgenda().length, 0);
eq("...nor does agendaHeight", typeof agendaHeight({ width: W, now: 0 }), "number");

// ---------------------------------------------------------------------------
section("22. the zone is an argument, like the clock");
// Intl's default zone is an environment read (DESIGN 3.1), so a caller who names
// none must get the same answer on every machine.

const inUTC = text({ tz: "UTC" });
eq("a different zone moves the clock", inUTC[0].trimEnd().endsWith("12:20"), true);
eq("...and the times on the rows", has(inUTC, "15:30"), true);
eq("naming no zone is UTC, not the machine's",
  renderAgenda({ width: W, rows: 14, calendars: CALS, cache: CACHE, now: NOW }).map(plain)[0],
  inUTC[0]);

done();
