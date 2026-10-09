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
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;

// The status lists (plans/fleet-picker-status DESIGN §2.2, §2.4, §2.7, §3.3).
const GLYPH = { wait: "●", run: "◐", bad: "✗", done: "✓" };
const LOADING = "…";
const EMPTY = "nothing running";
const UNAVAILABLE = "status unavailable";
// Below this many rows the title and its rule are dropped to make room for the lists.
const ROOMY_ROWS = 18;
// A list sits past its entry's name: 7 columns in a wide slot, 3 in a narrow one.
const WIDE_COLS = 50;
const SUB_WIDE = "       ";
const SUB_NARROW = "   ";

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

// One line of an entry's list: `       ● needs you  sdet-tools / epic-readiness` (status DESIGN
// §2.2, §2.4). The word column is `sw` wide; a name too long is cut with `…`, and the name goes
// entirely before the word is touched, so the status survives the narrowest slot.
function itemLine(item, sw, sub, cols) {
  const word = item.word + " ".repeat(Math.max(0, sw - width(item.word)));
  const lead = `${GLYPH[item.cls]} ${word}`;
  const room = cols - width(sub) - width(lead) - 2;
  const name = room > 0 ? clipDots(item.name, room) : "";
  if (item.cls === "done") return styled([[sub, ""], [lead + (name ? `  ${name}` : ""), DIM]], cols);
  const tone = item.cls === "wait" ? YELLOW : item.cls === "bad" ? RED : "";
  return styled([[sub, ""], [lead, tone], [name ? `  ${name}` : "", ""]], cols);
}

// A dim line that is not an item: `…`, `nothing running`, `status unavailable`, `+N more`.
function dimLine(text, sub, cols) {
  return styled([[sub, ""], [clipDots(text, cols - width(sub)), DIM]], cols);
}

function clipDots(s, n) {
  if (n <= 0) return "";
  return width(s) <= n ? s : [...s].slice(0, n - 1).join("") + "…";
}

// Names, words and the unavailable text are wire text (claude agents, pir's service). A NEWLINE
// in one would paint a second terminal line out of a single entry and an ESC would run as a
// control sequence in the pane, so every control character becomes one space where the text
// enters the drawing, as the agenda's safeText does (this module may import nothing).
const safe = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");

// The status DESIGN §3.3 List, normalised: omitted is still loading, anything unrecognised is
// unavailable, and an array keeps only items it can draw (a malformed one is skipped, never a
// blank line, §2.7).
function normalise(list) {
  if (list === undefined || list === "loading") return "loading";
  if (Array.isArray(list)) {
    return list
      .filter((i) => i && typeof i === "object" && GLYPH[i.cls] && typeof i.word === "string" &&
        typeof i.name === "string" && i.name !== "")
      .map((i) => ({ cls: i.cls, word: safe(i.word), name: safe(i.name) }));
  }
  if (list && typeof list === "object" && typeof list.unavailable === "string" && list.unavailable) {
    return { unavailable: safe(list.unavailable) };
  }
  return "unavailable";
}

// An unavailable text too wide for its line keeps what follows its last ` · `, the cause the
// person acts on: at 39 columns `status unavailable · pir service no…` lost exactly that, so
// it reads `pir service not running` there (person, 2026-10-09, status DESIGN §7). Only then
// is it cut with `…`. A text ending in ` · ` has no cause to keep and is cut whole, never blank.
function unavailableText(text, sub, cols) {
  const at = text.lastIndexOf(" · ");
  const cause = at < 0 ? "" : text.slice(at + 3);
  return width(sub + text) <= cols || !cause.trim() ? text : cause;
}

// How many rows an entry would like: one per item, or the single line of every other state.
function wanted(list) {
  return Array.isArray(list) ? Math.max(1, list.length) : 1;
}

// The lines under one entry, in exactly `n` rows or fewer. An entry with more items than its
// rows shows the first `n - 1` and `+N more`; one row alone holds `+N more` rather than a cut
// item (status DESIGN §2.4).
function listLines(list, n, sub, cols) {
  if (n <= 0) return [];
  if (list === "loading") return [dimLine(LOADING, sub, cols)];
  if (list === "unavailable") return [dimLine(UNAVAILABLE, sub, cols)];
  if (!Array.isArray(list)) return [dimLine(unavailableText(list.unavailable, sub, cols), sub, cols)];
  if (list.length === 0) return [dimLine(EMPTY, sub, cols)];
  const shown = list.length <= n ? list : list.slice(0, n - 1);
  const sw = Math.max(...shown.map((i) => width(i.word)), 0);
  const out = shown.map((i) => itemLine(i, sw, sub, cols));
  if (shown.length < list.length) out.push(dimLine(`  +${list.length - shown.length} more`, sub, cols));
  return out;
}

// §2.3 and status DESIGN §2.4: the frame top to bottom, each entry followed by its list, the
// hint on the last line of the pane. Exactly `rows` lines, none wider than `cols` visible
// columns. At 18 rows and more the title, its rule and the spacers around them stay; below
// that they go, leaving the two entries, their lists, one spacer and the hint. The rows left
// after the frame are shared between the two lists: half each, the odd row to the first
// entry, and what one list does not need goes to the other. When it is too narrow the rule
// shortens, the indents go, a name is cut with `…`, and only then is anything clipped.
export function render(state, cols, rows, lists) {
  cols = Math.max(0, Math.floor(cols) || 0);
  rows = Math.max(0, Math.floor(rows) || 0);
  if (rows === 0) return [];

  const roomy = rows >= ROOMY_ROWS;
  const indent = width(INDENT + TITLE) <= cols ? INDENT : "";
  const ruleLen = Math.max(0, Math.min(RULE_MAX, cols - width(indent)));
  const sub = cols >= WIDE_COLS ? SUB_WIDE : SUB_NARROW;
  const entry = (prog) => {
    const e = entryText(state, prog, cols);
    const on = prog === state.sel;
    return styled([[e.lead, ""], [e.name, on ? BOLD : ""], [e.gap, ""], [e.tag, DIM]], cols);
  };
  const hintIndent = width(INDENT + HINT) <= cols ? INDENT : "";
  const hint = styled([[hintIndent, ""], [HINT, DIM]], cols);
  const data = Object.fromEntries(ORDER.map((p) => [p, normalise(lists ? lists[p] : undefined)]));

  const head = roomy
    ? ["", styled([[indent, ""], [TITLE, BOLD]], cols), styled([[indent, ""], ["─".repeat(ruleLen), DIM]], cols), ""]
    : [];
  // The spacer between the entries, and at the roomy size one more before the hint. In a
  // pane too short even for that, the spacer goes before any entry does.
  let spacers = roomy ? 2 : 1;
  const frame = () => head.length + ORDER.length + spacers + 1;
  if (frame() > rows) spacers = 0;
  const avail = Math.max(0, rows - frame());

  const [first, second] = ORDER;
  let a = Math.min(wanted(data[first]), Math.ceil(avail / 2));
  const b = Math.min(wanted(data[second]), avail - a);
  a = Math.min(wanted(data[first]), avail - b);

  let lines = [
    ...head,
    entry(first),
    ...listLines(data[first], a, sub, cols),
    ...(spacers > 0 ? [""] : []),
    entry(second),
    ...listLines(data[second], b, sub, cols),
  ];
  const room = rows - 1;
  if (lines.length > room) lines = lines.slice(lines.length - room);
  while (lines.length < room) lines.push("");
  lines.push(hint);
  return lines.slice(-rows);
}
