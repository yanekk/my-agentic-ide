#!/usr/bin/env node
// cockpitd — follow the `claude agents` fleet view and keep the cockpit in sync.
//
// Watches for attach/detach in the fleet view. On each attach it swaps BOTH
// slots to that agent's own panes: its own revdiff on its own worktree, and its
// own terminal. Every agent keeps both alive -- they keep running while you are
// elsewhere, so switching away and back resumes them mid-flight rather than
// starting over. Nothing is re-typed and no diff is re-parsed on a return, which
// is what makes switching instant. When you flush review annotations (`O`),
// it types them into the agent's prompt box and leaves them there UNSENT for you
// to edit and send.
//
// Every mechanism here is measured rather than assumed; see
// docs/tool-selection-rev2.md and spikes/pty-inject/RESULTS.md.
//
//   node bin/cockpitd.mjs
//
// Started for you by bin/cockpit-layout.sh.

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
const PANES = path.join(DIR, "panes.json");
const FLEET_LOG = path.join(DIR, "fleet.log");
// State for the terminal-list strip, and the command channel the WezTerm
// keybindings append to (new/next/prev/close). Both are files: the strip watches
// TERMS, the daemon tails CMD_FILE.
const TERMS = path.join(DIR, "terminals.json");
const CMD_FILE = path.join(DIR, "cmd");
// The persisted diff-mode preference (see DIFF_MODES below). One line, one of the
// mode names; rewritten atomically whenever the mode is toggled.
const DIFF_MODE_FILE = path.join(DIR, "diff-mode");

// Auto-reload the diff while the agent writes. `R` in revdiff drops annotations,
// but revdiff prompts first (we deliberately do NOT pass --no-confirm-reload), so
// an auto-reload can never silently destroy work in progress.
const AUTO_RELOAD = process.env.COCKPIT_AUTO_RELOAD !== "0";
const RELOAD_DEBOUNCE_MS = 1200;
const ANNOTATION_DEBOUNCE_MS = 250;
// Above this many lines a review is sent as a bracketed paste, which the prompt
// box collapses to a tidy `[Pasted text +N lines]` chip. Below it, raw newlines
// keep the text expanded and directly editable.
const PASTE_CHIP_THRESHOLD = 10;

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------------------
// WezTerm
// ---------------------------------------------------------------------------

const panes = JSON.parse(fs.readFileSync(PANES, "utf8"));

const WEZ_DIR = path.join(os.homedir(), ".local", "share", "wezterm");
const MUX_LINK = path.join(WEZ_DIR, "default-org.wezfurlong.wezterm");
const REPAIR_COOLDOWN_MS = 5000;
let lastRepair = 0;

function wezRaw(args, stdin) {
  return execFileSync("wezterm", ["cli", ...args], {
    input: stdin, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
  });
}

/**
 * Point the mux symlink back at a socket that is actually alive.
 *
 * `wezterm cli` reaches the GUI through default-org.wezfurlong.wezterm, a symlink
 * to that instance's gui-sock-<pid>. When WezTerm is killed rather than quit --
 * or restarts -- the symlink is left aimed at a dead socket and every cli call
 * fails with "failed to connect". The layout script repairs this at startup, but
 * a daemon that outlives a window restart needs to repair it mid-flight too;
 * otherwise the panes silently stop following with nothing to say why.
 *
 * Candidates are tried newest first and confirmed by an actual cli call, so a
 * leftover socket file cannot be mistaken for a live one.
 */
