#!/usr/bin/env node
// cockpit-welcome — the diff pane's resting screen, shown while no agent is
// attached (at the fleet LIST). It replaces the bare login shell that used to
// sit here, whose only content was a one-line echo and a prompt showing the
// repo's directory name -- which read as "the cockpit is just a git prompt".
//
// It is a 75/25 virtual split: the BitBucket DASHBOARD fills the left ~75%, and
// on the right the NOTES list over a rule over the AGENDA takes the remaining
// ~25% (DESIGN 2.1). The old centred greeting is gone -- its job of telling a
// first-time user what this is is now the dashboard's own unconfigured state
// (DESIGN 2.n), drawn by the pure model. All of it is drawn by
// THIS ONE PROCESS -- the right column is a virtual pane, not a WezTerm one, and
// so are the two sections inside it. That is deliberate: the diff slot is
// swapped by parking exactly one pane and splitting the incoming one into it
// (see insertIntoSlot/rebuildDiffSlot in cockpitd.mjs, and the measurements in
// spikes/pane-swap), and a real second or third pane up here would make every one
// of those swaps a two- or three-pane dance for lists that nothing types into.
// Drawing them costs one string; splitting them would cost the invariant.
//
// So attaching an agent still parks this whole pane and swaps in revdiff at full
// width, exactly as before -- the notes column goes with it and comes back
// untouched. Nothing about the agent view changes.
//
// Like cockpit-strip.mjs this is PURE DISPLAY: it never runs a shell command and
// never moves a pane, so cockpitd can own the pane as the REPO_KEY diff slot.
// Notes are added and edited from the `note` command in any cockpit terminal
// (bin/cockpit-note.mjs); this only ever reads them. The agenda is the same
// shape: `agenda` (bin/cockpit-agenda.mjs) configures it and cockpitd fetches
// it, and this reads the two state files and draws what they say. The dashboard
// is the same shape once more: `config` sets the credentials and cockpitd fetches
// the PRs, and this reads the config + cache + view-state files and hands them to
// the pure model, which decides every line and every hit-zone (DESIGN 3.1, 3.4).
//
// Started for you by bin/cockpit-layout.sh.

import fs from "node:fs";

import { DIR, cockpitRepo, readNotes, relTime } from "./cockpit-notes.mjs";
import { agendaHeight, clip, pad, renderAgenda, visibleLen } from "./cockpit-agenda-model.mjs";
import { readCache, readState } from "./cockpit-agenda-store.mjs";
import { renderDashboard, verbAt } from "./cockpit-bitbucket-model.mjs";
import {
  readCache as readBBCache,
  readConfig as readBBConfig,
  readView as readBBView,
} from "./cockpit-bitbucket-store.mjs";

const ESC = "\x1b[";
// The command channel the daemon tails -- the same file the strip and footer append
// their click verbs to (see cockpit-strip.mjs). A click in the dashboard appends the
// verb of the hit-zone it landed on, and the daemon owns every consequence (a tab
// switch, a page change, an Open); this pane never moves a pane or opens a socket, so
// it stays the pure-display diff slot (DESIGN 3.1, 3.4). Built from DIR by
// concatenation rather than node:path so this pane keeps its tight import allowlist
// (only the models, the stores and the notes -- see spikes/notes-test).
const CMD_FILE = `${DIR}/cmd`;

// visibleLen/pad/clip come from the model now, where T03 put them, rather than
// being kept in a second copy here: both sections of the right column must
// measure a string identically or the rule between them will not line up with
// the rows above and below it. The model's `clip` is also the better one -- it
// walks the string, where this file's copy sliced raw bytes and could cut an
// escape in half, spilling `[38;5;37m` into the pane.

// --- the notes column ------------------------------------------------------
// Fixed-width id and date columns so the texts line up as a block and the eye can
// run straight down them. 6 covers an id (4, or 6 after a collision) and a date
// ("now", "12m", "3h", "Mon", "Aug 12").

const ID_W = 6;
const DATE_W = 6;
const GAP = 2;

function notesColumn(width, rows, now) {
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

// --- the agenda section ----------------------------------------------------
// Below the notes, under a rule. Everything it draws is decided by the model's
// one call (DESIGN 3.3); this half only reads the two state files, budgets the
// rows and hands over the arguments the model may not read for itself.

const SEP = 1;              // the rule between the two sections
const MIN_NOTES = 3;        // a heading, a rule and one note. Below that the
                            // section is not a list, it is a label.

// The machine's zone, read ONCE and on this side of the boundary. Without it the
// model places every day boundary and every clock in UTC (DESIGN 3.1: reading
// Intl's default zone inside the model is the environment read the purity grep
// cannot see). It defaults to UTC, so forgetting it is a wrong column rather than
// a crash and nothing would fail for you.
const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
})();

