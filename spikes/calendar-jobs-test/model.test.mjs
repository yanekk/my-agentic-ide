// The jobs model: every rule of DESIGN 2.2 and 2.3, driven with a fixed `now`.
// Expected instants and names are written out as literal strings, never derived
// with the model's own arithmetic.

import { section, ok, eq, done } from "../agenda-test/harness.mjs";
import {
  plainText, parseJob, decideJobs, buildPreamble, buildClaudeArgs, noteText, worktreeName,
} from "../../bin/cockpit-jobs-model.mjs";
import { buildWallSettings } from "../../bin/cockpit-wall-model.mjs";
import { normaliseEvent } from "../../bin/cockpit-agenda-model.mjs";

const ZONE = "Europe/Warsaw";
const T = (s) => Date.parse(s);
const START = T("2026-11-01T20:00:00Z");   // 21:00 in Warsaw
const END = T("2026-11-01T23:00:00Z");     // 00:00 on the 2nd in Warsaw
const MIN = 60000;
const ROOT = "/Users/me/src";
const wallOf = (worktree = "/w") => buildWallSettings({ worktree, home: "/Users/me", guardPath: "/g.mjs",
  commonDir: "/r/.git", branches: ["main"], remoteHosts: [], exceptions: {} });
const WALL = wallOf();
const wallFor = () => WALL;

const ev = (over = {}) => ({
  id: "evt1", title: "superfrog / nightly", start: START, end: END, allDay: false, reply: "n/a", slug: "night",
  description: "run the tests", creatorOwn: true, ...over,
});
const CAL = { slug: "night", account: "me@x.y", jobs: true, jobsSince: T("2026-10-01T00:00:00Z") };

function decide({ events = [ev()], now = START, ledger = { version: 1, entries: {} }, calendars = [CAL],
  cacheEntry, exists = () => true, wall = wallFor } = {}) {
  const fresh = cacheEntry ?? { fetchedAt: now, events, error: null };
  return decideJobs({
    calendars, cache: { version: 1, calendars: { night: fresh } }, ledger, now,
    projectsRoot: ROOT, zone: ZONE, projectExists: exists, wallFor: wall,
  });
}
const nothing = (d) => d.start.length === 0 && d.notes.length === 0 && d.ledgerChanges.length === 0;

section("2.3 when it starts");
ok("not one millisecond before start", nothing(decide({ now: START - 1 })));
{
  const d = decide({ now: START });
  eq("starts at now === start", d.start.map((s) => s.key), ["night/evt1"]);
  eq("the start carries project", d.start[0].project, "superfrog");
  eq("the start's cwd is under the root", d.start[0].cwd, "/Users/me/src/superfrog");
  eq("the start carries end", d.start[0].end, END);
  eq("a start writes no note", d.notes, []);
  eq("a start is not recorded by the model; the tick writes starting", d.ledgerChanges, []);
}
eq("a trailing slash on the root does not double up",
  decideJobs({ calendars: [CAL], cache: { calendars: { night: { fetchedAt: START, events: [ev()], error: null } } },
    ledger: { entries: {} }, now: START, projectsRoot: ROOT + "/", zone: ZONE, projectExists: () => true, wallFor }).start[0].cwd,
  "/Users/me/src/superfrog");
eq("starts late, inside the entry", decide({ now: END - 1 }).start.length, 1);
{
  const d = decide({ now: END });
  eq("at now === end nothing starts", d.start, []);
  eq("at now === end it is missed", d.ledgerChanges, [{ key: "night/evt1", state: "missed" }]);
  eq("missed leaves one note under its key", d.notes.map((n) => n.key), ["night/evt1"]);
  ok("the note names the entry", d.notes[0].text.includes('"superfrog / nightly"'));
}
eq("overlapping entries all start",
  decide({ events: [ev({ id: "a" }), ev({ id: "b", start: START - 5 * MIN })] }).start.map((s) => s.key),
  ["night/a", "night/b"]);
eq("one key twice in a fetch is one start", decide({ events: [ev(), ev()] }).start.length, 1);

