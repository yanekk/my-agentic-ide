#!/usr/bin/env node
// cockpit-fleet-picker — the program picker that stands in the fleet slot while the person
// chooses between `claude agents` and pir (plans/fleet-picker DESIGN §2.3–§2.7).
//
//   node cockpit-fleet-picker.mjs <cmd-file> <shown>
//
// Started by bin/cockpit-fleet-picker.sh, which cockpitd splits into the slot (never run by
// hand). The cmd file is an argument rather than read from the environment because the pane
// is spawned from the mux server and inherits nothing. Every decision is the pure model's;
// this owns the raw tty, the redraw on resize, and the one verb it hands back.
//
// Exactly one verb per run: `fleet-claude`, `fleet-pir` or `picker-cancel`, appended to the
// cmd file the daemon tails, then exit 0. Any other way out (a crash, a signal) exits
// non-zero WITHOUT appending, and the wrapper appends `picker-cancel` for it -- so a choice
// is never followed by a cancel that would race it (§2.7).
//
// Under each entry it lists what that program has going (plans/fleet-picker-status §2.5): the
// frame is drawn first with `…`, both programs are asked once in the background, and the lists
// are drawn when both have answered. Never refreshed while open; abandoned with the process.

import fs from "node:fs";
import { ORDER, initialState, decodeKey, splitKeys, reduce, render } from "./cockpit-fleet-picker-model.mjs";
import { claudeItems, pirItems } from "./cockpit-fleet-status-model.mjs";
import { gatherAll } from "./cockpit-fleet-status.mjs";

const [cmdFile, shown] = process.argv.slice(2);
if (!cmdFile || !ORDER.includes(shown)) {
  process.stderr.write("usage: cockpit-fleet-picker.mjs <cmd-file> <claude|pir>\n");
  process.exit(2);
}

const ESC = "\x1b[";
let state = initialState(shown);
let finished = false;
let lists = { claude: "loading", pir: "loading" };

function draw() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  // Home, then each line cleared to its end. No newline after the last line: on the bottom
  // row it would scroll the whole frame up by one. A line that fills the width gets no clear:
  // the cursor then still sits ON the last column, and erasing from there wipes the line's
  // last character (seen at 39 columns, where `shown now` read `shown no`).
  const lines = render(state, cols, rows, lists);
  const full = (l) => [...l.replace(/\x1b\[[0-9;]*m/g, "")].length >= cols;
  process.stdout.write(`${ESC}H` + lines.map((l) => (full(l) ? l : `${l}${ESC}K`)).join("\r\n"));
}

function restore() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  try { process.stdout.write(`${ESC}?25h`); } catch {}
}

function finish(done) {
  if (finished) return;
  finished = true;
  const verb = done === "cancel" ? "picker-cancel" : `fleet-${done}`;
  try {
    fs.appendFileSync(cmdFile, `${verb}\n`);
  } catch {
    // Unwritten, the daemon would wait on a picker that has gone. Exiting non-zero hands the
    // cancel to the wrapper, which tries the same file once more.
    restore();
    process.exit(1);
  }
  restore();
  process.exit(0);
}

function onData(chunk) {
  if (finished) return;
  const s = chunk.toString("utf8");
  // WezTerm closing a pane whose program is still running writes `\n` + Ctrl+D into it on
  // the way out (measured on a headless mux, fleet-picker T04). The daemon does exactly that
  // when a BitBucket click closes an open picker, and read as keys the `\n` was an Enter:
  // the picker handed back `fleet-pir` just after the spawn. A read carrying Ctrl+D is
  // never a choice; SIGHUP follows and the wrapper appends the (then ignored) cancel.
  if (s.includes("\x04")) return;
  // A lone ESC is only Esc when it is the whole read (§2.4); otherwise split the read into
  // its keys so a fast ↓→ is two keys, not one ignored blob.
  const keys = s === "\x1b" ? [s] : splitKeys(s);
  for (const k of keys) {
    const r = reduce(state, decodeKey(k));
    if ("done" in r) return finish(r.done);
    state = r.state;
  }
  draw();
}

// Ctrl+C arrives as a byte in raw mode; a SIGINT can still come from outside (or before raw
// mode is set), and it means the same thing.
process.on("SIGINT", () => finish("cancel"));
// SIGTERM and SIGHUP are a kill, not an answer: leave the tty sane and exit non-zero, so the
// wrapper appends the cancel.
for (const sig of ["SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { restore(); process.exit(128 + (sig === "SIGTERM" ? 15 : 1)); });
}

process.stdout.write(`${ESC}?25l${ESC}2J`);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", onData);
// Input that ends leaves nothing holding the event loop open, so node would exit 0 with no
// verb and the wrapper, seeing a clean exit, would add none: the daemon would wait for ever.
process.stdin.on("end", () => finish("cancel"));
process.stdout.on("resize", draw);
draw();

// After the first draw, so the fetch can never delay the frame. The model runs inside the
// chain too: a throw anywhere, gather or model, ends as `status unavailable` rather than an
// unhandled rejection, which would kill the picker and lose the person's ← to a cancel
// (status §2.7). No redraw once a verb is appended: the screen never changes behind a choice.
gatherAll()
  .then(({ claude, pir }) => {
    const now = Date.now();
    return {
      claude: claude.ok ? claudeItems(claude.agents, claude.finishedAt, now) : "unavailable",
      pir: pir.ok ? pirItems(pir.body, now)
        : pir.why === "down" ? { unavailable: "status unavailable · pir service not running" } : "unavailable",
    };
  })
  .catch(() => ({ claude: "unavailable", pir: "unavailable" }))
  .then((got) => {
    lists = got;
    if (!finished) draw();
  })
  .catch(() => {});