/**
 * The agenda's lines, or null when it gets no rows at all and the notes take the
 * whole column.
 *
 * The split is CONTENT-DRIVEN rather than a fixed half: in the evening the agenda
 * is two lines, and a fixed half would show `nothing left today` over four blank
 * rows while the notes overflowed below it (DESIGN 2.6). `agendaHeight` answers
 * how many rows it wants without rendering twice and measuring.
 *
 * Nothing in here may throw: this is the resting screen of the whole cockpit, and
 * a pane that will not paint because a JSON file lost a brace is worse than one
 * that has forgotten a calendar (DESIGN 2.7). The store already starts clean on a
 * corrupt file; the catch is for everything nobody thought of.
 */
function agendaBlock(width, rows, now) {
  try {
    // `rescue: false`: a corrupt agenda.json is left exactly where it is. This
    // pane repaints every two seconds, so it would always be the one to move the
    // sign-ins aside -- and it has nobody to tell, where the `agenda` command
    // names the file it rescued and says the calendars need adding again
    // (DESIGN 2.7). Reading is this pane's whole job; rescuing is not.
    const calendars = readState({ rescue: false }).calendars;
    const cache = readCache();
    const wanted = agendaHeight({ width, calendars, cache, now, tz: TZ });
    const cap = Math.max(4, Math.floor((rows - SEP) / 2));
    let n = Math.min(wanted, cap);
    // The notes' floor wins over the agenda's share: three rows is the least that
    // still reads as a list.
    if (rows - SEP - n < MIN_NOTES) n = Math.max(0, rows - SEP - MIN_NOTES);
    if (n <= 0) return null;
    return renderAgenda({ width, rows: n, calendars, cache, now, tz: TZ });
  } catch {
    return null;
  }
}

/** NOTES over a rule over AGENDA, in exactly `rows` lines. */
function rightColumn(width, rows, now) {
  const agenda = agendaBlock(width, rows, now);
  const notesRows = agenda ? rows - SEP - agenda.length : rows;

  // Sliced AND padded: the notes' empty state draws four lines whatever it is
  // given, and a section that returned one line too many would push the rule and
  // the agenda off the bottom of the pane.
  const out = notesColumn(width, notesRows, now).slice(0, notesRows);
  while (out.length < notesRows) out.push("");

  if (agenda) {
    out.push(`${ESC}2m${"─".repeat(width)}${ESC}0m`);
    out.push(...agenda);
  }
  return out;
}

// --- the dashboard column --------------------------------------------------
// The left ~75%. Everything it shows -- the tabs, the table, the pager, the
// unconfigured greeting, the offline footnotes -- is decided by the pure model's
// one call (DESIGN 3.3); this half only reads the three files and hands over the
// arguments the model may not read for itself. The model already returns EXACTLY
// `rows` lines, each clipped to `width`, so there is no budgeting to do here.
//
// It also returns the click hit-zones (T08): each is { verb, x0, x1, y }, 1-indexed
// and local to this dashboard column, which starts at pane column 1 (the dashboard is
// always the LEFT region, so a pane column equals a dashboard column and no offset is
// needed -- when split, the notes/agenda column to the right simply has no zones and a
// click there matches none). render() stashes them so a click can be mapped to a verb.
//
// Nothing in here may throw: this is the resting screen of the whole cockpit
// (DESIGN 2.n). The store's reads already return the empty/default shape on a
// corrupt or absent file rather than throwing, so a corrupt cache draws the
// empty/unconfigured view; the catch is for everything nobody thought of.
function dashboardColumn(width, rows, now) {
  try {
    const config = readBBConfig();
    const cache = readBBCache();
    const view = readBBView();
    const { lines, hitZones } = renderDashboard({ width, rows, cache, view, now, config });
    return { lines, hitZones };
  } catch {
    return { lines: Array.from({ length: rows }, () => ""), hitZones: [] };
  }
}

// --- the frame -------------------------------------------------------------
// Recomputed on every render so it tracks resizes -- the pane is resized to the
// full tab and back on every agent switch, so it takes two SIGWINCHes per swap.

// The dashboard's click hit-zones as last drawn (T08). render() overwrites this on
// every paint, so a click is always mapped against exactly what is on screen -- the
// same reason the strip rebuilds its zones each render. Empty until the first paint.
let lastHitZones = [];

function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  // The ONE clock read in this process (DESIGN 3.4 -- the daemon's tick is the
  // other one in the whole feature). All three regions are drawn from this single
  // instant, so a note's age, the agenda's `NOW` row and the dashboard's offline
  // "22m ago" can never disagree.
  const now = Date.now();

  // The 75/25 split (DESIGN 2.1). The 3 columns are the " │ " divider between the
  // two regions. Below the notes/agenda floor the right column is a few characters
  // wide and unreadable, so the dashboard takes the WHOLE pane rather than showing
  // a cramped column beside it -- the same floor the old greeting/notes split used
  // (the notes are still there; `note ls` reads them).
  const leftW = Math.floor((cols - 3) * 0.75);
  const rightW = cols - leftW - 3;
  const split = rightW >= 24;

  const lines = [];
  if (!split) {
    const dash = dashboardColumn(cols, rows, now);
    lastHitZones = dash.hitZones;
    for (let r = 0; r < rows; r++) lines.push(clip(dash.lines[r] ?? "", cols));
  } else {
    const dash = dashboardColumn(leftW, rows, now);
    lastHitZones = dash.hitZones;
    const right = rightColumn(rightW, rows, now);
    for (let r = 0; r < rows; r++) {
      const l = pad(clip(dash.lines[r] ?? "", leftW), leftW);
      lines.push(`${l} ${ESC}2m│${ESC}0m ${clip(right[r] ?? "", rightW)}`);
    }
  }

  // No trailing newline: writing one on the last row would scroll the pane.
  process.stdout.write(`${ESC}2J${ESC}H` + lines.map((l) => l + `${ESC}K`).join("\r\n"));
}