section("2.3 decided once");
for (const state of ["starting", "started", "refused", "missed", "failed", "unknown"]) {
  const ledger = { version: 1, entries: { "night/evt1": { state, at: 1 } } };
  ok(`state ${state}: never starts or notes again`, nothing(decide({ ledger })));
  ok(`state ${state}: nor once it has ended`, nothing(decide({ ledger, now: END + MIN })));
}
{
  const a = "abc_20261101T200000Z", b = "abc_20261108T200000Z";
  eq("recurring instances each start",
    decide({ events: [ev({ id: a }), ev({ id: b })] }).start.map((s) => s.key), [`night/${a}`, `night/${b}`]);
  const moved = ev({ start: START + 60 * MIN, end: END + 60 * MIN });
  ok("a moved, already decided entry does not run again",
    nothing(decide({ events: [moved], now: START + 60 * MIN, ledger: { entries: { "night/evt1": { state: "started" } } } })));
}

section("2.3 only a fresh, complete fetch decides");
{
  const old = ev();
  delete old.creatorOwn;
  ok("no creatorOwn: no decision", nothing(decide({ events: [old] })));
  ok("no creatorOwn after its end: no decision, no missed", nothing(decide({ events: [old], now: END })));
  const realFetch = normaliseEvent(
    { id: "n", summary: "superfrog / nightly", description: "go", start: { dateTime: "2026-11-01T20:00:00Z" }, end: { dateTime: "2026-11-01T23:00:00Z" } },
    { slug: "night", tz: ZONE, selfEmail: "me@x.y" });
  ok("a real non-jobs normalised event: no decision", nothing(decide({ events: [realFetch] })));
  const jobsFetch = normaliseEvent(
    { id: "n", summary: "superfrog / nightly", description: "go", creator: { self: true }, start: { dateTime: "2026-11-01T20:00:00Z" }, end: { dateTime: "2026-11-01T23:00:00Z" } },
    { slug: "night", tz: ZONE, selfEmail: "me@x.y", jobs: true });
  eq("a real jobs normalised event starts", decide({ events: [jobsFetch] }).start.length, 1);
  // Measured in T06 on a secondary calendar: the creator carries an email and no `self`,
  // and `self` sits on the organizer, which is the calendar. Only the email can match.
  const measured = (creator) => normaliseEvent(
    { id: "n", summary: "superfrog / nightly", description: "go", creator,
      organizer: { email: "x@group.calendar.google.com", displayName: "agents", self: true },
      start: { dateTime: "2026-11-01T20:00:00+01:00", timeZone: "Europe/Warsaw" },
      end: { dateTime: "2026-11-01T23:00:00+01:00", timeZone: "Europe/Warsaw" } },
    { slug: "night", tz: ZONE, selfEmail: "me@x.y", jobs: true });
  eq("real shape, the account's own email: mine", measured({ email: "me@x.y" }).creatorOwn, true);
  eq("real shape, another email: not mine, whatever the organizer says",
    measured({ email: "you@x.y" }).creatorOwn, false);
  eq("real shape, no creator: not mine", measured(undefined).creatorOwn, false);
}
const atEnd = END + 10 * MIN;
ok("stale by over 5 minutes: nothing starts",
  nothing(decide({ cacheEntry: { fetchedAt: START - 5 * MIN - 1, events: [ev()], error: null } })));
eq("exactly 5 minutes old still decides",
  decide({ cacheEntry: { fetchedAt: START - 5 * MIN, events: [ev()], error: null } }).start.length, 1);
ok("stale: not even missed",
  nothing(decide({ now: atEnd, cacheEntry: { fetchedAt: atEnd - 6 * MIN, events: [ev()], error: null } })));
ok("error set: nothing starts",
  nothing(decide({ cacheEntry: { fetchedAt: START, events: [ev()], error: { kind: "network" } } })));
ok("error set: not even missed",
  nothing(decide({ now: atEnd, cacheEntry: { fetchedAt: atEnd, events: [ev()], error: { kind: "auth" } } })));
ok("never fetched: nothing", nothing(decide({ cacheEntry: { fetchedAt: 0, events: [ev()], error: null } })));
ok("no cache entry for the calendar: nothing",
  nothing(decideJobs({ calendars: [CAL], cache: { calendars: {} }, ledger: { entries: {} }, now: START,
    projectsRoot: ROOT, zone: ZONE, projectExists: () => true })));

