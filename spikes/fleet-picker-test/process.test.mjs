// The picker process and its wrapper, under a real pseudo-terminal (pty-drive.py). Real key
// bytes go through the real tty into bin/cockpit-fleet-picker.sh; what comes back is the cmd
// file, whether the wrapper is still alive, and the drawn screen. Prints failures in full,
// then one line `CHECKS <pass> <fail>`.
import { deepStrictEqual } from "node:assert";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const WRAPPER = path.join(ROOT, "bin/cockpit-fleet-picker.sh");
const DRIVER = path.join(HERE, "pty-drive.py");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-picker-test-"));
// Screens go to a scratch folder, never the repo; kept on failure for a look.
const SHOTS = path.join(SCRATCH, "screens");
fs.mkdirSync(SHOTS);

let pass = 0;
let fail = 0;
function check(name, got, want) {
  try {
    deepStrictEqual(got, want);
    pass++;
    if (process.env.VERBOSE) console.log(`  ok   ${name}`);
  } catch {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       want ${JSON.stringify(want)}`);
    console.log(`       got  ${JSON.stringify(got)}`);
  }
}

const UP = "\x1b[A", DOWN = "\x1b[B", RIGHT = "\x1b[C", LEFT = "\x1b[D";
// The hint is on screen at every size; the title is gone below 18 rows (status DESIGN §2.4).
const READY = ["wait", "choose"];

// --- a scratch world, so no run reads this machine (status DESIGN §3.6, §5.2) ---------
// Every run gets its own HOME (Claude's jobs folder), PIR_HOME (pir's api.json and key) and a
// PATH whose only `claude` is fixtures/claude. node is linked into a tools folder rather than
// putting its own folder on PATH, which may hold the real claude. /usr/bin and /bin carry
// bash and sleep, and no claude.
const TOOLS = path.join(SCRATCH, "tools");
const FAKE_BIN = path.join(SCRATCH, "fake-bin");
fs.mkdirSync(TOOLS);
fs.mkdirSync(FAKE_BIN);
fs.symlinkSync(process.execPath, path.join(TOOLS, "node"));
fs.symlinkSync(path.join(HERE, "fixtures/claude"), path.join(FAKE_BIN, "claude"));
const MIN = 60000;

// pir's service, stood in by a node:http server in this process; it answers /v2/runs with the
// body named by the Bearer key, so each run picks its fixture through its own api-key file.
const pirBodies = {};
const pirSeen = [];
const pirServer = http.createServer((req, res) => {
  const key = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
  pirSeen.push({ url: req.url, key });
  if (req.url !== "/v2/runs" || !key || !(key in pirBodies)) { res.writeHead(401).end(); return; }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(pirBodies[key]));
});
await new Promise((r) => pirServer.listen(0, "127.0.0.1", r));
const PIR_PORT = pirServer.address().port;

let worlds = 0;
// world({ agents, finished, claude, pir, pirKey }) → the wrapper's environment.
//   agents    the array fake claude prints; finished { id: ms ago } writes each state.json
//   claude    { sleep, mode } for fixtures/claude; null takes claude off PATH
//   pir       a /v2/runs body (served), or undefined for no api.json (the service is down)
function world({ agents = [], finished = {}, claude = {}, pir } = {}) {
  const dir = path.join(SCRATCH, `world-${++worlds}`);
  const home = path.join(dir, "home");
  const jobs = path.join(home, ".claude/jobs");
  fs.mkdirSync(jobs, { recursive: true });
  const out = path.join(dir, "agents.json");
  fs.writeFileSync(out, JSON.stringify(agents));
  for (const [id, ago] of Object.entries(finished)) {
    fs.mkdirSync(path.join(jobs, id));
    fs.writeFileSync(path.join(jobs, id, "state.json"),
      JSON.stringify({ state: "done", lastTerminalAt: new Date(Date.now() - ago).toISOString() }));
  }
  const pirHome = path.join(dir, "pir");
  fs.mkdirSync(path.join(pirHome, ".pir"), { recursive: true });
  if (pir !== undefined) {
    const key = `key-${worlds}`;
    pirBodies[key] = pir;
    fs.writeFileSync(path.join(pirHome, ".pir/api.json"),
      JSON.stringify({ version: 1, pid: process.pid, url: `http://127.0.0.1:${PIR_PORT}` }));
    fs.writeFileSync(path.join(pirHome, ".pir/api-key"), `${key}\n`);
  }
  const env = {
    HOME: home,
    PIR_HOME: pirHome,
    PATH: [...(claude === null ? [] : [FAKE_BIN]), TOOLS, "/usr/bin", "/bin"].join(":"),
    FAKE_CLAUDE_OUT: out,
  };
  if (claude?.sleep) env.FAKE_CLAUDE_SLEEP = String(claude.sleep);
  if (claude?.mode) env.FAKE_CLAUDE_MODE = claude.mode;
  return env;
}
// The default: nothing running in either program, answered at once.
const QUIET = () => world({ pir: { runs: [] } });

