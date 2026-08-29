// The push itself: pane lookup, the refusals, the locked tab list, the sending.
//
// `cockpit-open.mjs` is the world-touching half (DESIGN 3.1), so unlike the model
// suite next door this one runs the real command as a subprocess against a STUBBED
// `wezterm` that records every argv it is handed and can be told to fail or to
// dawdle. What is asserted is therefore the actual bytes that would reach a pane --
// including, on every refusal path, that there are none.
//
// The stub is written here rather than in run.sh because these cases need to vary
// its behaviour per case (fail, sleep) and to read back the calls in the same
// process that made the assertions.
//
// What this cannot show is that micro obeys any of it: that is T07, with a person
// at the screen.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { section, ok, eq, done } from "./harness.mjs";
import { withLock } from "../../bin/cockpit-agenda-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OPEN = path.join(ROOT, "bin", "cockpit-open.mjs");

// run.sh hands each suite its own state dir; standalone, make one.
const DIR = process.env.COCKPIT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "browse-open-dir-"));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "browse-open-"));
process.on("exit", () => { try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* gone */ } });

const PANES = path.join(DIR, "panes.json");
const TABS = path.join(DIR, "viewer-tabs.json");
const TABS_LOCK = path.join(DIR, "viewer-tabs.lock");
const AGENDA_LOCK = path.join(DIR, "agenda.lock");
const CALLS = path.join(WORK, "calls.log");

