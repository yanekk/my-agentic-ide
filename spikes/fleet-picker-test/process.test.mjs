// The picker process and its wrapper, under a real pseudo-terminal (pty-drive.py). Real key
// bytes go through the real tty into bin/cockpit-fleet-picker.sh; what comes back is the cmd
// file, whether the wrapper is still alive, and the drawn screen. Prints failures in full,
// then one line `CHECKS <pass> <fail>`.
import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const WRAPPER = path.join(ROOT, "bin/cockpit-fleet-picker.sh");
const DRIVER = path.join(HERE, "pty-drive.py");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-picker-test-"));
// Screens go to a scratch folder, never the repo; kept on failure for a look.
const SHOTS = path.join(SCRATCH, "screens");
fs.mkdirSync(SHOTS);

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

const UP = "\x1b[A", DOWN = "\x1b[B", RIGHT = "\x1b[C", LEFT = "\x1b[D";
const READY = ["wait", "SWITCH PROGRAM"];

let n = 0;
function drive(name, shown, cols, rows, steps) {
  const cmd = path.join(SCRATCH, `cmd-${++n}`);
  let out;
  try {
    out = execFileSync("python3", ["-I", DRIVER, WRAPPER, cmd, shown, String(cols), String(rows), JSON.stringify(steps)],
      { encoding: "utf8", timeout: 30000 });
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: the pty driver failed`);
    console.log(String(e.stdout || "") + String(e.stderr || e.message));
    return null;
  }
  const r = JSON.parse(out);
  fs.writeFileSync(path.join(SHOTS, `${n}-${name.replace(/[^a-z0-9]+/gi, "-")}.txt`),
    [...Object.entries(r.snaps).flatMap(([k, v]) => [`--- ${k}`, ...v]), "--- final", ...r.screen].join("\n") + "\n");
  check(`${name}: the driver saw everything it waited for`, r.errors, []);
  check(`${name}: nothing left running after teardown`, r.leftover, []);
  check(`${name}: no line drawn past the right edge`, r.overflow, []);
  return r;
}

function oneVerb(name, r, verb) {
  if (!r) return;
  check(`${name}: exactly one verb, ${verb}`, r.cmd, [verb]);
  check(`${name}: the wrapper is still alive`, r.alive, true);
}

// --- every exit path appends exactly one verb -----------------------------------
// The settle (sleep) after the verb is what proves "exactly one": a late cancel from the
// wrapper would land inside it.
const settle = [["wait-cmd", 1], ["sleep", 0.5]];
for (const [shown, other] of [["claude", "pir"], ["pir", "claude"]]) {
  oneVerb(`${shown} shown, Enter`, drive(`${shown}-enter`, shown, 59, 22, [READY, ["send", "\r"], ...settle]), `fleet-${other}`);
  oneVerb(`${shown} shown, →`, drive(`${shown}-right`, shown, 59, 22, [READY, ["send", RIGHT], ...settle]), `fleet-${other}`);
  oneVerb(`${shown} shown, ↓ Enter`, drive(`${shown}-down-enter`, shown, 59, 22, [READY, ["send", DOWN], ["send", "\r"], ...settle]), `fleet-${shown}`);
  oneVerb(`${shown} shown, ↑ ↓ Enter`, drive(`${shown}-up-down-enter`, shown, 39, 12, [READY, ["send", UP], ["send", DOWN], ["send", "\r"], ...settle]), `fleet-${other}`);
}
// The task doc's end-to-end line, as DESIGN §2.4 reads it: with pir shown the highlight starts
// on Claude Agents, so ↓ moves it onto PIR and → hands back the shown program ("just close").
oneVerb("pir shown, ↓ →", drive("pir-down-right", "pir", 59, 22, [READY, ["send", DOWN], ["send", RIGHT], ...settle]), "fleet-pir");
oneVerb("pir shown, → alone", drive("pir-right-39", "pir", 39, 12, [READY, ["send", RIGHT], ...settle]), "fleet-claude");
oneVerb("Esc", drive("esc", "claude", 59, 22, [READY, ["send", "\x1b"], ...settle]), "picker-cancel");
oneVerb("Ctrl+C", drive("ctrl-c", "claude", 59, 22, [READY, ["send", "\x03"], ...settle]), "picker-cancel");
oneVerb("SS3 ↓ then CR", drive("ss3", "claude", 59, 22, [READY, ["send", "\x1bOB"], ["send", "\r"], ...settle]), "fleet-claude");
oneVerb("fast ↓→ in one read", drive("burst", "claude", 59, 22, [READY, ["send", DOWN + RIGHT], ...settle]), "fleet-claude");

// ← and other keys do nothing; the picker is still up and still answers afterwards.
{
  const r = drive("ignored-keys", "claude", 59, 22, [READY, ["send", LEFT], ["send", "q"], ["send", "x"], ["send", "\x1b[<0;10;5M"],
    ["send", "\x1b[5~"], ["sleep", 0.3], ["snap", "after"]]);
  if (r) {
    check("← q x mouse PgUp: nothing appended", r.cmd, []);
    check("← q x mouse PgUp: the highlight has not moved", r.snaps.after[6], "   ▸ PIR");
    check("← q x mouse PgUp: still drawn", r.snaps.after[1], "   SWITCH PROGRAM");
  }
}

// The bytes WezTerm writes into a pane it is closing (`\n` + Ctrl+D, fleet-picker T04 drill)
// are not an Enter: nothing is appended, and the picker still answers a real key after.
{
  const r = drive("pane-closing", "claude", 59, 22, [READY, ["send", "\n\x04"], ["sleep", 0.5], ["snap", "after"],
    ["send", DOWN], ["send", RIGHT], ...settle]);
  if (r) {
    check("pane-closing bytes: still drawn, PIR still highlighted", r.snaps.after[6], "   ▸ PIR");
    // ↓ first, so a `\n` taken for Enter (fleet-pir) and the picker still answering differ.
    check("pane-closing bytes: no choice, then ↓ → answers", r.cmd, ["fleet-claude"]);
  }
}

// A kill is not an answer: node dies, the wrapper appends the cancel and stays up.
oneVerb("SIGTERM to node", drive("sigterm", "claude", 59, 22, [READY, ["term-node"], ...settle]), "picker-cancel");
// A missing shown program is a crash of the picker's own; the wrapper still answers.
oneVerb("bad argument", drive("bad-arg", "nope", 59, 22, [["sleep", 0.5], ...settle]), "picker-cancel");

// Input that ends is not an answer either. Without a handler the event loop empties and node
// exits 0 having appended nothing, so the wrapper appends nothing and the daemon waits on a
// picker that has gone. No pty here: stdin is /dev/null, so the read ends at once.
{
  const cmd = path.join(SCRATCH, "cmd-eof");
  let status = 0;
  try {
    execFileSync("node", [path.join(ROOT, "bin/cockpit-fleet-picker.mjs"), cmd, "claude"],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 5000 });
  } catch (e) { status = e.status; }
  const lines = fs.existsSync(cmd) ? fs.readFileSync(cmd, "utf8").split("\n").filter(Boolean) : [];
  check("stdin at EOF: exactly one verb, picker-cancel", lines, ["picker-cancel"]);
  check("stdin at EOF: a clean exit, so the wrapper adds none", status, 0);
}

// --- the frame, drawn through the real tty, at the slot sizes --------------------
{
  const r = drive("frame-59", "claude", 59, 22, [READY, ["snap", "a"], ["send", DOWN], ["snap", "b"]]);
  if (r) {
    check("59x22: the §2.3 frame", r.snaps.a, [
      "", "   SWITCH PROGRAM", "   " + "─".repeat(40), "",
      "     Claude Agents             shown now", "", "   ▸ PIR",
      ...Array(14).fill(""), "   ↑↓ choose · enter or → open · esc back",
    ]);
    check("59x22: ↓ redraws with ▸ on Claude Agents", [r.snaps.b[4], r.snaps.b[6]],
      ["   ▸ Claude Agents             shown now", "     PIR"]);
  }
}
{
  const r = drive("frame-39", "pir", 39, 12, [READY, ["snap", "a"]]);
  if (r) {
    check("39x12: the whole frame, nothing cut", r.snaps.a, [
      "", "   SWITCH PROGRAM", "   " + "─".repeat(36), "",
      "   ▸ Claude Agents", "", "     PIR" + " ".repeat(22) + "shown now",
      "", "", "", "", "↑↓ choose · enter or → open · esc back",
    ]);
  }
}

// --- a resize redraws at the new size ---------------------------------------------
{
  const r = drive("resize", "pir", 59, 22, [READY, ["resize", 39, 12], ["wait", "SWITCH PROGRAM"], ["snap", "small"],
    ["resize", 20, 6], ["wait", "SWITCH"], ["snap", "tiny"], ["resize", 120, 40], ["wait", "SWITCH PROGRAM"], ["snap", "big"],
    ["send", RIGHT], ...settle]);
  if (r) {
    check("resize to 39x12: redrawn with the shortened rule", r.snaps.small[2], "   " + "─".repeat(36));
    check("resize to 39x12: hint on the last row", r.snaps.small[11], "↑↓ choose · enter or → open · esc back");
    check("resize to 39x12: shown now intact", r.snaps.small[6], "     PIR" + " ".repeat(22) + "shown now");
    check("resize to 20x6: six rows, hint last", r.snaps.tiny.length === 6 && r.snaps.tiny[5].startsWith("↑↓"), true);
    check("resize to 120x40: hint on row 40", r.snaps.big[39], "   ↑↓ choose · enter or → open · esc back");
    check("resize to 120x40: full rule", r.snaps.big[2], "   " + "─".repeat(40));
    check("after the resizes the picker still answers", r.cmd, ["fleet-claude"]);
    check("after the resizes the wrapper is alive", r.alive, true);
  }
}

if (fail === 0) fs.rmSync(SCRATCH, { recursive: true, force: true });
else console.log(`  screens kept in ${SHOTS}`);
console.log(`CHECKS ${pass} ${fail}`);
process.exit(fail ? 1 : 0);
