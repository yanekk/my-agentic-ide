// The `config` command and the key store behind it. The pure store functions
// (readApiKey, maskedStatus) are imported and driven directly; the command's
// behaviour -- masking on the read path, a non-zero exit for an unknown setting,
// the file it leaves on disk -- is exercised by spawning the real script, since
// those are what an agent inheriting the cockpit PATH would actually run.
//
// Every case runs against its OWN throwaway dir, so one can never see another's
// key, and none touches the real ~/.claude/cockpit.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { readApiKey, maskedStatus } from "../../bin/cockpit-config.mjs";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const CMD = join(ROOT, "bin", "cockpit-config.mjs");
const T = mkdtempSync(join(process.env.COCKPIT_DIR || tmpdir(), "config-"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); if (detail) console.log(`       got [${detail}]`); }
};

let seq = 0;
const freshDir = () => {
  const d = join(T, `d${++seq}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// Run the command against a given dir. Returns { out, code }; never throws, so a
// refusal (non-zero exit) is assertable rather than an exception.
function config(dir, args) {
  try {
    const out = execFileSync("node", [CMD, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, COCKPIT_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

console.log("== the key store ==");

// A realistic-length key so masking reveals exactly its last four.
const KEY = "sk-ant-api03-EXAMPLEEXAMPLEEXAMPLE1234";
{
  const d = freshDir();
  config(d, ["anthropic-api-key", KEY]);
  const p = join(d, "anthropic-api-key");

  ok("set writes the file with the exact bytes", readFileSync(p, "utf8") === KEY,
     JSON.stringify(readFileSync(p, "utf8")));
  ok("...at mode 0600", (statSync(p).mode & 0o777) === 0o600,
     (statSync(p).mode & 0o777).toString(8));
  ok("...and leaves no temp file behind (the rename was atomic)", !existsSync(`${p}.tmp`));

  ok("readApiKey returns the key when set", readApiKey(d) === KEY, readApiKey(d));
}

{
  const d = freshDir();
  ok("readApiKey is null when the file is absent", readApiKey(d) === null, String(readApiKey(d)));
  ok("...and maskedStatus is 'not set'", maskedStatus(d) === "not set", maskedStatus(d));
}

{
  // An empty (or whitespace-only) file reads as no key -- the feature is off, not
  // holding a blank secret.
  const d = freshDir();
  config(d, ["anthropic-api-key", ""]);          // writes an empty file
  ok("an empty key file reads as null", readApiKey(d) === null, String(readApiKey(d)));
}

console.log("== masking never leaks the key ==");
{
  const d = freshDir();
  config(d, ["anthropic-api-key", KEY]);
  const status = maskedStatus(d);
  ok("maskedStatus shows only the last four", status === "set · …1234", status);
  ok("...and never the whole key", !status.includes(KEY));
}

// The property that matters: for ANY key length, the masked status must not
// contain the full key -- including keys shorter than the four we would reveal.
for (const key of ["a", "ab", "abcd", "abcde", "0123456789"]) {
  const d = freshDir();
  config(d, ["anthropic-api-key", key]);
  const status = maskedStatus(d);
  ok(`maskedStatus never contains the full key (len ${key.length})`,
     !status.includes(key), `${status} <- ${key}`);
}

console.log("== the command ==");
{
  const d = freshDir();

  // A bare read on an unset key.
  ok("bare read is 'not set' when unset", config(d, ["anthropic-api-key"]).out.trim() === "not set");

  // Round-trip: set, then a bare read shows a masked status, never the key.
  config(d, ["anthropic-api-key", KEY]);
  const readOut = config(d, ["anthropic-api-key"]).out;
  ok("bare read after set shows the masked status", readOut.trim() === "set · …1234", readOut.trim());
  ok("...and the command's read path never prints the key", !readOut.includes(KEY));

  // The bare `config` list mentions the setting and its masked status.
  const listOut = config(d, []).out;
  ok("bare `config` lists the setting", listOut.includes("anthropic-api-key"));
  ok("...with its masked status, not the key", listOut.includes("set · …1234") && !listOut.includes(KEY));
}

{
  // --unset removes the file and returns naming to today's behaviour.
  const d = freshDir();
  config(d, ["anthropic-api-key", KEY]);
  const r = config(d, ["anthropic-api-key", "--unset"]);
  ok("--unset exits 0", r.code === 0, String(r.code));
  ok("...removes the file", !existsSync(join(d, "anthropic-api-key")));
  ok("...so a following read is null", readApiKey(d) === null, String(readApiKey(d)));
  ok("...and the command reports 'not set'", config(d, ["anthropic-api-key"]).out.trim() === "not set");
}

{
  // An unknown setting is a clean non-zero exit that names what it did not know,
  // not a stack trace.
  const d = freshDir();
  const r = config(d, ["no-such-setting"]);
  ok("unknown setting exits non-zero", r.code !== 0, String(r.code));
  ok("...and names the setting", r.out.includes("no-such-setting"), r.out.trim());
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
