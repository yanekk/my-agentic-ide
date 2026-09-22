#!/usr/bin/env node
//
// The Stop-hook notification sound, made selective for PIR parallel workers.
//
// Background. Claude Code fires the `Stop` hook every time a session finishes
// responding and goes idle. The cockpit user's own hook was an unconditional
// `afplay .../Glass.aiff`, so every idle ding -- fine for one interactive
// session, noise in a parallel PIR run where a dozen worker agents each go idle
// the instant they finish their one task. This script keeps the ding for
// everything EXCEPT a worker that stopped because it is *done*; a worker that
// stopped because it needs a decision from the person still dings, because that
// is exactly the moment the person has to attend to it.
//
// How a worker is recognised, and how "done" is told from "needs you":
//
//   * A PIR worker runs in a worktree at
//     `{repo}/.claude/worktrees/pir-{plan}-T{nn}/` (the pir-worker contract:
//     the branch `pir/{plan}-T{nn}` with its slash flattened to a dash). The
//     Stop hook input carries the session `cwd`, so that path IS the signal --
//     no session-title parsing needed, and it cannot false-positive on an
//     ordinary agent, whose worktree is not named `pir-*-T{nn}`.
//
//   * The same worker records why it parked by dropping a report file into
//     `{repo}/plans/{plan}/.parallel/control/reports/`, whose body opens with
//     `[pir:v1 kind=<kind> task=<Txx>]`. The `kind` is the whole answer:
//     `implemented`/`done` are routine (silent); `question`/`decision`/`conflict`
//     all park the worker waiting for the person (ding). We read the newest
//     report for THIS task -- the folder holds every task's reports, so the
//     task filter is not optional.
//
// Fail-safe: anything we cannot classify falls back to the old behaviour of
// playing the sound -- a missed ding on a routine worker stop is cheaper than a
// silenced ding on a real one. The one deliberate exception is a *recognised*
// worker whose report we could not read at all: it is silenced, because the
// user's whole ask is "stop dinging every time these agents finish", and a
// worker with no needs-person report on disk is, by default, one that finished.
//
// Registration mirrors cockpit-auto-name.mjs / cockpit-usage-tap.mjs: the script
// owns its own settings.json merge (`--install`/`--check`/`--uninstall`), so the
// knowledge of WHERE it hooks lives with the hook and the tests drive the same
// code path bin/install.sh does. settings.json is the user's file -- a malformed
// one is refused rather than overwritten, every other Stop hook is left alone,
// and the write is atomic.

import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

// The sound is owned here, not passed on the command line: the registered hook
// command is just this script's path, and "play the Glass sound" is what it
// means. Same file the user's original unconditional hook used.
const SOUND = "/System/Library/Sounds/Glass.aiff";

// The report kinds that mean "this worker is parked waiting for the person" --
// every one of these dings. `conflict` is included deliberately: a worker whose
// branch conflicts is parked exactly like one asking a question, waiting for the
// person to attach and give the resolution (pir-worker contract). The routine
// kinds -- `implemented`, `done` -- are the ones we silence.
const NEEDS_PERSON = new Set(["question", "decision", "conflict"]);

const WORKTREES = "/.claude/worktrees/";

// From a session cwd, the worker it belongs to, or null for anything that is not
// a PIR worker. Matches the FIRST `.claude/worktrees/` segment and reads the
// `pir-{plan}-T{nn}` folder right after it -- the worker may cd deeper, so we
// take the folder, not the whole tail. The `-T{nn}` suffix anchors the plan, so
// a plan slug with its own dashes (`remote-grant`) is captured whole.
export function workerContext(cwd) {
  if (typeof cwd !== "string" || cwd === "") return null;
  const i = cwd.indexOf(WORKTREES);
  if (i < 0) return null;
  const main = cwd.slice(0, i);
  const folder = cwd.slice(i + WORKTREES.length).split("/")[0];
  const m = folder.match(/^pir-(.+)-T(\d+)$/);
  if (!m) return null;
  return { main, plan: m[1], task: `T${m[2]}` };
}