// --- the stubbed wezterm ---------------------------------------------------
// Extensionless with a node shebang, so it is CommonJS and needs no manifest. It
// records argv EXACTLY -- \x05 and \r are the two bytes a silent failure turns
// into something else, so nothing here may re-quote them.
const STUB_BIN = path.join(WORK, "bin");
fs.mkdirSync(STUB_BIN, { recursive: true });
fs.writeFileSync(path.join(STUB_BIN, "wezterm"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
const ms = Number(process.env.STUB_SLEEP || 0);
if (ms) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (process.env.STUB_FAIL) { process.stderr.write("stub wezterm: refusing\\n"); process.exit(1); }
`);
fs.chmodSync(path.join(STUB_BIN, "wezterm"), 0o755);

// --- a repo to push files out of -------------------------------------------
// Under a symlinked parent on purpose: broot hands back a resolved path while a
// worktree usually is not resolved, which is the case that made `realpath` the
// caller's job (FINDINGS, DESIGN 3.1).
const REAL = path.join(WORK, "real", "proj");
fs.mkdirSync(path.join(REAL, "src"), { recursive: true });
fs.writeFileSync(path.join(REAL, "src", "a.js"), "a\n");
fs.writeFileSync(path.join(REAL, "src", "b.js"), "b\n");
fs.writeFileSync(path.join(REAL, "README.md"), "r\n");
const LINKED = path.join(WORK, "link");            // link -> real/proj
fs.symlinkSync(REAL, LINKED);

const AGENT = "job-abc123";
const VIEWER = 42;
const goodPanes = (over = {}) => ({
  diff: 10, fleet: 20, shell: 30,
  viewer: VIEWER, viewerAgent: AGENT, viewerRoot: REAL,
  ...over,
});

// --- driving it -------------------------------------------------------------

function reset({ panes = goodPanes(), tabs = undefined } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.rmSync(PANES, { force: true });
  fs.rmSync(TABS, { force: true });
  fs.rmSync(TABS_LOCK, { force: true });
  fs.rmSync(AGENDA_LOCK, { force: true });
  fs.writeFileSync(CALLS, "");
  if (panes !== null) fs.writeFileSync(PANES, typeof panes === "string" ? panes : JSON.stringify(panes));
  if (tabs !== undefined) fs.writeFileSync(TABS, typeof tabs === "string" ? tabs : JSON.stringify(tabs));
}

const env = (extra = {}) => ({
  ...process.env,
  PATH: `${STUB_BIN}:${process.env.PATH}`,
  COCKPIT_DIR: DIR,
  CALLS,
  ...extra,
});

/** Every recorded wezterm invocation, as the argv array it actually received. */
const calls = () =>
  fs.readFileSync(CALLS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** The payload of each send-text call, in order -- the bytes micro would see. */
const sent = () => calls().map((c) => c[c.length - 1]);

const readTabs = () => { try { return JSON.parse(fs.readFileSync(TABS, "utf8")); } catch { return null; } };

function run(args, extraEnv = {}) {
  // Each run reports its OWN calls, so a sequence of pushes that deliberately
  // share a tab list (the open/tab/tabswitch progression) still asserts one at a
  // time. `start()` does not truncate: its two processes share the log on purpose.
  fs.writeFileSync(CALLS, "");
  const r = spawnSync(process.execPath, [OPEN, ...args], { env: env(extraEnv), encoding: "utf8" });
  return { code: r.status, stderr: r.stderr.trim(), sent: sent(), calls: calls(), tabs: readTabs() };
}

/** Async twin, for the cases that need two of them alive at once. */
function start(args, extraEnv = {}) {
  const p = spawn(process.execPath, [OPEN, ...args], { env: env(extraEnv), stdio: "ignore" });
  const exited = new Promise((res) => p.on("exit", (code) => res(code)));
  return { proc: p, exited };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
section("10. the happy path: first file, later files, an already-open one");

reset();
const first = run([path.join(REAL, "src/a.js")]);
eq("the first file is one open triple", first.sent, ["\x05", "open src/a.js", "\r"]);
ok("...and exits 0", first.code === 0, `exit ${first.code} ${first.stderr}`);
eq("...and the tab list is written under the jobId", first.tabs, { [AGENT]: ["src/a.js"] });

const second = run([path.join(REAL, "src/b.js")]);
eq("a second distinct file is a tab triple", second.sent, ["\x05", "tab src/b.js", "\r"]);
eq("...and the list grows in order", second.tabs, { [AGENT]: ["src/a.js", "src/b.js"] });

const again = run([path.join(REAL, "src/a.js")]);
eq("a file already open switches to its tab, 1-based", again.sent, ["\x05", "tabswitch 1", "\r"]);
eq("...and the list is unchanged", again.tabs, { [AGENT]: ["src/a.js", "src/b.js"] });

// A relative path is what a verb could just as easily hand over; it must resolve
// against the cwd like any other command's argument.
reset();
const rel = spawnSync(process.execPath, [OPEN, "src/a.js"], { env: env(), cwd: REAL, encoding: "utf8" });
eq("a relative path resolves against the cwd", sent(), ["\x05", "open src/a.js", "\r"]);
ok("...and exits 0", rel.status === 0, `exit ${rel.status} ${rel.stderr}`);

// ---------------------------------------------------------------------------
section("11. the line argument");

reset();
const jump = run([path.join(REAL, "src/a.js"), "42"]);
eq("a line follows the open with its own goto triple",
   jump.sent, ["\x05", "open src/a.js", "\r", "\x05", "goto 42", "\r"]);

reset();
eq("a non-numeric line is dropped, and the file still opens",
   run([path.join(REAL, "src/a.js"), "not-a-line"]).sent, ["\x05", "open src/a.js", "\r"]);

reset();
eq("line 0 is not a line either", run([path.join(REAL, "src/a.js"), "0"]).sent,
   ["\x05", "open src/a.js", "\r"]);

reset();
eq("nor is a fractional one", run([path.join(REAL, "src/a.js"), "12.5"]).sent,
   ["\x05", "open src/a.js", "\r"]);

// The two shapes broot's Enter verb actually produces (T03). `{line}` is the
// matching line only while a `c/` content search is running and is EMPTY the rest
// of the time, so `cockpit-open {file} {line}` arrives either as two arguments or
// as three with a blank one -- depending on whether broot passes an empty token
// through as an argv element. Asserted rather than assumed: a plain Enter is the
// commonest gesture in browse mode and must open the file with no jump.
reset();
eq("an EMPTY line argument -- broot's `{line}` with no content search",
   run([path.join(REAL, "src/a.js"), ""]).sent, ["\x05", "open src/a.js", "\r"]);

reset();
eq("no line argument at all", run([path.join(REAL, "src/a.js")]).sent,
   ["\x05", "open src/a.js", "\r"]);

reset();
eq("a blank-space line argument is not a line either",
   run([path.join(REAL, "src/a.js"), " "]).sent, ["\x05", "open src/a.js", "\r"]);

// ---------------------------------------------------------------------------
section("12. every call is aimed at the viewer, unpasted");
// --no-paste because bracketed paste wraps the text in markers micro's command bar
// reads as literal characters; the pane id because these keystrokes in a revdiff
// pane would be a keybinding each.

reset();
const aimed = run([path.join(REAL, "src/a.js"), "7"]);
ok("six calls, all of them send-text", aimed.calls.length === 6
   && aimed.calls.every((c) => c[0] === "cli" && c[1] === "send-text"), JSON.stringify(aimed.calls));
ok("every call carries --no-paste", aimed.calls.every((c) => c.includes("--no-paste")));
ok("every call names the viewer pane", aimed.calls.every((c) => {
  const i = c.indexOf("--pane-id");
  return i !== -1 && c[i + 1] === String(VIEWER);
}), JSON.stringify(aimed.calls));
ok("the payload is the last argument, never stdin", aimed.calls.every((c) => c.length === 6));

// ---------------------------------------------------------------------------
section("13. refusals send NOTHING");
// The expensive failure is not a refused push, it is a push into the wrong pane:
// panes.json is the only thing that knows a viewer is showing, so anything less
// than all three keys means the daemon does not believe it (DESIGN 3.4, 2.n).

const refuses = (name, args, opts) => {
  reset(opts);
  const r = run(args);
  ok(`${name}: exits 1`, r.code === 1, `exit ${r.code}`);
  ok(`${name}: sent nothing at all`, r.calls.length === 0, JSON.stringify(r.calls));
  return r;
};

const file = path.join(REAL, "src/a.js");
refuses("no viewer key", [file], { panes: goodPanes({ viewer: undefined }) });
refuses("viewer is null", [file], { panes: goodPanes({ viewer: null }) });
refuses("viewer is not a pane id", [file], { panes: goodPanes({ viewer: "not-a-pane" }) });
// Found in review: `Number()` coerces every one of these to 0, which is a REAL
// pane and on a fresh mux the FIRST one -- so the push landed in whatever holds
// pane 0 instead of refusing. A pane id is a number (DESIGN 3.4); these are not.
refuses("viewer is an empty string", [file], { panes: goodPanes({ viewer: "" }) });
refuses("viewer is a blank string", [file], { panes: goodPanes({ viewer: " " }) });
refuses("viewer is false", [file], { panes: goodPanes({ viewer: false }) });
refuses("viewer is true", [file], { panes: goodPanes({ viewer: true }) });
refuses("viewer is an empty array", [file], { panes: goodPanes({ viewer: [] }) });
refuses("viewer is an array holding a number", [file], { panes: goodPanes({ viewer: [7] }) });
refuses("viewer is fractional", [file], { panes: goodPanes({ viewer: 12.5 }) });
refuses("viewer is negative", [file], { panes: goodPanes({ viewer: -1 }) });
refuses("viewer is padded with spaces", [file], { panes: goodPanes({ viewer: " 12 " }) });

// ...but the digit string a hand-edited panes.json might carry is still a pane.
reset({ panes: goodPanes({ viewer: "42" }) });
const strId = run([file]);
ok("a digit string is still accepted as a pane id",
   strId.code === 0 && strId.calls.every((c) => c[c.indexOf("--pane-id") + 1] === "42"),
   `exit ${strId.code} ${JSON.stringify(strId.calls)}`);
reset({ panes: goodPanes({ viewer: 0 }) });
const paneZero = run([file]);
ok("...and a real 0 is accepted, since only the coercions were the problem",
   paneZero.code === 0 && paneZero.calls.every((c) => c[c.indexOf("--pane-id") + 1] === "0"),
   `exit ${paneZero.code} ${JSON.stringify(paneZero.calls)}`);
refuses("viewerAgent missing", [file], { panes: goodPanes({ viewerAgent: undefined }) });
refuses("viewerAgent null", [file], { panes: goodPanes({ viewerAgent: null }) });
refuses("viewerAgent empty", [file], { panes: goodPanes({ viewerAgent: "" }) });
refuses("viewerRoot missing", [file], { panes: goodPanes({ viewerRoot: undefined }) });
refuses("viewerRoot null", [file], { panes: goodPanes({ viewerRoot: null }) });
refuses("panes.json absent", [file], { panes: null });
refuses("panes.json unparseable", [file], { panes: "{not json" });
refuses("panes.json is an array", [file], { panes: "[1,2,3]" });
refuses("no argument at all", []);
refuses("an empty path", [""]);

const gone = refuses("the file does not exist", [path.join(REAL, "src/ghost.js")]);
ok("...and stderr names it", gone.stderr.includes("ghost.js"), gone.stderr);

// A carriage return SUBMITS micro's command bar half way through the filename and
// runs whatever the first half spells; the newline is the tamer version. The model
// has no refusal channel, so the guard is here (FINDINGS).
const cr = refuses("a path holding a carriage return", [`${REAL}/src/a.js\rquit`]);
ok("...and says so", /carriage return|newline/.test(cr.stderr), cr.stderr);
refuses("a path holding a newline", [`${REAL}/src/a.js\nquit`]);

// Found in review: the guard saw the ARGUMENT, but what is sent is the RESOLVED
// path -- and a symlink can resolve into a directory whose own name holds one.
// Measured before the fix: `open we\rird/f.js` went out, which micro submits at
// the `\r` as `open we`.
const crDir = path.join(REAL, "we\rird");
fs.mkdirSync(crDir, { recursive: true });
fs.writeFileSync(path.join(crDir, "f.js"), "x\n");
const crLink = path.join(REAL, "innocent.js");
fs.symlinkSync(path.join(crDir, "f.js"), crLink);
const viaLink = refuses("a symlink resolving into a carriage return", [crLink]);
ok("...and says it was the resolved path", /resolved path/.test(viaLink.stderr), viaLink.stderr);

// Refusing must not leave state behind either -- a tab list written under an empty
// key would hand the next agent someone else's tabs.
reset({ panes: goodPanes({ viewerAgent: "" }) });
run([file]);
eq("a refusal writes no tab list at all", readTabs(), null);

// ---------------------------------------------------------------------------
section("14. realpath, both sides");
// broot resolves symlinks and a worktree path usually does not. Relativising one
// against the other yields a ../../../.. chain, which the model refuses to emit --
// so it degrades to the absolute path unless the CALLER resolves both.

reset({ panes: goodPanes({ viewerRoot: LINKED }) });
eq("an unresolved root still gives a short label",
   run([path.join(REAL, "src/a.js")]).sent, ["\x05", "open src/a.js", "\r"]);

reset({ panes: goodPanes({ viewerRoot: REAL }) });
eq("...and so does an unresolved file path",
   run([path.join(LINKED, "src/a.js")]).sent, ["\x05", "open src/a.js", "\r"]);

reset({ panes: goodPanes({ viewerRoot: LINKED }) });
eq("...and both unresolved at once",
   run([path.join(LINKED, "src/b.js")]).sent, ["\x05", "open src/b.js", "\r"]);

// The third recorded deviation, which nothing asserted until this review: a
// viewerRoot that does not resolve is NOT a refusal. Losing the push over a
// cosmetic detail is the worse trade, and an unresolvable root is no evidence
// that the viewer is wrong -- so the push lands with a longer label.
reset({ panes: goodPanes({ viewerRoot: path.join(WORK, "no", "such", "root") }) });
const noRoot = run([path.join(REAL, "src/a.js")]);
ok("an unresolvable viewerRoot still pushes", noRoot.code === 0, `exit ${noRoot.code} ${noRoot.stderr}`);
eq("...with the absolute path as the label",
   noRoot.sent, ["\x05", `open ${fs.realpathSync(path.join(REAL, "src/a.js"))}`, "\r"]);

// Outside the root there is nothing to shorten, and an absolute label is the
// deliberate degrade -- micro can still open it.
const outside = path.join(WORK, "real", "elsewhere.txt");
fs.writeFileSync(outside, "x\n");
reset();
eq("a file outside the worktree keeps its absolute path",
   run([outside]).sent, ["\x05", `open ${fs.realpathSync(outside)}`, "\r"]);

// ---------------------------------------------------------------------------
section("15. a failed send never updates the tab list");
// Believing in a tab that was never opened is the expensive mistake: every later
// push would tabswitch to a number micro does not have and land on the wrong file,
// silently. Untidy beats wrong (DESIGN 2.n).

reset();
const failed = run([file], { STUB_FAIL: "1" });
ok("a wezterm that exits non-zero fails the push", failed.code === 1, `exit ${failed.code}`);
eq("...and no tab list is written", failed.tabs, null);
ok("...and it stops at the first failure rather than typing on", failed.calls.length === 1,
   JSON.stringify(failed.calls));

reset({ tabs: { [AGENT]: ["src/a.js"] } });
const failed2 = run([path.join(REAL, "src/b.js")], { STUB_FAIL: "1" });
eq("an existing list is left exactly as it was", failed2.tabs, { [AGENT]: ["src/a.js"] });

// Found in review: a state dir that cannot be written (full, read-only) threw out
// of `writeTabs` uncaught, so the command answered with a stack trace instead of
// the ONE line on stderr its own interface promises. A directory where the file
// belongs is the cheapest way to make the rename fail without breaking the lock.
reset();
fs.mkdirSync(TABS, { recursive: true });
const unwritable = run([file]);
ok("an unwritable tab list still exits 1", unwritable.code === 1, `exit ${unwritable.code}`);
ok("...with one line, not a stack trace",
   unwritable.stderr.split("\n").length === 1 && /could not be written/.test(unwritable.stderr),
   JSON.stringify(unwritable.stderr));
ok("...and the push itself had already gone out", unwritable.calls.length === 3,
   JSON.stringify(unwritable.calls));
fs.rmSync(TABS, { recursive: true, force: true });

// ---------------------------------------------------------------------------
section("16. the tab list is per agent, and survives corruption");

reset({ tabs: { "job-other": ["docs/x.md"] } });
const other = run([file]);
eq("another agent's tabs are untouched", other.tabs,
   { "job-other": ["docs/x.md"], [AGENT]: ["src/a.js"] });

reset({ tabs: "{{{ not json" });
const corrupt = run([file]);
ok("a corrupt tab list does not throw", corrupt.code === 0, `exit ${corrupt.code} ${corrupt.stderr}`);
eq("...it is treated as empty, so the push uses `open`", corrupt.sent, ["\x05", "open src/a.js", "\r"]);
eq("...and the file is rewritten whole", corrupt.tabs, { [AGENT]: ["src/a.js"] });

reset({ tabs: { [AGENT]: "not-a-list" } });
eq("a non-array entry is treated as empty too",
   run([file]).sent, ["\x05", "open src/a.js", "\r"]);

// ---------------------------------------------------------------------------
section("17. the lock: concurrent pushes, stale locks, and whose lock it is");

// Two pushes landing together (you and an agent, DESIGN 2.n). Both must land: the
// second has to SEE the first's entry, or both would decide `open` and the second
// would replace the first's buffer instead of adding a tab.
reset();
const slow = { STUB_SLEEP: "80" };
const a = start([path.join(REAL, "src/a.js")], slow);
const b = start([path.join(REAL, "src/b.js")], slow);
const codes = await Promise.all([a.exited, b.exited]);
eq("both concurrent pushes exit 0", codes, [0, 0]);
const bothTabs = readTabs()?.[AGENT] ?? [];
eq("...and the list ends with BOTH, never one", [...bothTabs].sort(), ["src/a.js", "src/b.js"]);
ok("...one of them used `open` and the other `tab`",
   sent().filter((p) => p.startsWith("open ")).length === 1
   && sent().filter((p) => p.startsWith("tab ")).length === 1, JSON.stringify(sent()));

// A process killed mid-write leaves the lock behind forever; 5s is the stale
// window notes.lock and agenda.lock already use.
reset();
fs.writeFileSync(TABS_LOCK, "");
const old = Date.now() / 1000 - 6;
fs.utimesSync(TABS_LOCK, old, old);
const t0 = Date.now();
const stale = run([file]);
ok("a lock older than 5s is broken", stale.code === 0, `exit ${stale.code} ${stale.stderr}`);
ok("...promptly", Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
eq("...and the push lands", stale.tabs, { [AGENT]: ["src/a.js"] });

// A FRESH lock is somebody's live write; it is waited for, not stolen.
reset();
fs.writeFileSync(TABS_LOCK, "");
const held = start([file]);
await sleep(400);
const stillWaiting = readTabs() === null && held.proc.exitCode === null;
ok("a fresh lock is waited for, not broken", stillWaiting,
   `tabs=${JSON.stringify(readTabs())} exit=${held.proc.exitCode}`);
fs.rmSync(TABS_LOCK, { force: true });
ok("...and the push completes once it is released", (await held.exited) === 0);
eq("...having done its work", readTabs(), { [AGENT]: ["src/a.js"] });

// The agenda's lock is a different file, and browse mode's push must not queue
// behind a calendar refresh (DESIGN 3.5).
reset();
fs.writeFileSync(AGENDA_LOCK, "");
const t1 = Date.now();
const past = run([file]);
ok("a held agenda.lock does not block a push", past.code === 0 && Date.now() - t1 < 2000,
   `exit ${past.code} in ${Date.now() - t1}ms`);
ok("...and the push did not touch it", fs.existsSync(AGENDA_LOCK));
fs.rmSync(AGENDA_LOCK, { force: true });

reset();
run([file]);
ok("no lock is left behind on the happy path", !fs.existsSync(TABS_LOCK));

// ---------------------------------------------------------------------------
section("18. withLock counts depth per FILE, not per process");
// One module-level counter was right while there was one lock. With two, a
// viewer-tabs write nested inside an agenda one would see depth > 0, take the
// reentrant branch and run holding NO lock on its own file -- the exact failure
// the counter exists to prevent, in a new disguise.

reset();
let sawTabsLock = null;
let sawAgendaLock = null;
withLock(() => {
  sawAgendaLock = fs.existsSync(AGENDA_LOCK);
  withLock(() => { sawTabsLock = fs.existsSync(TABS_LOCK); }, TABS_LOCK);
});
ok("the outer agenda call really holds agenda.lock", sawAgendaLock === true);
ok("a viewer-tabs lock nested inside it takes its OWN file lock", sawTabsLock === true);
ok("both are released afterwards", !fs.existsSync(AGENDA_LOCK) && !fs.existsSync(TABS_LOCK));

// The agenda's own nesting is unchanged: same file, so still reentrant rather than
// spinning the whole retry budget against a lock this process is holding.
const t2 = Date.now();
let inner = false;
withLock(() => { withLock(() => { inner = true; }); });
const nested = Date.now() - t2;
ok("the agenda's own nesting still counts as reentrant", inner && nested < 1000, `took ${nested}ms`);
ok("...and leaves no lock behind", !fs.existsSync(AGENDA_LOCK));

// The same reentrancy now holds for any lock file, including the new one.
const t3 = Date.now();
let inner2 = false;
withLock(() => { withLock(() => { inner2 = true; }, TABS_LOCK); }, TABS_LOCK);
ok("viewer-tabs.lock is reentrant with itself too", inner2 && Date.now() - t3 < 1000);
ok("...and released", !fs.existsSync(TABS_LOCK));

// ---------------------------------------------------------------------------
section("19. the state never lands in the repo");
// A file written into the checkout appears in `revdiff --untracked HEAD` -- the
// very diff the agent is being reviewed on.

reset();
run([file]);
ok("viewer-tabs.json is written under COCKPIT_DIR", fs.existsSync(TABS));
ok("...and nowhere near the checkout", !fs.existsSync(path.join(ROOT, "viewer-tabs.json")));

done();
