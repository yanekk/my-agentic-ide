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

// --- render: the full frame, lists omitted (both still loading) ------------------
const full = render(initialState("claude"), 59, 22).map(plain);
check("render 59x22: the frame with … under each entry", full, [
  "",
  "   SWITCH PROGRAM",
  "   " + "─".repeat(40),
  "",
  "     Claude Agents             shown now",
  "       …",
  "",
  "   ▸ PIR",
  "       …",
  ...Array(12).fill(""),
  "   ↑↓ choose · enter or → open · esc back",
]);
const fullPir = render(initialState("pir"), 59, 22).map(plain);
check("render 59x22 pir shown: ▸ on Claude Agents", fullPir[4], "   ▸ Claude Agents");
check("render 59x22 pir shown: shown now on PIR", fullPir[7], "     PIR                       shown now");
const flippedFrame = render({ shown: "claude", sel: "claude" }, 59, 22).map(plain);
check("render: ▸ follows sel onto the shown entry", [flippedFrame[4], flippedFrame[7]],
  ["   ▸ Claude Agents             shown now", "     PIR"]);
check("render: styles are reset on every styled line",
  render(initialState("claude"), 59, 22).every((l) => !l.includes("\x1b[") || l.endsWith("\x1b[0m")), true);
check("render: … is dim", render(initialState("claude"), 59, 22)[5], "       \x1b[2m…\x1b[0m");
check("render: lists {} is loading too", render(initialState("claude"), 59, 22, {}), render(initialState("claude"), 59, 22));

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

// --- render: the smallest slot of an 80x24 window (39x12) drops the title -------------
const small = render(initialState("claude"), 39, 12).map(plain);
check("render 39x12: no title or rule, entries, lists, one spacer, hint", small, [
  "     Claude Agents            shown now",
  "   …",
  "",
  "   ▸ PIR",
  "   …",
  "", "", "", "", "", "",
  "↑↓ choose · enter or → open · esc back",
]);
const tiny = render(initialState("claude"), 20, 6).map(plain);
check("render 20x6: entries, their lists, spacer and hint", tiny, [
  "  Claude Agents  sho", "   …", "", "   ▸ PIR", "   …", "↑↓ choose · enter or",
]);
const three = render(initialState("claude"), 59, 3).map(plain);
check("render 59x3: just the entries and the hint", three, [
  "     Claude Agents             shown now",
  "   ▸ PIR",
  "   ↑↓ choose · enter or → open · esc back",
]);
const four = render(initialState("claude"), 59, 4).map(plain);
check("render 59x4: the spacer stays, no room for lists", four, [
  "     Claude Agents             shown now", "", "   ▸ PIR", "   ↑↓ choose · enter or → open · esc back",
]);
const five = render(initialState("claude"), 59, 5).map(plain);
check("render 59x5: the one spare row goes to Claude", five, [
  "     Claude Agents             shown now", "       …", "", "   ▸ PIR", "   ↑↓ choose · enter or → open · esc back",
]);

// --- render: the title rule (status DESIGN §2.4) ---------------------------------
for (const r of [17, 18, 19, 30]) {
  const p = render(initialState("claude"), 59, r).map(plain);
  check(`render 59x${r}: title ${r >= 18 ? "stays" : "gone"}`, p.includes("   SWITCH PROGRAM"), r >= 18);
  check(`render 59x${r}: rule ${r >= 18 ? "stays" : "gone"}`, p.includes("   " + "─".repeat(40)), r >= 18);
  check(`render 59x${r}: hint last`, p[r - 1], "   ↑↓ choose · enter or → open · esc back");
}

// --- render: the lists (status DESIGN §2.2, §2.4, §2.7, §3.3) --------------------
const it = (cls, word, name) => ({ cls, word, name });
const typical = {
  claude: [
    it("wait", "needs you", "sdet-tools / epic-readiness"),
    it("run", "working", "sdet-tools / branch-tilt-setup"),
    it("bad", "failed", "sdet-tools / denormalization-gaps"),
    it("done", "done 12m", "cribl / pack-delete-plumbing"),
  ],
  pir: [
    it("wait", "asking you", "plan-implement-review / finisher-go-covers-steps"),
    it("run", "building 4/9", "sdet-tools / rca-sidebar-filter"),
  ],
};
const ty = render(initialState("claude"), 59, 22, typical);
check("lists 59x22: the typical frame", ty.map(plain), [
  "",
  "   SWITCH PROGRAM",
  "   " + "─".repeat(40),
  "",
  "     Claude Agents             shown now",
  "       ● needs you  sdet-tools / epic-readiness",
  "       ◐ working    sdet-tools / branch-tilt-setup",
  "       ✗ failed     sdet-tools / denormalization-gaps",
  "       ✓ done 12m   cribl / pack-delete-plumbing",
  "",
  "   ▸ PIR",
  "       ● asking you    plan-implement-review / finisher-go…",
  "       ◐ building 4/9  sdet-tools / rca-sidebar-filter",
  ...Array(8).fill(""),
  "   ↑↓ choose · enter or → open · esc back",
]);
check("lists: wait glyph and word yellow, name plain", ty[5], "       \x1b[33m● needs you\x1b[0m  sdet-tools / epic-readiness");
check("lists: run plain throughout", ty[6], "       ◐ working    sdet-tools / branch-tilt-setup");
check("lists: bad glyph and word red, name plain", ty[7], "       \x1b[31m✗ failed   \x1b[0m  sdet-tools / denormalization-gaps");
check("lists: done whole line dim", ty[8], "       \x1b[2m✓ done 12m   cribl / pack-delete-plumbing\x1b[0m");
check("lists: a cut name lands exactly on the width", vis(ty[11]), 59);
check("lists: the word column is per entry", plain(ty[12]).indexOf("sdet"), 7 + 2 + 12 + 2);