{
  const bad = [null, ev({ id: "a", end: undefined }), ev({ id: "b", start: "soon" })];
  const d = decide({ events: [...bad, ev()] });
  eq("a damaged row costs the others nothing", d.start.map((s) => s.key), ["night/evt1"]);
  eq("...and is itself left undecided", d.ledgerChanges, []);
}

section("2.1 which calendars and entries count");
ok("a calendar without the flag is ignored", nothing(decide({ calendars: [{ slug: "night", account: "me@x.y" }] })));
ok("ended before jobsSince: ignored silently",
  nothing(decide({ now: END + 60 * MIN, calendars: [{ ...CAL, jobsSince: END + 1 }] })));
eq("ended exactly at jobsSince is still reported",
  decide({ now: END + 60 * MIN, calendars: [{ ...CAL, jobsSince: END }] }).ledgerChanges.length, 1);
eq("started before jobsSince but still running starts",
  decide({ now: START + MIN, calendars: [{ ...CAL, jobsSince: START + MIN }] }).start.length, 1);

section("2.7 notBefore");
ok("started before notBefore: ignored silently",
  nothing(decide({ ledger: { entries: {}, notBefore: START + 1 }, now: START + 2 })));
ok("...and not reported once ended either",
  nothing(decide({ ledger: { entries: {}, notBefore: START + 1 }, now: END + MIN })));
eq("started exactly at notBefore starts", decide({ ledger: { entries: {}, notBefore: START } }).start.length, 1);

section("2.2 faults are judged at the start");
const refusal = (d) => d.ledgerChanges[0]?.reason;
{
  const faulty = ev({ title: "../x" });
  ok("a faulty entry before its start: no note, no ledger change", nothing(decide({ events: [faulty], now: START - MIN })));
  eq("corrected in time, it starts", decide({ events: [ev({ title: "superfrog / nightly" })], now: START }).start.length, 1);
  const ended = decide({ events: [faulty], now: END });
  eq("ended and faulty is missed, not refused", ended.ledgerChanges, [{ key: "night/evt1", state: "missed" }]);
  eq("an ended all-day entry is missed",
    decide({ events: [ev({ allDay: true })], now: END }).ledgerChanges[0].state, "missed");
  eq("an ended unowned entry is missed",
    decide({ events: [ev({ creatorOwn: false })], now: END }).ledgerChanges[0].state, "missed");
}
for (const [name, over, reason] of [
  ["all-day", { allDay: true }, "all-day"],
  ["empty description", { description: "" }, "empty"],
  ["description empty after plainText", { description: "<p><br></p>&nbsp;" }, "empty"],
  ["not the owner's", { creatorOwn: false }, "not-yours"],
  ["no slash", { title: "p" }, "bad-title"],
  ["nothing after the slash", { title: "p /" }, "bad-title"],
  ["a lone slash", { title: "/" }, "bad-title"],
  ["the (no title) stand-in", { title: "(no title)" }, "bad-title"],
  ["title empty", { title: "" }, "bad-title"],
  ["an item of control characters", { title: "p / \x01" }, "bad-title"],
  ["an item of rule characters", { title: "p / ─ ─" }, "bad-title"],
  ["empty project", { title: "/ item" }, "bad-project"],
  ["project ../x", { title: "../x / y" }, "bad-project"],
  ["project ..", { title: ".. / y" }, "bad-project"],
  ["project .", { title: ". / y" }, "bad-project"],
  ["project with spaces", { title: "my project / y" }, "bad-project"],
]) {
  const d = decide({ events: [ev(over)] });
  eq(`refused: ${name}`, d.ledgerChanges, [{ key: "night/evt1", state: "refused", reason }]);
  eq(`...${name}: starts nothing`, d.start, []);
  eq(`...${name}: one note`, d.notes.length, 1);
}
{
  const d = decide({ exists: () => false });
  eq("refused: unknown project", refusal(d), "bad-project");
  ok("...and the note names the folder", d.notes[0].text.includes('no project folder is named "superfrog"'));
  let asked = [];
  decide({ events: [ev({ title: "../x / y" }), ev({ id: "2", title: "p" }), ev({ id: "3", title: "good.name-1 / y" })], exists: (n) => (asked.push(n), true) });
  eq("projectExists is never asked about an invalid name", asked, ["good.name-1"]);
  eq("the title is trimmed", decide({ events: [ev({ title: "  superfrog / x " })] }).start[0].project, "superfrog");
  eq("a truthy non-boolean creatorOwn is left undecided", decide({ events: [ev({ creatorOwn: "yes" })] }).start, []);
}
eq("parseJob: the happy shape", parseJob(ev({ description: "<p>go</p>" })), { project: "superfrog", item: "nightly", instructions: "go" });
eq("parseJob: a non-true creatorOwn refuses", parseJob(ev({ creatorOwn: 1 })), { refuse: "not-yours" });
eq("parseJob: a trailing newline in the title is trimmed", parseJob(ev({ title: "x / y\n" })).item, "y");
for (const [title, project, item] of [
  ["p / item", "p", "item"],
  ["p/item", "p", "item"],
  ["  p  /  item  ", "p", "item"],
  ["p / a/b", "p", "a/b"],
]) eq(`parseJob: ${JSON.stringify(title)}`, [parseJob(ev({ title })).project, parseJob(ev({ title })).item], [project, item]);
eq("parseJob: a bad project is named beside its refusal", parseJob(ev({ title: "../x / y" })), { refuse: "bad-project", project: ".." });

