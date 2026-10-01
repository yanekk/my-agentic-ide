// cockpit-usage-pir: the reader against a stand-in pir service (DESIGN 2.1, 2.5,
// 2.6, 4). The stand-in is a node:http server on an OS-chosen loopback port and the
// home is a scratch folder whose .pir/api.json this file writes, so nothing here can
// reach the real ~/.pir/api.json or the real service. `home` and `dir` are passed
// explicitly everywhere; the CLI runs get scratch PIR_HOME and COCKPIT_DIR.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { section, ok, eq, done } from "./harness.mjs";
import {
  PIR_TIMEOUT_MS, pirHome, isAlive, fetchPirUsage, pollPirUsage,
} from "../../bin/cockpit-usage-pir.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../../bin/cockpit-usage-pir.mjs");
const CACHE = "usage-cache.json";

const scratch = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `usage-pir-${p}-`));

function writeApi(home, obj) {
  fs.mkdirSync(path.join(home, ".pir"), { recursive: true });
  const text = typeof obj === "string" ? obj : JSON.stringify(obj);
  fs.writeFileSync(path.join(home, ".pir", "api.json"), text);
}

// The stand-in. `mode` switches what it does; `hits` and `seen` record requests.
function standIn() {
  const s = { mode: "doc", body: null, hits: 0, seen: [], server: null, port: 0 };
  s.server = http.createServer((req, res) => {
    s.hits++;
    s.seen.push({ method: req.method, url: req.url, headers: req.headers });
    const json = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    switch (s.mode) {
      case "doc": return json(200, s.body);
      case "text": res.writeHead(200, { "content-type": "application/json" }); return res.end("not json {");
      case "hang": return;                                     // never answers
      case "half": res.writeHead(200, { "content-type": "application/json" }); res.write('{"version":'); return;
      case "redirect": res.writeHead(302, { location: s.location }); return res.end();
      default: return json(Number(s.mode), { error: "x" });    // "403", "404", "500"
    }
  });
  return new Promise((resolve) => s.server.listen(0, "127.0.0.1", () => {
    s.port = s.server.address().port;
    s.origin = `http://127.0.0.1:${s.port}`;
    resolve(s);
  }));
}
function stop(s) {
  s.server.closeAllConnections?.();
  return new Promise((r) => s.server.close(() => r()));
}

// A pid that is certainly not running: a child that has already exited.
const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;

const OBS = 1790669288699;
const docBody = (observed = OBS, five = 97) => ({
  version: 1,
  observed_at: observed,
  rate_limits: {
    five_hour: { used_percentage: five, resets_at: 1790673000 },
    seven_day: { used_percentage: 77, resets_at: 1790830800 },
  },
});
const seed = (dir, writtenAt) => fs.writeFileSync(path.join(dir, CACHE), JSON.stringify({
  writtenAt, fiveHour: { usedPct: 1, resetsAt: 2 }, sevenDay: null,
}));
const raw = (dir) => { try { return fs.readFileSync(path.join(dir, CACHE), "utf8"); } catch { return null; } };

const srv = await standIn();
const home = scratch("home");
writeApi(home, { version: 1, url: srv.origin, pid: process.pid });

section("constants and helpers");
eq("the request limit is 2 s", PIR_TIMEOUT_MS, 2000);
eq("pirHome: PIR_HOME wins over HOME", pirHome({ PIR_HOME: "/a", HOME: "/b" }), "/a");
eq("pirHome: PIR_HOME unset is HOME", pirHome({ HOME: "/b" }), "/b");
ok("isAlive: this process is alive", isAlive(process.pid));
ok("isAlive: an exited child is not", !isAlive(deadPid));