const execFileP = promisify(execFile);
let n = 0;
async function drive(name, shown, cols, rows, steps, env = QUIET()) {
  const cmd = path.join(SCRATCH, `cmd-${++n}`);
  let out;
  try {
    ({ stdout: out } = await execFileP("python3",
      ["-I", DRIVER, WRAPPER, cmd, shown, String(cols), String(rows), JSON.stringify(steps), JSON.stringify(env)],
      { encoding: "utf8", timeout: 30000 }));
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: the pty driver failed`);
    console.log(String(e.stdout || "") + String(e.stderr || e.message));
    return null;
  }
  const r = JSON.parse(out);
  fs.writeFileSync(path.join(SHOTS, `${n}-${name.replace(/[^a-z0-9]+/gi, "-")}.txt`),
    [...Object.entries(r.snaps).flatMap(([k, v]) => [`--- ${k}`, ...v]), "--- final", ...r.screen].join("\n") + "\n");
  check(`${name}: the driver saw everything it waited for`, r.errors, []);
  check(`${name}: nothing left running after teardown`, r.leftover, []);
  check(`${name}: no line drawn past the right edge`, r.overflow, []);
  return r;
}

function oneVerb(name, r, verb) {
  if (!r) return;
  check(`${name}: exactly one verb, ${verb}`, r.cmd, [verb]);
  check(`${name}: the wrapper is still alive`, r.alive, true);
}

// --- every exit path appends exactly one verb -----------------------------------
// The settle (sleep) after the verb is what proves "exactly one": a late cancel from the
// wrapper would land inside it.
const settle = [["wait-cmd", 1], ["sleep", 0.5]];
for (const [shown, other] of [["claude", "pir"], ["pir", "claude"]]) {
  oneVerb(`${shown} shown, Enter`, await drive(`${shown}-enter`, shown, 59, 22, [READY, ["send", "\r"], ...settle]), `fleet-${other}`);
  oneVerb(`${shown} shown, →`, await drive(`${shown}-right`, shown, 59, 22, [READY, ["send", RIGHT], ...settle]), `fleet-${other}`);
  oneVerb(`${shown} shown, ↓ Enter`, await drive(`${shown}-down-enter`, shown, 59, 22, [READY, ["send", DOWN], ["send", "\r"], ...settle]), `fleet-${shown}`);
  oneVerb(`${shown} shown, ↑ ↓ Enter`, await drive(`${shown}-up-down-enter`, shown, 39, 12, [READY, ["send", UP], ["send", DOWN], ["send", "\r"], ...settle]), `fleet-${other}`);
}
// The task doc's end-to-end line, as DESIGN §2.4 reads it: with pir shown the highlight starts
// on Claude Agents, so ↓ moves it onto PIR and → hands back the shown program ("just close").
oneVerb("pir shown, ↓ →", await drive("pir-down-right", "pir", 59, 22, [READY, ["send", DOWN], ["send", RIGHT], ...settle]), "fleet-pir");
oneVerb("pir shown, → alone", await drive("pir-right-39", "pir", 39, 12, [READY, ["send", RIGHT], ...settle]), "fleet-claude");
oneVerb("Esc", await drive("esc", "claude", 59, 22, [READY, ["send", "\x1b"], ...settle]), "picker-cancel");
oneVerb("Ctrl+C", await drive("ctrl-c", "claude", 59, 22, [READY, ["send", "\x03"], ...settle]), "picker-cancel");
oneVerb("SS3 ↓ then CR", await drive("ss3", "claude", 59, 22, [READY, ["send", "\x1bOB"], ["send", "\r"], ...settle]), "fleet-claude");
oneVerb("fast ↓→ in one read", await drive("burst", "claude", 59, 22, [READY, ["send", DOWN + RIGHT], ...settle]), "fleet-claude");

// ← and other keys do nothing; the picker is still up and still answers afterwards.
{
  const r = await drive("ignored-keys", "claude", 59, 22, [READY, ["send", LEFT], ["send", "q"], ["send", "x"], ["send", "\x1b[<0;10;5M"],
    ["send", "\x1b[5~"], ["sleep", 0.3], ["snap", "after"]]);
  if (r) {
    check("← q x mouse PgUp: nothing appended", r.cmd, []);
    check("← q x mouse PgUp: the highlight has not moved", r.snaps.after[7], "   ▸ PIR");
    check("← q x mouse PgUp: still drawn", r.snaps.after[1], "   SWITCH PROGRAM");
  }
}

// The bytes WezTerm writes into a pane it is closing (`\n` + Ctrl+D, fleet-picker T04 drill)
// are not an Enter: nothing is appended, and the picker still answers a real key after.
{
  const r = await drive("pane-closing", "claude", 59, 22, [READY, ["send", "\n\x04"], ["sleep", 0.5], ["snap", "after"],
    ["send", DOWN], ["send", RIGHT], ...settle]);
  if (r) {
    check("pane-closing bytes: still drawn, PIR still highlighted", r.snaps.after[7], "   ▸ PIR");
    // ↓ first, so a `\n` taken for Enter (fleet-pir) and the picker still answering differ.
    check("pane-closing bytes: no choice, then ↓ → answers", r.cmd, ["fleet-claude"]);
  }
}

// A kill is not an answer: node dies, the wrapper appends the cancel and stays up.
oneVerb("SIGTERM to node", await drive("sigterm", "claude", 59, 22, [READY, ["term-node"], ...settle]), "picker-cancel");
// A missing shown program is a crash of the picker's own; the wrapper still answers.
oneVerb("bad argument", await drive("bad-arg", "nope", 59, 22, [["sleep", 0.5], ...settle]), "picker-cancel");

// Input that ends is not an answer either. Without a handler the event loop empties and node
// exits 0 having appended nothing, so the wrapper appends nothing and the daemon waits on a
// picker that has gone. No pty here: stdin is /dev/null, so the read ends at once.
{
  const cmd = path.join(SCRATCH, "cmd-eof");
  let status = 0;
  try {
    execFileSync("node", [path.join(ROOT, "bin/cockpit-fleet-picker.mjs"), cmd, "claude"],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 5000, env: QUIET() });
  } catch (e) { status = e.status; }
  const lines = fs.existsSync(cmd) ? fs.readFileSync(cmd, "utf8").split("\n").filter(Boolean) : [];
  check("stdin at EOF: exactly one verb, picker-cancel", lines, ["picker-cancel"]);
  check("stdin at EOF: a clean exit, so the wrapper adds none", status, 0);
}

// --- the frame, drawn through the real tty, at the slot sizes --------------------
{
  const r = await drive("frame-59", "claude", 59, 22, [READY, ["snap", "a"], ["send", DOWN], ["snap", "b"]],
    world({ claude: { sleep: 2 } }));
  if (r) {
    check("59x22: the §2.3 frame, … under each entry", r.snaps.a, [
      "", "   SWITCH PROGRAM", "   " + "─".repeat(40), "",
      "     Claude Agents             shown now", "       …", "", "   ▸ PIR", "       …",
      ...Array(12).fill(""), "   ↑↓ choose · enter or → open · esc back",
    ]);
    check("59x22: ↓ redraws with ▸ on Claude Agents", [r.snaps.b[4], r.snaps.b[7]],
      ["   ▸ Claude Agents             shown now", "     PIR"]);
  }
}
{
  const r = await drive("frame-39", "pir", 39, 12, [READY, ["snap", "a"]], world({ claude: { sleep: 2 } }));
  if (r) {
    check("39x12: entries, lists, one spacer and hint, no title", r.snaps.a, [
      "   ▸ Claude Agents", "   …", "", "     PIR" + " ".repeat(22) + "shown now", "   …",
      "", "", "", "", "", "", "↑↓ choose · enter or → open · esc back",
    ]);
  }
}

// --- a resize redraws at the new size ---------------------------------------------
{
  const r = await drive("resize", "pir", 59, 22, [READY, ["resize", 39, 12], ["wait", "choose"], ["snap", "small"],
    ["resize", 20, 6], ["wait", "choose"], ["snap", "tiny"], ["resize", 120, 40], ["wait", "SWITCH PROGRAM"], ["snap", "big"],
    ["send", RIGHT], ...settle]);
  if (r) {
    check("resize to 39x12: redrawn without the title", r.snaps.small.some((l) => l.includes("SWITCH PROGRAM")), false);
    check("resize to 39x12: hint on the last row", r.snaps.small[11], "↑↓ choose · enter or → open · esc back");
    check("resize to 39x12: shown now intact", r.snaps.small[3], "     PIR" + " ".repeat(22) + "shown now");
    check("resize to 20x6: six rows, hint last", r.snaps.tiny.length === 6 && r.snaps.tiny[5].startsWith("↑↓"), true);
    check("resize to 120x40: hint on row 40", r.snaps.big[39], "   ↑↓ choose · enter or → open · esc back");
    check("resize to 120x40: full rule", r.snaps.big[2], "   " + "─".repeat(40));
    check("after the resizes the picker still answers", r.cmd, ["fleet-claude"]);
    check("after the resizes the wrapper is alive", r.alive, true);
  }
}

// --- the status lists (plans/fleet-picker-status T04, DESIGN §2.5, §2.7) -----------------
const bgAgent = (id, name, state, startedAt) => ({ id, kind: "background", name, state, startedAt });
const TYPICAL = {
  agents: [
    bgAgent("b-run", "my-agentic-ide / oauth-loopback", "working", 3000),
    bgAgent("b-wait", "sdet-tools / epic-readiness", "blocked", 2000),
    bgAgent("b-done", "pir / ended-at", "done", 1000),
    { id: "i-1", kind: "interactive", name: "pir / a worker", state: "working", startedAt: 4000 },
  ],
  finished: { "b-done": 12 * MIN + 30000 },
  pir: {
    runs: [
      { repo: "my-agentic-ide", slug: "fleet-picker-status", kind: "work", state: "running", waitingForYou: true,
        display: { state: "asking you", done: 3, total: 7 } },
      { repo: "pir", slug: "s-restart", label: "fix restart", kind: "single", state: "running", waitingForYou: false,
        display: { state: "testing" } },
    ],
  },
};
const BUSY = {
  agents: Array.from({ length: 8 }, (_, i) => bgAgent(`b${i}`, `repo-${i} / topic-${i}`, i < 2 ? "blocked" : "working", 100 - i)),
  pir: { runs: Array.from({ length: 8 }, (_, i) => ({ repo: `r${i}`, slug: `plan-${i}`, kind: "work", state: "running",
    waitingForYou: i === 0, display: { state: i === 0 ? "asking you" : "building" } })) },
};
const pad = (n) => Array(n).fill("");
const HINT_59 = "   ↑↓ choose · enter or → open · esc back";
const HINT_39 = "↑↓ choose · enter or → open · esc back";
const HEAD_59 = ["", "   SWITCH PROGRAM", "   " + "─".repeat(40), ""];
const TYPICAL_59 = [
  ...HEAD_59,
  "     Claude Agents             shown now",
  "       ● needs you  sdet-tools / epic-readiness",
  "       ◐ working    my-agentic-ide / oauth-loopback",
  "       ✓ done 12m   pir / ended-at",
  "",
  "   ▸ PIR",
  "       ● asking you 3/7  my-agentic-ide / fleet-picker-sta…",
  "       ◐ testing         pir / \"fix restart\"",
  ...pad(9), HINT_59,
];
const TYPICAL_39 = [
  "     Claude Agents            shown now",
  "   ● needs you  sdet-tools / epic-read…",
  "   ◐ working    my-agentic-ide / oauth…",
  "   ✓ done 12m   pir / ended-at",
  "",
  "   ▸ PIR",
  "   ● asking you 3/7  my-agentic-ide / …",
  "   ◐ testing         pir / \"fix restar…",
  ...pad(3), HINT_39,
];
const LOADING_59 = [...HEAD_59, "     Claude Agents             shown now", "       …", "", "   ▸ PIR", "       …", ...pad(12), HINT_59];
const LOADING_39 = ["     Claude Agents            shown now", "   …", "", "   ▸ PIR", "   …", ...pad(6), HINT_39];

// The frame is up before a slow claude (1s) answers, with … under both entries; the lists then
// fill in, at both slot sizes. Only the redraw is waited for, never a fixed time.
for (const [size, cols, rows, loading, loaded] of [["59x22", 59, 22, LOADING_59, TYPICAL_59], ["39x12", 39, 12, LOADING_39, TYPICAL_39]]) {
  const seen = pirSeen.length;
  const r = await drive(`typical-${size}`, "claude", cols, rows,
    [READY, ["sleep", 0.2], ["snap", "early"], ["wait-line", loaded.find((l) => l.includes("◐ working"))], ["snap", "late"]],
    world({ ...TYPICAL, claude: { sleep: 1 } }));
  if (r) {
    check(`${size}: … under both entries at 0.3s, before claude answers`, r.snaps.early, loading);
    check(`${size}: the typical lists once both have answered`, r.snaps.late, loaded);
    check(`${size}: pir was asked once, for /v2/runs with its key`, pirSeen.slice(seen).map((x) => x.url), ["/v2/runs"]);
  }
}

// A choice made while loading is normal and loses nothing: one verb, the wrapper alive, and the
// screen never redrawn behind it (the lists would have filled in at 1s).
{
  const r = await drive("enter-while-loading", "claude", 59, 22, [READY, ["send", "\r"], ["wait-cmd", 1], ["sleep", 1.5]],
    world({ ...TYPICAL, claude: { sleep: 1 } }));
  oneVerb("Enter while loading", r, "fleet-pir");
  if (r) check("Enter while loading: the screen still shows the loading frame", r.screen, LOADING_59);
}

// ↓ ↑ move the highlight while loading and after, and never touch the lists.
{
  const after = TYPICAL_59.map((l) => l === "     Claude Agents             shown now" ? "   ▸ Claude Agents             shown now"
    : l === "   ▸ PIR" ? "     PIR" : l);
  const r = await drive("arrows-around-loading", "claude", 59, 22, [READY, ["send", DOWN], ["snap", "loadingDown"], ["send", UP],
    ["snap", "loadingUp"], ["wait-line", TYPICAL_59[6]], ["send", DOWN], ["snap", "loadedDown"], ["send", UP], ["snap", "loadedUp"]],
    world({ ...TYPICAL, claude: { sleep: 1 } }));
  if (r) {
    check("↓ while loading: ▸ on Claude Agents, … kept", [r.snaps.loadingDown[4], r.snaps.loadingDown[5], r.snaps.loadingDown[7], r.snaps.loadingDown[8]],
      ["   ▸ Claude Agents             shown now", "       …", "     PIR", "       …"]);
    check("↑ while loading: back to the loading frame", r.snaps.loadingUp, LOADING_59);
    check("↓ after: ▸ on Claude Agents, lists unchanged", r.snaps.loadedDown, after);
    check("↑ after: back to the typical lists", r.snaps.loadedUp, TYPICAL_59);
    check("arrows: nothing appended", r.cmd, []);
  }
}

// Esc after the lists fill: one cancel.
oneVerb("Esc after the lists", await drive("esc-after-lists", "claude", 59, 22,
  [READY, ["wait-line", TYPICAL_59[6]], ["send", "\x1b"], ...settle], world(TYPICAL)), "picker-cancel");

// No claude on PATH: Claude is unavailable, pir still listed.
{
  const r = await drive("no-claude", "claude", 59, 22, [READY, ["wait-line", TYPICAL_59[10]], ["snap", "a"]],
    world({ ...TYPICAL, claude: null }));
  if (r) check("no claude on PATH: status unavailable under Claude, pir drawn", r.snaps.a,
    [...HEAD_59, TYPICAL_59[4], "       status unavailable", "", ...TYPICAL_59.slice(9, 12), ...pad(11), HINT_59]);
}

// No api.json: the PIR entry names the usual cause; at 39 columns only the cause, which the
// whole line would have cut to `pir service no…` (T05 drill, person 2026-10-09).
for (const [size, cols, rows, line] of [["59x22", 59, 22, "       status unavailable · pir service not running"],
  ["39x12", 39, 12, "   pir service not running"]]) {
  const r = await drive(`pir-down-${size}`, "claude", cols, rows, [READY, ["wait-line", line], ["snap", "a"]],
    world({ ...TYPICAL, pir: undefined }));
  if (r) check(`${size}: no api.json → the pir-down line, Claude still listed`,
    r.snaps.a.filter((l) => l === line || l.includes("needs you")).length, 2);
}

// A claude whose answer cannot be read (~20 MB of non-JSON): unavailable, and keys still answered.
{
  const r = await drive("huge-claude", "claude", 59, 22, [READY, ["wait-line", "       status unavailable"], ["snap", "a"],
    ["send", DOWN], ["send", "\r"], ...settle], world({ ...TYPICAL, claude: { mode: "huge" } }));
  oneVerb("huge claude output", r, "fleet-claude");
  if (r) check("huge claude output: unavailable under Claude, pir drawn", [r.snaps.a[5], r.snaps.a[8]], ["       status unavailable", "       ● asking you 3/7  my-agentic-ide / fleet-picker-sta…"]);
}

// Busy: more items than rows → `+N more` under both entries at 39x12.
{
  const r = await drive("busy-39", "claude", 39, 12, [READY, ["wait-line", "     +5 more"], ["snap", "a"]], world(BUSY));
  if (r) check("busy at 39x12: four rows each, +5 more under both", r.snaps.a, [
    "     Claude Agents            shown now",
    "   ● needs you  repo-0 / topic-0", "   ● needs you  repo-1 / topic-1", "   ◐ working    repo-2 / topic-2", "     +5 more",
    "",
    "   ▸ PIR",
    "   ● asking you  r0 / plan-0", "   ◐ building    r1 / plan-1", "   ◐ building    r2 / plan-2", "     +5 more",
    HINT_39,
  ]);
}

// No run read the real machine: every pir request carried a scratch key.
check("pir stand-in: only scratch keys were ever sent", pirSeen.every((x) => /^key-\d+$/.test(x.key || "")), true);

pirServer.close();
if (fail === 0) fs.rmSync(SCRATCH, { recursive: true, force: true });
else console.log(`  screens kept in ${SHOTS}`);
console.log(`CHECKS ${pass} ${fail}`);
process.exit(fail ? 1 : 0);
