// cockpit-fleet-status and fetchPirRuns: the fleet picker's status gather against
// fakes (fleet-picker-status DESIGN 2.5, 2.7, 3.6, 4). A fake `claude` is a shell
// script on a scratch PATH, the jobs folder is a scratch HOME or CLAUDE_CONFIG_DIR,
// and pir is a node:http stand-in on an OS-chosen port named by a scratch home's
// .pir/api.json. `env` and `home` are passed explicitly everywhere, so nothing here
// reads the real ~/.claude, ~/.pir or the real claude.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { section, ok, eq, done } from "./harness.mjs";
import { fetchPirRuns, fetchPirUsage } from "../../bin/cockpit-usage-pir.mjs";
import {
  CLAUDE_TIMEOUT_MS, gatherClaude, gatherPir, gatherAll,
} from "../../bin/cockpit-fleet-status.mjs";

const scratch = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `fleet-status-${p}-`));
const SH = "/bin/sh";

// A scratch PATH holding only a fake `claude` (and nothing else, so a missing
// fake is "not on PATH"). The fake records its argv in ./args. `/bin` stays off
// PATH; the script names its tools by absolute path.
function fakeClaude(body) {
  const bin = scratch("bin");
  const f = path.join(bin, "claude");
  fs.writeFileSync(f, `#!${SH}\nprintf '%s\\n' "$@" > "${bin}/args"\n${body}\n`);
  fs.chmodSync(f, 0o755);
  return bin;
}
const printing = (arr) => fakeClaude(`/bin/cat <<'JSON'\n${JSON.stringify(arr)}\nJSON`);

function writeState(jobs, id, text) {
  fs.mkdirSync(path.join(jobs, id), { recursive: true });
  fs.writeFileSync(path.join(jobs, id, "state.json"), typeof text === "string" ? text : JSON.stringify(text));
}

const ISO = "2026-10-09T10:15:42.123Z";
const AGENTS = [
  { id: "aaaa0001", kind: "background", state: "done", name: "repo / one", startedAt: 1 },
  { id: "aaaa0002", kind: "background", state: "done", name: "repo / two", startedAt: 2 },
  { id: "aaaa0003", kind: "background", state: "done", name: "repo / three", startedAt: 3 },
  { id: "aaaa0004", kind: "background", state: "done", name: "repo / four", startedAt: 4 },
  { id: "aaaa0005", kind: "background", state: "blocked", name: "repo / five", startedAt: 5 },
  { id: "aaaa0006", kind: "interactive", state: "done", name: "repo / six", startedAt: 6 },
  { id: "aaaa0007", kind: "background", state: "stopped", name: "repo / seven", startedAt: 7 },
  { id: "..", kind: "background", state: "done", name: "evil", startedAt: 8 },
];
function seedJobs(jobs) {
  writeState(jobs, "aaaa0001", { state: "done", lastTerminalAt: ISO, firstTerminalAt: "x" });
  // aaaa0002: no state.json at all (T00 saw such job folders)
  fs.mkdirSync(path.join(jobs, "aaaa0002", "tmp"), { recursive: true });
  writeState(jobs, "aaaa0003", '{"state":"done","lastTerminalAt":"2026-10');   // torn
  writeState(jobs, "aaaa0004", { state: "done", firstTerminalAt: ISO });          // no field
  writeState(jobs, "aaaa0005", { state: "working", lastTerminalAt: ISO });        // not done
  writeState(jobs, "aaaa0006", { state: "done", lastTerminalAt: ISO });           // interactive
  writeState(jobs, "aaaa0007", { state: "stopped", lastTerminalAt: ISO });        // bad, not done
}

section("constants");
eq("the claude limit is 3 s", CLAUDE_TIMEOUT_MS, 3000);

