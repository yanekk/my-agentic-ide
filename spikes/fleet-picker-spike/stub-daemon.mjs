// A stand-in for what fleet-picker T03 will do on the `picker` verb, and nothing else
// (fleet-picker T00). It reads verbs from a cmd file either the way cockpitd does
// today (a 200ms stat poll, cockpitd.mjs tail()) or with an fs.watch on the cmd
// file's directory, and on `picker` splits a picker pane into the slot, parks the
// slot pane and activates the picker -- the pir-pane swap. `close` undoes it.
//
//   node stub-daemon.mjs <cfg> <sock> <cmd> <slotPane> poll|watch <picker.mjs> <outDir>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [cfg, sock, cmd, slotArg, mode, picker, out] = process.argv.slice(2);
const slot = Number(slotArg);
const now = () => performance.timeOrigin + performance.now();
const wez = (args) => {
  const r = spawnSync("wezterm", ["--config-file", cfg, "cli", "--no-auto-start", ...args],
    { encoding: "utf8", env: { ...process.env, WEZTERM_UNIX_SOCKET: sock } });
  if (r.status !== 0) { console.error(`stub: wezterm ${args.join(" ")}: ${r.stderr.trim()}`); return null; }
  return r.stdout;
};

let n = 0, pickerPane = null;
function onLine(line) {
  if (line === "picker") {
    n += 1;
    const marks = { verbSeen: now() };
    const id = Number.parseInt((wez(["split-pane", "--left", "--percent", "50", "--pane-id", String(slot),
      "--", process.execPath, picker, out, String(n)]) ?? "").trim(), 10);
    marks.split = now();
    fs.writeFileSync(path.join(out, `pane-${n}`), String(id));
    wez(["move-pane-to-new-tab", "--pane-id", String(slot)]);
    marks.parked = now();
    wez(["activate-pane", "--pane-id", String(id)]);
    marks.activated = now();
    pickerPane = id;
    fs.writeFileSync(path.join(out, `marks-${n}.json`), JSON.stringify(marks));
  } else if (line === "close" && pickerPane !== null) {
    wez(["split-pane", "--left", "--percent", "50", "--pane-id", String(pickerPane), "--move-pane-id", String(slot)]);
    wez(["kill-pane", "--pane-id", String(pickerPane)]);
    pickerPane = null;
    fs.writeFileSync(path.join(out, `closed-${n}`), "");
  }
}

// cockpitd's tail(), verbatim in shape: stat, read what is new, split lines.
let pos = fs.statSync(cmd).size, buf = "";
function read() {
  const st = fs.statSync(cmd);
  if (st.size <= pos) return;
  const fd = fs.openSync(cmd, "r");
  const b = Buffer.alloc(st.size - pos);
  fs.readSync(fd, b, 0, b.length, pos);
  fs.closeSync(fd);
  pos = st.size;
  buf += b.toString("utf8");
  const ls = buf.split("\n");
  buf = ls.pop();
  for (const l of ls) onLine(l);
}
if (mode === "watch") fs.watch(path.dirname(cmd), () => read());
else setInterval(read, 200);
fs.writeFileSync(path.join(out, "ready"), "");
process.on("SIGTERM", () => process.exit(0));