const tys = render(initialState("claude"), 39, 12, typical).map(plain);
check("lists 39x12: the typical frame", tys, [
  "     Claude Agents            shown now",
  "   ● needs you  sdet-tools / epic-read…",
  "   ◐ working    sdet-tools / branch-ti…",
  "   ✗ failed     sdet-tools / denormali…",
  "   ✓ done 12m   cribl / pack-delete-pl…",
  "",
  "   ▸ PIR",
  "   ● asking you    plan-implement-revi…",
  "   ◐ building 4/9  sdet-tools / rca-si…",
  "", "",
  "↑↓ choose · enter or → open · esc back",
]);

// The word is never cut before the name is: narrow until the name is gone.
{
  const one = { claude: [it("wait", "needs you", "sdet-tools / epic-readiness")], pir: [] };
  const at = (c) => plain(render(initialState("claude"), c, 12, one)[1]);
  check("narrow: name cut to one char then …", at(19), "   ● needs you  sd…");
  check("narrow: name only …", at(17), "   ● needs you  …");
  check("narrow: no room for a name, word whole", at(16), "   ● needs you");
  check("narrow: word clipped only once the name is gone", at(10), "   ● needs");
  for (let c = 0; c <= 40; c++) {
    const l = render(initialState("claude"), c, 12, one)[1] ?? "";
    if (vis(l) > c) check(`narrow ${c}: within width`, plain(l), "");
    const w = plain(l);
    if (w.includes("…") && !w.includes("needs you")) check(`narrow ${c}: name cut before word`, w, "");
  }
}

// The row share. 59x22 has 13 rows for lists, 39x12 has 8.
const many = (k, n) => Array.from({ length: n }, (_, i) => it("run", "working", `${k}-${i + 1}`));
const rowsOf = (lines, entry) => {
  const p = lines.map(plain);
  const i = p.findIndex((l) => l.includes(entry));
  let j = i + 1;
  while (j < p.length && p[j].startsWith("   ") && !/(Claude Agents|PIR)/.test(p[j]) && p[j].trim()) j++;
  return p.slice(i + 1, j).map((l) => l.trim());
};
const share = (c, r, nc, np) => {
  const lines = render(initialState("claude"), c, r, { claude: many("c", nc), pir: many("p", np) });
  return [rowsOf(lines, "Claude Agents").length, rowsOf(lines, "PIR").length];
};
check("share 59x22: both overflow, 7 and 6 (odd row to Claude)", share(59, 22, 20, 20), [7, 6]);
check("share 39x12: both overflow, 4 and 4", share(39, 12, 20, 20), [4, 4]);
check("share 39x11: 7 rows, 4 and 3", share(39, 11, 20, 20), [4, 3]);
check("share 59x22: Claude needs 2, PIR gets 11", share(59, 22, 2, 20), [2, 11]);
check("share 59x22: PIR needs 1, Claude gets 12", share(59, 22, 20, 1), [12, 1]);
check("share 39x12: Claude empty, PIR gets 7", share(39, 12, 0, 20), [1, 7]);
check("share 39x12: both fit exactly, 3 and 5", share(39, 12, 3, 5), [3, 5]);
check("share 39x12: nothing overflows below the room", share(39, 12, 2, 2), [2, 2]);
{
  const lines = render(initialState("claude"), 59, 22, { claude: many("c", 20), pir: many("p", 20) });
  const c = rowsOf(lines, "Claude Agents");
  check("overflow: rows - 1 items then +N more", c, [...many("c", 6).map((i) => `◐ working  ${i.name}`), "+14 more"]);
  check("overflow: +N more is dim", lines.find((l) => plain(l).includes("+14 more")), "       \x1b[2m  +14 more\x1b[0m");
  check("overflow: +N more lines up under the word", plain(lines.find((l) => plain(l).includes("+14 more"))), "         +14 more");
  check("overflow: PIR's N", rowsOf(lines, "PIR").at(-1), "+15 more");
}
{
  // One spare row for PIR: `+N more` alone rather than a cut item.
  const lines = render(initialState("claude"), 59, 5, { claude: many("c", 3), pir: many("p", 3) }).map(plain);
  check("one row for Claude: +3 more alone", lines[1], "         +3 more");
  const l6 = render(initialState("claude"), 59, 6, { claude: many("c", 3), pir: many("p", 3) }).map(plain);
  check("one row each: +3 more under both", [l6[1], l6[4]], ["         +3 more", "         +3 more"]);
}
{
  // The word column is as wide as the longest word among the items drawn.
  const lines = render(initialState("claude"), 59, 22, { claude: [it("run", "working", "a"), it("bad", "crashed!!", "b")], pir: [] });
  check("word column: padded to the longest", [plain(lines[5]), plain(lines[6])],
    ["       ◐ working    a", "       ✗ crashed!!  b"]);
}