// The kind out of a report body, or null. Prefer the machine header the worker
// is contracted to write; fall back to a bare `kind:` marker in case the header
// was malformed but the body still names it (the pir-worker escape hatch).
export function extractKind(text) {
  if (typeof text !== "string") return null;
  const header = text.match(/\[pir:v1\s+kind=(\w+)/);
  if (header) return header[1].toLowerCase();
  const loose = text.match(/(?:^|\n)\s*kind:\s*(\w+)/i);
  return loose ? loose[1].toLowerCase() : null;
}

const REPORT_TASK = (text, task) =>
  typeof text === "string" && new RegExp(`\\btask=${task}\\b`).test(text);

// The newest report for one task, as its kind -- or null when there is none we
// can read. `deps` is injectable so the decision is testable without a disk.
// Newest is decided by the report filename's leading `Date.now()` (the worker
// writes `${ts}-${Txx}-${rand}.json`); mtime is the fallback when a name does
// not carry a parseable timestamp.
export function latestKind(main, plan, task, deps = { readdirSync, readFileSync, statSync }) {
  const dir = join(main, "plans", plan, ".parallel", "control", "reports");
  let names;
  try {
    names = deps.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return null; // no reports dir yet
  }
  const rows = [];
  for (const name of names) {
    let text;
    try {
      const raw = deps.readFileSync(join(dir, name), "utf8");
      text = JSON.parse(raw)?.text;
    } catch {
      continue; // a half-written or foreign file: skip, never throw
    }
    // The folder holds every task's reports, so filter to this one. Match the
    // header's `task=` first; fall back to the filename's `-{Txx}-` segment.
    if (!REPORT_TASK(text, task) && !name.includes(`-${task}-`)) continue;
    const ts = Number.parseInt(name, 10);
    let order = Number.isFinite(ts) ? ts : NaN;
    if (!Number.isFinite(order)) {
      try { order = deps.statSync(join(dir, name)).mtimeMs; } catch { order = 0; }
    }
    rows.push({ order, kind: extractKind(text) });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.order - a.order);
  return rows[0].kind;
}

// The whole decision, pure. `readLatestKind` is injected so the branch is
// testable; the default reads disk.
export function decideSound(input, readLatestKind = latestKind) {
  const ctx = workerContext(input?.cwd);
  // Not a PIR worker -- the user's own session, or an ordinary agent. Behave
  // exactly as the old unconditional hook did.
  if (!ctx) return { play: true, reason: "not a pir worker" };

  const kind = readLatestKind(ctx.main, ctx.plan, ctx.task);
  if (kind && NEEDS_PERSON.has(kind)) {
    return { play: true, reason: `worker parked for the person (kind=${kind})` };
  }
  // A recognised worker that is done (or whose report we could not read) is the
  // case the user asked to silence.
  return { play: false, reason: kind ? `worker routine (kind=${kind})` : "worker, no needs-person report" };
}

function play() {
  // Detached and unref'd so the ding outlives this short-lived hook process,
  // matching the original `async: true` afplay. Failure is silent -- a Stop hook
  // must never make noise on stderr into the session.
  try {
    const child = spawn("afplay", [SOUND], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch { /* no afplay, or spawn refused: nothing to play */ }
}

// --------------------------------------------------------------- install ---

const MINE = (h) =>
  typeof h?.command === "string" && basename(h.command) === "cockpit-stop-notify.mjs";

// The one legacy entry this hook SUPERSEDES: the plain unconditional afplay of
// the same sound. Removing it on install is what makes the selective behaviour
// actually take effect rather than sit alongside the old ding. Any OTHER Stop
// hook -- a different sound, a different command -- is left untouched.
const LEGACY_AFPLAY = (h) =>
  typeof h?.command === "string" && h.command.trim() === `afplay ${SOUND}`;

export function registerIn(settings, command) {
  const next = structuredClone(settings ?? {});
  next.hooks ??= {};
  const groups = Array.isArray(next.hooks.Stop) ? next.hooks.Stop : [];
  const drop = (h) => MINE(h) || LEGACY_AFPLAY(h);
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !drop(h)) }))
    .filter((g) => g.hooks.length > 0);
  const removed = groups.reduce((n, g) => n + (g.hooks ?? []).length, 0) -
    kept.reduce((n, g) => n + (g.hooks ?? []).length, 0);
  next.hooks.Stop = [...kept, { hooks: [{ type: "command", command, async: true }] }];
  return { settings: next, replaced: removed > 0 };
}

export function unregisterIn(settings) {
  const next = structuredClone(settings ?? {});
  if (!next.hooks || !Array.isArray(next.hooks.Stop)) return { settings: next, removed: false };
  const before = next.hooks.Stop.reduce((n, g) => n + (g.hooks ?? []).length, 0);
  next.hooks.Stop = next.hooks.Stop
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !MINE(h)) }))
    .filter((g) => g.hooks.length > 0);
  const after = next.hooks.Stop.reduce((n, g) => n + (g.hooks ?? []).length, 0);
  if (next.hooks.Stop.length === 0) delete next.hooks.Stop;
  return { settings: next, removed: before !== after };
}

function loadSettings(settingsPath) {
  let raw = null;
  try { raw = readFileSync(settingsPath, "utf8"); } catch { /* first run: none yet */ }
  if (raw === null || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    // A malformed settings.json silently disables EVERY setting in it, so it is
    // never overwritten on a guess.
    process.stderr.write(`cockpit-stop-notify: ${settingsPath} is not valid JSON -- not touching it.\n`);
    process.exit(1);
  }
}

function writeSettings(settingsPath, next) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, settingsPath); // atomic: a half-written settings.json is a dead one
}

function install({ settingsPath, command, dryRun }) {
  const settings = loadSettings(settingsPath);
  const { settings: next, replaced } = registerIn(settings, command);
  const before = JSON.stringify(settings);
  const after = JSON.stringify(next);
  const verb = before === after ? "already registered"
    : dryRun ? (replaced ? "will re-point" : "will register")
    : (replaced ? "re-pointed" : "registered");
  if (!dryRun && before !== after) writeSettings(settingsPath, next);
  process.stdout.write(`${verb}: ${command}\n`);
  return verb;
}

function uninstall({ settingsPath }) {
  const settings = loadSettings(settingsPath);
  const { settings: next, removed } = unregisterIn(settings);
  if (removed) writeSettings(settingsPath, next);
  process.stdout.write(`${removed ? "removed" : "not registered"}: cockpit-stop-notify.mjs\n`);
  return removed;
}

// ------------------------------------------------------------------ main ---

function runHook() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // No / bad hook input: fall back to the old unconditional ding rather than
    // swallow a notification the user was relying on.
    play();
    return;
  }
  if (decideSound(input).play) play();
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? "") : null;
  };
  const settingsPath = flag("--settings") || join(homedir(), ".claude", "settings.json");

  if (argv.includes("--uninstall")) { uninstall({ settingsPath }); return; }
  if (argv.includes("--install") || argv.includes("--check")) {
    install({
      settingsPath,
      command: flag("--command") || new URL(import.meta.url).pathname,
      dryRun: argv.includes("--check") && !argv.includes("--install"),
    });
    return;
  }
  runHook();
}

// Importable by the tests without running anything.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch { /* a Stop hook must never fail loudly */ }
  process.exit(0);
}
