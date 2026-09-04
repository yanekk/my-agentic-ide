#!/usr/bin/env node
// cockpit-open — push a file from broot into the viewer beside it.
//
// This is the world-touching half of the push (DESIGN 3.1): it finds the viewer
// pane, reads what that agent already has open, asks the pure model what to do
// (cockpit-open-model.mjs), types the bytes into micro's command bar and writes
// the tab list back. Nothing else in this project types into a pane it does not
// own, so its REFUSALS matter more than its successes: the same keystrokes landing
// in a revdiff pane would be a keybinding each.
//
//   cockpit-open <file> [line]
//     exit 0   pushed, or switched to the tab that already holds it
//     exit 1   refused, one line on stderr saying why
//
// It is run by broot's Enter verb (T03), never by hand, and it is deliberately
// silent on success -- broot stays on screen, drawing exactly as it was.
//
// A successful push then ACTIVATES the viewer pane, so Enter lands you on the file
// you asked for (T11, the user's decision of 2026-09-03 -- it reverses the original
// "focus is never taken", taken with the cost in front of them: stacking several
// files into tabs without reading them now costs a `Cmd+Alt+Left` between each
// Enter). The reversal is scoped to this ONE human gesture. The daemon's rule --
// focus follows the pair, never takes it -- is untouched, because a pane swap, a
// heal, a fence and a worktree migration are nobody pressing a key.
//
// EVERY check happens before the first send. A half-validated push that has
// already typed `\x05` leaves micro's command bar open with nothing to submit,
// which is a state the user has to notice and clear.
//
// Three keys in panes.json are read and all three must be present (DESIGN 3.4):
// `viewer` (where to type), `viewerAgent` (the jobId whose tab list this is) and
// `viewerRoot` (the worktree the tab label is relative to). The daemon publishes
// them together and nulls them together, so any one missing means it does not
// believe a viewer is showing -- refuse. Neither `terminals.json.agent` (a display
// name, not a jobId) nor `panes.json.repo` (the projects root, not a repo root)
// is a substitute; both were measured, and both are the wrong value.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { planPush } from "./cockpit-open-model.mjs";
import { withLock } from "./cockpit-agenda-store.mjs";

const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
const PANES = path.join(DIR, "panes.json");
const TABS = path.join(DIR, "viewer-tabs.json");
// Its own lock, not the agenda's: a calendar refresh and a file push have nothing
// to say to each other and must not queue behind one another (DESIGN 3.5).
const TABS_LOCK = path.join(DIR, "viewer-tabs.lock");

const die = (msg) => { console.error(`cockpit-open: ${msg}`); process.exit(1); };

// --- what was asked for ----------------------------------------------------

const [rawFile, rawLine] = process.argv.slice(2);

if (rawFile === undefined || rawFile === "") die("usage: cockpit-open <file> [line]");

// A path holding a carriage return would SUBMIT micro's command bar half way
// through the filename and run whatever the first half happened to spell; a
// newline is the tamer version of the same accident. The model cannot refuse
// anything -- it has no channel for it -- so the guard lives here, next to the
// stat that has to happen anyway (FINDINGS, 2026-08-29).
if (/[\r\n]/.test(rawFile)) die("path contains a newline or carriage return, refusing to send it");

// A NUMBER, not the string argv hands over: `planPush` drops a non-integer line
// silently, so parsing here is the difference between the cursor moving and not.
// Anything unparseable degrades to "no jump" rather than losing the push -- the
// file still opens, which is most of what was wanted.
const line = /^\d+$/.test(rawLine ?? "") ? Number(rawLine) : null;

// --- the viewer ------------------------------------------------------------

let panes;
try {
  panes = JSON.parse(fs.readFileSync(PANES, "utf8"));
} catch {
  // Absent or unparseable both mean the same thing to us: there is no cockpit
  // whose viewer we can be sure of.
  die("no readable panes.json — is the cockpit running?");
}

const viewer = panes?.viewer;
const viewerAgent = panes?.viewerAgent;
const viewerRoot = panes?.viewerRoot;

// A pane id is a NUMBER (DESIGN 3.4), and `Number()` on its own is far too
// generous about what counts as one: "", " ", false and [] all coerce to 0 --
// which is a REAL pane, and on a fresh mux the first one. A `viewer` of any of
// those would type micro's command bar into whatever holds pane 0, where in a
// revdiff every character is a keybinding: precisely the accident every refusal
// in this file exists to prevent. So the accepted shapes are named rather than
// coerced -- a non-negative integer, or the all-digits string a hand-edited
// panes.json might carry.
const paneId =
  typeof viewer === "number" ? viewer
    : (typeof viewer === "string" && /^\d+$/.test(viewer)) ? Number(viewer)
      : NaN;
if (!Number.isInteger(paneId) || paneId < 0) {
  die("no viewer pane — the attached agent is not in browse mode");
}
// Without the jobId there is no key to file the tab list under, and writing it
// under "" would hand the next agent someone else's tabs.
if (typeof viewerAgent !== "string" || viewerAgent === "") {
  die("no viewerAgent — the cockpit does not know whose viewer this is");
}
if (typeof viewerRoot !== "string" || viewerRoot === "") {
  die("no viewerRoot — the cockpit does not know which worktree this viewer shows");
}