section("gatherClaude: an answer, finish times from HOME/.claude/jobs");
{
  const bin = printing(AGENTS);
  const home = scratch("home");
  seedJobs(path.join(home, ".claude", "jobs"));
  const r = await gatherClaude({ env: { PATH: bin, HOME: home } });
  eq("ok with the array as printed", [r.ok, r.agents], [true, AGENTS]);
  eq("finishedAt: only the readable done background agent", r.finishedAt, { aaaa0001: ISO });
  ok("...missing state.json left out", !("aaaa0002" in r.finishedAt));
  ok("...truncated JSON left out", !("aaaa0003" in r.finishedAt));
  ok("...no lastTerminalAt left out", !("aaaa0004" in r.finishedAt));
  ok("...a blocked agent's file not read into it", !("aaaa0005" in r.finishedAt));
  ok("...an interactive done agent left out", !("aaaa0006" in r.finishedAt));
  ok("...a stopped agent left out", !("aaaa0007" in r.finishedAt));
  ok("...an id of .. is never read", !(".." in r.finishedAt));
  eq("the ISO string is passed through unchanged", r.finishedAt.aaaa0001, ISO);
  eq("the fake was invoked with exactly agents --json --all",
     fs.readFileSync(path.join(bin, "args"), "utf8"), "agents\n--json\n--all\n");

  // An epoch-ms finish time is passed through raw too; T01 decides what it means.
  writeState(path.join(home, ".claude", "jobs"), "aaaa0004", { lastTerminalAt: 1791551714206 });
  eq("a numeric lastTerminalAt is passed through raw",
     (await gatherClaude({ env: { PATH: bin, HOME: home } })).finishedAt.aaaa0004, 1791551714206);
}

section("gatherClaude: CLAUDE_CONFIG_DIR wins over HOME");
{
  const bin = printing(AGENTS.slice(0, 2));
  const home = scratch("home2");
  writeState(path.join(home, ".claude", "jobs"), "aaaa0001", { lastTerminalAt: "from-home" });
  writeState(path.join(home, ".claude", "jobs"), "aaaa0002", { lastTerminalAt: "from-home" });
  const cfg = scratch("cfg");
  writeState(path.join(cfg, "jobs"), "aaaa0001", { lastTerminalAt: ISO });
  const r = await gatherClaude({ env: { PATH: bin, HOME: home, CLAUDE_CONFIG_DIR: cfg } });
  eq("read from CLAUDE_CONFIG_DIR/jobs, never HOME's", r.finishedAt, { aaaa0001: ISO });
  eq("an empty array is still an answer", await gatherClaude({ env: { PATH: printing([]), HOME: home } }),
     { ok: true, agents: [], finishedAt: {} });
}

section("gatherClaude: every failure is { ok: false }, within the limit");
{
  const home = scratch("home3");
  const timed = async (env, timeoutMs) => {
    const t0 = performance.now();
    const r = await gatherClaude({ env: { HOME: home, ...env }, timeoutMs });
    return { r, ms: performance.now() - t0 };
  };
  let x = await timed({ PATH: fakeClaude(`/bin/echo '[]'\nexit 3`) });
  eq("non-zero exit, even with an array printed", x.r, { ok: false });
  x = await timed({ PATH: fakeClaude(`/bin/echo 'Error: not logged in'`) });
  eq("junk on stdout", x.r, { ok: false });
  x = await timed({ PATH: fakeClaude(`/bin/echo '{"agents":[]}'`) });
  eq("JSON that is not an array", x.r, { ok: false });
  x = await timed({ PATH: fakeClaude(`/bin/echo '[{"id":"a"'`) });
  eq("truncated JSON", x.r, { ok: false });
  x = await timed({ PATH: scratch("empty-bin") });
  eq("claude missing from PATH", x.r, { ok: false });
  ok("...answered at once", x.ms < 1000, `took ${Math.round(x.ms)} ms`);

  // exec: the fake becomes the sleep, so the kill reaches the process holding stdout.
  x = await timed({ PATH: fakeClaude(`exec /bin/sleep 10`) }, 400);
  eq("sleeping past the limit", x.r, { ok: false });
  ok("...within the limit plus a margin", x.ms < 400 + 600, `took ${Math.round(x.ms)} ms`);

  // Not exec: the shell's child `sleep` keeps the stdout pipe open after the shell
  // is killed. The answer must still come at the deadline, not when sleep exits.
  x = await timed({ PATH: fakeClaude(`/bin/sleep 3\n/bin/echo '[]'`) }, 400);
  eq("a grandchild holding the pipe past the limit", x.r, { ok: false });
  ok("...still within the limit plus a margin", x.ms < 400 + 600, `took ${Math.round(x.ms)} ms`);

  // The default limit, with a fake that answers just under it, still answers.
  x = await timed({ PATH: fakeClaude(`/bin/sleep 1\n/bin/echo '[]'`) });
  eq("a slow but in-time answer is ok", x.r.ok, true);
}

