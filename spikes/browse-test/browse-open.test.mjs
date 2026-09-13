// The double-click shim: WHICH files it hands to cockpit-open, and which it leaves
// alone. broot's double-click calls the system `open`; the cockpit puts its own
// `open` (cockpit-browse-open.mjs) on broot's PATH to reroute a text file into the
// viewer and do nothing for the rest (the user's ruling, 2026-09-13).
//
// Like open.test.mjs next door, the world-touching command runs as a real
// subprocess against a STUB -- here a stub `cockpit-open` on PATH that records the
// argv it is handed (and can be told to fail). What is asserted is therefore the
// actual call the shim would make, and on every no-op path that there is none.
//
// The one thing this cannot show is that broot's opener really finds this shim on a
// double-click: that is broot's own PATH lookup, checked with a person at the
// screen (the hands-on step in the report).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { section, ok, eq, done } from "./harness.mjs";
import { looksBinary } from "../../bin/cockpit-open-model.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHIM = path.join(ROOT, "bin", "cockpit-browse-open.mjs");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "browse-open-shim-"));
process.on("exit", () => { try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* gone */ } });

// --- a stub cockpit-open on PATH -------------------------------------------
// Extensionless with a node shebang (CommonJS, no manifest), the same trick the
// wezterm stub uses. Records every argv it is handed; OPEN_FAIL makes it exit 1 so
// the shim's "stay silent even on failure" rule can be checked.
const STUB_BIN = path.join(WORK, "bin");
fs.mkdirSync(STUB_BIN, { recursive: true });
const CALLS = path.join(WORK, "calls.log");
fs.writeFileSync(path.join(STUB_BIN, "cockpit-open"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.OPEN_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.OPEN_FAIL) process.exit(1);
`);
fs.chmodSync(path.join(STUB_BIN, "cockpit-open"), 0o755);

// --- fixtures ---------------------------------------------------------------
const TEXT = path.join(WORK, "hello.js");
fs.writeFileSync(TEXT, "const x = 1;\nconsole.log(x);\n");
const BINARY = path.join(WORK, "logo.png");
fs.writeFileSync(BINARY, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
const SUBDIR = path.join(WORK, "src");
fs.mkdirSync(SUBDIR, { recursive: true });

// --- driving the shim -------------------------------------------------------
function run(arg, { fail = false } = {}) {
  fs.writeFileSync(CALLS, "");
  const env = {
    ...process.env,
    PATH: `${STUB_BIN}:${process.env.PATH || ""}`,
    OPEN_CALLS: CALLS,
  };
  if (fail) env.OPEN_FAIL = "1";
  // argv is [file] or, for the no-arg case, nothing. cwd is WORK so a bare
  // relative path resolves the way broot's opener (which shares broot's cwd) would.
  const args = arg === undefined ? [SHIM] : [SHIM, arg];
  const r = spawnSync(process.execPath, args, { env, cwd: WORK, encoding: "utf8" });
  const calls = fs.readFileSync(CALLS, "utf8").trim();
  return {
    status: r.status,
    calls: calls === "" ? [] : calls.split("\n").map((l) => JSON.parse(l)),
  };
}

// === the pure classifier ====================================================
section("1. looksBinary");
ok("plain text is not binary", !looksBinary(Buffer.from("hello\nworld\n")));
ok("empty is not binary", !looksBinary(Buffer.from([])));
ok("undefined is not binary (never throws)", !looksBinary(undefined));
ok("a NUL byte anywhere makes it binary", looksBinary(Buffer.from([0x61, 0x00, 0x62])));
ok("UTF-8 with accents is text", !looksBinary(Buffer.from("café — naïve\n", "utf8")));
// Only the first 8000 bytes are sampled: a NUL past that is not seen, which is the
// documented limit, asserted so a change to it is a deliberate one.
const late = Buffer.alloc(9000, 0x41); late[8500] = 0x00;
ok("a NUL past the 8000-byte sample is not seen", !looksBinary(late));
const early = Buffer.alloc(9000, 0x41); early[10] = 0x00;
ok("a NUL inside the sample is seen", looksBinary(early));

// === the shim's routing =====================================================
section("2. a text file goes to cockpit-open");
{
  const r = run(TEXT);
  eq("cockpit-open called once, with the file and line 0", r.calls, [[TEXT, "0"]]);
  eq("exit 0", r.status, 0);
}

section("3. the path is resolved to absolute");
{
  // broot passes absolute, but a relative arg must still reach cockpit-open
  // absolute -- cockpit-open resolves from its OWN cwd, not the shim's. macOS
  // resolves a child's cwd through symlinks (/var -> /private/var), so the absolute
  // form carries that; cockpit-open realpaths either way, so it does not matter
  // functionally -- only that it is absolute and points at the file.
  const r = run("hello.js"); // cwd is WORK
  const wantAbs = path.join(fs.realpathSync(WORK), "hello.js");
  eq("relative arg arrives absolute", r.calls, [[wantAbs, "0"]]);
}

section("4. a non-text file is ignored");
{
  const r = run(BINARY);
  eq("cockpit-open not called", r.calls, []);
  eq("exit 0", r.status, 0);
}

section("5. a directory is ignored");
{
  const r = run(SUBDIR);
  eq("cockpit-open not called", r.calls, []);
  eq("exit 0", r.status, 0);
}

section("6. a missing file is ignored, silently");
{
  const r = run(path.join(WORK, "gone.txt"));
  eq("cockpit-open not called", r.calls, []);
  eq("exit 0", r.status, 0);
}

section("7. no argument does nothing");
{
  const r = run(undefined);
  eq("cockpit-open not called", r.calls, []);
  eq("exit 0", r.status, 0);
}

section("8. a cockpit-open failure stays silent");
{
  // broot's opener draws an error line on a non-zero exit; the Enter verb is silent
  // on the same failure, so the shim must swallow it and still exit 0.
  const r = run(TEXT, { fail: true });
  eq("cockpit-open was still attempted", r.calls, [[TEXT, "0"]]);
  eq("but the shim exits 0 regardless", r.status, 0);
}

done();