section("plainText");
for (const [name, input, want] of [
  ["<br> variants", "a<br>b<br/>c<br />d<BR>e", "a\nb\nc\nd\ne"],
  ["<p>", "<p>one</p><p>two</p>", "one\ntwo"],
  ["<div>", "<div>one</div><div>two</div>", "one\ntwo"],
  ["list items keep their lines", "<ul><li>one</li><li>two</li></ul>", "one\ntwo"],
  ["link keeps its text", 'see <a href="https://x.y/a?b=1&amp;c=2" target="_blank">the doc</a> now', "see the doc now"],
  ["a > inside an attribute", '<a href="x>y">t</a>', "t"],
  ["formatting tags", "<b>bold</b> <i>it</i> <u>un</u> <span style='x'>sp</span>", "bold it un sp"],
  ["the five entities", "a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos;", "a & b <c> \"d\" 'e' 'f'"],
  ["&amp;lt; decodes once", "&amp;lt;", "&lt;"],
  ["an escaped tag stays text", "&lt;b&gt;x&lt;/b&gt;", "<b>x</b>"],
  ["already plain", "run the tests\nthen fix them", "run the tests\nthen fix them"],
  ["a literal < in code", "if a < b && c > d then", "if a < b && c > d then"],
  ["shell redirects survive", "cat <in >out", "cat <in >out"],
  ["a placeholder survives", "checkout <branch> and List<T>", "checkout <branch> and List<T>"],
  ["a redirect from a file named like a tag", "sort <a >b", "sort <a >b"],
  ["a comparison starting with a tag name", "if x <b and c> d", "if x <b and c> d"],
  ["unquoted attributes", "<a href=x target=_blank>t</a>", "t"],
  ["space before the close", '<span style="a" >s</span>', "s"],
  ["self-closed with a space", "a<hr />b", "ab"],
  ["outer whitespace goes", "\n  hi  \n", "hi"],
  ["null", null, ""],
]) eq(`plainText: ${name}`, plainText(input), want);

