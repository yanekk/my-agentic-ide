#!/usr/bin/env node
// cockpit-welcome — the diff pane's resting screen, shown while no agent is
// attached (at the fleet LIST). It replaces the bare login shell that used to
// sit here, whose only content was a one-line echo and a prompt showing the
// repo's directory name -- which read as "the cockpit is just a git prompt".
//
// It is split down the middle: the cockpit's own greeting on the left, the
// NOTES list on the right. Both halves are drawn by THIS ONE PROCESS -- the
// notes column is a virtual pane, not a WezTerm one. That is deliberate: the
// diff slot is swapped by parking exactly one pane and splitting the incoming
// one into it (see insertIntoSlot/rebuildDiffSlot in cockpitd.mjs, and the
// measurements in spikes/pane-swap), and a real second pane up here would make
// every one of those swaps a two-pane dance for a list that nothing types into.
// Drawing it costs one string; splitting it would cost the invariant.
//
// So attaching an agent still parks this whole pane and swaps in revdiff at full
// width, exactly as before -- the notes column goes with it and comes back
// untouched. Nothing about the agent view changes.
//
// Like cockpit-strip.mjs this is PURE DISPLAY: it never runs a shell command and
// never moves a pane, so cockpitd can own the pane as the REPO_KEY diff slot.
// Notes are added and edited from the `note` command in any cockpit terminal
// (bin/cockpit-note.mjs); this only ever reads them.
//
// Started for you by bin/cockpit-layout.sh.

import fs from "node:fs";

import { DIR, cockpitRepo, readNotes, relTime } from "./cockpit-notes.mjs";

const ESC = "\x1b[";

// Two phrasings of the same greeting. The left half is only half a window wide
// now, so on a smaller cockpit the long form would be clipped mid-word -- which
// looks like a bug rather than a greeting. Picked by the width actually available.
const GREETING_LONG = [
  `${ESC}1magentic-ide cockpit${ESC}0m`,
  "",
  `${ESC}2menter an agent in the fleet view below to review its work${ESC}0m`,
  `${ESC}2mits diff opens here; its shell opens to the right${ESC}0m`,
];
const GREETING_SHORT = [
  `${ESC}1magentic-ide cockpit${ESC}0m`,
  "",
  `${ESC}2menter an agent below to review it${ESC}0m`,
  `${ESC}2mits diff opens here${ESC}0m`,
];
const greeting = (w) => (w >= 58 ? GREETING_LONG : GREETING_SHORT);

// Visible width ignores the escape sequences, so centring and clipping line up
// with what is actually on screen.
const visibleLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
const pad = (s, w) => s + " ".repeat(Math.max(0, w - visibleLen(s)));

/** Clip to `w` VISIBLE columns, marking the cut so a truncated note reads as one. */
function clip(s, w) {
  if (w <= 0) return "";
  if (visibleLen(s) <= w) return s;
  return `${s.slice(0, Math.max(0, w - 1))}…`;
}

// --- the notes column ------------------------------------------------------
// Fixed-width id and date columns so the texts line up as a block and the eye can
// run straight down them. 6 covers an id (4, or 6 after a collision) and a date
// ("now", "12m", "3h", "Mon", "Aug 12").

const ID_W = 6;
const DATE_W = 6;
const GAP = 2;