// --- clicks ----------------------------------------------------------------
// The dashboard is the one region of this pane that reacts. A left-click is mapped to
// the hit-zone it landed on and that zone's verb is appended to the cmd channel; the
// daemon owns the actual consequence (DESIGN 3.4). This mirrors cockpit-strip.mjs
// exactly -- the SGR parse, the left-press filter, the directory-not-file reasoning --
// and, like the strip, appends a fixed verb rather than moving a pane or opening a
// socket, so this file stays pure display and starts no process.

// A left-click at pane-local (x, y): look up the verb of the zone it hit (null if
// none) and hand it to the daemon. A click that lands on no zone -- the header, a
// blank row, the notes/agenda column -- emits nothing.
function onDashClick(x, y) {
  const verb = verbAt(lastHitZones, x, y);
  if (!verb) return;
  try { fs.appendFileSync(CMD_FILE, `${verb}\n`); } catch { /* daemon re-reads on the next click */ }
}

// Turn on mouse reporting and forward left-button presses to onDashClick(x, y), both
// 1-indexed and pane-local. 1000h reports press/release; 1006h is SGR extended
// coordinates (unambiguous, not capped at column 223). Scoped to this pane's own
// terminal -- it never reaches the Claude pane, whose mouse handling is left to claude
// (this pane is parked, not on screen, whenever an agent is attached). WezTerm
// delivers mouse events to the pane under the pointer once it has enabled reporting,
// so the dashboard is clickable without being focused. When stdin is not a TTY
// (headless, e.g. the notes-test render harness) the escape is written but no reader
// is attached, so the pane still starts and draws -- it simply cannot be clicked.
let mouseOn = false;
function enableMouse() {
  process.stdout.write(`${ESC}?1000h${ESC}?1006h`);
  mouseOn = true;
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf) => {
    const s = buf.toString("latin1");
    // SGR mouse: ESC [ < b ; x ; y  (M = press, m = release). Act on a left-button
    // press only: low two bits 0 = left; bit 32 set = motion, and bit 64 set = a WHEEL
    // event -- both ignored. The wheel matters: WezTerm reports a scroll under 1000h as
    // a button with bit 64 (wheel-up is 64, so its low two bits are 0 and it would sail
    // through a `(b & 3) === 0` filter as a "left click"), which hand-verified as a
    // stray Open on a scroll over the dashboard (FINDINGS 2026-09-05). Excluding bit 64
    // is what keeps a scroll from firing a click here (and a spawn on Review/Address).
    const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let m;
    while ((m = re.exec(s))) {
      const b = Number(m[1]);
      if (m[4] === "M" && (b & 3) === 0 && !(b & 32) && !(b & 64)) onDashClick(Number(m[2]), Number(m[3]));
    }
  });
}

process.stdout.write(`${ESC}?25l`);                // hide the cursor
render();
enableMouse();
process.stdout.on("resize", render);
setInterval(render, 2000);                          // repaint if a resize is missed
// Watch the state DIRECTORY, not the files: `note` and the agenda's store both
// replace them atomically (temp + rename), so a file watch would go deaf after
// the first write -- the same reason the strip and the review watcher watch
// directories. agenda-cache.json is what the daemon rewrites every minute,
// and agenda.json is what `agenda add` writes, so both belong here: a calendar
// attached in a terminal should appear up here without waiting for the 2s tick.
// bitbucket-cache.json is what the daemon rewrites every minute with the fetched
// PRs, and bitbucket-view.json is what it rewrites on a tab/page click, so both
// belong here too: a fresh fetch or a tab switch should land without a tick wait.
// The four bitbucket-* config files are NOT watched -- configuring is a one-time
// setup and the 2s repaint covers the moment the dashboard turns on.
const INTERESTING = new Set([
  "notes.json", "panes.json", "agenda.json", "agenda-cache.json",
  "bitbucket-cache.json", "bitbucket-view.json",
]);
try {
  fs.watch(DIR, (_e, name) => {
    if (!name || INTERESTING.has(name)) render();
  });
} catch { /* the 2s repaint covers it */ }

const bye = () => {
  if (mouseOn) process.stdout.write(`${ESC}?1000l${ESC}?1006l`);   // stop mouse reporting
  process.stdout.write(`${ESC}?25h`);
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
