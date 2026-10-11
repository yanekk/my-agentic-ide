#!/usr/bin/env node
//
// The Stop-hook notification sound, silenced for every session pir runs.
//
// Background. Claude Code fires the `Stop` hook every time a session finishes
// responding and goes idle. The cockpit user's own hook was an unconditional
// `afplay .../Glass.aiff`: fine for one interactive session, noise once pir
// runs plans in parallel -- planners, plan reviewers, build workers, task
// reviewers, the coordinator agent, the finisher and end-of-run helpers each go
// idle many times a run, and every idle dinged.
//
// The rule: a session pir launched never dings; everything else does.
//
//   * pir starts every one of its claude sessions (Agent SDK `query()`, stdio
//     pipes -- never a terminal) from a run process that its launcher gave
//     `PIR_RUN=1` (pir-engine src/backend/shell/launch.mjs), and each session
//     inherits that whole environment, as does this hook. So the variable marks
//     "pir launched this" for every role at once, and needs no knowledge of
//     roles, worktree names or report files.
//
//   * Silencing a pir session that is waiting on the person costs nothing: the
//     person never answers it in a terminal, only in pir's own dashboard or web
//     page, and pir already sends its own push alert when one needs them. An
//     earlier version kept the ding for a build worker parked on a question by
//     reading its report file; that recognised only build workers (by a
//     `pir-{plan}-T{nn}` worktree), so every other role kept dinging.
//
// Fail-safe: no or unreadable hook input still plays the sound -- a missed ding
// on the person's own session is the failure worth avoiding.
//
// Registration mirrors cockpit-auto-name.mjs / cockpit-usage-tap.mjs: the script
// owns its own settings.json merge (`--install`/`--check`/`--uninstall`), so the
// knowledge of WHERE it hooks lives with the hook and the tests drive the same
// code path bin/install.sh does. settings.json is the user's file -- a malformed
// one is refused rather than overwritten, every other Stop hook is left alone,
// and the write is atomic.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

// The sound is owned here, not passed on the command line: the registered hook
// command is just this script's path, and "play the Glass sound" is what it
// means. Same file the user's original unconditional hook used.
const SOUND = "/System/Library/Sounds/Glass.aiff";

// True when pir launched this session. pir's launcher sets `PIR_RUN=1`; a "0"
// or empty value is read as unset, so a person can force the ding back on.
export function isPirSession(env) {
  const v = env?.PIR_RUN;
  return typeof v === "string" && v !== "" && v !== "0";
}

// The whole decision, pure: the environment arrives as an argument.
export function decideSound(env) {
  if (isPirSession(env)) return { play: false, reason: "pir session" };
  return { play: true, reason: "not a pir session" };
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
  // The decision reads only the environment; stdin is drained so Claude Code
  // never sees a broken pipe, and its content does not matter.
  try { readFileSync(0); } catch { /* no stdin: still decide */ }
  if (decideSound(process.env).play) play();
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
