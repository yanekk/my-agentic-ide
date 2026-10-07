// The measuring half of probe.sh (fleet-picker T00). probe.sh owns the private muxes
// and their teardown; this file only drives them and prints what it measured.
//
//   node probe.mjs <scratch> <cfg59x22> <cfg39x12> <rigPirHome|"">
//
// Every `wezterm cli` call goes through cli(), which names the private mux's config
// and passes --no-auto-start, so nothing here can reach (or start) another mux.
// Nothing ever sends \r or \n: the claude box would dispatch a new agent.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [scratch, cfgBig, cfgSmall, claudeCwd, pirHome, rigPirHome] = process.argv.slice(2);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CLAUDE_MARKER = "❯ describe a task for a new session";
const PIR_MARKER = "↑↓ move · ↵ open";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.timeOrigin + performance.now();

function cli(cfg, args) {
  const sock = cfg.replace(/wezterm-(.*)\.lua$/, "sock-$1");
  const r = spawnSync("wezterm", ["--config-file", cfg, "cli", "--no-auto-start", ...args],
    { encoding: "utf8", env: { ...process.env, WEZTERM_UNIX_SOCKET: sock } });
  if (r.status !== 0) throw new Error(`wezterm cli ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}
const send = (cfg, pane, s) => cli(cfg, ["send-text", "--pane-id", String(pane), "--no-paste", s]);
const lines = (cfg, pane) => cli(cfg, ["get-text", "--pane-id", String(pane)]).split("\n");
const list = (cfg) => JSON.parse(cli(cfg, ["list", "--format", "json"]));
const size = (cfg, pane) => { const p = list(cfg).find((x) => x.pane_id === pane); return p ? `${p.size.cols}x${p.size.rows}` : "?"; };

function spawnWindow(cfg, cwd, argv) {
  const out = cli(cfg, ["spawn", "--new-window", "--cwd", cwd, "--", ...argv]);
  return Number.parseInt(out.trim(), 10);
}
async function waitFor(fn, ms, step = 0) {
  const end = now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (now() > end) return null; if (step) await sleep(step); }
}
const claudeEmpty = (ls) => ls.some((l) => l.trimEnd() === CLAUDE_MARKER);
const pirMarkerLine = (ls) => ls.find((l) => l.trimStart().startsWith(PIR_MARKER)) ?? null;
const stats = (xs) => {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, median: +med.toFixed(1), min: +s[0].toFixed(1), max: +s[s.length - 1].toFixed(1) };
};
const show = (l) => JSON.stringify(l);   // keeps leading/trailing blanks visible

const results = {};
const say = (...a) => console.log(...a);

// --- 0. How long one get-text costs: the resolution of every poll below ------------
async function cliCost(cfg, pane) {
  const xs = [];
  for (let i = 0; i < 20; i++) { const t = now(); lines(cfg, pane); xs.push(now() - t); }
  return stats(xs);
}

// --- 1. Claude's echo time at 59x22 -------------------------------------------------
async function echo(cfg, pane) {
  const up = [], down = [], sendCost = [];
  for (let i = 0; i < 20; i++) {
    let t = now();
    send(cfg, pane, "x");
    sendCost.push(now() - t);
    const gone = await waitFor(() => !claudeEmpty(lines(cfg, pane)), 3000);
    up.push(gone ? now() - t : NaN);
    t = now();
    send(cfg, pane, "\x7f");
    const back = await waitFor(() => claudeEmpty(lines(cfg, pane)), 3000);
    down.push(back ? now() - t : NaN);
    await sleep(150);
  }
  return { charHidesPlaceholder: stats(up.filter(Number.isFinite)), backspaceRestores: stats(down.filter(Number.isFinite)),
           misses: up.filter((x) => !Number.isFinite(x)).length + down.filter((x) => !Number.isFinite(x)).length,
           sendTextCall: stats(sendCost) };
}

// --- 2. The markers, intact or not ---------------------------------------------------
async function claudeMarker(cfg, pane) {
  const ok = await waitFor(() => claudeEmpty(lines(cfg, pane)), 20000, 200);
  const line = lines(cfg, pane).find((l) => l.includes("describe a task")) ?? null;
  // and gone with text in the box, back when cleared
  send(cfg, pane, "y");
  const hides = await waitFor(() => !claudeEmpty(lines(cfg, pane)), 3000, 20);
  send(cfg, pane, "\x7f");
  const returns = await waitFor(() => claudeEmpty(lines(cfg, pane)), 3000, 20);
  return { size: size(cfg, pane), intact: !!ok, line: line && show(line), hidesWithText: !!hides, returnsWhenCleared: !!returns };
}
async function pirMarker(cfg, pane, listed = null) {
  // the screen it settles on: backend answered, and (with the rig) the run listed
  const settled = await waitFor(() => { const t = lines(cfg, pane).join("\n");
    return !t.includes("waiting for pir's backend") && (!listed || listed.test(t)); }, 30000, 250);
  const ok = await waitFor(() => pirMarkerLine(lines(cfg, pane)), 20000, 200);
  const hintish = lines(cfg, pane).find((l) => l.includes("move") || l.includes("open")) ?? null;
  send(cfg, pane, "y");
  const hides = await waitFor(() => !pirMarkerLine(lines(cfg, pane)), 3000, 20);
  const typed = lines(cfg, pane).find((l) => l.includes("start planning")) ?? null;
  send(cfg, pane, "\x7f");
  const returns = await waitFor(() => pirMarkerLine(lines(cfg, pane)), 3000, 20);
  const screen = lines(cfg, pane).map((l) => l.trimEnd()).filter(Boolean);
  return { size: size(cfg, pane), settled: !!settled, intact: !!ok, line: show(ok ?? hintish), hidesWithText: !!hides,
           typedHint: typed && show(typed.trim()), returnsWhenCleared: !!returns, screen };
}

// --- 3. Picker open time through a stub of what T03 will do ------------------------
async function openTime(cfg, mode) {
  const dir = path.join(scratch, `open-${mode}`);
  fs.mkdirSync(dir, { recursive: true });
  // cmd in a folder of its own, so the directory watch hears only the cmd file
  fs.mkdirSync(path.join(dir, "cmdd"), { recursive: true });
  const cmd = path.join(dir, "cmdd", "cmd");
  fs.writeFileSync(cmd, "");
  const slot = spawnWindow(cfg, scratch, ["/bin/bash", "--norc", "-c", "exec cat >/dev/null"]);
  const right = Number.parseInt(cli(cfg, ["split-pane", "--right", "--percent", "50", "--pane-id", String(slot),
    "--", "/bin/bash", "--norc", "-c", "exec cat >/dev/null"]).trim(), 10);
  void right;
  const sock = cfg.replace(/wezterm-(.*)\.lua$/, "sock-$1");
  const stub = (await import("node:child_process")).spawn("node",
    [path.join(HERE, "stub-daemon.mjs"), cfg, sock, cmd, String(slot), mode, path.join(HERE, "stub-picker.mjs"), dir],
    { stdio: ["ignore", "inherit", "inherit"] });
  await waitFor(() => fs.existsSync(path.join(dir, "ready")), 5000, 20);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const n = i + 1;
    const t0 = now();
    fs.appendFileSync(cmd, "picker\n");
    const idFile = path.join(dir, `pane-${n}`);
    const id = await waitFor(() => fs.existsSync(idFile) && Number.parseInt(fs.readFileSync(idFile, "utf8"), 10), 5000);
    const seen = id && await waitFor(() => lines(cfg, id).some((l) => l.includes("SWITCH PROGRAM")), 5000);
    const tSeen = now();
    const marksFile = path.join(dir, `marks-${n}.json`);
    await waitFor(() => fs.existsSync(marksFile), 5000, 10);
    const marks = JSON.parse(fs.readFileSync(marksFile, "utf8"));
    const frame = Number(fs.readFileSync(path.join(dir, `frame-${n}`), "utf8"));
    samples.push({ verbSeen: marks.verbSeen - t0, split: marks.split - t0, parked: marks.parked - t0,
                   activated: marks.activated - t0, firstFrame: frame - t0, onScreen: seen ? tSeen - t0 : NaN });
    fs.appendFileSync(cmd, "close\n");
    await waitFor(() => fs.existsSync(path.join(dir, `closed-${n}`)), 5000, 10);
    await sleep(300 + Math.floor(Math.random() * 200));   // spread the verb across the poll phase
  }
  stub.kill("SIGTERM");
  cli(cfg, ["kill-pane", "--pane-id", String(slot)]);
  const col = (k) => stats(samples.map((s) => s[k]).filter(Number.isFinite));
  return { verbSeen: col("verbSeen"), splitDone: col("split"), parkDone: col("parked"), activateDone: col("activated"),
           firstFrame: col("firstFrame"), onScreenViaGetText: col("onScreen") };
}

// -------------------------------------------------------------------------------------
const env = (extra) => ["/usr/bin/env", ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)];

for (const [label, cfg] of [["59x22", cfgBig], ["39x12", cfgSmall]]) {
  say(`\n== ${label} ==`);
  const claude = spawnWindow(cfg, claudeCwd, ["claude", "agents"]);
  const pir = spawnWindow(cfg, scratch, env({ PIR_HOME: pirHome }).concat(["pir"]));
  results[label] = {};
  results[label].claude = await claudeMarker(cfg, claude);
  say("claude marker", JSON.stringify(results[label].claude));
  results[label].pir = await pirMarker(cfg, pir);
  say("pir marker (empty runs list)", JSON.stringify(results[label].pir));
  if (rigPirHome) {
    const pr = spawnWindow(cfg, scratch, env({ PIR_HOME: rigPirHome }).concat(["pir"]));
    results[label].pirWithRun = await pirMarker(cfg, pr, /\brig\b/);
    say("pir marker (rig run listed)", JSON.stringify(results[label].pirWithRun));
    cli(cfg, ["kill-pane", "--pane-id", String(pr)]);
  }
  if (label === "59x22") {
    results.getTextCost = await cliCost(cfg, claude);
    say("get-text call", JSON.stringify(results.getTextCost));
    results.echo = await echo(cfg, claude);
    say("claude echo", JSON.stringify(results.echo));
    for (const mode of ["poll", "watch"]) {
      results[`open-${mode}`] = await openTime(cfg, mode);
      say(`picker open (${mode})`, JSON.stringify(results[`open-${mode}`]));
    }
  }
  // Ctrl+C would also do, but killing the pane is what teardown would do anyway.
  cli(cfg, ["kill-pane", "--pane-id", String(claude)]);
  cli(cfg, ["kill-pane", "--pane-id", String(pir)]);
}
fs.writeFileSync(path.join(scratch, "results.json"), JSON.stringify(results, null, 2));
say("\nresults.json written");