function notesColumn(width, rows) {
  const repo = cockpitRepo();
  const notes = repo ? readNotes(repo) : [];
  const out = [];

  const count = notes.length ? `${ESC}2m${notes.length}${ESC}0m` : "";
  out.push(pad(`${ESC}1mNOTES${ESC}0m`, width - visibleLen(count)) + count);
  out.push(`${ESC}2m${"─".repeat(width)}${ESC}0m`);

  if (!repo) {
    out.push(`${ESC}2mwaiting for the cockpit to start…${ESC}0m`);
    return out;
  }
  if (!notes.length) {
    out.push(`${ESC}2mno notes yet${ESC}0m`);
    out.push("");
    out.push(`${ESC}2mrun ${ESC}0m${ESC}1mnote "something worth remembering"${ESC}0m`);
    out.push(`${ESC}2min any cockpit terminal${ESC}0m`);
    return out;
  }

  // One row per note, and one more for the "+N more" line when they overrun the
  // pane -- the list is the SUMMARY; `note ls` in a terminal is the full view, so
  // running out of rows must say so rather than silently stop at the fold.
  const room = Math.max(1, rows - out.length);
  const overflow = notes.length > room;
  const shown = overflow ? notes.slice(0, room - 1) : notes;

  const now = Date.now();
  const textW = width - ID_W - DATE_W - GAP * 2;
  for (const n of shown) {
    if (textW < 8) {                       // too narrow for columns: text only
      out.push(clip(n.text, width));
      continue;
    }
    // An agent's note carries its name so being handed one never reads like
    // something you wrote. It is allowed at most a third of the text column, so a
    // long agent name cannot squeeze the note itself down to nothing.
    const by = n.author ? ` — ${n.author}` : "";
    const byW = by ? Math.min(by.length, Math.floor(textW / 3)) : 0;
    const text = byW ? pad(clip(n.text, textW - byW), textW - byW) : clip(n.text, textW);
    out.push(`${ESC}36m${pad(n.id, ID_W)}${ESC}0m${" ".repeat(GAP)}` +
             `${ESC}2m${pad(relTime(n.ts, now), DATE_W)}${ESC}0m${" ".repeat(GAP)}` +
             text + (byW ? `${ESC}2m${clip(by, byW)}${ESC}0m` : ""));
  }
  if (overflow) {
    out.push(`${ESC}2m… +${notes.length - shown.length} more · ${ESC}0m${ESC}1mnote ls${ESC}0m`);
  }
  return out;
}

// --- the frame -------------------------------------------------------------
// Recomputed on every render so it tracks resizes -- the pane is resized to the
// full tab and back on every agent switch, so it takes two SIGWINCHes per swap.

function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  // Below this the notes column would be a few characters wide and unreadable, so
  // the pane keeps its old single-column greeting rather than showing two useless
  // halves. Notes are still there; `note ls` reads them.
  const leftW = Math.floor((cols - 3) / 2);
  const rightW = cols - leftW - 3;
  const split = rightW >= 24;

  const lines0 = greeting(split ? leftW : cols);
  const left = [];
  const top = Math.max(0, Math.floor((rows - lines0.length) / 2));
  for (let i = 0; i < top; i++) left.push("");
  left.push(...lines0);

  const centre = (line, w) => {
    const p = Math.max(0, Math.floor((w - visibleLen(line)) / 2));
    return " ".repeat(p) + line;
  };

  const lines = [];
  if (!split) {
    for (let r = 0; r < rows; r++) lines.push(centre(left[r] ?? "", cols));
  } else {
    const right = notesColumn(rightW, rows);
    for (let r = 0; r < rows; r++) {
      const l = pad(centre(clip(left[r] ?? "", leftW), leftW), leftW);
      lines.push(`${l} ${ESC}2m│${ESC}0m ${clip(right[r] ?? "", rightW)}`);
    }
  }

  // No trailing newline: writing one on the last row would scroll the pane.
  process.stdout.write(`${ESC}2J${ESC}H` + lines.map((l) => l + `${ESC}K`).join("\r\n"));
}

process.stdout.write(`${ESC}?25l`);                // hide the cursor
render();
process.stdout.on("resize", render);
setInterval(render, 2000);                          // repaint if a resize is missed
// Watch the state DIRECTORY, not notes.json: the `note` command replaces it
// atomically (temp + rename), so a file watch would go deaf after the first
// write -- the same reason the strip and the review watcher watch directories.
try {
  fs.watch(DIR, (_e, name) => {
    if (!name || name === "notes.json" || name === "panes.json") render();
  });
} catch { /* the 2s repaint covers it */ }

const bye = () => { process.stdout.write(`${ESC}?25h`); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
