#!/usr/bin/env node
// cockpit-custom-prompt — the ASCII "modal" that asks for a branch or SHA when
// the diff mode is switched to "custom".
//
// It runs IN THE DIFF PANE, exactly where revdiff and the welcome screen run:
// the daemon quits revdiff back to its shell and types a `node <this>` line in,
// so this owns the pane for the length of the prompt. There is no other way for
// the daemon to capture free-form text -- the `cmd` channel carries only fixed
// verbs (new/next/prev/close) and the daemon otherwise only ever WRITES into
// panes. So the handshake is inverted here: this reads a line from its own TTY,
// validates it against the agent's worktree, then hands the answer BACK to the
// daemon by writing a result file and appending a verb to the same `cmd`
// channel. The daemon relaunches revdiff on the chosen range.
//
//   node cockpit-custom-prompt.mjs <worktree> <jobId> <prefill-ref>
//
// Started for you by bin/cockpitd.mjs (never run by hand).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ESC = "\x1b[";
const [worktree, jobId, prefill = ""] = process.argv.slice(2);

const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
const CMD_FILE = path.join(DIR, "cmd");
const PENDING = path.join(DIR, "custom-ref-pending");

// The line being edited, and the last validation error to show under it. Seeded
// with the agent's persisted ref (the answer to "prompt every time, PRE-FILLED"),
// with the cursor left at the end so Enter accepts it or a keystroke edits it.
let value = prefill;
let error = "";

// ---------------------------------------------------------------------------
// Rendering — a boxed prompt, centred in the pane, redrawn on every keystroke
// and every resize (the pane is resized to full-tab and back on an agent switch).
// ---------------------------------------------------------------------------
const INNER = 44;                                    // width inside the box borders

function boxLine(text = "", { dim = false, bold = false } = {}) {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, INNER - visible.length);
  const style = bold ? `${ESC}1m` : dim ? `${ESC}2m` : "";
  const reset = style ? `${ESC}0m` : "";
  return `│ ${style}${text}${reset}${" ".repeat(pad)} │`;
}

function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const top = `┌─ ${"Custom diff range"} ${"─".repeat(Math.max(0, INNER - 19))}─┐`;
  const bottom = `└─${"─".repeat(INNER)}─┘`;
  const lines = [
    top,
    boxLine(""),
    boxLine("Diff against branch or SHA:", { dim: true }),
    boxLine(`  ${ESC}1m${value}${ESC}0m${ESC}7m ${ESC}0m`),   // reverse-video block = cursor
    boxLine(""),
    boxLine(error ? `${ESC}31m✗ ${error}${ESC}0m` : "", { }),
    boxLine("Enter confirm · Esc cancel", { dim: true }),
    bottom,
  ];

  const visibleLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const topPad = Math.max(0, Math.floor((rows - lines.length) / 2));
  let out = `${ESC}2J${ESC}H` + "\r\n".repeat(topPad);
  for (const line of lines) {
    const leftPad = Math.max(0, Math.floor((cols - visibleLen(line)) / 2));
    out += " ".repeat(leftPad) + line + `${ESC}K\r\n`;
  }
  process.stdout.write(out);
}

// ---------------------------------------------------------------------------
// Handing the answer back to the daemon.
// ---------------------------------------------------------------------------
function finish(kind, ref) {
  // Written atomically so the daemon never reads a half-file, then the verb is
  // appended to the command channel the daemon already tails.
  try {
    const payload = kind === "ok" ? { jobId, ref } : { jobId, cancel: true };
    const tmp = `${PENDING}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, PENDING);
    fs.appendFileSync(CMD_FILE, kind === "ok" ? "custom-ok\n" : "custom-cancel\n");
  } catch { /* best-effort: a lost handshake just leaves the mode unchanged */ }
  restore();
  process.exit(0);
}

// A ref is valid if git can resolve it to a commit in the agent's worktree.
// `^{commit}` rejects a tag/tree that is not commit-ish; --quiet keeps git silent
// so nothing leaks onto the prompt.
function refIsValid(ref) {
  try {
    execFileSync("git", ["-C", worktree, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
                 { stdio: ["ignore", "ignore", "ignore"], timeout: 3000 });
    return true;
  } catch { return false; }
}

function submit() {
  const ref = value.trim();
  if (!ref) { error = "Enter a branch or SHA"; return render(); }
  if (!refIsValid(ref)) { error = `git cannot resolve "${ref}"`; return render(); }
  finish("ok", ref);
}

// ---------------------------------------------------------------------------
// Input — raw bytes, so a single keystroke arrives whole (Esc as "\x1b" alone,
// arrows as "\x1b[..."). We only care about text, Enter, Backspace and cancel.
// ---------------------------------------------------------------------------
function onData(chunk) {
  const s = chunk.toString("utf8");
  if (s === "\x1b" || s === "\x03") return finish("cancel");   // Esc / Ctrl-C
  if (s.startsWith("\x1b")) return;                            // arrows/nav: ignore
  if (s === "\x7f" || s === "\b") { value = value.slice(0, -1); error = ""; return render(); }
  // A newline submits -- even bundled at the end of typed/pasted text, so a paste
  // of "main\n" confirms rather than swallowing the Enter.
  const nl = s.search(/[\r\n]/);
  const text = nl >= 0 ? s.slice(0, nl) : s;
  const printable = [...text].filter((c) => c >= " " && c !== "\x7f").join("");
  if (printable) { value += printable; error = ""; }
  if (nl >= 0) return submit();
  if (printable) render();
}

function restore() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  process.stdout.write(`${ESC}?25h`);                 // show the cursor again
}

process.stdout.write(`${ESC}?25l`);                   // hide the terminal's own cursor
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", onData);
process.stdout.on("resize", render);
render();

process.on("SIGINT", () => finish("cancel"));
process.on("SIGTERM", () => { restore(); process.exit(0); });
