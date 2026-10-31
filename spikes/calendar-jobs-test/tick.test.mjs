// The tick against a fake `claude` in a throwaway COCKPIT_DIR. run.sh sets both up;
// this refuses to run otherwise, because the real binary would start a real agent.

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { section, ok, eq, done } from "../agenda-test/harness.mjs";

const SCRATCH = process.env.COCKPIT_DIR;
const IDENTITY = (() => {
  try { return execFileSync("claude", ["--i-am-the-fake"], { encoding: "utf8" }).trim(); } catch { return ""; }
})();
if (!SCRATCH || !process.env.FAKE_CLAUDE_LOG || IDENTITY !== "fake-claude") {
  console.log("  FAIL refusing to run: use spikes/calendar-jobs-test/run.sh");
  process.exit(1);
}

const { jobsTick, recoverStarting, fetchJobCalendars } = await import("../../bin/cockpit-jobs.mjs");
const { readLedger, writeLedger, pruneLedger, LEDGER_FILE } = await import("../../bin/cockpit-jobs-store.mjs");
const { putCacheEntry, STATE_FILE, CACHE_FILE } = await import("../../bin/cockpit-agenda-store.mjs");
const { readNotes, NOTES_FILE } = await import("../../bin/cockpit-notes.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOBS_BIN = path.join(HERE, "../../bin/cockpit-jobs.mjs");
const LOG = process.env.FAKE_CLAUDE_LOG;
const ZONE = "Europe/Warsaw";
const T = (s) => Date.parse(s);
const START = T("2026-11-01T20:00:00Z");
const END = T("2026-11-01T23:00:00Z");
const ROOT = path.join(SCRATCH, "root");
const NOW = START + 1000;

fs.mkdirSync(path.join(ROOT, "proj", ".git"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "proj2", ".git"), { recursive: true });

const calls = () => fs.existsSync(LOG)
  ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const notes = () => readNotes(ROOT);

function reset({ jobs = true, mode } = {}) {
  for (const f of fs.readdirSync(SCRATCH)) {
    if (f !== "root") fs.rmSync(path.join(SCRATCH, f), { recursive: true, force: true });
  }
  fs.rmSync(LOG, { force: true });
  if (mode) process.env.FAKE_CLAUDE_MODE = mode; else delete process.env.FAKE_CLAUDE_MODE;
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    version: 1,
    accounts: { "me@x.y": { refreshToken: "r", addedAt: 1 } },
    calendars: [{
      slug: "night", account: "me@x.y", calendarId: "cal", title: "n", colour: null, addedAt: 1,
      ...(jobs ? { jobs: true, jobsSince: T("2026-10-01T00:00:00Z") } : {}),
    }],
  }));
}

const ev = (over = {}) => ({
  id: "evt1", title: "proj", start: START, end: END, allDay: false, reply: "n/a", slug: "night",
  description: "run the tests", creatorOwn: true, ...over,
});
const cached = (events = [ev()], { fetchedAt = NOW, error = null } = {}) =>
  putCacheEntry("night", { fetchedAt, events, error });
const logLines = [];
const log = (l) => logLines.push(l);
const tick = (over = {}) => jobsTick({ now: NOW, projectsRoot: ROOT, zone: ZONE, notesRepo: ROOT, log, ...over });
const entry = (key = "night/evt1") => readLedger().entries[key];

section("starting and started");
{
  reset();
  cached();
  await tick();
  const c = calls();
  eq("one invocation", c.length, 1);
  eq("the ledger held `starting` when claude was invoked", c[0].ledger?.entries?.["night/evt1"]?.state, "starting");
  eq("it runs in the project", fs.realpathSync(c[0].cwd), fs.realpathSync(path.join(ROOT, "proj")));
  ok("the prompt is the last argument", c[0].args.at(-1) === "Instructions from the calendar entry:\nrun the tests");
  eq("exit 0 is `started`", entry().state, "started");
  eq("...with the id parsed", entry().agentId, "ab12cd34");
  eq("a successful start adds no note", notes().length, 0);
  eq("the ledger file is 0600", fs.statSync(LEDGER_FILE).mode & 0o777, 0o600);

  await tick();
  await tick({ now: NOW + 60000 });
  eq("two more ticks, still one start", calls().length, 1);
}
{
  reset({ mode: "read-stdin" });
  cached();
  await tick();
  eq("stdin is closed, so a program that reads it finishes", entry().state, "started");
}