// The single-line states.
const single = (list) => plain(render(initialState("claude"), 59, 22, { claude: list, pir: "loading" })[5]);
check("[] → nothing running", single([]), "       nothing running");
check("\"unavailable\" → status unavailable", single("unavailable"), "       status unavailable");
check("{ unavailable: t } → t", single({ unavailable: "status unavailable · pir service not running" }),
  "       status unavailable · pir service not running");
check("\"loading\" → …", single("loading"), "       …");
check("null → status unavailable", single(null), "       status unavailable");
check("a malformed item is skipped", single([{ cls: "run", word: "working" }, it("nope", "x", "y"), null]), "       nothing running");
check("nothing running is dim", render(initialState("claude"), 59, 22, { claude: [] })[5], "       \x1b[2mnothing running\x1b[0m");
check("unavailable is dim", render(initialState("claude"), 59, 22, { claude: "unavailable" })[5], "       \x1b[2mstatus unavailable\x1b[0m");
// Too wide, the text keeps its cause after the last ` · ` (person, 2026-10-09), and only then
// is cut with …; it fits whole at 59 columns, and a text with no ` · ` is simply cut.
check("39x12: a too-wide unavailable text keeps the part after ` · `",
  plain(render(initialState("claude"), 39, 12, { pir: { unavailable: "status unavailable · pir service not running" } })[4]),
  "   pir service not running");
check("25x12: the kept cause is still cut with … when even it does not fit",
  plain(render(initialState("claude"), 25, 12, { pir: { unavailable: "status unavailable · pir service not running" } })[4]),
  "   pir service not runni…");
check("39x12: an unavailable text with no ` · ` is cut with …",
  plain(render(initialState("claude"), 39, 12, { pir: { unavailable: "status unavailable because pir is not running" } })[4]),
  "   status unavailable because pir is n…");
check("39 columns exactly: a text that fits keeps its prefix",
  plain(render(initialState("claude"), 39, 12, { pir: { unavailable: "status unavailable · pir not running" } })[4]),
  "   status unavailable · pir not running");

// Names and words are wire text (claude agents, pir's service): a NEWLINE would paint a second
// terminal line out of one entry and an ESC would run as a control sequence, so each control
// character is drawn as one space, as safeText does for the agenda and the BitBucket pane.
{
  const nasty = { claude: [it("run", "work\x1bing", "a\x1b[2Jb\nc\td\x9b")], pir: { unavailable: "down\r\nnow" } };
  const lines = render(initialState("claude"), 59, 22, nasty);
  check("wire text: no control character survives outside our own styles",
    lines.map((l) => l.replace(/\x1b\[[0-9]+m/g, "")).filter((l) => /[\u0000-\u001f\u007f-\u009f]/.test(l)), []);
  check("wire text: each control character is one space", plain(lines[5]), "       ◐ work ing  a [2Jb c d ");
  check("wire text: the unavailable text too", plain(lines[8]), "       down  now");
}

// --- render: the sweep (every line within cols, exactly rows lines) ----------------
{
  const fixtures = [
    undefined,
    {},
    typical,
    { claude: [], pir: "unavailable" },
    { claude: { unavailable: "status unavailable · pir service not running" }, pir: [] },
    { claude: many("a-very-long-repository-name / an-even-longer-topic-name", 30), pir: many("p", 1) },
    { claude: [it("done", "finished 59m", "x".repeat(200))], pir: [it("wait", "w".repeat(70), "y")] },
  ];
  let bad = [];
  let count = 0;
  for (const f of fixtures) {
    for (const st of [initialState("claude"), initialState("pir")]) {
      for (let c = 30; c <= 80; c++) {
        for (let r = 8; r <= 30; r++) {
          const lines = render(st, c, r, f);
          count++;
          if (lines.length !== r) bad.push(`${c}x${r}: ${lines.length} lines`);
          for (const l of lines) if (vis(l) > c) bad.push(`${c}x${r}: ${plain(l)}`);
          if (lines.some((l) => l.split("\x1b[0m").at(-1).includes("\x1b["))) bad.push(`${c}x${r}: unreset style`);
          const p = lines.map(plain);
          if (!p[r - 1].includes("choose")) bad.push(`${c}x${r}: hint not last`);
          if (!p.some((l) => l.includes("Claude Agents")) || !p.some((l) => l.includes("PIR"))) bad.push(`${c}x${r}: entry lost`);
          if (p.includes("   SWITCH PROGRAM") !== (r >= 18)) bad.push(`${c}x${r}: title rule`);
        }
      }
    }
  }
  check(`sweep 30–80 x 8–30 (${count} frames): every frame holds`, bad.slice(0, 5), []);
}

console.log(`CHECKS ${pass} ${fail}`);
process.exit(fail ? 1 : 0);