// --- the file ---------------------------------------------------------------
// realpath BOTH sides, and this is the whole reason the model hands the job to its
// caller (DESIGN 3.1 -- it may not touch the filesystem). broot returns a
// symlink-resolved path (`/private/var/...` on macOS) while an agent worktree
// usually is not resolved (`/var/...`); relativising one against the other yields
// a `../../../../..` chain, and the model deliberately degrades to the absolute
// path rather than emit one. Resolving both here is what keeps tab labels short.
let file;
try {
  file = fs.realpathSync(rawFile);
} catch {
  // micro would cheerfully open an empty buffer named after a file that is gone
  // (DESIGN 2.n), so say which one instead.
  die(`no such file: ${rawFile}`);
}
// The guard on `rawFile` sees the ARGUMENT; what goes into the payload is the
// RESOLVED path, and a symlink can resolve into a directory whose own name holds
// a carriage return -- `plain.js` -> `.../we\rird/f.js` sends `open we\rird/f.js`,
// which micro submits at the `\r` as `open we`. Measured in review. So check the
// bytes that are actually going to be sent, not only the ones that were typed.
if (/[\r\n]/.test(file)) {
  die("resolved path contains a newline or carriage return, refusing to send it");
}

// A root that cannot be resolved is not fatal: the push still works, the label is
// just longer. Losing the push over a cosmetic detail would be the worse trade.
let root = viewerRoot;
try { root = fs.realpathSync(viewerRoot); } catch { /* label may be absolute */ }

// --- send, under the lock ---------------------------------------------------

/** Corrupt is treated as empty and rewritten: a lost tab list costs a duplicate tab. */
function readTabs() {
  try {
    const data = JSON.parse(fs.readFileSync(TABS, "utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch { /* absent, unreadable or broken */ }
  return {};
}

/** Temp file plus rename, as panes.json and notes.json already do. */
function writeTabs(data) {
  fs.mkdirSync(DIR, { recursive: true });
  // The pid keeps two writers off each other's temp file even in the window where
  // one has just broken the other's stale lock.
  const tmp = `${TABS}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, TABS);
}

/**
 * `--no-paste` because bracketed paste would wrap the text in markers that micro's
 * command bar reads as literal characters. The payload goes on the command line,
 * which is the shape the pane probes measured working (spikes/browse-mode).
 */
function sendText(payload) {
  execFileSync("wezterm", [
    "cli", "send-text", "--pane-id", String(paneId), "--no-paste", payload,
  ], { stdio: ["ignore", "ignore", "ignore"] });
}

/**
 * Put the cursor on the file that was just opened (T11). Always the VIEWER pane --
 * the same id every send-text was aimed at, so a push can never land in one pane
 * and the focus in another.
 *
 * A failure here is swallowed on purpose. A dead pane, or no `wezterm` on PATH,
 * does not un-open the file: the push landed, and turning a delivered file into
 * exit 1 over the cursor would be the worse trade. This command's whole interface
 * is exit 0, or exit 1 plus one line on stderr.
 */
function activateViewer() {
  try {
    execFileSync("wezterm", [
      "cli", "activate-pane", "--pane-id", String(paneId),
    ], { stdio: ["ignore", "ignore", "ignore"] });
  } catch { /* the file is open; only the cursor failed to follow it */ }
}

// The lock covers the send as well as the read-modify-write, and it has to: two
// pushes landing together (you and an agent, DESIGN 2.n) that both read an empty
// list would both decide `open`, and the second would replace the first's buffer
// instead of adding a tab. Serialising the whole transaction is what makes the
// second one see the first's entry.
let failure = null;
// Whether the KEYSTROKES landed, which is a different question from whether the
// command succeeded: a tab list that could not be written is exit 1 with the file
// on screen. Focus follows the file, so it follows this flag and not `failure`.
let pushed = false;
withLock(() => {
  const all = readTabs();
  const openTabs = Array.isArray(all[viewerAgent]) ? all[viewerAgent] : [];
  const plan = planPush({ openTabs, file, line, repoRoot: root });

  for (const payload of plan.payloads) {
    try {
      sendText(payload);
    } catch (e) {
      // The tab list is NOT updated on a failed send. Believing in a tab that was
      // never opened is the expensive mistake: every later push would `tabswitch`
      // to a number micro does not have, silently landing on the wrong file.
      failure = `wezterm send-text failed: ${String(e.message).split("\n")[0]}`;
      return;
    }
  }

  pushed = true;

  all[viewerAgent] = plan.openTabs;
  try {
    writeTabs(all);
  } catch (e) {
    // The push itself landed; only the record of it failed -- a full or read-only
    // state dir. This command promises exit 1 and ONE line on stderr, and an
    // uncaught throw here would break that interface with a stack trace instead.
    failure = `viewer-tabs.json could not be written: ${String(e.message).split("\n")[0]}`;
  }
}, TABS_LOCK);

// OUTSIDE the lock, deliberately: the lock serialises the read-modify-write against
// a second pusher, and a pane activation is no part of that transaction -- holding
// it across another `wezterm` spawn only widens the window the other pusher waits
// in.
//
// A FAILED SEND is the one case that stays in the tree, and it is not a detail: a
// half-sent push leaves micro's command bar OPEN with a half-typed command in it
// (FINDINGS, 2026-08-29). Dropping the cursor there hands the user a live command
// bar they did not ask for, in a program they may not know, with no file to show
// for it. Staying in the tree keeps the damage to one missing file.
//
// An unwritable tab list is the opposite call for the opposite reason: the push
// landed and the file IS on screen, so the cursor follows the file even though the
// command still exits 1 with its one line.
if (pushed) activateViewer();

if (failure) die(failure);
