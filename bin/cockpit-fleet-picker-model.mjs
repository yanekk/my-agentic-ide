// The pure half of the fleet slot's program picker (plans/fleet-picker DESIGN §2.3, §2.4, §3.1).
//
// bin/cockpit-fleet-picker.mjs owns the raw tty, the resize signal and the hand-back on the
// cmd channel; everything it decides comes from here. This module imports nothing and reaches
// for no clock, file system, process or environment: spikes/fleet-picker-test greps it for
// that, and if the grep ever fails the fix is to move the code into the process, never to
// relax the grep.

export const ORDER = ["claude", "pir"];
export const NAMES = { claude: "Claude Agents", pir: "PIR" };

const HINT = "↑↓ choose · enter or → open · esc back";
const TITLE = "SWITCH PROGRAM";
const SHOWN = "shown now";
const RULE_MAX = 40;
const INDENT = "   ";
// The name column of the mock (variant A): `shown now` starts 26 columns after the name does.
const NAME_COL = 26;

const ESC = "\x1b[";
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const RESET = `${ESC}0m`;

function other(prog) {
  return prog === "claude" ? "pir" : "claude";
}

// The picker is spawned fresh on every open, so the highlight always starts on the program
// that is NOT shown: the one the person most likely opened the picker to reach (§2.5).
export function initialState(shown) {
  return { shown, sel: other(shown) };
}

// One read from the raw tty → one key, or null for anything the picker ignores. WezTerm sends
// arrows as CSI or SS3 depending on the pane's cursor-key mode, so both are accepted (§2.4).
// A lone ESC in one read is Esc; ESC followed by anything else is some other sequence (a
// mouse report, a function key, an Alt chord) and is ignored.
const ARROWS = { A: "up", B: "down", C: "right", D: "left" };
export function decodeKey(chunk) {
  if (typeof chunk !== "string" || chunk.length === 0) return null;
  if (chunk === "\x1b") return "escape";
  if (chunk === "\x03") return "ctrl-c";
  if (chunk === "\r" || chunk === "\n" || chunk === "\r\n") return "enter";
  const m = /^\x1b(?:\[|O)([ABCD])$/.exec(chunk);
  if (m) return ARROWS[m[1]];
  return null;
}

// One read may carry several keys (a fast ↓→, or keys queued before raw mode was set), so the
// process splits a chunk into sequences before decoding each. CSI runs to its final byte
// (0x40–0x7e), SS3 is ESC O plus one byte, ESC plus any other byte is one unknown sequence.
// `\r\n` stays one Enter, since a terminal that sends it means one key.
export function splitKeys(chunk) {
  if (typeof chunk !== "string") return [];
  const out = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\x1b") {
      if (i + 1 >= chunk.length) { out.push("\x1b"); i += 1; continue; }
      const next = chunk[i + 1];
      if (next === "[") {
        let j = i + 2;
        while (j < chunk.length && !(chunk.charCodeAt(j) >= 0x40 && chunk.charCodeAt(j) <= 0x7e)) j++;
        out.push(chunk.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      if (next === "O") { out.push(chunk.slice(i, i + 3)); i += 3; continue; }
      out.push(chunk.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (chunk[i] === "\r" && chunk[i + 1] === "\n") { out.push("\r\n"); i += 2; continue; }
    const cp = chunk.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    out.push(ch);
    i += ch.length;
  }
  return out;
}

// §2.4. Two entries, so ↑ and ↓ both toggle. Enter and → hand back the highlighted program
// even when it is the shown one: the daemon reads that as "just close". ← does nothing
// (person, 2026-10-07), nor does any key not in the table.
export function reduce(state, key) {
  switch (key) {
    case "up":
    case "down":
      return { state: { ...state, sel: other(state.sel) } };
    case "enter":
    case "right":
      return { done: state.sel };
    case "escape":
    case "ctrl-c":
      return { done: "cancel" };
    default:
      return { state };
  }
}

// Every glyph the picker draws is one column wide, so a string's width is its code points.
function width(s) {
  return [...s].length;
}

function clip(s, cols) {
  const cps = [...s];
  return cps.length <= cols ? s : cps.slice(0, Math.max(0, cols)).join("");
}

// The line for one entry: `   ▸ Claude Agents             shown now`, narrowing its indent and
// then the gap before `shown now` until it fits, and clipping only when nothing else will.
function entryText(state, prog, cols) {
  const mark = prog === state.sel ? "▸ " : "  ";
  const name = NAMES[prog];
  const tag = prog === state.shown ? SHOWN : "";
  for (const indent of [INDENT, ""]) {
    const lead = indent + mark;
    if (!tag) {
      if (width(lead + name) <= cols) return { lead, name, gap: "", tag };
      continue;
    }
    const gap = Math.max(2, NAME_COL - width(name));
    for (let g = gap; g >= 2; g--) {
      if (width(lead + name) + g + width(tag) <= cols) return { lead, name, gap: " ".repeat(g), tag };
    }
  }
  return { lead: mark, name, gap: tag ? "  " : "", tag };
}

// A line as plain text plus how to style it. Styling is applied after clipping so an escape
// sequence is never cut in half.
function styled(parts, cols) {
  let room = cols;
  let out = "";
  for (const [text, style] of parts) {
    if (room <= 0) break;
    const t = clip(text, room);
    room -= width(t);
    if (!t) continue;
    out += style ? `${style}${t}${RESET}` : t;
  }
  return out;
}

// §2.3: the lines of variant A, top to bottom, with the hint on the last line of the pane.
// Exactly `rows` lines, none wider than `cols` visible columns. When the pane is too short for
// the whole frame the blank spacers go first, then the rule, then the title; the two entries
// and the hint are the picker and go last. When it is too narrow the rule shortens, the
// indents go, and only then is anything clipped.
export function render(state, cols, rows) {
  cols = Math.max(0, Math.floor(cols) || 0);
  rows = Math.max(0, Math.floor(rows) || 0);
  if (rows === 0) return [];

  const indent = width(INDENT + TITLE) <= cols ? INDENT : "";
  const ruleLen = Math.max(0, Math.min(RULE_MAX, cols - width(indent)));
  const entry = (prog) => {
    const e = entryText(state, prog, cols);
    const on = prog === state.sel;
    return styled([[e.lead, ""], [e.name, on ? BOLD : ""], [e.gap, ""], [e.tag, DIM]], cols);
  };
  const hintIndent = width(INDENT + HINT) <= cols ? INDENT : "";

  // [text, priority]: a higher priority survives a shorter pane.
  const top = [
    ["", 0],
    [styled([[indent, ""], [TITLE, BOLD]], cols), 3],
    [styled([[indent, ""], ["─".repeat(ruleLen), DIM]], cols), 2],
    ["", 1],
    [entry(ORDER[0]), 9],
    ["", 1],
    [entry(ORDER[1]), 9],
  ];
  const hint = styled([[hintIndent, ""], [HINT, DIM]], cols);

  let body = top;
  const room = rows - 1;
  for (const p of [0, 1, 2, 3]) {
    if (body.length <= room) break;
    // Drop this priority's lines from the top down until the frame fits.
    const next = [];
    let excess = body.length - room;
    for (const line of body) {
      if (excess > 0 && line[1] === p) { excess--; continue; }
      next.push(line);
    }
    body = next;
  }
  let lines = body.map(([t]) => t);
  if (lines.length > room) lines = lines.slice(lines.length - room);
  while (lines.length < room) lines.push("");
  lines.push(hint);
  return lines.slice(-rows);
}