// ---- pir ------------------------------------------------------------------

function writeApi(home, obj) {
  fs.mkdirSync(path.join(home, ".pir"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pir", "api.json"), typeof obj === "string" ? obj : JSON.stringify(obj));
}
function writeKey(home, text) {
  fs.mkdirSync(path.join(home, ".pir"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pir", "api-key"), text);
}

const RUNS = [{ repo: "r", slug: "s", kind: "work", state: "running", waitingForYou: false,
                display: { state: "testing", done: 1, total: 3 } }];
function standIn() {
  const s = { mode: "200", body: RUNS, delay: 0, hits: 0, seen: [], server: null };
  s.server = http.createServer((req, res) => {
    s.hits++;
    s.seen.push({ method: req.method, url: req.url, headers: req.headers });
    const answer = () => {
      if (s.mode === "hang") return;
      if (s.mode === "text") { res.writeHead(200, { "content-type": "application/json" }); return res.end("nope {"); }
      const code = Number(s.mode);
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(code === 200 ? s.body : { error: "x" }));
    };
    if (s.delay) setTimeout(answer, s.delay); else answer();
  });
  return new Promise((resolve) => s.server.listen(0, "127.0.0.1", () => {
    s.origin = `http://127.0.0.1:${s.server.address().port}`;
    resolve(s);
  }));
}
function stop(s) {
  s.server.closeAllConnections?.();
  return new Promise((r) => s.server.close(() => r()));
}
const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;

const srv = await standIn();
const home = scratch("pir");
writeApi(home, { version: 1, url: srv.origin, pid: process.pid });
writeKey(home, "  sekret-key-123\n");

section("fetchPirRuns: the request as the server saw it");
{
  srv.seen = [];
  eq("200: answered with the body", await fetchPirRuns({ home }), { state: "answered", body: RUNS });
  const req = srv.seen[0] || { headers: {} };
  eq("method GET", req.method, "GET");
  eq("path /v2/runs", req.url, "/v2/runs");
  eq("the Bearer key, trimmed", req.headers.authorization, "Bearer sekret-key-123");
  eq("gatherPir: ok with the body", await gatherPir({ home }), { ok: true, body: RUNS });
}

section("fetchPirRuns: states decided without a request");
{
  srv.hits = 0;
  eq("no api.json: absent", await fetchPirRuns({ home: scratch("none") }), { state: "absent" });
  const bad = scratch("bad"); writeApi(bad, "not json"); writeKey(bad, "k");
  eq("api.json not JSON: bad-file", await fetchPirRuns({ home: bad }), { state: "bad-file" });
  const dead = scratch("dead"); writeApi(dead, { version: 1, url: srv.origin, pid: deadPid }); writeKey(dead, "k");
  eq("dead pid: dead", await fetchPirRuns({ home: dead }), { state: "dead" });
  const nokey = scratch("nokey"); writeApi(nokey, { version: 1, url: srv.origin, pid: process.pid });
  eq("no api-key file: no-key", await fetchPirRuns({ home: nokey }), { state: "no-key" });
  const blank = scratch("blank"); writeApi(blank, { version: 1, url: srv.origin, pid: process.pid }); writeKey(blank, " \n");
  eq("a blank api-key: no-key", await fetchPirRuns({ home: blank }), { state: "no-key" });
  const dk = scratch("deadkey"); writeApi(dk, { version: 1, url: srv.origin, pid: deadPid });
  eq("dead pid and no key: dead first", await fetchPirRuns({ home: dk }), { state: "dead" });
  eq("none of those sent a request", srv.hits, 0);
}

section("gatherPir: down");
{
  eq("no api.json", await gatherPir({ home: scratch("none2") }), { ok: false, why: "down" });
  const dead = scratch("dead2"); writeApi(dead, { version: 1, url: srv.origin, pid: deadPid }); writeKey(dead, "k");
  eq("dead pid", await gatherPir({ home: dead }), { ok: false, why: "down" });

  const tmp = await standIn(); const closed = tmp.origin; await stop(tmp);
  const ch = scratch("closed"); writeApi(ch, { version: 1, url: closed, pid: process.pid }); writeKey(ch, "k");
  eq("refused port", await gatherPir({ home: ch }), { ok: false, why: "down" });

  srv.mode = "hang";
  const t0 = performance.now();
  eq("a hang past 2 s (the default limit)", await gatherPir({ home }), { ok: false, why: "down" });
  const ms = performance.now() - t0;
  ok("...answered at the 2 s limit, not before or long after", ms >= 1900 && ms < 2800, `took ${Math.round(ms)} ms`);
  srv.server.closeAllConnections?.();

  for (const code of [500, 403, 404]) {
    srv.mode = String(code);
    eq(`${code}`, await gatherPir({ home }), { ok: false, why: "down" });
  }
}

section("gatherPir: other");
{
  const nokey = scratch("nokey2"); writeApi(nokey, { version: 1, url: srv.origin, pid: process.pid });
  eq("no api-key file", await gatherPir({ home: nokey }), { ok: false, why: "other" });
  srv.mode = "401";
  eq("fetchPirRuns: 401 is http 401", await fetchPirRuns({ home }), { state: "http", status: 401 });
  eq("401", await gatherPir({ home }), { ok: false, why: "other" });
  srv.mode = "text";
  eq("fetchPirRuns: bad body", await fetchPirRuns({ home }), { state: "bad-body" });
  eq("bad body", await gatherPir({ home }), { ok: false, why: "other" });
  const bad = scratch("bad2"); writeApi(bad, { version: 1, url: "http://example.com:80", pid: process.pid }); writeKey(bad, "k");
  eq("api.json off loopback: bad-file", await gatherPir({ home: bad }), { ok: false, why: "other" });
  srv.mode = "200";
}

section("fetchPirUsage is untouched by the shared helpers");
{
  // Its own suite (pir.test.mjs) is the full proof; this pins that the two GETs
  // share discovery without /v1/usage starting to send the key.
  srv.seen = []; srv.body = { version: 1, observed_at: null, rate_limits: null };
  eq("answered with origin and body", await fetchPirUsage({ home }),
     { state: "answered", origin: srv.origin, body: srv.body });
  eq("asked /v1/usage", srv.seen[0]?.url, "/v1/usage");
  ok("with no Authorization header", !("authorization" in (srv.seen[0]?.headers || {})));
  eq("no api.json reads absent through both", [
    (await fetchPirUsage({ home: scratch("dz") })).state, (await fetchPirRuns({ home: scratch("dz2") })).state,
  ], ["absent", "absent"]);
  srv.body = RUNS;
}

section("gatherAll: both at once");
{
  srv.mode = "200"; srv.delay = 1000;
  const bin = fakeClaude(`/bin/sleep 1\n/bin/echo '[]'`);
  const t0 = performance.now();
  const r = await gatherAll({ env: { PATH: bin, HOME: scratch("all") }, home });
  const ms = performance.now() - t0;
  eq("both answered", r, { claude: { ok: true, agents: [], finishedAt: {} }, pir: { ok: true, body: RUNS } });
  ok("a 1 s claude and a 1 s pir finish in under 1.8 s", ms < 1800, `took ${Math.round(ms)} ms`);
  srv.delay = 0;

  // home defaults to pirHome of the env given, so a scratch PIR_HOME is honoured.
  const r2 = await gatherAll({ env: { PATH: scratch("nobin"), HOME: scratch("h"), PIR_HOME: home } });
  eq("home defaults to PIR_HOME from env", r2, { claude: { ok: false }, pir: { ok: true, body: RUNS } });
}

await stop(srv);
done();
