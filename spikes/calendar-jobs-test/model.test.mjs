// The jobs model: every rule of DESIGN 2.2 and 2.3, driven with a fixed `now`.
// Expected instants and names are written out as literal strings, never derived
// with the model's own arithmetic.

import { section, ok, eq, done } from "../agenda-test/harness.mjs";
import {
  plainText, parseJob, decideJobs, buildPreamble, buildClaudeArgs, noteText,
} from "../../bin/cockpit-jobs-model.mjs";
import { normaliseEvent } from "../../bin/cockpit-agenda-model.mjs";

const ZONE = "Europe/Warsaw";
const T = (s) => Date.parse(s);
const START = T("2026-11-01T20:00:00Z");   // 21:00 in Warsaw
const END = T("2026-11-01T23:00:00Z");     // 00:00 on the 2nd in Warsaw
const MIN = 60000;
const ROOT = "/Users/me/src";

const ev = (over = {}) => ({
  id: "evt1", title: "superfrog", start: START, end: END, allDay: false, reply: "n/a", slug: "night",
  description: "run the tests", creatorOwn: true, ...over,
});
const CAL = { slug: "night", account: "me@x.y", jobs: true, jobsSince: T("2026-10-01T00:00:00Z") };

function decide({ events = [ev()], now = START, ledger = { version: 1, entries: {} }, calendars = [CAL],
  cacheEntry, exists = () => true } = {}) {
  const fresh = cacheEntry ?? { fetchedAt: now, events, error: null };
  return decideJobs({
    calendars, cache: { version: 1, calendars: { night: fresh } }, ledger, now,
    projectsRoot: ROOT, zone: ZONE, projectExists: exists,
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
    ledger: { entries: {} }, now: START, projectsRoot: ROOT + "/", zone: ZONE, projectExists: () => true }).start[0].cwd,
  "/Users/me/src/superfrog");
eq("starts late, inside the entry", decide({ now: END - 1 }).start.length, 1);
{
  const d = decide({ now: END });
  eq("at now === end nothing starts", d.start, []);
  eq("at now === end it is missed", d.ledgerChanges, [{ key: "night/evt1", state: "missed" }]);
  eq("missed leaves one note under its key", d.notes.map((n) => n.key), ["night/evt1"]);
  ok("the note names the entry", d.notes[0].text.includes('"superfrog"'));
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
    { id: "n", summary: "superfrog", description: "go", start: { dateTime: "2026-11-01T20:00:00Z" }, end: { dateTime: "2026-11-01T23:00:00Z" } },
    { slug: "night", tz: ZONE, selfEmail: "me@x.y" });
  ok("a real non-jobs normalised event: no decision", nothing(decide({ events: [realFetch] })));
  const jobsFetch = normaliseEvent(
    { id: "n", summary: "superfrog", description: "go", creator: { self: true }, start: { dateTime: "2026-11-01T20:00:00Z" }, end: { dateTime: "2026-11-01T23:00:00Z" } },
    { slug: "night", tz: ZONE, selfEmail: "me@x.y", jobs: true });
  eq("a real jobs normalised event starts", decide({ events: [jobsFetch] }).start.length, 1);
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
  eq("corrected in time, it starts", decide({ events: [ev({ title: "superfrog" })], now: START }).start.length, 1);
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
  ["title ..", { title: ".." }, "bad-project"],
  ["title .", { title: "." }, "bad-project"],
  ["title a/b", { title: "a/b" }, "bad-project"],
  ["title ../x", { title: "../x" }, "bad-project"],
  ["title with spaces", { title: "my project" }, "bad-project"],
  ["title empty", { title: "" }, "bad-project"],
  ["the (no title) stand-in", { title: "(no title)" }, "bad-project"],
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
  decide({ events: [ev({ title: "../x" }), ev({ id: "2", title: "good.name-1" })], exists: (n) => (asked.push(n), true) });
  eq("projectExists is never asked about an invalid name", asked, ["good.name-1"]);
  eq("the title is trimmed", decide({ events: [ev({ title: "  superfrog " })] }).start[0].project, "superfrog");
  eq("a truthy non-boolean creatorOwn is left undecided", decide({ events: [ev({ creatorOwn: "yes" })] }).start, []);
}
eq("parseJob: the happy shape", parseJob(ev({ description: "<p>go</p>" })), { project: "superfrog", instructions: "go" });
eq("parseJob: a non-true creatorOwn refuses", parseJob(ev({ creatorOwn: 1 })), { refuse: "not-yours" });
eq("parseJob: a trailing newline in the title is trimmed", parseJob(ev({ title: "x\n" })).project, "x");

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
  ["outer whitespace goes", "\n  hi  \n", "hi"],
  ["null", null, ""],
]) eq(`plainText: ${name}`, plainText(input), want);

