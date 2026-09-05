#!/usr/bin/env node
// cockpit-strip — the terminal-list UI. Two display modes, one renderer:
//
//   node bin/cockpit-strip.mjs           the STRIP: a vertical list of the
//                                         attached agent's terminals, on the
//                                         right edge of the terminal slot, with
//                                         the active one marked.
//   node bin/cockpit-strip.mjs footer     the FOOTER: a one-line, full-width key
//                                         legend at the bottom of the window, so
//                                         the gestures are always discoverable.
//
// Both are PURE DISPLAY: they never run a shell command and never move a pane, so
// cockpitd can own them as fixed panes it never parks. The one thing the footer
// does touch is its OWN height -- see pinHeight() -- and nothing else's.
//
// The daemon writes ~/.claude/cockpit/terminals.json on every change (which
// agent, which terminals, which is active); both modes repaint from it. The
// keybindings that add/switch/close terminals live in wezterm/cockpit.lua and
// reach the daemon through its command channel.
//
// Started for you by bin/cockpit-layout.sh.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
const FILE = path.join(DIR, "terminals.json");
// The command channel the daemon tails. Both display modes append verbs here on a
// click -- the footer a `diff-<mode>`, the strip a `new` (the [+ add] button),
// `close-<n>` (a terminal's [x]) or `select-<n>` (a terminal's label area) -- the
// same channel the ⌥ keybindings and the
// custom prompt use, so the daemon owns every actual pane change.
const CMD_FILE = path.join(DIR, "cmd");
const FOOTER = process.argv[2] === "footer";

const ESC = "\x1b[";

// The four diff-mode labels, in the order the footer draws them. A click is
// mapped back to one of these by column, so this list is what gives each label a
// hit zone as well as a position -- a mode left out of it is drawn nowhere and
// clickable nowhere.
const DIFF_ORDER = ["uncommitted", "lastcommit", "custom", "browse"];

// Strip CSI sequences to measure how many COLUMNS a rendered string occupies:
// escapes take no width, so the label positions a click must match are the
// visible lengths, not the raw string lengths.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const vlen = (s) => stripAnsi(s).length;

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { agent: null, diffMode: "uncommitted", customRef: null, terminals: [] }; }
}

// The daemon persists one of these mode names; anything else falls back to the
// default (uncommitted) rather than showing a raw token. `browse` needs an entry
// for a sharper reason than being listed: the highlight below falls back to
// uncommitted for an unknown mode, so a missing entry would light up "Uncommitted
// Changes" while the agent is actually browsing -- worse than showing nothing.
const DIFF_MODE_LABELS = {
  uncommitted: "Uncommitted Changes", lastcommit: "Last Commit", custom: "Custom", browse: "Browse",
};

// Name a terminal by what is RUNNING in it, VSCode-style: `zsh` at a prompt,
// `node`/`npm`/`vim` while a command is in the foreground. WezTerm's pane title
// only reflects the shell's prompt string (usually the cwd), so we ask the OS
// instead: `ps -t <tty>` lists the tty's processes, and the foreground one is the
// process group with `+` in its state. Resolved on every repaint, so it tracks
// the running command live. Falls back to the number alone if ps says nothing.
function procOf(tty) {
  if (!tty) return null;
  try {
    const out = execFileSync("ps", ["-t", tty, "-o", "stat=,comm="],
                             { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] });
    let comm = null;
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\S+)\s+(.+)$/);
      if (m && m[1].includes("+")) comm = m[2];       // last foreground-group line wins
    }
    return comm ? comm.replace(/^-/, "").split("/").pop() : null;
  } catch { return null; }
}