function repairMuxSocket() {
  if (Date.now() - lastRepair < REPAIR_COOLDOWN_MS) return false;
  lastRepair = Date.now();

  let candidates;
  try {
    candidates = fs.readdirSync(WEZ_DIR)
      .filter((f) => f.startsWith("gui-sock-"))
      .map((f) => {
        const full = path.join(WEZ_DIR, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return false;
  }

  for (const { full } of candidates) {
    try {
      fs.rmSync(MUX_LINK, { force: true });
      fs.symlinkSync(full, MUX_LINK);
      wezRaw(["list"]);                       // prove it before believing it
      log(`repaired stale mux socket → ${path.basename(full)}`);
      return true;
    } catch {
      /* dead socket too; try the next */
    }
  }
  return false;
}

/**
 * Never throws. The mux can be briefly unreachable -- a window closing, a socket
 * being replaced -- and this daemon has to outlive that. A dead cockpit that
 * needs restarting is far worse than a dropped keystroke. One failure triggers a
 * symlink repair and a single retry.
 */
function wez(args, stdin) {
  try {
    return wezRaw(args, stdin);
  } catch (e) {
    if (repairMuxSocket()) {
      try {
        return wezRaw(args, stdin);
      } catch { /* fall through to the log below */ }
    }
    log(`wezterm cli ${args[0]} failed: ${e.message.split("\n")[0]}`);
    return null;
  }
}

/** Write text to a pane exactly as typed. No newline is added. */
function sendRaw(paneId, text, { paste = false } = {}) {
  const args = ["send-text", "--pane-id", String(paneId)];
  if (!paste) args.push("--no-paste");
  return wez(args, text) !== null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** revdiff's annotation editor replaces the status bar with its own footer. */
const EDITOR_MARKER = "[enter] save";
/**
 * revdiff frames its file tree and diff, so every row of its screen begins with
 * a box-drawing rule. A shell prompt does not produce anything like this many.
 */
const FRAMED_LINES = /^│/gm;
const FRAMED_ENOUGH = 5;
/** How long a freshly spawned login shell gets before we type into it. */
const SHELL_SETTLE_MS = 400;

/**
 * What is in a diff pane right now.
 *
 *   "absent"  -- the pane is gone
 *   "shell"   -- a shell prompt: revdiff is not running (someone pressed `q`)
 *   "editing" -- revdiff is up with its ANNOTATION EDITOR OPEN
 *   "running" -- revdiff is up and otherwise idle
 *
 * "editing" is why this function exists. While the editor is open revdiff treats
 * every keystroke as comment text, so an auto-reload `R` is typed INTO the
 * comment as a literal "R". That is survivable on a pane you are looking at; a
 * parked pane would silently collect stray letters in a half-written comment.
 *
 * Two independent signals say revdiff is running, and EITHER is enough, because
 * the obvious one is not trustworthy on its own: WezTerm titles a pane after its
 * foreground process, but the title lags the launch by about a second -- longer
 * for a pane that has just been moved between tabs. Believing a stale "bash"
 * would retype the whole revdiff command into a running revdiff, where every
 * character is a keybinding. So the screen is consulted too, and it answers
 * immediately: measured 19 framed lines within half a second of launch, 0 at a
 * shell prompt, 19 again while a transient status message covers the status bar,
 * and back to 0 once revdiff is quit with `q`.
 */
function diffPaneStatus(paneId, table = paneTable()) {
  const pane = table?.find((p) => p.pane_id === paneId);
  if (!pane) return "absent";
  const text = wez(["get-text", "--pane-id", String(paneId)]) ?? "";
  if (text.includes(EDITOR_MARKER)) return "editing";
  const framed = (text.match(FRAMED_LINES) ?? []).length >= FRAMED_ENOUGH;
  return framed || /revdiff/.test(pane.title ?? "") ? "running" : "shell";
}

/**
 * Start revdiff in a pane sitting at a shell prompt.
 *
 * ctrl-U first, because a restored pane may have stray characters on its prompt
 * -- the `q` that quit revdiff, for one. No `q` is sent: callers only reach here
 * when revdiff is *not* running, and a `q` into a running revdiff with the
 * annotation editor open would land in the comment.
 */
function launchInPane(paneId, cmd) {
  sendRaw(paneId, "\x15");          // ctrl-U: clear the line
  sendRaw(paneId, `${cmd}\n`);
}

// ---------------------------------------------------------------------------
// Per-agent panes
//
// Each of the two slots -- the full-width diff on top, the terminal bottom-right
// -- shows ONE pane at a time, but every agent keeps its own live pane in both.
// Switching agents moves the outgoing pane into a tab of its own and moves the
// incoming one back into the slot. WezTerm never tears the PTY down, so a
// `sleep 60` started before a switch has ~30s left when you come back 30s later
// -- and scrollback, cwd, history and any running job come back with it.
//
// The diff slot works the same way and for a sharper reason: starting revdiff
// costs a couple of seconds of git and parsing, which used to be paid on EVERY
// switch. A parked revdiff is already sitting on that agent's diff, with its
// selected file, scroll position and unflushed annotations intact, so returning
// to an agent types nothing at all.
//
// Measured on wezterm 20240203 against a headless mux server (so no window was
// disturbed to find this out):
//
//   * a parked pane keeps running -- a 1/s counter accrued 21 ticks while its
//     pane sat in a background tab, and kept climbing after it was moved back;
//   * `split-pane --move-pane-id` returns the MOVED pane's id (not a new one)
//     and restores the 50/50 bottom row;
//   * `kill-pane` on a parked pane disposes of its now-empty tab as well;
//   * a parked pane is resized to the full tab (80x24 in the probe) and back on
//     return, so it gets two SIGWINCHes per switch. Line-oriented output does not
//     care; a full-screen TUI reflows, which is why this is written down.
//
// Parked panes live in tabs of the cockpit window. `enable_tab_bar = false` in
// wezterm/cockpit.lua keeps them off screen and un-clickable -- activating one
// would fill the window with a bare shell and look like the cockpit had vanished.
// ---------------------------------------------------------------------------

/** Key for the shell shown while the fleet LIST is up: cwd = the cockpit repo. */
const REPO_KEY = "__repo__";
const LOGIN_SHELL = process.env.SHELL || "/bin/zsh";
// Tests drive this down so two strikes take seconds rather than half a minute.
const REAP_MS = Number(process.env.COCKPIT_REAP_MS) || 15000;
// Two consecutive misses before killing. One failed `claude agents` read must
// never be enough to take out a shell with someone's build running in it.
const REAP_STRIKES = 2;

/**
 * key (job id, or REPO_KEY) -> { panes: [id,...], cur }. Every id is a live PTY.
 *
 * An agent has ONE diff but MANY terminals -- VSCode's terminal-tab model. Only
 * `cur`'s pane is in the slot at a time; the rest are parked in tabs of their
 * own, still running. The repo (fleet-list) context keeps a single shell.
 */
const terminals = new Map([[REPO_KEY, { panes: [panes.shell], cur: 0 }]]);
let visibleKey = REPO_KEY;
/** How many terminals one agent may open. A backstop, not a real ceiling. */
const MAX_TERMS = 8;
/** The same, for the diff slot: one live revdiff per agent. */
const diffs = new Map([[REPO_KEY, panes.diff]]);
let visibleDiff = REPO_KEY;
const reapStrikes = new Map();

// ---------------------------------------------------------------------------
// Diff mode
//
// Every agent's revdiff shows one of two ranges, toggled with ⌥[/⌥] WHILE THE
// DIFF PANE IS FOCUSED (the same keys cycle terminals otherwise -- see the
// CMD_FILE tail):
//
//   "uncommitted" — revdiff --untracked HEAD: HEAD -> working tree, the agent's
//                   uncommitted work. Matches what the agent sees from git status.
//   "lastcommit"  — revdiff HEAD~1 HEAD: just the most recent commit.
//
// The choice is GLOBAL and PERSISTED: reopening the cockpit restores the last
// mode chosen, and every agent's revdiff is (re)launched in it. `diffLaunchedMode`
// records the mode a parked pane was actually launched with, so returning to an
// agent relaunches its revdiff only when the mode has changed since -- otherwise
// the pane comes back untouched, which is the whole point of parking it.
// ---------------------------------------------------------------------------

const DIFF_MODES = ["uncommitted", "lastcommit"];

function readDiffMode() {
  try {
    const v = fs.readFileSync(DIFF_MODE_FILE, "utf8").trim();
    if (DIFF_MODES.includes(v)) return v;
  } catch { /* no preference yet */ }
  return "uncommitted";
}

let diffMode = readDiffMode();
const diffLaunchedMode = new Map();

function persistDiffMode() {
  try {
    const tmp = `${DIFF_MODE_FILE}.tmp`;
    fs.writeFileSync(tmp, `${diffMode}\n`);
    fs.renameSync(tmp, DIFF_MODE_FILE);
  } catch { /* best-effort; a lost write just defaults back next launch */ }
}

/**
 * The revdiff command line for the current mode, writing annotations to
 * `reviewFile`. `HEAD` is passed symbolically (not resolved to a SHA) so a reload
 * re-reads it and committing work drops it out of an uncommitted diff.
 */
function diffCommand(reviewFile) {
  const out = ["-o", JSON.stringify(reviewFile)];
  if (diffMode === "lastcommit") {
    // HEAD~1 -> HEAD is exactly the most recent commit. No --untracked: this range
    // has no working tree, so untracked files do not belong to it.
    return ["revdiff", ...out, "HEAD~1", "HEAD"].join(" ");
  }
  // HEAD -> working tree. --untracked is not optional: agents create new files
  // constantly and plain `git diff` omits them.
  return ["revdiff", "--untracked", ...out, "HEAD"].join(" ");
}

/** The pane currently shown for `key`, or undefined if it has none live. */
function curTermId(key) {
  const t = terminals.get(key);
  if (!t || !t.panes.length) return undefined;
  if (t.cur >= t.panes.length) t.cur = t.panes.length - 1;
  return t.panes[t.cur];
}

/** Drop pane ids that no longer exist; forget an agent whose last one is gone. */
function pruneDeadTerminals(live) {
  for (const [k, t] of terminals) {
    const before = t.panes.length;
    t.panes = t.panes.filter((id) => live.has(id));
    if (t.cur >= t.panes.length) t.cur = Math.max(0, t.panes.length - 1);
    if (t.panes.length !== before && !t.panes.length && k !== REPO_KEY) terminals.delete(k);
  }
}

/** Drop one pane id from an agent's list, keeping `cur` in range. */
function removeTerminal(entry, id) {
  const i = entry.panes.indexOf(id);
  if (i < 0) return;
  entry.panes.splice(i, 1);
  if (entry.cur >= entry.panes.length) entry.cur = Math.max(0, entry.panes.length - 1);
}

/**
 * Publish the visible agent's terminal list for the strip renderer
 * (bin/cockpit-strip.mjs), which draws it in the always-present right-edge pane.
 * Written atomically so the strip never reads a half-file.
 */
function writeTerminals(table = paneTable()) {
  const t = terminals.get(visibleKey);
  // The pane title is just whatever the shell's prompt sets it to (usually the
  // cwd), not what is running -- useless as a terminal name. The strip labels
  // each terminal by its foreground PROCESS instead (VSCode-style: zsh, node,
  // npm...), which it resolves from the tty on every repaint so it stays live.
  const ttyOf = (id) => {
    const tn = table?.find((p) => p.pane_id === id)?.tty_name;
    return tn ? tn.replace(/^\/dev\//, "") : null;
  };
  const list = t ? t.panes.map((id, i) => ({ n: i + 1, active: i === t.cur, tty: ttyOf(id) })) : [];
  const agent = visibleKey === REPO_KEY ? "repo" : (attached?.name ?? visibleKey);
  try {
    const tmp = `${TERMS}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ agent, diffMode, terminals: list })}\n`);
    fs.renameSync(tmp, TERMS);
  } catch { /* the strip just keeps its last frame */ }
}

function paneTable() {
  const out = wez(["list", "--format", "json"]);
  if (out === null) return null;
  try { return JSON.parse(out); } catch { return null; }
}

/** Keep panes.json honest: both visible pane ids change on every switch. */
function publishPanes(patch) {
  Object.assign(panes, patch);
  try {
    const tmp = `${PANES}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(panes)}\n`);
    fs.renameSync(tmp, PANES);
  } catch { /* the daemon's own copy is what matters; the file is for humans */ }
}

/**
 * Move a pane out of the cockpit tab, keeping its PTY -- and everything running
 * in it -- alive.
 */
function parkPane(paneId, label, cockpitTab) {
  wez(["move-pane-to-new-tab", "--pane-id", String(paneId)]);
  // Titled purely so `wezterm cli list` is readable while debugging -- the tab
  // bar is off.
  wez(["set-tab-title", "--pane-id", String(paneId), `cockpit: ${label}`]);
  // In the GUI the new tab becomes the active one, which would swap the whole
  // cockpit off screen. Put it back.
  if (cockpitTab !== undefined) wez(["activate-tab", "--tab-id", String(cockpitTab)]);
}

/**
 * Put a pane into the bottom-right terminal slot, which sits BETWEEN the fleet
 * pane (left) and the strip (right).
 *
 * `anchor` is the pane that currently holds the slot. The incoming pane is split
 * INTO it at 50%, and the caller disposes of the anchor afterwards, so the
 * incoming inherits the slot's exact geometry regardless of its neighbours --
 * the same trick the diff slot uses. When the slot is EMPTY (anchor undefined),
 * the strip is parked so the split can come off the fleet pane and span the whole
 * bottom-right region, then the strip is moved back to its edge. All four cases
 * measured against a headless mux; see spikes/pane-swap.
 *
 * `spec` is { moveId } to bring a parked pane back, or { cwd } to spawn a fresh
 * login shell. Returns the pane id now in the slot, or undefined on failure.
 */
function insertIntoSlot(anchor, spec, cockpitTab) {
  const tail = spec.moveId !== undefined
    ? ["--move-pane-id", String(spec.moveId)]
    : ["--cwd", spec.cwd, "--", LOGIN_SHELL, "-l"];

  let out;
  if (anchor !== undefined) {
    out = wez(["split-pane", "--right", "--percent", "50", "--pane-id", String(anchor), ...tail]);
  } else {
    const strip = panes.strip;
    if (strip !== undefined) parkPane(strip, "strip", cockpitTab);
    out = wez(["split-pane", "--right", "--percent", "50", "--pane-id", String(panes.fleet), ...tail]);
    const gap = Number.parseInt((out ?? "").trim(), 10);
    if (strip !== undefined && Number.isInteger(gap)) {
      wez(["split-pane", "--right", "--percent", "20", "--pane-id", String(gap), "--move-pane-id", String(strip)]);
    }
  }
  const id = Number.parseInt((out ?? "").trim(), 10);
  return Number.isInteger(id) ? id : undefined;
}

/** Is `id` a live pane sitting in the cockpit tab (i.e. actually in a slot)? */
function inCockpit(id, table, cockpitTab) {
  return id !== undefined && table.find((p) => p.pane_id === id)?.tab_id === cockpitTab;
}

/**
 * Is the diff pane the focused (active) pane in the cockpit tab right now?
 *
 * This is what routes ⌥[/⌥]: they cycle the diff mode when the diff pane holds
 * focus and terminals otherwise. WezTerm reports one active pane PER TAB, so the
 * parked panes (each alone in its own tab) each read active too -- only the one in
 * the cockpit tab counts.
 */
function diffPaneFocused(table = paneTable()) {
  if (!table) return false;
  const cockpitTab = table.find((p) => p.pane_id === panes.fleet)?.tab_id;
  const active = table.find((p) => p.tab_id === cockpitTab && p.is_active);
  return active !== undefined && active.pane_id === panes.diff;
}

/**
 * Show `key`'s CURRENT terminal in the bottom-right slot, creating the first one
 * at `cwd`. Whatever held the slot is parked, not killed.
 */
async function showTerminal(key, cwd, label) {
  const table = paneTable();
  if (!table) return log("cannot read the pane list; leaving the terminal alone");

  const live = new Set(table.map((p) => p.pane_id));
  const cockpitTab = table.find((p) => p.pane_id === panes.fleet)?.tab_id;

  // Panes die with their window, and this daemon outlives windows. Forget the
  // ghosts before trying to move any of them.
  pruneDeadTerminals(live);
  if (!terminals.has(key)) terminals.set(key, { panes: [], cur: 0 });
  const entry = terminals.get(key);

  const outgoing = curTermId(visibleKey);
  const anchor = inCockpit(outgoing, table, cockpitTab) ? outgoing : undefined;

  // Already showing this key's current terminal, and it really is in the slot:
  // returning types nothing, which is the whole point of parking.
  if (key === visibleKey && anchor !== undefined) return writeTerminals(table);

  let incoming = curTermId(key);
  if (incoming !== undefined) {
    const moved = insertIntoSlot(anchor, { moveId: incoming }, cockpitTab);
    if (moved === undefined) { removeTerminal(entry, incoming); incoming = undefined; }
    else log(`restored terminal pane ${incoming} for ${label ?? key}`);
  }
  if (incoming === undefined) {
    incoming = insertIntoSlot(anchor, { cwd }, cockpitTab);
    if (incoming === undefined) return log(`could not open a terminal for ${label ?? key}`);
    entry.panes.push(incoming);
    entry.cur = entry.panes.length - 1;
    log(`opened terminal pane ${incoming} for ${label ?? key} at ${cwd}`);
  }

  if (anchor !== undefined && anchor !== incoming) {
    parkPane(anchor, visibleKey === REPO_KEY ? "repo" : visibleKey, cockpitTab);
  }
  visibleKey = key;
  // split-pane activates whatever it put in the slot. Switching agents happens in
  // the fleet view, so that is where the next keystroke belongs.
  wez(["activate-pane", "--pane-id", String(panes.fleet)]);
  publishPanes({ shell: incoming });
  writeTerminals();
}

/**
 * new / next / prev / close, applied to the VISIBLE agent's terminals. Agents
 * only: at the fleet list the slot holds the single repo shell, so these are
 * ignored. Shares the reconcile lock so a keypress can never race a pane swap.
 */
async function terminalCommand(verb, attempt = 0) {
  if (!attached || visibleKey === REPO_KEY) return;
  // A keystroke must not be lost just because a reconcile happens to be running:
  // back off and retry rather than dropping it. reconcile holds the lock only for
  // the length of one pane swap, so a handful of tries covers it.
  if (reconciling) {
    if (attempt < 20) setTimeout(() => terminalCommand(verb, attempt + 1), 100);
    return;
  }
  reconciling = true;
  try {
    const key = visibleKey;
    const table = paneTable();
    if (!table) return;
    const live = new Set(table.map((p) => p.pane_id));
    const cockpitTab = table.find((p) => p.pane_id === panes.fleet)?.tab_id;
    pruneDeadTerminals(live);
    const entry = terminals.get(key);
    if (!entry) return;
    const current = curTermId(key);
    const anchor = inCockpit(current, table, cockpitTab) ? current : undefined;

    if (verb === "new") {
      if (entry.panes.length >= MAX_TERMS) return log(`terminal cap (${MAX_TERMS}) reached for ${key}`);
      const id = insertIntoSlot(anchor, { cwd: attached.worktree }, cockpitTab);
      if (id === undefined) return log(`could not open a new terminal for ${key}`);
      if (anchor !== undefined) parkPane(anchor, key, cockpitTab);
      entry.panes.push(id);
      entry.cur = entry.panes.length - 1;
      log(`opened terminal pane ${id} for ${key} (${entry.panes.length} total)`);
    } else if (verb === "next" || verb === "prev") {
      if (entry.panes.length < 2 || anchor === undefined) return;
      const delta = verb === "next" ? 1 : -1;
      const incoming = entry.panes[(entry.cur + delta + entry.panes.length) % entry.panes.length];
      if (insertIntoSlot(anchor, { moveId: incoming }, cockpitTab) === undefined) {
        return removeTerminal(entry, incoming);
      }
      parkPane(anchor, key, cockpitTab);
      entry.cur = entry.panes.indexOf(incoming);
      log(`switched to terminal pane ${incoming} for ${key}`);
    } else if (verb === "close") {
      if (entry.panes.length < 2) return log(`refusing to close the last terminal for ${key}`);
      if (anchor === undefined) return;
      // Show a sibling (the previous one, or the next if this is the first), then
      // kill the pane being closed -- restoring collapses the split and the
      // sibling inherits the slot before the closed pane goes.
      const nextIdx = entry.cur > 0 ? entry.cur - 1 : 1;
      const incoming = entry.panes[nextIdx];
      insertIntoSlot(anchor, { moveId: incoming }, cockpitTab);
      wez(["kill-pane", "--pane-id", String(anchor)]);
      removeTerminal(entry, anchor);
      entry.cur = entry.panes.indexOf(incoming);
      log(`closed terminal pane ${anchor} for ${key} (${entry.panes.length} left)`);
    } else {
      return;
    }
    // The user is managing terminals, so leave the keystroke focus in the one now
    // showing rather than bouncing it back to the fleet pane.
    const shown = curTermId(key);
    if (shown !== undefined) wez(["activate-pane", "--pane-id", String(shown)]);
    publishPanes({ shell: shown });
    writeTerminals();
  } finally {
    reconciling = false;
  }
}

/**
 * Restart revdiff in `pane` with the current mode's range.
 *
 * Switching the range means RESTARTING revdiff -- `R` only reloads the same range
 * -- so the TUI is quit back to its shell (`q`) and relaunched. Never done while
 * the annotation editor is open: revdiff reads every keystroke as comment text, so
 * the `q` and the whole command would land in the comment. On a pane already at a
 * shell (revdiff was quit with `q`) there is nothing to quit, so skip straight to
 * the launch.
 */
async function relaunchDiff(jobId, pane, worktree, reviewFile) {
  const status = diffPaneStatus(pane);
  if (status === "editing") {
    return log(`not switching diff mode for ${jobId}: annotation editor is open`);
  }
  if (status === "running") {
    sendRaw(pane, "q");                 // quit revdiff back to the shell
    await sleep(SHELL_SETTLE_MS);       // let the prompt return before we type
  }
  launchInPane(pane, `cd ${JSON.stringify(worktree)} && ${diffCommand(reviewFile)}`);
  diffLaunchedMode.set(jobId, diffMode);
  log(`relaunched diff pane ${pane} for ${jobId} in ${diffMode} mode`);
}

/**
 * Toggle the diff mode (⌥[/⌥] while the diff pane is focused) and relaunch the
 * attached agent's revdiff in the new mode. Only meaningful attached to an agent:
 * the repo diff pane shown at the fleet list is a static placeholder, not a
 * revdiff. Shares the reconcile lock -- like terminalCommand -- so the relaunch
 * cannot race a pane swap; a keypress that lands during one backs off and retries.
 */
async function diffModeCommand(verb, attempt = 0) {
  if (!attached || visibleDiff === REPO_KEY) return;
  if (reconciling) {
    if (attempt < 20) setTimeout(() => diffModeCommand(verb, attempt + 1), 100);
    return;
  }
  reconciling = true;
  try {
    const i = DIFF_MODES.indexOf(diffMode);
    const dir = verb === "next" ? 1 : -1;
    const next = DIFF_MODES[(i + dir + DIFF_MODES.length) % DIFF_MODES.length];
    if (next === diffMode) return;
    diffMode = next;
    persistDiffMode();
    writeTerminals();                   // the footer shows the current mode
    const jobId = visibleDiff;
    const pane = diffs.get(jobId);
    if (pane === undefined || jobId !== attached.jobId) return;
    await relaunchDiff(jobId, pane, attached.worktree, attached.reviewFile);
    // The reviewer is reading the diff, so leave focus on it rather than bouncing
    // back to the fleet pane the way an agent switch does.
    wez(["activate-pane", "--pane-id", String(pane)]);
  } finally {
    reconciling = false;
  }
}

/**
 * Rebuild an EMPTY diff slot, full width.
 *
 * If the slot's pane is gone -- someone exited the shell revdiff was running in
 * -- a plain `split-pane --top --pane-id <fleet>` does NOT restore it: it splits
 * the fleet pane's own region, so the new pane is half a window wide (59 of 120
 * columns in the probe) because the bottom row is a horizontal split. Parking
 * BOTH the terminal and the strip leaves the fleet pane alone in its row, so the
 * split spans the window; both are then moved back to their edges. All measured;
 * see spikes/pane-swap/RESULTS.md.
 *
 * Returns a throwaway placeholder pane holding the slot, for the caller to split
 * into and then kill.
 */
function rebuildDiffSlot(cockpitTab) {
  const term = curTermId(visibleKey);
  const strip = panes.strip;
  if (term !== undefined) parkPane(term, "rebuilding", cockpitTab);
  if (strip !== undefined) parkPane(strip, "strip", cockpitTab);
  const out = wez(["split-pane", "--top", "--percent", "42",
                   "--pane-id", String(panes.fleet), "--cwd", panes.repo,
                   "--", LOGIN_SHELL, "-l"]);
  // Restore the bottom row: fleet | terminal | strip. The strip clings to
  // whichever pane now forms the right edge -- the terminal if there is one,
  // otherwise the fleet pane.
  if (term !== undefined) {
    wez(["split-pane", "--right", "--percent", "50",
         "--pane-id", String(panes.fleet), "--move-pane-id", String(term)]);
  }
  if (strip !== undefined) {
    wez(["split-pane", "--right", "--percent", "20",
         "--pane-id", String(term ?? panes.fleet), "--move-pane-id", String(strip)]);
  }
  const id = Number.parseInt((out ?? "").trim(), 10);
  if (!Number.isInteger(id)) {
    log("could not rebuild the diff slot");
    return null;
  }
  log(`rebuilt the diff slot (placeholder pane ${id})`);
  return id;
}

/**
 * Put `key`'s diff pane in the full-width top slot, creating it at `cwd` the
 * first time. Whatever was there is parked, not killed.
 *
 * The ORDER is the opposite of the terminal slot's, and it is not a style
 * choice. The diff pane spans the window, so its geometry lives in the pane it
 * occupies: park it first and there is nothing left to split but the fleet
 * pane's half-width region. So the incoming pane is split INTO the outgoing one
 * (`--percent 50` of the slot) and the outgoing one is disposed of afterwards;
 * removing it collapses the split and the incoming pane inherits the whole slot,
 * at exactly the original size. Measured both ways -- getting this backwards
 * brings revdiff back at half width.
 *
 * Returns { pane, spawned } so the caller knows whether anything needs typing.
 */
async function showDiff(key, cwd, label) {
  const table = paneTable();
  if (!table) {
    log("cannot read the pane list; leaving the diff alone");
    return null;
  }

  const live = new Set(table.map((p) => p.pane_id));
  const cockpitTab = table.find((p) => p.pane_id === panes.fleet)?.tab_id;
  for (const [k, id] of diffs) if (!live.has(id)) { diffs.delete(k); diffLaunchedMode.delete(k); }

  if (key === visibleDiff && diffs.has(key)) return { pane: diffs.get(key), spawned: false };

  let anchor = diffs.get(visibleDiff);
  const throwaway = anchor === undefined;
  if (throwaway) {
    anchor = rebuildDiffSlot(cockpitTab);
    if (anchor === null) return null;
  }

  let pane = diffs.get(key);
  if (pane !== undefined) {
    const moved = wez(["split-pane", "--top", "--percent", "50",
                       "--pane-id", String(anchor), "--move-pane-id", String(pane)]);
    if (moved === null) { diffs.delete(key); pane = undefined; }
  }
  let spawned = false;
  if (pane === undefined) {
    const out = wez(["split-pane", "--top", "--percent", "50",
                     "--pane-id", String(anchor), "--cwd", cwd, "--", LOGIN_SHELL, "-l"]);
    const id = Number.parseInt((out ?? "").trim(), 10);
    if (!Number.isInteger(id)) {
      log(`could not open a diff pane for ${label ?? key}`);
      return null;
    }
    pane = id;
    spawned = true;
    diffs.set(key, pane);
  }

  if (throwaway) wez(["kill-pane", "--pane-id", String(anchor)]);
  else parkPane(anchor, `diff ${visibleDiff === REPO_KEY ? "repo" : visibleDiff}`, cockpitTab);

  visibleDiff = key;
  // split-pane activates whatever it put in the slot. Switching agents happens in
  // the fleet view, so that is where the next keystroke belongs.
  wez(["activate-pane", "--pane-id", String(panes.fleet)]);
  publishPanes({ diff: pane });
  log(spawned ? `opened diff pane ${pane} for ${label ?? key} at ${cwd}`
              : `restored diff pane ${pane} for ${label ?? key}`);
  return { pane, spawned };
}

/**
 * Kill the panes of agents that are gone from the fleet, in both slots, and stop
 * following their worktrees. Without this they accumulate for the life of the
 * window, pointing at worktrees that no longer exist, with no way to reach them
 * (their agent is no longer in the list).
 */
async function reapAgents() {
  const candidates = [...new Set([...terminals.keys(), ...diffs.keys()])]
    .filter((k) => k !== REPO_KEY && k !== visibleKey && k !== visibleDiff);
  if (!candidates.length) return;

  let list;
  try { list = await agents(); } catch { return; }
  const alive = new Set(list.map((a) => a.id));

  for (const key of candidates) {
    if (alive.has(key)) { reapStrikes.delete(key); continue; }
    const strikes = (reapStrikes.get(key) ?? 0) + 1;
    reapStrikes.set(key, strikes);
    if (strikes < REAP_STRIKES) continue;
    // An agent has many terminals but one diff; kill every pane it owns.
    const term = terminals.get(key);
    if (term) {
      for (const id of term.panes) {
        wez(["kill-pane", "--pane-id", String(id)]);
        log(`reaped terminal pane ${id} — agent ${key} is gone`);
      }
      terminals.delete(key);
    }
    const d = diffs.get(key);
    if (d !== undefined) {
      wez(["kill-pane", "--pane-id", String(d)]);
      log(`reaped diff pane ${d} — agent ${key} is gone`);
      diffs.delete(key);
      diffLaunchedMode.delete(key);
    }
    stopWorktreeWatch(key);
    reapStrikes.delete(key);
  }
}

/**
 * Notice that the attached agent has lost a pane, and rebuild it.
 *
 * A pane can go away under us -- quit revdiff with `q`, then exit the shell it
 * was running in. Nothing else would repair it: the reconcile poll returns early
 * while the attached agent is still the one showing, so the slot would sit empty
 * until the next switch. Forgetting `attached` is enough; the next poll sees a
 * newly attached agent and rebuilds both slots.
 *
 * Skipped while a reconcile is in flight: attaching creates the two panes one
 * after the other, and a check landing in that gap sees a missing terminal and
 * restarts an attach that was already half done.
 */
function healMissingPanes() {
  if (!attached || reconciling) return;
  const table = paneTable();
  if (!table) return;
  const live = new Set(table.map((p) => p.pane_id));
  const cockpitTab = table.find((p) => p.pane_id === panes.fleet)?.tab_id;

  const diff = diffs.get(attached.jobId);
  if (diff === undefined || !live.has(diff)) {
    log(`diff pane for ${attached.jobId} is gone; rebuilding`);
    diffs.delete(attached.jobId);
    attached = null;
    return;
  }
  // The terminal slot is healthy as long as this agent's CURRENT terminal is in
  // it. A dead current with a live sibling still needs a rebuild -- the sibling
  // is parked, so the slot is empty until it is brought back. Losing a background
  // terminal (not the visible one) is just pruned, no rebuild needed.
  pruneDeadTerminals(live);
  if (!inCockpit(curTermId(attached.jobId), table, cockpitTab)) {
    log(`terminal pane for ${attached.jobId} is gone; rebuilding`);
    attached = null;
  }
}

// ---------------------------------------------------------------------------
// claude
// ---------------------------------------------------------------------------

async function agents() {
  const { stdout } = await execFileAsync("claude", ["agents", "--json"], {
    timeout: 8000, maxBuffer: 4 << 20,
  });
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// Tail the fleet debug log
// ---------------------------------------------------------------------------

const ENTER = /\[FV-attach\] respawnJob (\S+?):/;
const EXIT = /\[FV-attach\] attachJob returned after (\d+)ms/;

function tail(file, onLine) {
  let pos = 0, ino = null, buf = "";
  const read = () => {
    let st;
    try { st = fs.statSync(file); } catch { return; }
    if (ino !== null && (st.ino !== ino || st.size < pos)) pos = 0;  // rotated
    ino = st.ino;
    if (st.size <= pos) return;
    const fd = fs.openSync(file, "r");
    const len = st.size - pos;
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, pos);
    fs.closeSync(fd);
    pos = st.size;
    buf += b.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) onLine(l);
  };
  try { pos = fs.statSync(file).size; ino = fs.statSync(file).ino; } catch {}
  setInterval(read, 200);
}

// ---------------------------------------------------------------------------
// Per-agent session
// ---------------------------------------------------------------------------

/**
 * `attached` gates every injection. When the fleet view is showing its LIST
 * rather than an agent, its prompt box dispatches a NEW agent -- typing a review
 * into it there would spawn one instead of commenting. Verified; see RESULTS.md.
 */
let attached = null;          // { jobId, worktree, reviewFile }
let watchers = [];            // annotation watch: torn down on every switch

function stopWatchers() {
  for (const w of watchers) { try { w.close(); } catch {} }
  watchers = [];
}

/**
 * Worktree watches, one per agent, kept ALIVE while that agent's diff pane is
 * parked.
 *
 * This is what makes a restored pane current rather than a snapshot of whenever
 * you last looked at it. The agent keeps writing while you are elsewhere, so
 * without this the whole point of parking the pane would be undone: it would come
 * back instantly and out of date. Reloading in the background costs one `R` per
 * quiet second of agent writes, in a pane nobody is looking at.
 */
const worktreeWatches = new Map();      // jobId -> fs.FSWatcher

function stopWorktreeWatch(jobId) {
  const w = worktreeWatches.get(jobId);
  if (!w) return;
  try { w.close(); } catch {}
  worktreeWatches.delete(jobId);
}

/** Compose the annotations into the prompt we type into the agent. */
function composePrompt(annotations) {
  return [
    "Review comments on your changes (file:line anchored):",
    "",
    annotations.trim(),
    "",
    "Please address each one. Ask if any is ambiguous.",
  ].join("\n");
}

function injectReview(text) {
  if (!attached) {
    log("refusing to inject: not attached to an agent");
    return;
  }
  // \r is what the Enter key sends and WOULD submit the prompt early; \n merely
  // inserts a newline. Normalising is the entire safety requirement here.
  const safe = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const asChip = safe.split("\n").length > PASTE_CHIP_THRESHOLD;
  sendRaw(panes.fleet, safe, { paste: asChip });
  log(`injected ${safe.split("\n").length} lines into ${attached.jobId} (unsent)`);
}

/**
 * Watch for review flushes (`O` in revdiff).
 *
 * Two things here are deliberate, and both were learned by getting them wrong:
 *
 * 1. **Watch the DIRECTORY, not the file.** revdiff flushes atomically -- it
 *    writes a temporary file and renames it over the target -- so the path gets a
 *    new inode every time. `fs.watch` on the file follows the inode it opened
 *    with, so it fires for the first flush and then watches a deleted file
 *    forever. Measured: inode 32065744 → 32065765 across one flush. Directory
 *    watches survive the replacement.
 *
 * 2. **Trigger on write identity, not content.** `O` is an explicit "send this to
 *    the agent" gesture, so pressing it twice must inject twice even if nothing
 *    changed -- the reviewer may have cleared the prompt box and want it back.
 *    Deduplicating on content silently swallows that. Keying on mtime+size
 *    instead collapses the several filesystem events of a single write while
 *    still treating a second flush as a second request.
 */
function watchAnnotations(file) {
  try { fs.writeFileSync(file, ""); } catch {}
  const name = path.basename(file);
  let lastWrite = "";
  let timer = null;

  const check = () => {
    let st, cur;
    try {
      st = fs.statSync(file);
      cur = fs.readFileSync(file, "utf8");
    } catch {
      return;                                   // mid-rename; the next event wins
    }
    const id = `${st.mtimeMs}:${st.size}`;
    if (!cur.trim() || id === lastWrite) return;
    lastWrite = id;
    injectReview(composePrompt(cur));
  };

  const w = fs.watch(DIR, (_event, changed) => {
    if (changed && changed !== name) return;
    clearTimeout(timer);
    timer = setTimeout(check, ANNOTATION_DEBOUNCE_MS);
  });
  watchers.push(w);
}

/**
 * Ask an agent's revdiff to reload -- visible or parked, it is the same pane.
 *
 * Two things must be true before `R` is sent, and only one of them was needed
 * back when the diff pane was rebuilt on every switch:
 *
 * 1. **Nothing flushed yet.** `R` drops annotations, so the diff has to stop
 *    moving the moment you start commenting.
 * 2. **The annotation editor is not open.** revdiff reads every keystroke as
 *    comment text while it is, so `R` would be typed into the comment as a
 *    literal "R" -- unnoticed, in a pane that is not on screen.
 *
 * With a *saved* annotation and no editor open, `R` is safe by revdiff's own
 * doing: it asks "Annotations will be dropped -- press y to confirm", a second
 * `R` counts as "any other key" and cancels, and the annotation survives. So
 * prompts cannot pile up in a parked pane. Measured.
 */
function reloadDiff(jobId, reviewFile) {
  const pane = diffs.get(jobId);
  if (pane === undefined) return;

  let pending = "";
  try { pending = fs.readFileSync(reviewFile, "utf8"); } catch {}
  if (pending.trim()) return;

  const status = diffPaneStatus(pane);
  if (status === "editing") return log(`not reloading ${jobId}: annotation editor is open`);
  if (status !== "running") return;
  sendRaw(pane, "R");
}

function watchWorktree(jobId, worktree, reviewFile) {
  if (!AUTO_RELOAD || worktreeWatches.has(jobId)) return;
  let timer = null;
  const w = fs.watch(worktree, { recursive: true }, (_e, name) => {
    if (!name || name.startsWith(".git/") || name.includes("node_modules")) return;
    clearTimeout(timer);
    timer = setTimeout(() => reloadDiff(jobId, reviewFile), RELOAD_DEBOUNCE_MS);
  });
  worktreeWatches.set(jobId, w);
}

async function onEnter(jobId, knownName) {
  // Tear down the previous agent's watchers BEFORE touching the panes: quitting
  // revdiff flushes its annotations, and that write must not be mistaken for a
  // review of the agent we are switching to.
  stopWatchers();

  let agent;
  try {
    agent = (await agents()).find((a) => a.id === jobId);
  } catch (e) {
    log(`could not list agents: ${e.message}`);
    return;
  }
  if (!agent) return log(`no agent for job ${jobId}`);

  const worktree = agent.cwd;
  const reviewFile = path.join(DIR, `review-${jobId}.md`);
  attached = { jobId, worktree, reviewFile, name: knownName ?? agent.name };
  log(`enter ${jobId} "${agent.name}" → ${worktree}`);

  const shown = await showDiff(jobId, worktree, agent.name);
  // A restored pane already has revdiff up on this diff, with the file you were
  // reading and any unflushed annotations still there. Typing nothing is the
  // entire point -- so revdiff is only started when there is no revdiff to
  // return to: a brand-new pane, or one whose revdiff was quit with `q`. The one
  // exception is a mode change while the pane was parked: the diff would come
  // back in the old range, so it is relaunched in the current mode (see
  // diffCommand / the DIFF_MODES block for what each range means).
  if (shown) {
    if (shown.spawned || diffPaneStatus(shown.pane) === "shell") {
      if (shown.spawned) await sleep(SHELL_SETTLE_MS);  // let the login shell start reading
      launchInPane(shown.pane, `cd ${JSON.stringify(worktree)} && ${diffCommand(reviewFile)}`);
      diffLaunchedMode.set(jobId, diffMode);
    } else if (diffLaunchedMode.get(jobId) !== diffMode) {
      await relaunchDiff(jobId, shown.pane, worktree, reviewFile);
    }
  }

  await showTerminal(jobId, worktree, agent.name);

  watchAnnotations(reviewFile);
  watchWorktree(jobId, worktree, reviewFile);
}

async function onExit() {
  if (attached) log(`exit ${attached.jobId} → fleet list`);
  stopWatchers();
  attached = null;              // blocks injection while the list is showing
  // Both of the agent's panes are parked, not closed: whatever is running keeps
  // running, its revdiff keeps following its worktree, and entering that agent
  // again brings both back mid-flight.
  await showDiff(REPO_KEY, panes.repo, "repo");
  await showTerminal(REPO_KEY, panes.repo, "repo");
}

// ---------------------------------------------------------------------------
// Reconciling against what the fleet pane actually shows
//
// The debug log is fast but undocumented, and it only exists if the fleet view
// was started with --debug-file. The fleet pane renders the attached agent's
// name in its own header:
//
//     ────────────────────────── polish psychiatric hotline voiceover ─
//
// and shows "describe a task for a new session" when it is back at the list. We
// own that pane, so `wezterm cli get-text` can read it -- a fully supported way
// to know the truth. The log is therefore demoted to a latency hint that merely
// triggers an immediate reconcile; this poll decides what is actually true.
// ---------------------------------------------------------------------------

const HEADER = /─{10,}\s+(\S.*?)\s+─/;
const LIST_MARKER = "describe a task for a new session";
const POLL_MS = 800;

async function paneState() {
  let text;
  try {
    const { stdout } = await execFileAsync(
      "wezterm", ["cli", "get-text", "--pane-id", String(panes.fleet)],
      { timeout: 4000, maxBuffer: 8 << 20 },
    );
    text = stdout;
  } catch {
    // This poll is the daemon's main heartbeat, so it is also where a stale mux
    // socket shows up first. Repair and retry once rather than going quiet.
    if (!repairMuxSocket()) return null;
    try {
      text = wezRaw(["get-text", "--pane-id", String(panes.fleet)]);
    } catch {
      return null;                                // pane really is gone
    }
  }
  if (text.includes(LIST_MARKER)) return { mode: "list" };
  const m = text.match(HEADER);
  return m ? { mode: "agent", name: m[1].trim() } : null;
}

let reconciling = false;

async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    const state = await paneState();
    if (!state) return;

    if (state.mode === "list") {
      if (attached) await onExit();
      return;
    }
    if (attached && attached.name === state.name) return;   // already correct

    let list;
    try { list = await agents(); } catch { return; }
    const hits = list.filter((a) => a.name === state.name);
    if (hits.length !== 1) {
      // Ambiguous or unknown: a truncated header, or two agents sharing a name.
      // Better to leave the panes where they are than to point them at a guess.
      if (hits.length > 1) log(`ambiguous agent name ${JSON.stringify(state.name)}`);
      return;
    }
    await onEnter(hits[0].id, state.name);
  } finally {
    reconciling = false;
  }
}

