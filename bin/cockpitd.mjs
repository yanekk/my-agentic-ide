#!/usr/bin/env node
// cockpitd — follow the `claude agents` fleet view and keep the cockpit in sync.
//
// Watches for attach/detach in the fleet view, and on each attach retargets the
// diff pane and the shell pane at that agent's worktree. When you flush review
// annotations (`O` in revdiff), it types them into the agent's prompt box and
// leaves them there UNSENT for you to edit and send.
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

/**
 * Never throws. The mux can be briefly unreachable -- a window closing, a socket
 * being replaced -- and this daemon has to outlive that. A dead cockpit that
 * needs restarting is far worse than a dropped keystroke.
 */
function wez(args, stdin) {
  try {
    return execFileSync("wezterm", ["cli", ...args], {
      input: stdin, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
    });
  } catch (e) {
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

/**
 * Run a shell command in a pane that may currently be showing revdiff.
 *
 * `q` quits revdiff if it is running; if it is not, `q` is a stray character on
 * the shell prompt, which the following ctrl-U clears. So this is safe in both
 * states without having to track which one we are in.
 */
async function runInPane(paneId, cmd) {
  sendRaw(paneId, "q");
  await sleep(350);
  sendRaw(paneId, "\x15");          // ctrl-U: clear the line
  sendRaw(paneId, `${cmd}\n`);
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
let watchers = [];            // torn down on every switch

function stopWatchers() {
  for (const w of watchers) { try { w.close(); } catch {} }
  watchers = [];
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

function watchAnnotations(file) {
  fs.writeFileSync(file, "");
  let last = "";
  let timer = null;
  const check = () => {
    let cur = "";
    try { cur = fs.readFileSync(file, "utf8"); } catch { return; }
    if (!cur.trim() || cur === last) return;
    last = cur;
    injectReview(composePrompt(cur));
  };
  const w = fs.watch(file, () => {
    clearTimeout(timer);
    timer = setTimeout(check, ANNOTATION_DEBOUNCE_MS);
  });
  watchers.push(w);
  return () => (last = "");
}

function watchWorktree(worktree, reviewFile) {
  if (!AUTO_RELOAD) return;
  let timer = null;
  const w = fs.watch(worktree, { recursive: true }, (_e, name) => {
    if (!name || name.startsWith(".git/") || name.includes("node_modules")) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Only refresh while nothing has been flushed for review. Once you start
      // commenting, the diff should stop moving under you.
      let pending = "";
      try { pending = fs.readFileSync(reviewFile, "utf8"); } catch {}
      if (pending.trim()) return;
      sendRaw(panes.diff, "R");
    }, RELOAD_DEBOUNCE_MS);
  });
  watchers.push(w);
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

  await runInPane(panes.diff, `cd ${JSON.stringify(worktree)} && ${cmd}`);
  await runInPane(panes.shell, `cd ${JSON.stringify(worktree)}`);

  watchAnnotations(reviewFile);
  watchWorktree(worktree, reviewFile);
}

function onExit() {
  if (attached) log(`exit ${attached.jobId} → fleet list`);
  stopWatchers();
  attached = null;              // blocks injection while the list is showing
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
    return null;                                  // pane gone or mux busy
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
      if (attached) onExit();
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
reconcile();

process.on("SIGINT", () => { stopWatchers(); process.exit(0); });
process.on("SIGTERM", () => { stopWatchers(); process.exit(0); });

// Stay alive. This runs unattended behind a terminal window; dying silently means
// the panes simply stop following and nothing says why.
process.on("uncaughtException", (e) => log(`uncaught: ${e.stack ?? e}`));
process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e?.stack ?? e}`));
