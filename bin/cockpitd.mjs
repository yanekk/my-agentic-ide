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

/** key (job id, or REPO_KEY) -> pane id. Every entry is a live PTY. */
const terminals = new Map([[REPO_KEY, panes.shell]]);
let visibleKey = REPO_KEY;
/** The same, for the diff slot: one live revdiff per agent. */
const diffs = new Map([[REPO_KEY, panes.diff]]);
let visibleDiff = REPO_KEY;
const reapStrikes = new Map();

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
 * Put `key`'s terminal in the bottom-right slot, creating it at `cwd` the first
 * time. Whatever was there is parked, not killed.
 */
async function showTerminal(key, cwd, label) {
  const table = paneTable();
  if (!table) return log("cannot read the pane list; leaving the terminal alone");

  const live = new Set(table.map((p) => p.pane_id));
  const cockpitTab = table.find((p) => p.pane_id === panes.fleet)?.tab_id;

  // Panes die with their window, and this daemon outlives windows. Forget the
  // ghosts before trying to move any of them.
  for (const [k, id] of terminals) if (!live.has(id)) terminals.delete(k);

  if (key === visibleKey && terminals.has(key)) return;

  const outgoing = terminals.get(visibleKey);
  if (outgoing !== undefined && visibleKey !== key) {
    parkPane(outgoing, visibleKey === REPO_KEY ? "repo" : visibleKey, cockpitTab);
  }

  let id = terminals.get(key);
  if (id !== undefined) {
    const moved = wez(["split-pane", "--right", "--percent", "50",
                       "--pane-id", String(panes.fleet), "--move-pane-id", String(id)]);
    if (moved === null) { terminals.delete(key); id = undefined; }
    else log(`restored terminal pane ${id} for ${label ?? key}`);
  }
  if (id === undefined) {
    const out = wez(["split-pane", "--right", "--percent", "50",
                     "--pane-id", String(panes.fleet), "--cwd", cwd,
                     "--", LOGIN_SHELL, "-l"]);
    const spawned = Number.parseInt((out ?? "").trim(), 10);
    if (!Number.isInteger(spawned)) return log(`could not open a terminal for ${label ?? key}`);
    id = spawned;
    terminals.set(key, id);
    log(`opened terminal pane ${id} for ${label ?? key} at ${cwd}`);
  }

  visibleKey = key;
  // split-pane activates whatever it put in the slot. Switching agents happens in
  // the fleet view, so that is where the next keystroke belongs.
  wez(["activate-pane", "--pane-id", String(panes.fleet)]);
  publishPanes({ shell: id });
}

/**
 * Rebuild an EMPTY diff slot, full width.
 *
 * If the slot's pane is gone -- someone exited the shell revdiff was running in
 * -- a plain `split-pane --top --pane-id <fleet>` does NOT restore it: it splits
 * the fleet pane's own region, so the new pane is half a window wide (59 of 120
 * columns in the probe) because the bottom row is a horizontal split. Parking the
 * terminal leaves the fleet pane alone in the tab, so the split spans the window;
 * the terminal is then moved back. Both ways measured; see
 * spikes/pane-swap/RESULTS.md.
 *
 * Returns a throwaway placeholder pane holding the slot, for the caller to split
 * into and then kill.
 */
function rebuildDiffSlot(cockpitTab) {
  const term = terminals.get(visibleKey);
  if (term !== undefined) parkPane(term, "rebuilding", cockpitTab);
  const out = wez(["split-pane", "--top", "--percent", "55",
                   "--pane-id", String(panes.fleet), "--cwd", panes.repo,
                   "--", LOGIN_SHELL, "-l"]);
  if (term !== undefined) {
    wez(["split-pane", "--right", "--percent", "50",
         "--pane-id", String(panes.fleet), "--move-pane-id", String(term)]);
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
  for (const [k, id] of diffs) if (!live.has(id)) diffs.delete(k);

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
    for (const [what, slot] of [["terminal", terminals], ["diff", diffs]]) {
      const id = slot.get(key);
      if (id === undefined) continue;
      wez(["kill-pane", "--pane-id", String(id)]);
      log(`reaped ${what} pane ${id} — agent ${key} is gone`);
      slot.delete(key);
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
  for (const [what, slot] of [["diff", diffs], ["terminal", terminals]]) {
    const id = slot.get(attached.jobId);
    if (id !== undefined && live.has(id)) continue;
    log(`${what} pane for ${attached.jobId} is gone; rebuilding`);
    slot.delete(attached.jobId);
    attached = null;
    return;
  }
}

// ---------------------------------------------------------------------------
// git / claude
// ---------------------------------------------------------------------------

// stderr is ignored: probing for an upstream or an origin/HEAD that does not
// exist is an expected miss, not an error worth printing.
const git = (cwd, args) =>
  execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();

/**
 * The commit an agent's work should be diffed against: the point where its
 * branch left the trunk. Agents branch from wherever they started, so the base
 * is discovered rather than hardcoded.
 */
function mergeBase(worktree) {
  const candidates = [];
  try { candidates.push(git(worktree, ["rev-parse", "--abbrev-ref", "@{upstream}"])); } catch {}
  try {
    const head = git(worktree, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    candidates.push(head.replace("refs/remotes/", ""));
  } catch {}
  candidates.push("main", "master");

  for (const base of candidates) {
    try {
      const mb = git(worktree, ["merge-base", base, "HEAD"]);
      if (mb) return mb;
    } catch {}
  }
  return null;
}

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
  // return to: a brand-new pane, or one whose revdiff was quit with `q`.
  if (shown && (shown.spawned || diffPaneStatus(shown.pane) === "shell")) {
    const base = mergeBase(worktree);
    if (!base) log(`warning: no merge base found in ${worktree}, showing working tree`);

    // --untracked is not optional: agents create new files constantly, and plain
    // `git diff` does not report them. A single base argument diffs base ->
    // WORKING TREE, which is what includes uncommitted work.
    const cmd = [
      "revdiff", "--untracked",
      "-o", JSON.stringify(reviewFile),
      base ?? "",
    ].filter(Boolean).join(" ");

    if (shown.spawned) await sleep(SHELL_SETTLE_MS);   // let the login shell start reading
    launchInPane(shown.pane, `cd ${JSON.stringify(worktree)} && ${cmd}`);
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

// The log only nudges; reconcile() decides.
tail(FLEET_LOG, (line) => {
  if (ENTER.test(line) || EXIT.test(line)) setTimeout(reconcile, 250);
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