// --- keeping the footer exactly one row tall --------------------------------
// WezTerm sizes panes as a SHARE of the window, so the one-line legend does not
// stay one line: every window resize and every font-size change rescales it, and
// the rounding creeps upwards until the legend is eating several rows of the
// fleet view. bin/cockpit-layout.sh splits it with `--cells 1` so it starts
// right; this puts it back whenever it drifts.
//
// Measured (spikes/pane-swap): `adjust-pane-size --pane-id` is IGNORED by
// wezterm 20240203 -- it resizes whatever pane is ACTIVE, so aiming it at the
// footer from elsewhere squashes the *fleet* row to one line instead. The only
// thing that works is to focus the footer, shrink it, and hand focus straight
// back. Over-shrinking is clamped, and the footer's own boundary is the only one
// that moves, so the daemon still owns every pane swap. `--pane-id` is passed
// anyway: harmless today, correct if a later wezterm honours it.
const SELF = Number.parseInt(process.env.WEZTERM_PANE ?? "", 10);

function wez(args) {
  try {
    return execFileSync("wezterm", ["cli", ...args],
                        { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
}

// The row count of the last correction we tried. Focus is borrowed for ~100ms
// per attempt, so a drift that cannot be fixed (no wezterm cli, a pane at its
// minimum) must not be retried on every tick -- only a NEW height is worth
// another go.
let pinned = 0;

function pinHeight() {
  const rows = process.stdout.rows || 1;
  if (rows <= 1) { pinned = 0; return; }        // right size: arm for the next drift
  if (rows === pinned || !Number.isInteger(SELF)) return;
  pinned = rows;

  const out = wez(["list", "--format", "json"]);
  if (out === null) return;
  let table;
  try { table = JSON.parse(out); } catch { return; }
  const me = table.find((p) => p.pane_id === SELF);
  if (!me) return;
  // WezTerm reports one active pane per TAB, so only this tab's counts.
  const active = table.find((p) => p.tab_id === me.tab_id && p.is_active);

  const borrow = active !== undefined && active.pane_id !== SELF;
  if (borrow) wez(["activate-pane", "--pane-id", String(SELF)]);
  wez(["adjust-pane-size", "--pane-id", String(SELF), "--amount", String(rows - 1), "Down"]);
  if (borrow) wez(["activate-pane", "--pane-id", String(active.pane_id)]);
  render();                                     // repaint over anything echoed
}

// A window drag fires a resize per frame; correct the size it settles at.
let pinTimer = null;
function schedulePin() {
  if (!FOOTER) return;
  clearTimeout(pinTimer);
  pinTimer = setTimeout(pinHeight, 250);
}

// The visible column span of each diff-mode label as last drawn, so a click in
// the footer maps back to the mode it landed on: [{ key, start, end }], 1-indexed
// to match WezTerm's SGR mouse report. `footerAttached` gates clicks: with no
// agent attached there is no diff to re-mode, so the labels are inert.
let hitZones = [];
let footerAttached = false;

// --- the footer: one full-width line of keys, always visible ----------------
function renderFooter() {
  const { agent, diffMode, customRef, terminals } = read();
  const attached = agent && agent !== "repo";
  footerAttached = attached;
  const n = terminals.length;
  const active = DIFF_MODE_LABELS[diffMode] ? diffMode : "uncommitted";
  // Unattached, the left slot is empty: its old "enter an agent" hint stole the
  // width a long `Custom: <branch>` needs to stay on the one footer line.
  const left = attached
    ? `${ESC}1m${agent}${ESC}0m${ESC}2m · ${n} terminal${n === 1 ? "" : "s"}${ESC}0m`
    : "";
  // All three modes are shown with the active one highlighted (reverse video), so
  // the current range is legible at a glance. It doubles as the hint for ⌥[/⌥],
  // which switch the mode when the diff pane is focused and terminals otherwise,
  // and each label is clickable (see the mouse handler below).
  // Custom carries the agent's base ref inline when it has one, so the reviewer
  // can see WHAT it is diffing against without opening the prompt.
  const label = (key) => key === "custom" && customRef ? `Custom: ${customRef}` : DIFF_MODE_LABELS[key];
  const opt = (key) => key === active
    ? `${ESC}7m ${label(key)} ${ESC}0m`
    : `${ESC}2m${label(key)}${ESC}0m`;
  const keys = [
    `${ESC}1m⌥t${ESC}0m new`,
    `${ESC}1m⌥[ ⌥]${ESC}0m switch`,
    `${ESC}1m⌥w${ESC}0m close`,
    `${ESC}1mO${ESC}0m send→claude`,
    `${ESC}2m⌥←↑↓→${ESC}0m move`,
    `${ESC}2m⌥z${ESC}0m zoom`,
    `${ESC}2mdrag${ESC}0m copy`,
  ].join(`${ESC}2m  ·  ${ESC}0m`);
  const lead = left ? `${left}    ` : "";
  // The write homes the cursor then emits a leading space, so visible column 1 is
  // that space -- fold it into `pre` so the measured label columns line up with
  // what a mouse click reports.
  const pre = ` ${lead}${keys}    `;
  const modePrefix = `${ESC}2mDiff mode:${ESC}0m `;
  const sep = `${ESC}2m | ${ESC}0m`;
  // Build the diff segment left-to-right, recording where each label sits.
  let col = vlen(pre) + vlen(modePrefix) + 1;   // 1-indexed column of the first label
  let diff = modePrefix;
  const zones = [];
  DIFF_ORDER.forEach((key, i) => {
    const seg = opt(key);
    const w = vlen(seg);
    zones.push({ key, start: col, end: col + w - 1 });
    diff += seg;
    col += w;
    if (i < DIFF_ORDER.length - 1) { diff += sep; col += vlen(sep); }
  });
  hitZones = zones;
  process.stdout.write(`${ESC}2J${ESC}H${pre}${diff}${ESC}K`);
}

// A left-click at column `x` on the footer: if it landed on a diff-mode label,
// hand the daemon the corresponding verb. Inert with no agent attached.
function onFooterClick(x) {
  if (!footerAttached) return;
  const zone = hitZones.find((z) => x >= z.start && x <= z.end);
  if (!zone) return;
  try { fs.appendFileSync(CMD_FILE, `diff-${zone.key}\n`); } catch { /* daemon re-reads on the next click */ }
}

// Turn on mouse reporting and forward left-clicks to `onClick(x, y)` (both 1-indexed,
// pane-local). 1000h reports button press/release; 1006h is SGR extended coordinates
// (unambiguous, and not capped at column 223). This is scoped to the display pane's
// own terminal -- it never reaches the Claude pane, whose mouse handling is
// deliberately left to claude. WezTerm delivers mouse events to the pane under the
// pointer once that pane has enabled reporting, so the pane is clickable without
// being focused. The footer needs only the column; the strip needs the row too.
let mouseOn = false;
function enableMouse(onClick) {
  process.stdout.write(`${ESC}?1000h${ESC}?1006h`);
  mouseOn = true;
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf) => {
    const s = buf.toString("latin1");
    // SGR mouse: ESC [ < b ; x ; y  (M = press, m = release). Act on a left-button
    // press only: low two bits 0 = left; bit 32 set = motion, and bit 64 set = a WHEEL
    // event -- both ignored. Wheel-up is 64, whose low two bits are 0, so without the
    // bit-64 guard a scroll over the strip would read as a left click and close/add/
    // select a terminal. The dashboard's twin reader (cockpit-welcome.mjs) carries the
    // same guard; the wheel-as-click was hand-verified there (FINDINGS 2026-09-05).
    const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let m;
    while ((m = re.exec(s))) {
      const b = Number(m[1]);
      if (m[4] === "M" && (b & 3) === 0 && !(b & 32) && !(b & 64)) onClick(Number(m[2]), Number(m[3]));
    }
  });
}

// The clickable buttons on the strip as last drawn, rebuilt on every renderStrip:
// [{ action: "close"|"add", n?, row, start, end }], all 1-indexed and pane-local to
// match the SGR mouse report. Unlike the footer (one line, column only), the strip
// is a column of rows, so a hit needs BOTH the row and the column span.
let stripZones = [];
const CLOSE = "[x]";                                  // per-terminal remove button
const ADD = "[+ add]";                                // open-another-terminal button

// --- the strip: a vertical list of the agent's terminals --------------------
function renderStrip() {
  const cols = process.stdout.columns || 12;
  const { terminals } = read();
  const rule = "─".repeat(Math.min(cols, 12));
  const clip = (s) => (s.length > cols ? s.slice(0, cols) : s);
  const row = (s, active) => `${active ? `${ESC}7m` : ""}${clip(s)}${ESC}0m${ESC}K\r\n`;

  const zones = [];
  let out = `${ESC}2J${ESC}H`;                         // clear, cursor home
  out += `${ESC}1mTERMINALS${ESC}0m${ESC}K\r\n`;       // pane row 1
  out += `${rule}${ESC}K\r\n`;                         // pane row 2
  let rowNum = 3;                                      // first terminal lands here
  if (!terminals.length) {
    out += row(" (none)", false);
    rowNum++;
  } else {
    // Never offer an [x] on the last terminal: the slot must always hold one, so
    // the daemon refuses to close it anyway (mirrors ⌥w). Drawing a dead button
    // would just invite a click that does nothing.
    const showClose = terminals.length > 1;
    for (const t of terminals) {
      const base = `${t.active ? "▶" : " "}${t.n} ${procOf(t.tty) ?? "sh"}`;
      if (showClose) {
        // Right-align [x] at the pane's edge; the strip is narrow (~12 cols), so
        // clip the process name rather than let a long one push [x] off-screen.
        const budget = cols - CLOSE.length - 1;
        const label = base.length > budget ? base.slice(0, budget) : base;
        const pad = " ".repeat(Math.max(1, cols - label.length - CLOSE.length));
        out += row(`${label}${pad}${CLOSE}`, t.active);
        // The row splits into two disjoint buttons: the label area selects that
        // terminal, and [x] at the right edge closes it. Select stops one column
        // short of [x] so a click never means both.
        zones.push({ action: "select", n: t.n, row: rowNum, start: 1, end: cols - CLOSE.length });
        zones.push({ action: "close", n: t.n, row: rowNum, start: cols - CLOSE.length + 1, end: cols });
      } else {
        out += row(base, t.active);
        // A lone terminal has no [x], so its whole row is the select button.
        zones.push({ action: "select", n: t.n, row: rowNum, start: 1, end: cols });
      }
      rowNum++;
    }
  }
  // A clickable line that opens another terminal, mirroring ⌥t.
  out += `${ESC}2m${ADD}${ESC}0m${ESC}K\r\n`;
  zones.push({ action: "add", row: rowNum, start: 1, end: ADD.length });

  stripZones = zones;
  process.stdout.write(out);
}

// A left-click at pane-local (x, y) on the strip: a terminal row's label area makes
// that terminal active, its [x] closes it by number, and [+ add] opens a new one.
// All hand the daemon a verb on the shared command channel, so it owns the actual
// pane change (a raw split here would make an untracked pane the daemon then has to
// shuffle around).
function onStripClick(x, y) {
  const z = stripZones.find((z) => z.row === y && x >= z.start && x <= z.end);
  if (!z) return;
  try {
    if (z.action === "add") fs.appendFileSync(CMD_FILE, "new\n");
    else if (z.action === "close") fs.appendFileSync(CMD_FILE, `close-${z.n}\n`);
    else if (z.action === "select") fs.appendFileSync(CMD_FILE, `select-${z.n}\n`);
  } catch { /* daemon re-reads on the next click */ }
}

const render = FOOTER ? renderFooter : renderStrip;

process.stdout.write(`${ESC}?25l`);                   // hide the cursor
render();
// The footer maps a click to a diff-mode label (column only); the strip to a
// terminal button (row + column). Both pass through the same reader.
enableMouse(FOOTER ? (x) => onFooterClick(x) : onStripClick);
// Watch the state DIR (not the file): the daemon replaces terminals.json
// atomically, so a file watch would go deaf after the first rename.
try { fs.watch(DIR, (_e, name) => { if (!name || name === "terminals.json") render(); }); } catch {}
process.stdout.on("resize", () => { render(); schedulePin(); });
setInterval(() => { render(); schedulePin(); }, 2000); // belt-and-braces if a watch is missed
schedulePin();                                        // the pane may open already oversized

const bye = () => {
  if (mouseOn) process.stdout.write(`${ESC}?1000l${ESC}?1006l`);   // stop mouse reporting
  process.stdout.write(`${ESC}?25h`);
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