section("2.4 the argv");
const EVT = ev({ id: "abc_20261101T200000Z" });
{
  const args = buildClaudeArgs({ event: EVT, project: "superfrog", instructions: "go", zone: ZONE });
  const name = args[2], wt = args[6], tag = name.slice(-4);
  ok("id4 is four hex characters", /^[0-9a-f]{4}$/.test(tag));
  eq("flag for flag", args, [
    "--bg",
    "-n", `superfrog / cal 11-01 21:00 ${tag}`,
    "--permission-mode", "bypassPermissions",
    "-w", `cal-20261101-2100-${tag}`,
    "--disallowedTools", "AskUserQuestion",
    "--append-system-prompt", buildPreamble({ end: EVT.end, zone: ZONE }),
    "Instructions from the calendar entry:\ngo",
  ]);
  eq("the worktree name is what Git allows", /^[A-Za-z0-9-]+$/.test(wt), true);
  eq("a flag follows --disallowedTools", args[args.indexOf("--disallowedTools") + 2], "--append-system-prompt");
  eq("decideJobs hands back this argv",
    decide({ events: [ev({ id: "abc_20261101T200000Z", description: "<p>go</p>" })] }).start[0].args, args);
}
for (const hostile of ["-rf /", "--dangerously", 'say "hi" \'there\'', "line one\nline two\n--flag", "$(touch x) `y`"]) {
  const args = buildClaudeArgs({ event: EVT, project: "p", instructions: hostile, zone: ZONE });
  eq(`one element, no more: ${JSON.stringify(hostile)}`, args.length, 12);
  eq("...byte-exact in the last element", args.at(-1), `Instructions from the calendar entry:\n${hostile}`);
  ok("...which never begins with -", !args.at(-1).startsWith("-"));
}
{
  const nameOf = (id) => buildClaudeArgs({ event: ev({ id }), project: "p", instructions: "i", zone: ZONE });
  const a = nameOf("abc_20261101T200000Z"), b = nameOf("def_20261101T200000Z");
  ok("two recurring instances in one minute: names differ", a[2] !== b[2]);
  ok("two recurring instances in one minute: worktrees differ", a[6] !== b[6]);
  eq("the same id always gives the same name", nameOf("abc_20261101T200000Z")[2], a[2]);
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
    ["nothing outside", "never touch anything outside the worktree"],
    ["the deadline, midnight in the zone", "The deadline is 00:00"],
    ["T00's confirmed wording", "Run long commands in the background with the longest time limit allowed and do not end your turn until they have finished."],
    ["work still running", "Do not end your turn while work is still running."],
    ["the report", "State the outcome, what was done, the decisions taken, and what is left."],
  ]) ok(`preamble: ${what}`, p.includes(needle), p);
  ok("preamble never begins with -", !p.startsWith("-"));
}

section("DST: the zone passed decides");
{
  // Warsaw leaves summer time at 01:00Z on 25 Oct 2026: 02:30 happens twice.
  const summer = T("2026-10-25T00:30:00Z"), winter = T("2026-10-25T01:30:00Z");
  const worktree = (start, zone) => buildClaudeArgs({ event: ev({ start, end: start + MIN }), project: "p", instructions: "i", zone })[6];
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
  const hostile = noteText("missed", { title: `evil\x1b[31m\nsecond ${"y".repeat(500)}` });
  ok("a title cannot put an escape into the pane", !hostile.includes("\x1b"));
  ok("a note is one line", !hostile.includes("\n"));
  ok("a long title is bounded", noteText("missed", { title: "y".repeat(500) }).length < 120);
  ok("instructions never reach a note", !decide({ events: [ev({ title: "../x", description: "SECRET" })] }).notes[0].text.includes("SECRET"));
}

done();
