// fleet-picker T00: a stand-in fleet list for gui.lua's left pane. Its box draws Claude's
// placeholder line when empty and the typed text otherwise; ← and → move a real cursor
// through the text, so a forwarded ← is visible. Every read is logged, byte for byte,
// to <dir>/standin.log, so the encoding SendKey delivered can be checked afterwards.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const log = path.join(dir, "standin.log");
const MARKER = "❯ describe a task for a new session";
let text = "", cur = 0, arrows = 0, last = "-";
const picks = () => { try { return fs.readFileSync(path.join(dir, "picker"), "utf8").split("\n").length - 1; } catch { return 0; } };

function draw() {
  const box = text === "" ? MARKER : `❯ ${text}`;
  process.stdout.write("\x1b[2J\x1b[H" +
    "STAND-IN FLEET LIST (left pane)\r\n\r\n" +
    `  arrows received here: ${arrows}   last bytes: ${last}\r\n` +
    `  picker verbs written: ${picks()}\r\n\r\n` +
    "  empty box + ← : the picker verb count goes up\r\n" +
    "  text in box + ← : the cursor moves left\r\n\r\n" + box +
    `\x1b[${9};${text === "" ? 1 : 3 + cur}H`);
}

process.stdin.setRawMode(true);
process.stdin.on("data", (b) => {
  const s = b.toString("latin1");
  fs.appendFileSync(log, `${Date.now()} ${[...b].map((x) => x.toString(16).padStart(2, "0")).join(" ")}\n`);
  last = JSON.stringify(s).slice(1, -1);
  // A held key can deliver several sequences in one read: walk them all.
  for (let i = 0; i < s.length;) {
    const m = /^\x1b(?:\[|O)([CD])/.exec(s.slice(i));
    if (m) {
      arrows += 1;
      cur = m[1] === "D" ? Math.max(0, cur - 1) : Math.min(text.length, cur + 1);
      i += m[0].length;
    } else if (s[i] === "\x03") { process.exit(0); }
    else if (s[i] === "\x7f") { if (cur > 0) { text = text.slice(0, cur - 1) + text.slice(cur); cur -= 1; } i += 1; }
    else if (s[i] >= " " && s[i] !== "\x7f") { text = text.slice(0, cur) + s[i] + text.slice(cur); cur += 1; i += 1; }
    else i += 1;
  }
  draw();
});
fs.watchFile(path.join(dir, "picker"), { interval: 100 }, draw);
process.stdout.on("resize", draw);
draw();