section("2.4 the argv");
const EVT = ev({ id: "abc_20261101T200000Z" });
{
  const args = buildClaudeArgs({ event: EVT, project: "superfrog", item: "nightly", instructions: "go", zone: ZONE, wall: WALL });
  const name = args[2], wt = args[6], tag = name.slice(-4);
  ok("id4 is four hex characters", /^[0-9a-f]{4}$/.test(tag));
  eq("flag for flag", args, [
    "--bg",
    "-n", `superfrog / nightly 11-01 21:00 ${tag}`,
    "--permission-mode", "dontAsk",
    "-w", `cal-20261101-2100-${tag}`,
    "--settings", JSON.stringify(WALL.settings),
    "--setting-sources", "user",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--disallowedTools", "AskUserQuestion",
    "--append-system-prompt", buildPreamble({ end: EVT.end, zone: ZONE }),
    "Instructions from the calendar entry:\ngo",
  ]);
  eq("the worktree name is what Git allows", /^[A-Za-z0-9-]+$/.test(wt), true);
  eq("a flag follows --disallowedTools", args[args.indexOf("--disallowedTools") + 2], "--append-system-prompt");
  eq("a flag follows --mcp-config", args[args.indexOf("--mcp-config") + 2], "--disallowedTools");
  ok("bypass is gone", !args.includes("bypassPermissions"));
  eq("worktreeName is what -w is given", worktreeName({ event: EVT, zone: ZONE }), wt);
  eq("decideJobs hands back this argv",
    decide({ events: [ev({ id: "abc_20261101T200000Z", description: "<p>go</p>" })] }).start[0].args, args);
}
for (const hostile of ["-rf /", "--dangerously", 'say "hi" \'there\'', "line one\nline two\n--flag", "$(touch x) `y`"]) {
  const args = buildClaudeArgs({ event: EVT, project: "p", item: "i", instructions: hostile, zone: ZONE, wall: WALL });
  eq(`one element, no more: ${JSON.stringify(hostile)}`, args.length, 19);
  eq("...and the settings do not move", args[args.indexOf("--settings") + 1], JSON.stringify(WALL.settings));
  eq("...byte-exact in the last element", args.at(-1), `Instructions from the calendar entry:\n${hostile}`);
  ok("...which never begins with -", !args.at(-1).startsWith("-"));
}
{
  const nameOf = (id) => buildClaudeArgs({ event: ev({ id }), project: "p", item: "i", instructions: "i", zone: ZONE, wall: WALL });
  const a = nameOf("abc_20261101T200000Z"), b = nameOf("def_20261101T200000Z");
  ok("two recurring instances in one minute: names differ", a[2] !== b[2]);
  ok("two recurring instances in one minute: worktrees differ", a[6] !== b[6]);
  eq("the same id always gives the same name", nameOf("abc_20261101T200000Z")[2], a[2]);
}

section("2.9 no wall, no start");
ok("buildClaudeArgs refuses to build without a wall", (() => {
  try { buildClaudeArgs({ event: EVT, project: "p", item: "i", instructions: "i", zone: ZONE }); return false; }
  catch { return true; }
})());
for (const [name, wall] of [
  ["unavailable", () => ({ unavailable: "sandbox-exec failed" })],
  ["a throw", () => { throw new Error("secret detail"); }],
  ["nothing returned", () => undefined],
  ["no wallFor at all", null],
]) {
  const d = decide({ wall });
  eq(`${name}: nothing starts`, d.start, []);
  eq(`${name}: recorded failed/wall`, d.ledgerChanges, [{ key: "night/evt1", state: "failed", reason: "wall" }]);
  eq(`${name}: one note`, d.notes.length, 1);
  ok(`${name}: the note names the entry`, d.notes[0].text.includes('"superfrog / nightly"'));
  ok(`${name}: the note quotes no exception message`, !d.notes[0].text.includes("secret detail"));
}
ok("the reason reaches the note", decide({ wall: () => ({ unavailable: "sandbox-exec failed" }) }).notes[0].text.includes("sandbox-exec failed"));
{
  const asked = [];
  const d = decide({ wall: (project, name) => { asked.push([project, name]); return WALL; } });
  eq("wallFor is asked for this project and worktree", asked, [["superfrog", worktreeName({ event: ev(), zone: ZONE })]]);
  ok("...and its settings reach the argv", d.start[0].args.includes(JSON.stringify(WALL.settings)));
  const none = [];
  decide({ now: START - 1, wall: () => { none.push(1); return WALL; } });
  decide({ exists: () => false, wall: () => { none.push(1); return WALL; } });
  eq("an entry not starting never asks", none, []);
  const one = decide({ events: [ev({ id: "a" }), ev({ id: "b" })],
    wall: () => { none.push(1); return none.length === 1 ? { unavailable: "x" } : WALL; } });
  eq("one project's failure leaves the next entry alone", one.start.map((s) => s.key), ["night/b"]);
}
{
  const d = decide({ wall: () => ({ ...WALL, listUnreadable: true,
    dropped: [{ kind: "site", value: "github.com", why: "no" }, { kind: "write", value: "/", why: "no" }] }) });
  eq("it still starts", d.start.length, 1);
  eq("unreadable list plus two dropped rows: three notes", d.notes.length, 3);
  ok("the list note names the project", d.notes[0].text.includes('"superfrog"') && d.notes[0].text.includes("could not be read"));
  ok("a dropped note names the value", d.notes[1].text.includes("github.com"));
  eq("nothing is recorded by the model", d.ledgerChanges, []);
}
ok("a hostile dropped value stays one clean line", !/[\x1b\n]/.test(noteText("wall-dropped", { project: "p", value: "a\x1b[31m\nb" })));

