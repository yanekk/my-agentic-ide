// live-check.sh against a stand-in pir service (plans/pir-usage-reader T06, DESIGN 4).
// The script is what the after-merge checklist runs on the real machine; here it is
// proven with a node:http stand-in on an OS-chosen port, PIR_HOME at a scratch home
// whose api.json names it, LIVE_COCKPIT_DIR and TMPDIR at scratch dirs. Nothing here
// reaches the real service or the real cockpit dir.
//
// The script runs as an ASYNC child: a spawnSync would block this process, and with
// it the stand-in the script is talking to.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { section, ok, eq, done } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "live-check.sh");
const scratch = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `live-check-${p}-`));

// Percentages above 59, so no HH:MM:SS a run prints can contain them by chance.
const PCTS = ["93", "88", "62"];
const OBS = Date.now() - 5000;
const docBody = (observed = OBS) => ({
  version: 1,
  observed_at: observed,
  rate_limits: {
    five_hour: { used_percentage: 93.4, resets_at: 1790673000 },
    seven_day: { used_percentage: 88, resets_at: 1790830800 },
  },
});
const NULLS = { version: 1, observed_at: null, rate_limits: null };

function standIn() {
  const s = { body: docBody(), server: null };
  s.server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(s.body));
  });
  return new Promise((r) => s.server.listen(0, "127.0.0.1", () => {
    s.origin = `http://127.0.0.1:${s.server.address().port}`;
    r(s);
  }));
}
const stop = (s) => { s.server.closeAllConnections?.(); return new Promise((r) => s.server.close(() => r())); };