section("failed");
{
  reset({ mode: "trust" });
  cached();
  await tick();
  eq("exit 1 is `failed`", entry().state, "failed");
  ok("...with the first line as its reason", /^Workspace not trusted/.test(entry().reason), entry().reason);
  ok("...and not the second", !/second line/.test(entry().reason));
  eq("one note", notes().length, 1);
  ok("the note carries Claude's line", /failed to start: Workspace not trusted/.test(notes()[0].text), notes()[0].text);
  await tick({ now: NOW + 60000 });
  eq("no retry on the next tick", calls().length, 1);
  eq("no second note", notes().length, 1);
}
{
  reset({ mode: "garbled" });
  cached();
  await tick();
  eq("unparseable success output is still `started`", entry().state, "started");
  eq("...with no id", entry().agentId, undefined);
  eq("...and no note", notes().length, 0);
}
{
  reset({ mode: "silent-fail" });
  cached();
  await tick();
  eq("a silent failure is `failed`", entry().state, "failed");
  eq("...and says only the status, never the command line", entry().reason, "claude exited with status 3");
}
{
  // execFile's error.message quotes the whole command line, instructions included.
  reset();
  cached([ev({ description: "secret\0nul" })]);
  await tick();
  eq("a NUL byte in the instructions is `failed`", entry().state, "failed");
  eq("...and claude was never invoked", calls().length, 0);
  ok("...and the reason quotes nothing", !/secret/.test(entry().reason), entry().reason);
  ok("...nor does the note", !/secret/.test(notes()[0]?.text ?? "secret"), notes()[0]?.text);
}
{
  reset();
  cached();
  const savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent";
  await tick();
  process.env.PATH = savedPath;
  eq("claude missing is `failed`, not a crash", entry().state, "failed");
  ok("...saying so", /could not run claude/.test(entry().reason), entry().reason);
}

{
  // The limit is read at import, so this goes through the command with a short one.
  reset({ mode: "hang" });
  cached([ev({ start: Date.now() - 1000, end: Date.now() + 60000 })], { fetchedAt: Date.now() });
  const at = Date.now();
  execFileSync("node", [JOBS_BIN, "--once", "--root", ROOT], {
    env: { ...process.env, COCKPIT_JOBS_START_LIMIT_MS: "300" }, stdio: "ignore",
  });
  eq("a claude that never answers is `failed`", entry().state, "failed");
  ok("...at the limit", Date.now() - at < 20000, `${Date.now() - at}ms`);
  ok("...saying so", /no answer from claude/.test(entry().reason), entry().reason);
}
{
  reset();
  cached([], { error: { kind: "auth", since: NOW } });
  fs.mkdirSync(LEDGER_FILE);
  await tick();
  await tick();
  eq("a ledger it cannot write repeats no note", notes().length, 0);
  fs.rmdirSync(LEDGER_FILE);
}
{
  reset();
  fs.mkdirSync(LEDGER_FILE);
  cached();
  let code = 0;
  try { execFileSync("node", [JOBS_BIN, "--once", "--root", ROOT], { stdio: "ignore" }); }
  catch (e) { code = e.status; }
  eq("--once exits 1 when its pass failed", code, 1);
  fs.rmdirSync(LEDGER_FILE);
  let usage = 0;
  try { execFileSync("node", [JOBS_BIN, "--bogus"], { stdio: "ignore" }); } catch (e) { usage = e.status; }
  eq("an unknown flag is a usage error", usage, 2);
  let noRoot = 0;
  try { execFileSync("node", [JOBS_BIN, "--once"], { stdio: "ignore" }); } catch (e) { noRoot = e.status; }
  eq("no root and no panes.json is an error", noRoot, 2);
}

