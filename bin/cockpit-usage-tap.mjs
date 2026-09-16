#!/usr/bin/env node
// cockpit-usage-tap -- the statusline command Claude Code runs after every turn.
// Its only job is to copy a personal subscription's `rate_limits` into the cache
// the footer reads. It is registered GLOBALLY (for every session, not only cockpit
// ones, DESIGN 2.6) because the limit is account-wide and any personal session
// reports the same true number, so more feeders means a fresher reading.
//
//   <this> < turn-input.json     tap the data (what settings.json invokes)
//   <this> --install             register as the statusLine in ~/.claude/settings.json
//   <this> --uninstall           remove ours, restore any statusline we replaced
//   <this> --check               say what --install would do, write nothing
//
// The registration mirrors the auto-name hook's merge (DESIGN 2.6, 6): never
// rewrite the user's settings.json, never drop their other keys or hooks, point
// rather than duplicate on a re-run, refuse a file it cannot parse. A statusLine
// already present that is NOT ours is preserved by CHAINING (DESIGN 2.7): install
// records it in ~/.claude/cockpit/statusline-prev, and at runtime the tap runs that
// recorded command with the same stdin and emits its stdout as the visible line
// before tapping the data on top; --uninstall restores it exactly. With no recorded
// command (the case on this machine) the visible output stays empty.
//
// Two hard rules shape the whole file (DESIGN 2.7): the tap must be INVISIBLE --
// Claude Code waits for our stdout before drawing its own status line, and the
// person asked for the cockpit footer, not a line inside every Claude session, so
// the default visible output is empty -- and it must NEVER DISRUPT a session --
// any error anywhere (Bedrock env, malformed stdin, an unwritable cache dir) ends
// in an empty stdout and exit 0, so a broken tap degrades to "no fresh reading",
// never to a broken Claude session. That is why every path here is wrapped and the
// process always exits 0.
//
// The clock is read HERE, in the shell layer (`Date.now()`), and passed into the
// pure model; the model never reads a clock (DESIGN 3.1). The tap stays quick and
// dependency-free otherwise: read stdin, normalize, one write, exit.

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { normalizeRateLimits } from "./cockpit-usage-model.mjs";
import { writeCache } from "./cockpit-usage-store.mjs";

// The cockpit state dir, resolved at call time so a test's COCKPIT_DIR is honoured
// the same way the store honours it (DESIGN 5.2). statusline-prev lives here, beside
// usage-cache.json -- per-machine, never in the repo (DESIGN 6).
function cockpitDir() {
  return process.env.COCKPIT_DIR || join(homedir(), ".claude", "cockpit");
}

const PREV_FILE = "statusline-prev";     // the foreign statusLine we replaced, recorded whole