section("2.9 the preamble");
{
  const p = buildPreamble({ end: END, zone: ZONE });
  for (const words of ["The machine enforces a wall", "Do not try to work around", "Carry on with what you can", "commit that", "list each block", "each thing the wall blocked",
    "Run each git command alone and in its plain form", "using git -c"]) {
    ok(`says: ${words}`, p.includes(words));
  }
  ok("no longer rests on \"never touch\"", !p.includes("never touch"));
}

section("the agent's name");
{
  const HEADER = /─{10,}\s+(\S.*?)\s+─/;   // cockpitd.mjs
  const nameOf = (title) => {
    const d = decide({ events: [ev({ id: "abc", title })] });
    return d.start[0].args[2];
  };
  const tail = (name) => name.split(" ").slice(-3).join(" ");
  const t = (name) => tail(name).replace(/^11-01 21:00 [0-9a-f]{4}$/, "TAIL");
  const body = (name) => name.slice(0, -tail(name).length - 1);
  eq("the example", /^superfrog-re \/ run nightly tests 11-01 21:00 [0-9a-f]{4}$/.test(nameOf("superfrog-re / run nightly tests")), true);
  eq("the tail is the date and id", t(nameOf("p / a")), "TAIL");
  eq("30 characters are kept", body(nameOf(`p / ${"x".repeat(30)}`)), `p / ${"x".repeat(30)}`);
  eq("31 are clipped to 30", body(nameOf(`p / ${"x".repeat(31)}`)), `p / ${"x".repeat(30)}`);
  eq("a clip landing on a space is trimmed", body(nameOf(`p / ${"x".repeat(29)} yy`)), `p / ${"x".repeat(29)}`);
  eq("a control character becomes a space", body(nameOf("p / a\x01b")), "p / a b");
  ok("an escape never reaches the name", !nameOf("p / a\x1b[31mb").includes("\x1b"));
  eq("whitespace runs collapse", body(nameOf("p / a \t  b")), "p / a b");
  const ruled = nameOf("p / a ─ b");
  ok("no rule character in the name", !ruled.includes("─"), ruled);
  eq("...which the header reads whole", `──────────── ${ruled} ─────`.match(HEADER)?.[1], ruled);
  const emoji = "😀".repeat(16);
  eq("16 emoji are not split", body(nameOf(`p / ${emoji}`)), `p / ${emoji}`);
  eq("31 emoji are clipped whole", body(nameOf(`p / ${"😀".repeat(31)}`)), `p / ${"😀".repeat(30)}`);
  const family = "👨‍👩‍👧";
  eq("a joined emoji is one character", body(nameOf(`p / ${family.repeat(31)}`)), `p / ${family.repeat(30)}`);
  const long = `superfrog / ${"y".repeat(40)}`;
  const instance = (id) => decide({ events: [ev({ id, title: long })] }).start[0].args[2];
  ok("two instances of a recurring entry get different names",
    instance("abc_20261101T200000Z") !== instance("def_20261101T200000Z"));
  eq("the started job carries the whole title", decide({ events: [ev({ title: long })] }).start[0].title, long);
}

section("2.5 the preamble");
{
  const p = buildPreamble({ end: END, zone: ZONE });
  for (const [what, needle] of [
    ["nobody is present", "Nobody is present"],
    ["nobody answers until morning", "nobody will answer until morning"],
    ["never wait", "Never wait for a reply"],
    ["never ask", "never ask"],
    ["defensible decision, recorded", "make the most defensible decision and record it"],
    ["worktree only", "Work only in the current worktree"],
    ["commit there", "commit there"],
    ["no push", "Never push"],
    ["no merge", "never merge"],
    ["the deadline, midnight in the zone", "The deadline is 00:00"],
    ["T00's confirmed wording", "Run long commands in the background with the longest time limit allowed and do not end your turn until they have finished."],
    ["work still running", "Do not end your turn while work is still running."],
    ["the report", "State the outcome, what was done, the decisions taken, each thing the wall blocked, and what is left."],
  ]) ok(`preamble: ${what}`, p.includes(needle), p);
  ok("preamble never begins with -", !p.startsWith("-"));
}

