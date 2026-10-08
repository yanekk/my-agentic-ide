// A stand-in picker (fleet-picker T00): draws one frame, notes when, then idles.
import fs from "node:fs";
import path from "node:path";
const [out, n] = process.argv.slice(2);
process.stdout.write("\x1b[2J\x1b[H\n   SWITCH PROGRAM\n   ──────────────\n\n     Claude Agents   shown now\n\n   ▸ PIR\n");
fs.writeFileSync(path.join(out, `frame-${n}`), String(performance.timeOrigin + performance.now()));
setInterval(() => {}, 1 << 30);