function writeApi(home, origin) {
  fs.mkdirSync(path.join(home, ".pir"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pir", "api.json"),
    JSON.stringify({ version: 1, url: origin, pid: process.pid }));
}

const outputs = [];
function run(args, { home, live, tmp, follow = "2", poll = "1" }) {
  const env = {
    ...process.env, PIR_HOME: home, LIVE_COCKPIT_DIR: live, TMPDIR: tmp,
    LIVE_FOLLOW_SECS: follow, LIVE_POLL_SECS: poll,
  };
  delete env.COCKPIT_DIR;      // the script must make its own; run.sh's is not its
  return new Promise((resolve) => {
    execFile("bash", [SCRIPT, ...args], { env, timeout: 30000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
      outputs.push(stdout + stderr);
      resolve({ code, out: stdout, lines: stdout.trim().split("\n"), stderr });
    });
  });
}
const last = (r) => r.lines[r.lines.length - 1];
const has = (r, line) => r.lines.includes(line);

const srv = await standIn();
const home = scratch("home");
writeApi(home, srv.origin);
const tmp = scratch("tmp");
const live = scratch("live");
const ctx = { home, live, tmp };

section("step 1, the contract");
{
  srv.body = docBody();
  const r = await run([], ctx);
  eq("documented body: agree", last(r), "agree");
  eq("documented body: exit 0", r.code, 0);
  eq("its scratch COCKPIT_DIR is gone", fs.readdirSync(tmp), []);
}
{
  srv.body = NULLS;
  const r = await run([], ctx);
  eq("nulls body: no reading", last(r), "no reading");
  eq("nulls body: exit 2", r.code, 2);
}
{
  const b = docBody(); b.rate_limits.seven_day = null;
  srv.body = b;
  const r = await run([], ctx);
  eq("one window null: agree", last(r), "agree");
  eq("one window null: exit 0", r.code, 0);
}
{
  const b = docBody(); b.rate_limits.five_hour = null;
  srv.body = b;
  const r = await run([], ctx);
  eq("the other window null: agree", last(r), "agree");
}
{
  // A reading with no drawable window: the reader correctly writes nothing, so
  // there is nothing to compare -- not checkable, never a false differ.
  const b = docBody(); b.rate_limits = { five_hour: null, seven_day: { used_percentage: 88 } };
  srv.body = b;
  const r = await run([], ctx);
  eq("no drawable window: no reading", last(r), "no reading");
  eq("no drawable window: exit 2", r.code, 2);
}
{
  const r = await run([], { ...ctx, home: scratch("noapi") });
  eq("no api.json: off absent", last(r), "off absent");
  eq("no api.json: exit 2", r.code, 2);
}
eq("no step 1 run left a scratch dir behind", fs.readdirSync(tmp), []);

section("step 2, follow");
const CACHE = path.join(live, "usage-cache.json");
const LOG = path.join(live, "daemon.log");
const seedCache = (writtenAt) => fs.writeFileSync(CACHE, JSON.stringify({
  writtenAt, fiveHour: { usedPct: 93, resetsAt: 1790673000 }, sevenDay: { usedPct: 88, resetsAt: 1790830800 },
}));
const seedLog = (...states) => fs.writeFileSync(LOG,
  ["2026-10-01T10:00:00.000Z daemon start", ...states.map((s) => `2026-10-01T10:00:01.000Z usage: pir service ${s}`)].join("\n") + "\n");
const snapshot = () => fs.readdirSync(live).sort().map((f) => `${f}:${fs.statSync(path.join(live, f)).mtimeMs}`);

{
  srv.body = docBody();
  seedCache(OBS);
  seedLog("absent", "ok");
  const before = snapshot();
  const r = await run(["follow"], ctx);
  eq("cache equal to observed_at, log ok: agree", last(r), "agree");
  eq("... exit 0", r.code, 0);
  ok("... moved 0", has(r, "moved 0"), r.out);
  ok("... failed 0", has(r, "failed 0"), r.out);
  eq("LIVE_COCKPIT_DIR is never written: names and mtimes unchanged", snapshot(), before);
}
{
  seedCache(OBS + 120000);             // a tap write, newer than any pir reading
  const r = await run(["follow"], ctx);
  eq("cache newer than observed_at (a tap write): agree", last(r), "agree");
}
{
  seedCache(OBS - 30000);              // inside the 35 s margin
  const r = await run(["follow"], ctx);
  eq("cache 30 s behind: agree", last(r), "agree");
}
{
  seedCache(OBS - 300000);
  const r = await run(["follow"], ctx);
  eq("cache 5 minutes behind: differ", last(r), "differ");
  eq("... exit 1", r.code, 1);
  ok("... every sample failed", has(r, "failed 3"), r.out);
  ok("... a failing sample names its lag", r.lines.some((l) => /^\d\d:\d\d:\d\d fail behind 30\ds$/.test(l)), r.out);
}
{
  // A fractional observed_at (the reader accepts one): bash (( )) is integer-only
  // and used to error out, which read as a passing sample.
  srv.body = docBody(OBS + 0.5);
  seedCache(OBS - 300000);
  const r = await run(["follow"], ctx);
  eq("fractional observed_at, cache 5 minutes behind: differ", last(r), "differ");
  ok("... every sample failed", has(r, "failed 3"), r.out);
  seedCache(OBS + 0.5);
  const r2 = await run(["follow"], ctx);
  eq("fractional observed_at, cache equal: agree", last(r2), "agree");
  srv.body = docBody();
}
{
  fs.rmSync(CACHE);
  const r = await run(["follow"], ctx);
  eq("no cache file: differ", last(r), "differ");
  eq("... exit 1", r.code, 1);
}
{
  seedCache(OBS);
  seedLog("ok", "unreachable");
  const r = await run(["follow"], ctx);
  eq("last log line unreachable: differ", last(r), "differ");
  ok("... names the log state", has(r, "log unreachable"), r.out);
}
{
  fs.writeFileSync(LOG, "2026-10-01T10:00:00.000Z daemon start\n");
  const r = await run(["follow"], ctx);
  eq("no usage line in the log: differ", last(r), "differ");
  ok("... log none", has(r, "log none"), r.out);
}
{
  fs.rmSync(LOG);
  const r = await run(["follow"], ctx);
  eq("no daemon.log at all: differ", last(r), "differ");
}
{
  seedLog("ok");
  srv.body = NULLS;
  const r = await run(["follow"], ctx);
  eq("service with nothing to report: no reading", last(r), "no reading");
  eq("... exit 2", r.code, 2);
}
{
  // A new reading mid-run, and the daemon following it. Samples at 0, 1, 2 and 3 s;
  // the change lands between the first two. The new reading is only 10 s newer, so
  // a sample caught between the two writes still sits inside the 35 s margin.
  srv.body = docBody();
  seedCache(OBS);
  const NEXT = OBS + 10000;
  const t = setTimeout(() => { srv.body = docBody(NEXT); seedCache(NEXT); }, 1500);
  const r = await run(["follow"], { ...ctx, follow: "3" });
  clearTimeout(t);
  eq("new observed_at mid-run, cache following: agree", last(r), "agree");
  ok("... moved 1", has(r, "moved 1"), r.out);
}

section("step 1, the stand-in stopped");
{
  srv.body = docBody();
  await stop(srv);
  const r = await run([], ctx);
  eq("stand-in stopped: off unreachable", last(r), "off unreachable");
  eq("... exit 2", r.code, 2);
}

section("output carries no percentage");
{
  const leaks = outputs.flatMap((o) => o.split("\n")).filter((l) => PCTS.some((p) => l.includes(p)));
  eq("no output line contains a stand-in percentage", leaks, []);
}

for (const d of [home, tmp, live]) fs.rmSync(d, { recursive: true, force: true });
done();