section("states decided without a request");
{
  srv.hits = 0;
  eq("no .pir/ at all: absent", await fetchPirUsage({ home: scratch("none") }), { state: "absent" });
  const h = scratch("nofile"); fs.mkdirSync(path.join(h, ".pir"));
  eq(".pir/ without api.json: absent", await fetchPirUsage({ home: h }), { state: "absent" });
  const bad = scratch("bad");
  writeApi(bad, "not json");
  eq("api.json not JSON: bad-file", await fetchPirUsage({ home: bad }), { state: "bad-file" });
  writeApi(bad, { version: 2, url: srv.origin, pid: process.pid });
  eq("api.json version 2: bad-file", await fetchPirUsage({ home: bad }), { state: "bad-file" });
  writeApi(bad, { version: 1, url: "http://example.com:80", pid: process.pid });
  eq("api.json pointing off loopback: bad-file", await fetchPirUsage({ home: bad }), { state: "bad-file" });
  const dead = scratch("dead");
  writeApi(dead, { version: 1, url: srv.origin, pid: deadPid });
  eq("a pid that is not running: dead", await fetchPirUsage({ home: dead }), { state: "dead" });
  eq("none of those sent a request", srv.hits, 0);
}

section("the request as the server saw it");
{
  srv.mode = "doc"; srv.body = docBody(); srv.seen = [];
  const r = await fetchPirUsage({ home });
  eq("a 200 is answered with its origin and body", r, { state: "answered", origin: srv.origin, body: docBody() });
  const req = srv.seen[0] || { headers: {} };
  eq("method GET", req.method, "GET");
  eq("path /v1/usage", req.url, "/v1/usage");
  ok("no Authorization header", !("authorization" in req.headers));
}

section("unreachable");
{
  // A closed port: grab one from a server, then close it.
  const tmp = await standIn(); const closed = tmp.origin; await stop(tmp);
  const h = scratch("closed"); writeApi(h, { version: 1, url: closed, pid: process.pid });
  eq("a closed port: unreachable", await fetchPirUsage({ home: h }), { state: "unreachable" });

  srv.mode = "hang";
  let t0 = performance.now();
  eq("a server that never answers: unreachable", await fetchPirUsage({ home, timeoutMs: 200 }), { state: "unreachable" });
  ok("...within a second", performance.now() - t0 < 1000, `took ${Math.round(performance.now() - t0)} ms`);

  srv.mode = "half";
  t0 = performance.now();
  eq("headers sent, body never finished: unreachable", await fetchPirUsage({ home, timeoutMs: 200 }), { state: "unreachable" });
  ok("...within a second", performance.now() - t0 < 1000, `took ${Math.round(performance.now() - t0)} ms`);
  srv.server.closeAllConnections?.();

  // A fresh redirecting server on its own home: fetch pools connections, and one
  // left over from the hung tests above (closed by closeAllConnections) would fail
  // with a reset and pass this check without the redirect ever being refused.
  const target = await standIn();
  target.mode = "doc"; target.body = docBody();
  const redir = await standIn();
  redir.mode = "redirect"; redir.location = `${target.origin}/v1/usage`;
  const rh = scratch("redir"); writeApi(rh, { version: 1, url: redir.origin, pid: process.pid });
  eq("a 302 to another address: unreachable", await fetchPirUsage({ home: rh }), { state: "unreachable" });
  eq("...the redirect was served", redir.hits, 1);
  eq("...and the target is never requested", target.hits, 0);
  await stop(target); await stop(redir);
}

section("http and bad-body");
for (const code of [403, 404, 500]) {
  srv.mode = String(code);
  eq(`${code}: http with the status`, await fetchPirUsage({ home }), { state: "http", status: code });
}
srv.mode = "text";
eq("200 with a non-JSON body: bad-body", await fetchPirUsage({ home }), { state: "bad-body" });