// The Bedrock gate (DESIGN 2.5). A boolean-ish env flag is "on" only when present,
// non-empty and not a spelled-out off value -- the exact reading Claude Code itself
// gives CLAUDE_CODE_USE_BEDROCK, so the tap short-circuits on the same signal that
// routed the session to Bedrock. Kept as a local copy rather than imported from the
// auto-namer: this file must stay small and pull in only the model and the store.
export function truthy(v) {
  const t = String(v ?? "").trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

// The recorded command of the statusLine we replaced at install, or null. Read
// afresh each turn (it is tiny) so an uninstall that removes the file takes effect
// at once. A missing, empty or malformed file means "nothing to chain" -> null,
// never a throw (DESIGN 2.7).
function prevCommand(dir) {
  try {
    const obj = JSON.parse(readFileSync(join(dir, PREV_FILE), "utf8"));
    const cmd = obj && typeof obj.command === "string" ? obj.command.trim() : "";
    return cmd || null;
  } catch { return null; }
}

// The visible statusline (DESIGN 2.7). The person asked for the cockpit footer, not
// a line inside every Claude session, so by default this is EMPTY. The one exception
// is chaining: if install recorded a foreign statusLine command (statusline-prev),
// run it with the same stdin Claude Code piped us and emit its stdout, so a person
// who already had a statusline keeps seeing it. Any failure there -- no recorded
// command, a command that errors or hangs -- falls back to empty output, exit 0,
// exactly like every other tap error: a broken chain never disrupts the session.
// This runs on EVERY path including Bedrock, because the foreign statusline is
// unrelated to usage and must keep working on a company session too.
function visibleLine(stdinText = "", dir = cockpitDir()) {
  const cmd = prevCommand(dir);
  if (!cmd) return "";
  try {
    // Run it as Claude Code would have: through the shell, with the turn's JSON on
    // stdin. A hard timeout bounds it -- the tap must stay fast (DESIGN 2.7); a
    // hung chained command would block Claude Code's status line. A non-zero exit
    // makes execSync throw, caught below -> empty output, never a stack.
    const out = execSync(cmd, {
      input: stdinText ?? "",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    });
    return out ?? "";
  } catch {
    return "";
  }
}

/**
 * The tap's whole behaviour as a function of its inputs, so the tests can drive it
 * without a subprocess. Returns the string to print; performs the cache write as a
 * side effect. NEVER THROWS -- any error (a bad env read, unparseable stdin, an
 * unwritable cache dir) is swallowed to an empty line, matching the exit-0 contract
 * the entrypoint relies on (DESIGN 2.7).
 *
 * @param stdinText  the raw JSON Claude Code piped on stdin
 * @param now        ms since epoch, read by the caller (the model stays clock-free)
 * @param dir        optional cache dir override (tests point it at a scratch dir);
 *                   omitted, the store uses COCKPIT_DIR or ~/.claude/cockpit
 */
export function runTap({ env = process.env, stdinText = "", now = Date.now(), dir } = {}) {
  try {
    // Bedrock first, before we even inspect the object (DESIGN 2.5): belt and
    // braces so a company session never surfaces a limit, even a future one the
    // gateway might attach. No read of stdin's rate_limits happens on this path.
    if (truthy(env.CLAUDE_CODE_USE_BEDROCK)) return visibleLine(stdinText, dir);

    let json;
    try { json = JSON.parse(stdinText); } catch { return visibleLine(stdinText, dir); }

    // normalizeRateLimits returns null for an absent, empty or undrawable
    // rate_limits (no five_hour/seven_day, or both incomplete), so stdin without
    // usable numbers leaves the last reading alone -- no clobber (DESIGN 2.5, 2.n).
    const cache = normalizeRateLimits(json && json.rate_limits, now);
    if (cache) writeCache(cache, dir);

    return visibleLine(stdinText, dir);
  } catch {
    // Any unexpected failure (e.g. an unwritable cache dir surfacing from
    // writeCache) degrades to no fresh reading, never a disrupted session.
    return "";
  }
}

// ------------------------------------------------------------- install ---
//
// Registering ourselves keeps the knowledge of WHERE we hook with the hook, and
// gives the tests the same code path bin/install.sh runs rather than a copy that
// would drift -- exactly as cockpit-auto-name.mjs does for its UserPromptSubmit
// hook. The difference: a statusLine is a SINGLE object, not a list, so there is at
// most one to reason about, and a foreign one is preserved by recording it rather
// than by keeping it alongside ours.

// "ours" is matched on the script basename, as the hook matches its own, so a
// checkout that moved (a different absolute path) is still recognised and
// re-pointed rather than left as a dead duplicate.
function isOurs(sl) {
  return sl && typeof sl.command === "string" && sl.command.endsWith("cockpit-usage-tap.mjs");
}

// Pure merge: given the parsed settings and our command, return the next settings,
// whether we re-pointed our own entry, and the foreign statusLine we must record
// (null unless one was present that is not ours). No I/O, so the tests can drive it
// directly and install() stays the thin file-writing shell around it.
export function registerStatusLine(settings, command) {
  const next = structuredClone(settings ?? {});
  const cur = next.statusLine;
  const replaced = isOurs(cur);              // our own entry, just needs re-pointing
  const foreign = cur && !isOurs(cur) ? cur : null;
  next.statusLine = { type: "command", command };
  return { settings: next, replaced, foreign };
}

function readPrev(dir) {
  try { return JSON.parse(readFileSync(join(dir, PREV_FILE), "utf8")); } catch { return null; }
}

function writePrev(dir, obj) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, PREV_FILE);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  renameSync(tmp, p);                        // atomic, like every cockpit state write
}

function removePrev(dir) {
  try { unlinkSync(join(dir, PREV_FILE)); } catch { /* already gone */ }
}

