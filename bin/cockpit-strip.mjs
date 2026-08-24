#!/usr/bin/env node
// cockpit-strip — the terminal-list strip on the right edge of the terminal slot.
//
// VSCode shows a vertical list of a workspace's terminals; this is that list, for
// the currently-attached agent. It is PURE DISPLAY: it never runs a shell command
// and never moves a pane, so cockpitd can own it as a fixed pane it never parks.
//
// The daemon writes ~/.claude/cockpit/terminals.json on every change (which
// agent, which terminals, which is active); this process repaints on every write.
// Nothing here talks to WezTerm -- the strip only reflects state, it never drives
// it. The keybindings that add/switch/close terminals live in wezterm/cockpit.lua
// and reach the daemon through its command channel.
//
//   node bin/cockpit-strip.mjs
//
// Started for you by bin/cockpit-layout.sh.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
const FILE = path.join(DIR, "terminals.json");

const ESC = "\x1b[";

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { agent: null, terminals: [] }; }
}

// A terminal's title is its foreground process ("-zsh", "node", a full path);
// trim it to something that fits a ~12-column strip.
function short(title) {
  return (title || "sh").replace(/^-/, "").split(/[/ ]/).pop().slice(0, 8) || "sh";
}

function render() {
  const cols = process.stdout.columns || 12;
  const { agent, terminals } = read();
  const rule = "─".repeat(Math.min(cols, 12));
  const clip = (s) => (s.length > cols ? s.slice(0, cols) : s);
  const row = (s, active) => `${active ? `${ESC}7m` : ""}${clip(s)}${ESC}0m${ESC}K\r\n`;

  let out = `${ESC}2J${ESC}H`;                         // clear, cursor home
  out += `${ESC}1mTERMINALS${ESC}0m${ESC}K\r\n`;
  out += `${rule}${ESC}K\r\n`;
  if (!terminals.length) {
    out += row(" (none)", false);
  } else {
    for (const t of terminals) out += row(`${t.active ? "▶" : " "}${t.n} ${short(t.title)}`, t.active);
  }
  out += `${ESC}K\r\n`;
  out += `${ESC}2m⌥t new${ESC}0m${ESC}K\r\n`;
  out += `${ESC}2m⌥[ ] cyc${ESC}0m${ESC}K\r\n`;
  out += `${ESC}2m⌥w close${ESC}0m${ESC}K\r\n`;
  process.stdout.write(out);
}

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