section("a tick overlapping a running tick");
{
  reset({ mode: "hold" });
  const release = path.join(SCRATCH, "release");
  process.env.FAKE_CLAUDE_RELEASE = release;
  cached();
  const first = tick();
  for (let i = 0; i < 400 && calls().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  eq("the first tick reached claude", calls().length, 1);
  const before = fs.statSync(LEDGER_FILE).mtimeMs;
  await tick();
  eq("the second does nothing", calls().length, 1);
  eq("...and wrote nothing", fs.statSync(LEDGER_FILE).mtimeMs, before);
  fs.writeFileSync(release, "");
  await first;
  eq("the first finishes", entry().state, "started");
  // The guard has to come down again, or the feature silently stops after one pass.
  cached([ev(), ev({ id: "evt2", title: "proj2" })]);
  await tick();
  eq("a later tick runs again", entry("night/evt2").state, "started");
}

section("overlapping entries");
{
  reset();
  cached([ev(), ev({ id: "evt2", title: "proj2" })]);
  await tick();
  eq("both start", calls().length, 2);
  ok("the second call saw the first as started", calls()[1].ledger.entries["night/evt1"].state === "started");
}

section("refused and missed");
{
  reset();
  cached([ev({ description: "" }), ev({ id: "gone1", start: START - 7200000, end: START - 3600000 })]);
  await tick();
  eq("nothing starts", calls().length, 0);
  eq("refused is recorded", entry().state, "refused");
  eq("...with its reason", entry().reason, "empty");
  eq("missed is recorded", entry("night/gone1").state, "missed");
  eq("one note each", notes().length, 2);
  await tick();
  eq("no repeat", notes().length, 2);
}
{
  reset();
  cached();
  fs.rmSync(path.join(ROOT, "proj", ".git"), { recursive: true });
  await tick();
  fs.mkdirSync(path.join(ROOT, "proj", ".git"));
  eq("a folder that is not a repo is refused", entry().reason, "bad-project");
}

section("recoverStarting");
{
  reset();
  writeLedger({ version: 1, entries: {
    "night/evt1": { state: "starting", at: NOW - 1000, project: "proj" },
    "night/done": { state: "started", at: NOW - 1000, project: "proj" },
  }, authNoted: {} });
  recoverStarting({ now: NOW, notesRepo: ROOT, log });
  eq("starting becomes unknown", entry().state, "unknown");
  eq("started is left alone", entry("night/done").state, "started");
  eq("one note", notes().length, 1);
  ok("the note names the project", /"proj" may not have started/.test(notes()[0].text), notes()[0].text);
  recoverStarting({ now: NOW, notesRepo: ROOT, log });
  eq("a second recovery adds nothing", notes().length, 1);
  cached();
  await tick();
  eq("it is never restarted", calls().length, 0);
}
{
  reset();
  recoverStarting({ now: NOW, notesRepo: ROOT, log });
  ok("with no ledger, none is written", !fs.existsSync(LEDGER_FILE));
}

section("a corrupt ledger");
{
  reset();
  cached();
  fs.writeFileSync(LEDGER_FILE, "{ not json");
  await tick();
  const aside = fs.readdirSync(SCRATCH).filter((f) => f.startsWith("calendar-jobs.json.corrupt-"));
  eq("moved aside", aside.length, 1);
  eq("...named for the time", aside[0], `calendar-jobs.json.corrupt-${NOW}`);
  eq("...with its contents", fs.readFileSync(path.join(SCRATCH, aside[0]), "utf8"), "{ not json");
  eq("...0600", fs.statSync(path.join(SCRATCH, aside[0])).mode & 0o777, 0o600);
  eq("one note", notes().length, 1);
  ok("the note names where it went", notes()[0].text.includes(aside[0]), notes()[0].text);
  eq("notBefore is now", readLedger().notBefore, NOW);
  eq("an entry inside its window does not re-run", calls().length, 0);
  await tick({ now: NOW + 30000 });
  eq("still no run, still one note", [calls().length, notes().length], [0, 1]);
  // After notBefore is a new entry, which is not what the corruption is about.
  cached([ev(), ev({ id: "later", start: NOW + 1000 })]);
  await tick({ now: NOW + 2000 });
  eq("a later entry does start", calls().length, 1);
  eq("...only that one", entry("night/later").state, "started");
}
{
  reset();
  cached();
  fs.writeFileSync(LEDGER_FILE, JSON.stringify([1, 2]));
  await tick();
  eq("valid JSON of the wrong shape is corrupt too", readLedger().notBefore, NOW);
  eq("...and nothing runs", calls().length, 0);
}
{
  // Reading as empty here would re-run everything, so it starts nothing.
  reset();
  cached();
  fs.mkdirSync(LEDGER_FILE);
  logLines.length = 0;
  await tick();
  eq("a ledger it cannot read starts nothing", calls().length, 0);
  ok("...and logs a failed tick, not a rejection", logLines.some((l) => /tick failed/.test(l)), logLines.join("|"));
  fs.rmdirSync(LEDGER_FILE);
}

section("fetch failures");
{
  reset();
  const auth = { kind: "auth", reason: "", code: "", detail: "", since: NOW };
  cached([], { error: auth });
  await tick();
  await tick();
  await tick();
  eq("auth: one note across many ticks", notes().length, 1);
  ok("...naming the repair", /agenda add night/.test(notes()[0].text), notes()[0].text);
  cached([], { error: { ...auth, kind: "network" } });
  await tick();
  eq("a network blip in the episode adds none", notes().length, 1);
  cached([], { error: auth });
  await tick();
  eq("...and does not end it", notes().length, 1);
  cached([]);
  await tick();
  eq("a success ends the episode", readLedger().authNoted, {});
  cached([], { error: auth });
  await tick();
  eq("a new note after a success and a second failure", notes().length, 2);
}
{
  reset();
  cached([], { error: { kind: "gone", since: NOW } });
  await tick();
  await tick();
  eq("gone: one note", notes().length, 1);
  ok("...naming the repair", /agenda rm night/.test(notes()[0].text), notes()[0].text);
}
{
  reset();
  cached([], { error: { kind: "auth", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", since: NOW } });
  await tick();
  ok("a scope failure is an auth note", /agenda add night/.test(notes()[0]?.text ?? ""));
}
{
  reset();
  cached([], { error: { kind: "network", since: NOW } });
  await tick();
  cached([], { error: { kind: "unknown", since: NOW } });
  await tick();
  eq("network and unknown: no note", notes().length, 0);
  ok("...and no ledger", !fs.existsSync(LEDGER_FILE));
}

section("a corrupt agenda.json");
{
  reset();
  cached();
  fs.writeFileSync(STATE_FILE, "{ broken");
  await tick();
  eq("left in place", fs.readFileSync(STATE_FILE, "utf8"), "{ broken");
  eq("nothing quarantined", fs.readdirSync(SCRATCH).filter((f) => f.includes("corrupt")), []);
  eq("nothing starts", calls().length, 0);
}

section("no jobs calendar");
{
  reset({ jobs: false });
  cached();
  fs.rmSync(LEDGER_FILE, { force: true });
  await tick();
  eq("no start", calls().length, 0);
  ok("no ledger is written", !fs.existsSync(LEDGER_FILE));
}

section("notes");
{
  reset({ mode: "trust" });
  cached();
  await tick();
  eq("author is calendar", notes().map((n) => n.author), ["calendar"]);
  ok("stored under notesRepo", Object.keys(JSON.parse(fs.readFileSync(NOTES_FILE, "utf8")).repos).includes(ROOT));
}

section("dry run");
{
  reset();
  cached([ev(), ev({ id: "bad", description: "" }), ev({ id: "over", start: START - 7200000, end: START - 3600000 })]);
  const out = [];
  process.env.COCKPIT_JOBS_DRY_RUN = "1";
  logLines.length = 0;
  await tick({ print: (l) => out.push(l) });
  eq("no invocation", calls().length, 0);
  ok("no ledger", !fs.existsSync(LEDGER_FILE));
  ok("no notes", !fs.existsSync(NOTES_FILE));
  ok("prints the argv", out.some((l) => l.includes('"--bg"') && l.includes("run the tests")), out.join("\n"));
  ok("prints the decisions", out.some((l) => /would record night\/bad: refused \(empty\)/.test(l)), out.join("\n"));
  ok("...and the notes", out.some((l) => /would note: .*skipped/.test(l)), out.join("\n"));
  ok("the log still holds no instructions", !logLines.join("\n").includes("run the tests"));

  fs.writeFileSync(LEDGER_FILE, "{ corrupt");
  await tick();
  eq("a corrupt ledger is left where it is", fs.readFileSync(LEDGER_FILE, "utf8"), "{ corrupt");
  eq("...with no copy", fs.readdirSync(SCRATCH).filter((f) => f.includes(".corrupt-")), []);
  eq("...and nothing runs against it", calls().length, 0);
  ok("...and no note", !fs.existsSync(NOTES_FILE));
  fs.rmSync(LEDGER_FILE);

  writeLedger({ version: 1, entries: { "night/x": { state: "starting", at: NOW } }, authNoted: {} });
  recoverStarting({ now: NOW, notesRepo: ROOT, log });
  eq("recovery changes nothing either", entry("night/x").state, "starting");
  ok("...and adds no note", !fs.existsSync(NOTES_FILE));
  fs.rmSync(LEDGER_FILE);

  // The command itself, against a fixture: what the task's "done when" names.
  cached([ev({ start: Date.now() - 1000, end: Date.now() + 60000 })], { fetchedAt: Date.now() });
  const stdout = execFileSync("node", [JOBS_BIN, "--once", "--root", ROOT], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  const argv = JSON.parse(stdout.split("\n").find((l) => l.includes("argv: ")).split("argv: ")[1]);
  eq("--once prints the flags", argv.slice(0, 2), ["claude", "--bg"]);
  eq("--once prints the prompt", argv.at(-1), "Instructions from the calendar entry:\nrun the tests");
  ok("--once wrote nothing", !fs.existsSync(LEDGER_FILE) && calls().length === 0);
  delete process.env.COCKPIT_JOBS_DRY_RUN;
}

section("hostile instructions");
{
  reset();
  const canary = path.join(SCRATCH, "pwned");
  const hostile = `$(touch ${canary}) \`touch ${canary}\` "double" 'single'\nline two; touch ${canary}\n--dangerous`;
  cached([ev({ description: hostile })]);
  logLines.length = 0;
  await tick();
  eq("reach claude byte-exact", calls()[0].args.at(-1), `Instructions from the calendar entry:\n${hostile}`);
  ok("run nothing", !fs.existsSync(canary));
  ok("appear in no log", !logLines.join("\n").includes("double"), logLines.join("|"));
  ok("a log line carries slug, project and state", logLines.includes("jobs: night proj started"), logLines.join("|"));
}
{
  reset({ mode: "trust" });
  cached([ev({ title: "bad title; $(x)", description: "TOPSECRET" }), ev({ id: "e2", description: "TOPSECRET" })]);
  logLines.length = 0;
  await tick();
  const all = logLines.join("\n");
  ok("a failure logs no instructions", !all.includes("TOPSECRET"), all);
  ok("...no Claude output", !all.includes("Workspace"), all);
  ok("...and no hostile title", !all.includes("bad title"), all);
  ok("the notes hold no instructions", !notes().some((n) => n.text.includes("TOPSECRET")));
}

section("the store");
{
  reset();
  eq("an absent ledger reads empty", readLedger(), { version: 1, entries: {}, authNoted: {} });
  const old = NOW - 31 * 86400000, fresh = NOW - 29 * 86400000;
  const input = { version: 1, notBefore: 5, entries: { a: { state: "started", at: old }, b: { state: "failed", at: fresh } }, authNoted: { s: true } };
  const copy = JSON.stringify(input);
  const pruned = pruneLedger(input, NOW);
  eq("prune drops past 30 days only", Object.keys(pruned.entries), ["b"]);
  eq("...keeps the rest", [pruned.notBefore, pruned.authNoted], [5, { s: true }]);
  eq("...and is pure", JSON.stringify(input), copy);
  writeLedger(pruned);
  eq("round trips", readLedger(), pruned);
  eq("no temp left behind", fs.readdirSync(SCRATCH).filter((f) => f.endsWith(".tmp")), []);
  writeLedger({ ...pruned, corruptedTo: "/x" });
  ok("corruptedTo is never written", !fs.readFileSync(LEDGER_FILE, "utf8").includes("corruptedTo"));

  writeLedger({ version: 1, entries: { a: { state: "started", at: old } }, authNoted: {} });
  cached([ev({ description: "" })]);
  await tick();
  ok("a tick prunes", !entry("a") && entry("night/evt1"));
}

// --- a stand-in Google, for --fetch and live-check.sh ------------------------

const raw = (over = {}) => ({
  id: "evt1", summary: "proj", description: "<b>run</b> it",
  start: { dateTime: new Date(Date.now() - 60000).toISOString() },
  end: { dateTime: new Date(Date.now() + 3600000).toISOString() },
  creator: { email: "me@x.y", self: true }, ...over,
});
let eventsReply = { status: 200, body: { items: [raw()], timeZone: ZONE } };
const eventQueries = [];
const google = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let r = { status: 404, body: {} };
  if (url.pathname === "/token") r = { status: 200, body: { access_token: "tok", expires_in: 3600 } };
  else if (url.pathname.endsWith("/events")) { eventQueries.push(Object.fromEntries(url.searchParams)); r = eventsReply; }
  res.writeHead(r.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(r.body));
});
await new Promise((r) => google.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${google.address().port}`;
process.env.AGENDA_ORIGIN = ORIGIN;

const writeClient = (dir) => fs.writeFileSync(path.join(dir, "agenda-client.json"),
  JSON.stringify({ version: 1, clientId: "id", clientSecret: "sec" }));

section("--fetch");
{
  reset();
  writeClient(SCRATCH);
  eventQueries.length = 0;
  const now = Date.now();
  const cache = await fetchJobCalendars({ now, zone: ZONE, log });
  const e = cache.calendars.night.events[0];
  eq("carries the description", e.description, "<b>run</b> it");
  eq("carries creatorOwn", e.creatorOwn, true);
  ok("written to the cache", fs.readFileSync(CACHE_FILE, "utf8").includes("creatorOwn"));
  ok("asks from at least seven days back", Date.parse(eventQueries[0].timeMin) <= now - 7 * 86400000);

  eventsReply = { status: 401, body: { error: { message: "nope" } } };
  const failed = await fetchJobCalendars({ now: now + 1, zone: ZONE, log });
  eq("a failure keeps the events", failed.calendars.night.events.length, 1);
  eq("...and records the kind", failed.calendars.night.error.kind, "auth");
  eventsReply = { status: 200, body: { items: [raw()], timeZone: ZONE } };

  fs.rmSync(CACHE_FILE);
  process.env.COCKPIT_JOBS_DRY_RUN = "1";
  const mem = await fetchJobCalendars({ now, zone: ZONE, log });
  delete process.env.COCKPIT_JOBS_DRY_RUN;
  eq("a dry run still returns the events", mem.calendars.night.events.length, 1);
  ok("...and does not write the cache", !fs.existsSync(CACHE_FILE));
}

// --- live-check.sh -----------------------------------------------------------

function liveCheck(args, env) {
  return new Promise((resolve) => {
    execFile("bash", [path.join(HERE, "live-check.sh"), ...args], { env: { ...process.env, ...env } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

section("live-check.sh");
{
  reset();
  const real = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-real-"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-tmp-"));
  writeClient(real);
  const realState = JSON.stringify({
    version: 1, accounts: { "me@x.y": { refreshToken: "REFRESHTOKEN", addedAt: 1 } },
    // A jobs calendar in the real copy, which must not run from the scratch one.
    calendars: [{ slug: "realjobs", account: "me@x.y", calendarId: "realjobs-id", title: "r", colour: null, addedAt: 1, jobs: true, jobsSince: 1 }],
  });
  fs.writeFileSync(path.join(real, "agenda.json"), realState);
  const env = { LIVE_COCKPIT_DIR: real, LIVE_ROOT: ROOT, TMPDIR: tmp, FAKE_CLAUDE_MODE: "" };
  eventQueries.length = 0;
  const r = await liveCheck(["test-cal", "me@x.y"], env);
  eq("exits 0", r.code, 0);
  eq("one real start across the two real passes", calls().length, 1);
  const parts = r.stdout.split("=== ");
  ok("the dry run prints the argv", parts.find((p) => p.startsWith("dry run")).includes("argv: "), r.stdout);
  ok("the second pass starts nothing", /"state": "started"/.test(parts.find((p) => p.startsWith("second"))), r.stdout);
  ok("the notes are printed", parts.find((p) => p.startsWith("scratch notes")).includes("(none)"), r.stdout);
  ok("the token is never printed", !r.stdout.includes("REFRESHTOKEN") && !r.stderr.includes("REFRESHTOKEN"));
  eq("the scratch directory is gone", fs.readdirSync(tmp), []);
  eq("the real file is untouched", fs.readFileSync(path.join(real, "agenda.json"), "utf8"), realState);
  eq("nothing else appeared beside it", fs.readdirSync(real).sort(), ["agenda-client.json", "agenda.json"]);
  ok("only the named calendar is read", eventQueries.length === 3, String(eventQueries.length));

  fs.rmSync(LOG, { force: true });
  const refused = await liveCheck(["test-cal", "other@x.y"], env);
  eq("an account with no sign-in is refused", refused.code, 2);
  ok("...saying so", /no sign-in/.test(refused.stderr), refused.stderr);
  eq("...starting nothing", calls().length, 0);
  eq("...and the scratch directory is gone", fs.readdirSync(tmp), []);

  eq("no arguments is a usage error", (await liveCheck([], env)).code, 2);
  fs.rmSync(real, { recursive: true });
  fs.rmSync(tmp, { recursive: true });
}

google.close();
done();