// Parse settings.json, refusing (exit 1, change nothing) a file that will not parse
// -- a malformed settings.json silently disables EVERY setting in it, so overwriting
// it on a guess would trade one dead feature for all of them (DESIGN 6). An absent
// or empty file is the first-run case and parses to {}.
function loadSettings(settingsPath) {
  let raw = null;
  try { raw = readFileSync(settingsPath, "utf8"); } catch { /* first run: none yet */ }
  if (raw === null || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    process.stderr.write(`cockpit-usage-tap: ${settingsPath} is not valid JSON -- not touching it.\n`);
    process.exit(1);
  }
}

function writeSettings(settingsPath, next) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  // Preserve the existing file's permissions: renameSync replaces the inode, so the
  // published file would otherwise take the temp's default mode. It is the user's
  // file -- a settings.json they had locked to 0600 must not silently widen.
  let mode;
  try { mode = statSync(settingsPath).mode; } catch { /* first run: no file to match */ }
  const tmp = `${settingsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, settingsPath);             // atomic: a half-written settings.json is a dead one
}

function install({ settingsPath, command, dir, dryRun }) {
  const settings = loadSettings(settingsPath);
  const { settings: next, replaced, foreign } = registerStatusLine(settings, command);
  const before = JSON.stringify(settings);
  const after = JSON.stringify(next);

  // --check runs before install.sh writes anything, so the future tense matters.
  const verb = before === after ? "already registered"
    : dryRun ? (foreign ? "will replace (existing statusline recorded)" : replaced ? "will re-point" : "will register")
    : (foreign ? "replaced (previous statusline recorded)" : replaced ? "re-pointed" : "registered");

  if (!dryRun && before !== after) {
    // Record the foreign statusLine BEFORE overwriting it, so a crash between the
    // two never loses it. Only when there IS a foreign one -- re-pointing our own
    // entry must not disturb a statusline-prev recorded by an earlier install.
    if (foreign) writePrev(dir, foreign);
    writeSettings(settingsPath, next);
  }
  process.stdout.write(`${verb}: ${command}\n`);
  return verb;
}

function uninstall({ settingsPath, dir, dryRun }) {
  const settings = loadSettings(settingsPath);
  const next = structuredClone(settings);

  if (!isOurs(next.statusLine)) {
    // Nothing of ours to remove. Leave a foreign or absent statusLine untouched.
    process.stdout.write("not registered: nothing to remove\n");
    return "not registered";
  }

  const prev = readPrev(dir);
  const verb = dryRun ? (prev ? "will remove (previous statusline restored)" : "will remove")
    : (prev ? "removed (previous statusline restored)" : "removed");

  if (prev) next.statusLine = prev;          // restore the recorded foreign one, exactly
  else delete next.statusLine;               // no recorded prior -> drop the key entirely

  if (!dryRun) {
    writeSettings(settingsPath, next);
    if (prev) removePrev(dir);               // consumed; a second uninstall is a no-op
  }
  process.stdout.write(`${verb}\n`);
  return verb;
}

// ------------------------------------------------------------------ main ---

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? "") : null;
  };
  const wantsInstall = argv.includes("--install");
  const wantsUninstall = argv.includes("--uninstall");
  const wantsCheck = argv.includes("--check");

  if (wantsInstall || wantsUninstall || wantsCheck) {
    const settingsPath = flag("--settings") || join(homedir(), ".claude", "settings.json");
    const dir = flag("--dir") || cockpitDir();
    const command = flag("--command") || new URL(import.meta.url).pathname;
    if (wantsUninstall) uninstall({ settingsPath, dir, dryRun: wantsCheck && !wantsUninstall });
    else install({ settingsPath, command, dir, dryRun: wantsCheck && !wantsInstall });
    return;
  }

  // ----- the tap itself -----
  // Read stdin whole and synchronously (Claude Code has already piped it), run the
  // tap, print its line, and ALWAYS exit 0. runTap never throws, and the outer
  // try/catch plus the fixed exit code are belt-and-braces on the same invariant.
  let stdinText = "";
  try { stdinText = readFileSync(0, "utf8"); } catch { stdinText = ""; }
  let out = "";
  try { out = runTap({ env: process.env, stdinText, now: Date.now() }); } catch { out = ""; }
  process.stdout.write(out);
}

// Importable by the tests without running anything. The tap and the installer are
// both synchronous, so a plain call is enough; the fixed exit 0 preserves the
// never-disrupt-a-session contract even if an install path throws.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch { /* never disrupt a session */ }
  process.exit(process.exitCode ?? 0);
}