log(`cockpitd up · panes ${JSON.stringify(panes)} · auto-reload ${AUTO_RELOAD}`);
writeTerminals();   // give the strip its first frame (the repo shell)

// The log only nudges; reconcile() decides.
tail(FLEET_LOG, (line) => {
  if (ENTER.test(line) || EXIT.test(line)) setTimeout(reconcile, 250);
});
// Terminal-management gestures. The WezTerm keybindings append one verb per line
// (see wezterm/cockpit.lua); tailing reuses the same rotation-safe reader as the
// fleet log, so a keypress that lands mid-file-replace is not lost.
const TERM_VERBS = new Set(["new", "next", "prev", "close"]);
tail(CMD_FILE, (line) => {
  const verb = line.trim();
  if (!TERM_VERBS.has(verb)) return;
  // ⌥[/⌥] are shared: next/prev cycle the DIFF MODE when the diff pane is focused
  // and terminals otherwise. ⌥t/⌥w (new/close) are always terminals.
  if ((verb === "next" || verb === "prev") && diffPaneFocused()) diffModeCommand(verb);
  else terminalCommand(verb);
});
setInterval(reconcile, POLL_MS);
setInterval(reapAgents, REAP_MS);
setInterval(healMissingPanes, REAP_MS);
reconcile();

const shutdown = () => {
  stopWatchers();
  for (const jobId of [...worktreeWatches.keys()]) stopWorktreeWatch(jobId);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Stay alive. This runs unattended behind a terminal window; dying silently means
// the panes simply stop following and nothing says why.
process.on("uncaughtException", (e) => log(`uncaught: ${e.stack ?? e}`));
process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e?.stack ?? e}`));
