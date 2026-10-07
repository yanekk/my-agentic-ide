// The pure fleet picker model (bin/cockpit-fleet-picker-model.mjs), exhaustively. No tty, no
// fs. Prints failures in full, then one line `CHECKS <pass> <fail>` that run.sh folds into its
// summary.
import { deepStrictEqual } from "node:assert";
import {
  ORDER,
  NAMES,
  initialState,
  decodeKey,
  splitKeys,
  reduce,
  render,
} from "../../bin/cockpit-fleet-picker-model.mjs";

let pass = 0;
let fail = 0;
function check(name, got, want) {
  try {
    deepStrictEqual(got, want);
    pass++;
    if (process.env.VERBOSE) console.log(`  ok   ${name}`);
  } catch {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       want ${JSON.stringify(want)}`);
    console.log(`       got  ${JSON.stringify(got)}`);
  }
}

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const vis = (s) => [...plain(s)].length;

// --- constants ---------------------------------------------------------------
check("ORDER is claude then pir", ORDER, ["claude", "pir"]);
check("NAMES", NAMES, { claude: "Claude Agents", pir: "PIR" });

// --- initialState ------------------------------------------------------------
check("initialState(claude): highlight on pir", initialState("claude"), { shown: "claude", sel: "pir" });
check("initialState(pir): highlight on claude", initialState("pir"), { shown: "pir", sel: "claude" });

// --- decodeKey -----------------------------------------------------------------
const keys = [
  ["\x1b[A", "up"], ["\x1b[B", "down"], ["\x1b[C", "right"], ["\x1b[D", "left"],
  ["\x1bOA", "up"], ["\x1bOB", "down"], ["\x1bOC", "right"], ["\x1bOD", "left"],
  ["\r", "enter"], ["\n", "enter"], ["\r\n", "enter"],
  ["\x1b", "escape"], ["\x03", "ctrl-c"],
  ["\x1b[<0;10;5M", null], ["\x1b[<0;10;5m", null], ["\x1b[M !!", null],
  ["a", null], ["q", null], [" ", null], ["j", null],
  ["\x1b[5~", null], ["\x1b[1;2A", null], ["\x1bx", null], ["\x1b[Z", null],
  ["", null], [undefined, null], ["\x1b[A\x1b[C", null],
];
for (const [chunk, want] of keys) check(`decodeKey(${JSON.stringify(chunk)})`, decodeKey(chunk), want);

// --- splitKeys -----------------------------------------------------------------
check("splitKeys: fast ↓→ is two keys", splitKeys("\x1b[B\x1b[C"), ["\x1b[B", "\x1b[C"]);
check("splitKeys: SS3 then CR", splitKeys("\x1bOA\r"), ["\x1bOA", "\r"]);
check("splitKeys: CRLF stays one", splitKeys("\r\n"), ["\r\n"]);
check("splitKeys: lone ESC", splitKeys("\x1b"), ["\x1b"]);
check("splitKeys: trailing ESC", splitKeys("\x1b[Bx\x1b"), ["\x1b[B", "x", "\x1b"]);
check("splitKeys: SGR mouse report is one sequence", splitKeys("\x1b[<0;10;5M\r"), ["\x1b[<0;10;5M", "\r"]);
check("splitKeys: alt chord is one sequence", splitKeys("\x1bx\x1b[A"), ["\x1bx", "\x1b[A"]);
check("splitKeys: astral char whole", splitKeys("😀\x03"), ["😀", "\x03"]);
check("splitKeys: non-string", splitKeys(null), []);
check("splitKeys + decodeKey: mouse report decodes to null", splitKeys("\x1b[<0;10;5M").map(decodeKey), [null]);

// --- reduce --------------------------------------------------------------------
for (const shown of ORDER) {
  const s = initialState(shown);
  const o = s.sel;
  const flipped = { shown, sel: shown };
  check(`reduce(${shown}): up toggles`, reduce(s, "up"), { state: flipped });
  check(`reduce(${shown}): down toggles`, reduce(s, "down"), { state: flipped });
  check(`reduce(${shown}): down twice comes back`, reduce(reduce(s, "down").state, "down"), { state: s });
  check(`reduce(${shown}): up then down comes back`, reduce(reduce(s, "up").state, "down"), { state: s });
  check(`reduce(${shown}): enter gives sel`, reduce(s, "enter"), { done: o });
  check(`reduce(${shown}): right gives sel`, reduce(s, "right"), { done: o });
  check(`reduce(${shown}): enter on the shown one gives it`, reduce(flipped, "enter"), { done: shown });
  check(`reduce(${shown}): escape cancels`, reduce(s, "escape"), { done: "cancel" });
  check(`reduce(${shown}): ctrl-c cancels`, reduce(s, "ctrl-c"), { done: "cancel" });
  check(`reduce(${shown}): left leaves the state`, reduce(s, "left"), { state: s });
  check(`reduce(${shown}): null leaves the state`, reduce(s, null), { state: s });
  check(`reduce(${shown}): unknown leaves the state`, reduce(s, "tab"), { state: s });
  check(`reduce(${shown}): does not mutate`, (reduce(s, "down"), s), initialState(shown));
}

// --- render: the full frame ----------------------------------------------------
const full = render(initialState("claude"), 59, 22).map(plain);
check("render 59x22: exactly the §2.3 frame", full, [
  "",
  "   SWITCH PROGRAM",
  "   " + "─".repeat(40),
  "",
  "     Claude Agents             shown now",
  "",
  "   ▸ PIR",
  ...Array(14).fill(""),
  "   ↑↓ choose · enter or → open · esc back",
]);
const fullPir = render(initialState("pir"), 59, 22).map(plain);
check("render 59x22 pir shown: ▸ on Claude Agents", fullPir[4], "   ▸ Claude Agents");
check("render 59x22 pir shown: shown now on PIR", fullPir[6], "     PIR                       shown now");
const flippedFrame = render({ shown: "claude", sel: "claude" }, 59, 22).map(plain);
check("render: ▸ follows sel onto the shown entry", [flippedFrame[4], flippedFrame[6]],
  ["   ▸ Claude Agents             shown now", "     PIR"]);
check("render: styles are reset on every styled line",
  render(initialState("claude"), 59, 22).every((l) => !l.includes("\x1b[") || l.endsWith("\x1b[0m")), true);

// --- render: every size --------------------------------------------------------
const sizes = [[59, 22], [39, 12], [20, 6], [120, 40], [80, 24], [10, 3], [44, 8], [5, 2], [1, 1], [0, 0], [40, 7]];
for (const shown of ORDER) {
  for (const sel of ORDER) {
    const st = { shown, sel };
    for (const [c, r] of sizes) {
      const lines = render(st, c, r);
      const tag = `render ${c}x${r} shown=${shown} sel=${sel}`;
      check(`${tag}: exactly ${r} lines`, lines.length, r);
      const wide = lines.filter((l) => vis(l) > c).map(plain);
      check(`${tag}: no line over ${c}`, wide, []);
      if (r >= 3 && c >= 20) {
        const p = lines.map(plain);
        const hint = p[p.length - 1];
        check(`${tag}: hint on the last line`, hint.trim().startsWith("↑↓ choose"), true);
        const ci = p.findIndex((l) => l.includes("Claude Agents"));
        const pi = p.findIndex((l) => l.includes("PIR"));
        check(`${tag}: both entries, claude above pir`, ci >= 0 && pi > ci, true);
        check(`${tag}: ▸ on sel only`, [p[ci].includes("▸"), p[pi].includes("▸")], [sel === "claude", sel === "pir"]);
        // Below 26 columns `▸ Claude Agents  shown now` cannot fit and the tag is clipped.
        if (c >= 26) check(`${tag}: shown now on shown only`,
          [p[ci].includes("shown now"), p[pi].includes("shown now")], [shown === "claude", shown === "pir"]);
      }
    }
  }
}

// --- render: the smallest slot of an 80x24 window (39x12) keeps the whole frame -------
const small = render(initialState("claude"), 39, 12).map(plain);
check("render 39x12: the whole frame, rule shortened, nothing clipped", small, [
  "",
  "   SWITCH PROGRAM",
  "   " + "─".repeat(36),
  "",
  "     Claude Agents            shown now",
  "",
  "   ▸ PIR",
  "", "", "", "",
  "↑↓ choose · enter or → open · esc back",
]);
const tiny = render(initialState("claude"), 20, 6).map(plain);
check("render 20x6: spacers go first, title, entries and hint stay", tiny.length === 6 &&
  tiny.some((l) => l.includes("SWITCH PROGRAM")) && tiny[tiny.length - 1].startsWith("↑↓"), true);
const three = render(initialState("claude"), 59, 3).map(plain);
check("render 59x3: just the entries and the hint", three, [
  "     Claude Agents             shown now",
  "   ▸ PIR",
  "   ↑↓ choose · enter or → open · esc back",
]);

console.log(`CHECKS ${pass} ${fail}`);
process.exit(fail ? 1 : 0);
