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
const FOOTER = process.argv[2] === "footer";

const ESC = "\x1b[";

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { agent: null, diffMode: "uncommitted", customRef: null, terminals: [] }; }
}

// The daemon persists one of these mode names; anything else falls back to the
// default (uncommitted) rather than showing a raw token.
const DIFF_MODE_LABELS = { uncommitted: "Uncommitted Changes", lastcommit: "Last Commit", custom: "Custom" };

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

// --- the footer: one full-width line of keys, always visible ----------------
function renderFooter() {
  const { agent, diffMode, customRef, terminals } = read();
  const attached = agent && agent !== "repo";
  const n = terminals.length;
  const active = DIFF_MODE_LABELS[diffMode] ? diffMode : "uncommitted";
  const left = attached
    ? `${ESC}1m${agent}${ESC}0m${ESC}2m · ${n} terminal${n === 1 ? "" : "s"}${ESC}0m`
    : `${ESC}2menter an agent to open terminals${ESC}0m`;
  // All three modes are shown with the active one highlighted (reverse video), so
  // the current range is legible at a glance. It doubles as the hint for ⌥[/⌥],
  // which switch the mode when the diff pane is focused and terminals otherwise.
  // Custom carries the agent's base ref inline when it has one, so the reviewer
  // can see WHAT it is diffing against without opening the prompt.
  const label = (key) => key === "custom" && customRef ? `Custom: ${customRef}` : DIFF_MODE_LABELS[key];
  const opt = (key) => key === active
    ? `${ESC}7m ${label(key)} ${ESC}0m`
    : `${ESC}2m${label(key)}${ESC}0m`;
  const diff = `${ESC}2mDiff mode:${ESC}0m ${opt("uncommitted")}${ESC}2m | ${ESC}0m${opt("lastcommit")}${ESC}2m | ${ESC}0m${opt("custom")}`;
  const keys = [
    `${ESC}1m⌥t${ESC}0m new`,
    `${ESC}1m⌥[ ⌥]${ESC}0m switch`,
    `${ESC}1m⌥w${ESC}0m close`,
    `${ESC}2m⌥←↑↓→${ESC}0m move`,
    `${ESC}2m⌥z${ESC}0m zoom`,
  ].join(`${ESC}2m  ·  ${ESC}0m`);
  process.stdout.write(`${ESC}2J${ESC}H ${left}    ${keys}    ${diff}${ESC}K`);
}

// --- the strip: a vertical list of the agent's terminals --------------------
function renderStrip() {
  const cols = process.stdout.columns || 12;
  const { terminals } = read();
  const rule = "─".repeat(Math.min(cols, 12));
  const clip = (s) => (s.length > cols ? s.slice(0, cols) : s);
  const row = (s, active) => `${active ? `${ESC}7m` : ""}${clip(s)}${ESC}0m${ESC}K\r\n`;

  let out = `${ESC}2J${ESC}H`;                         // clear, cursor home
  out += `${ESC}1mTERMINALS${ESC}0m${ESC}K\r\n`;
  out += `${rule}${ESC}K\r\n`;
  if (!terminals.length) {
    out += row(" (none)", false);
  } else {
    for (const t of terminals) {
      out += row(`${t.active ? "▶" : " "}${t.n} ${procOf(t.tty) ?? "sh"}`, t.active);
    }
  }
  process.stdout.write(out);
}

const render = FOOTER ? renderFooter : renderStrip;

process.stdout.write(`${ESC}?25l`);                   // hide the cursor
render();
// Watch the state DIR (not the file): the daemon replaces terminals.json
// atomically, so a file watch would go deaf after the first rename.
try { fs.watch(DIR, (_e, name) => { if (!name || name === "terminals.json") render(); }); } catch {}
process.stdout.on("resize", () => { render(); schedulePin(); });
setInterval(() => { render(); schedulePin(); }, 2000); // belt-and-braces if a watch is missed
schedulePin();                                        // the pane may open already oversized

const bye = () => { process.stdout.write(`${ESC}?25h`); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