section("DST: the zone passed decides");
{
  // Warsaw leaves summer time at 01:00Z on 25 Oct 2026: 02:30 happens twice.
  const summer = T("2026-10-25T00:30:00Z"), winter = T("2026-10-25T01:30:00Z");
  const worktree = (start, zone) => buildClaudeArgs({ event: ev({ start, end: start + MIN }), project: "p", item: "i", instructions: "i", zone, wall: WALL })[6];
  ok("before the change, summer offset", worktree(summer, ZONE).startsWith("cal-20261025-0230-"));
  ok("after the change, winter offset", worktree(winter, ZONE).startsWith("cal-20261025-0230-"));
  ok("another zone, another name", worktree(summer, "America/New_York").startsWith("cal-20261024-2030-"));
  ok("an hour earlier the same day is summer", worktree(T("2026-10-24T23:30:00Z"), ZONE).startsWith("cal-20261025-0130-"));
  ok("the deadline follows the zone (winter)", buildPreamble({ end: T("2026-10-25T03:00:00Z"), zone: ZONE }).includes("The deadline is 04:00"));
  ok("the deadline follows the zone (summer)", buildPreamble({ end: T("2026-10-24T03:00:00Z"), zone: ZONE }).includes("The deadline is 05:00"));
  ok("a bad zone reads as UTC, not a crash", buildPreamble({ end: T("2026-10-24T03:00:00Z"), zone: "Mars/Base" }).includes("The deadline is 03:00"));
}

section("2.6 the notes");
{
  for (const reason of ["bad-project", "empty", "all-day", "not-yours"]) {
    const text = noteText("refused", { title: "x", reason });
    ok(`refused ${reason}: names the entry and has a reason`, text.includes('"x"') && !text.includes("undefined"), text);
  }
  eq("failed carries the first line only",
    noteText("failed", { title: "x", line: "Workspace not trusted. Run claude in /a once\nsecond" }),
    'Calendar entry "x" failed to start: Workspace not trusted. Run claude in /a once');
  ok("unknown says it is not retried", noteText("unknown", { title: "x" }).includes("will not be retried"));
  ok("auth names the repair", noteText("auth", { slug: "night" }).includes("agenda add night"));
  ok("gone names the repair", noteText("gone", { slug: "night" }).includes("agenda rm night"));
  ok("corrupt names where it went", noteText("corrupt", { path: "/a/b.corrupt-1" }).includes("/a/b.corrupt-1"));
  const refused = (title, exists = () => true) => decide({ events: [ev({ title })], exists }).notes[0].text;
  eq("a title without the slash: the note gives the format", refused("superfrog"),
    'Calendar entry "superfrog" not started: its title must read "project / item name".');
  eq("an unknown folder: the whole title, and the folder alone as the folder",
    refused("superfrog / nightly", () => false),
    'Calendar entry "superfrog / nightly" not started: no project folder is named "superfrog".');
  eq("a bad project: named by its part", refused("my project / y"),
    'Calendar entry "my project / y" not started: no project folder is named "my project".');
  eq("missed quotes the whole title", decide({ events: [ev()], now: END }).notes[0].text,
    'Calendar entry "superfrog / nightly" skipped: it ended before it could start.');
  ok("a hostile project reaches no note with an escape", !refused("a\x1b[31m / y").includes("\x1b"));
  ok("a hostile item reaches no note with an escape", !refused("p\x1b[31m / y\x1b[0m").includes("\x1b"));
  const hostile = noteText("missed", { title: `evil\x1b[31m\nsecond ${"y".repeat(500)}` });
  ok("a title cannot put an escape into the pane", !hostile.includes("\x1b"));
  ok("a note is one line", !hostile.includes("\n"));
  ok("a long title is bounded", noteText("missed", { title: "y".repeat(500) }).length < 120);
  ok("instructions never reach a note", !decide({ events: [ev({ title: "../x", description: "SECRET" })] }).notes[0].text.includes("SECRET"));
}

done();
