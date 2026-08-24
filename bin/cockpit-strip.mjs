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
// cockpitd can own them as fixed panes it never parks. The daemon writes
// ~/.claude/cockpit/terminals.json on every change (which agent, which terminals,
// which is active); both modes repaint from it. The keybindings that add/switch/
// close terminals live in wezterm/cockpit.lua and reach the daemon through its
// command channel -- nothing here talks to WezTerm.
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
  catch { return { agent: null, diffMode: "uncommitted", terminals: [] }; }
}

// The daemon persists one of these mode names; anything else falls back to the
// default label rather than showing a raw token.
const DIFF_MODE_LABELS = { uncommitted: "uncommitted", lastcommit: "last commit" };

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

// --- the footer: one full-width line of keys, always visible ----------------
function renderFooter() {
  const { agent, diffMode, terminals } = read();
  const attached = agent && agent !== "repo";
  const n = terminals.length;
  const modeLabel = DIFF_MODE_LABELS[diffMode] ?? DIFF_MODE_LABELS.uncommitted;
  const left = attached
    ? `${ESC}1m${agent}${ESC}0m${ESC}2m · ${n} terminal${n === 1 ? "" : "s"}${ESC}0m`
    : `${ESC}2menter an agent to open terminals${ESC}0m`;
  // The diff-mode indicator doubles as the hint for ⌥[/⌥], which switch the mode
  // when the diff pane is focused and terminals otherwise.
  const diff = `${ESC}2mdiff${ESC}0m ${ESC}1m${modeLabel}${ESC}0m ${ESC}2m(⌥[ ⌥] in diff pane)${ESC}0m`;
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
process.stdout.on("resize", render);
setInterval(render, 2000);                            // belt-and-braces if a watch is missed

const bye = () => { process.stdout.write(`${ESC}?25h`); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