section("pollPirUsage: newest wins");
{
  srv.mode = "doc"; srv.body = docBody();
  const now = () => OBS + 5000;
  const dir = scratch("dir");
  const r = await pollPirUsage({ home, dir, now });
  eq("documented body, empty dir: ok, wrote", r, { state: "ok", origin: srv.origin, wrote: true });
  const file = path.join(dir, CACHE);
  const st = fs.statSync(file);
  eq("cache mode 0600", st.mode & 0o777, 0o600);
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  eq("writtenAt is observed_at", c.writtenAt, OBS);
  eq("both windows written", [c.fiveHour, c.sevenDay],
     [{ usedPct: 97, resetsAt: 1790673000 }, { usedPct: 77, resetsAt: 1790830800 }]);

  const r2 = await pollPirUsage({ home, dir, now });
  eq("polled again: ok, kept", r2, { state: "ok", origin: srv.origin, wrote: false });
  const st2 = fs.statSync(file);
  ok("...inode and mtime unchanged", st2.ino === st.ino && st2.mtimeMs === st.mtimeMs);

  const newer = scratch("newer"); seed(newer, OBS + 1000); const before = raw(newer);
  eq("a seeded newer cache: kept", (await pollPirUsage({ home, dir: newer, now })).wrote, false);
  eq("...file untouched", raw(newer), before);
  const older = scratch("older"); seed(older, OBS - 1000);
  eq("a seeded older cache: replaced", (await pollPirUsage({ home, dir: older, now })).wrote, true);
  eq("...with the pir reading", JSON.parse(raw(older)).writtenAt, OBS);

  const nul = scratch("nul"); seed(nul, 1); const nulBefore = raw(nul);
  srv.body = { version: 1, observed_at: null, rate_limits: null };
  eq("nulls body: empty", await pollPirUsage({ home, dir: nul, now }), { state: "empty", origin: srv.origin, wrote: false });
  eq("...seeded cache untouched", raw(nul), nulBefore);
  srv.body = { ...docBody(), version: 2 };
  eq("version 2 body: bad-body", (await pollPirUsage({ home, dir: nul, now })).state, "bad-body");
  eq("...seeded cache untouched", raw(nul), nulBefore);

  srv.body = docBody();
  const fut = scratch("fut"); seed(fut, 1); const futBefore = raw(fut);
  eq("now 2 minutes behind observed_at: future",
     (await pollPirUsage({ home, dir: fut, now: () => OBS - 120000 })).state, "future");
  eq("...seeded cache untouched", raw(fut), futBefore);

  // Not writable: a dir path whose parent is a file, so mkdir and write both fail
  // whatever the user's privileges.
  const blocker = path.join(scratch("ro"), "file"); fs.writeFileSync(blocker, "");
  eq("dir not writable: resolves ok, wrote false",
     await pollPirUsage({ home, dir: path.join(blocker, "cockpit"), now }),
     { state: "ok", origin: srv.origin, wrote: false });

  eq("a failed fetch carries its status through", await (async () => {
    srv.mode = "500"; const x = await pollPirUsage({ home, dir, now }); srv.mode = "doc"; return x;
  })(), { state: "http", wrote: false, status: 500 });
}

section("CLI");
{
  // execFile, not spawnSync: the stand-in lives in this process and must keep
  // answering while the CLI runs.
  const run = (args, env) => new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } }, (err, stdout) => {
      resolve({ code: err ? err.code : 0, out: stdout.trim() });
    });
  });
  srv.mode = "doc"; srv.body = docBody(Date.now() - 1000);
  const cdir = scratch("cli-status");
  const env = { PIR_HOME: home, COCKPIT_DIR: cdir };
  eq("--status, service up: running {origin}, exit 0", await run(["--status"], env), { code: 0, out: `running ${srv.origin}` });

  const odir = scratch("cli-once");
  eq("--once: ok wrote", await run(["--once"], { PIR_HOME: home, COCKPIT_DIR: odir }), { code: 0, out: "ok wrote" });
  eq("--once again: ok kept", await run(["--once"], { PIR_HOME: home, COCKPIT_DIR: odir }), { code: 0, out: "ok kept" });

  await stop(srv);
  eq("--status, service stopped: off unreachable, exit 1", await run(["--status"], env), { code: 1, out: "off unreachable" });
  eq("--status created no cache either way", fs.readdirSync(cdir), []);
}

done();
