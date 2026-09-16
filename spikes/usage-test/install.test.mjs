// cockpit-usage-tap --install / --uninstall: registering the tap as the statusLine
// in ~/.claude/settings.json (DESIGN 2.6, 2.7, 6). This file is the user's, not
// ours -- their model, their plugins, their own hooks -- and a settings.json that
// fails to parse silently disables EVERY setting in it. So, exactly as the
// auto-name hook's install test, the bar is not "our entry appears" but "nothing
// else moved", and a malformed file is refused rather than overwritten.
//
// A statusLine differs from the UserPromptSubmit hook in one way: it is a SINGLE
// object, not a list, and a foreign one is preserved by RECORDING it in
// statusline-prev (so the tap can chain it and --uninstall can restore it), not by
// keeping it alongside ours. Everything below is driven through the real script as a
// subprocess, so the tests exercise the same code path bin/install.sh runs.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const TAP = join(ROOT, "bin", "cockpit-usage-tap.mjs");
const T = mkdtempSync(join(process.env.COCKPIT_DIR || tmpdir(), "usage-install-"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); if (detail) console.log(`       got [${detail}]`); }
};

let seq = 0;
// Each case gets its own settings file and its own cockpit dir, so statusline-prev
// from one case never leaks into another.
function caseDirs(contents) {
  const n = ++seq;
  const settings = join(T, `settings${n}.json`);
  const dir = join(T, `cockpit${n}`);
  if (contents !== undefined) writeFileSync(settings, contents);
  return { settings, dir };
}

const OURS = "/repo/bin/cockpit-usage-tap.mjs";

// Run the script; returns { out, code }, never throws, so a refusal is assertable.
function run(args) {
  try {
    return { out: execFileSync("node", [TAP, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}
const doInstall = ({ settings, dir }, { command = OURS, check = false } = {}) =>
  run([check ? "--check" : "--install", "--settings", settings, "--dir", dir, "--command", command]);
const doUninstall = ({ settings, dir }) => run(["--uninstall", "--settings", settings, "--dir", dir]);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

console.log("== install / uninstall ==");

{ // 1. A machine with no settings.json at all gains our statusLine.
  const c = caseDirs();
  const r = doInstall(c);
  ok("creates settings.json when there is none", r.code === 0 && existsSync(c.settings));
  const s = read(c.settings);
  ok("...with our statusLine object", s.statusLine?.type === "command" && s.statusLine?.command === OURS,
     JSON.stringify(s.statusLine));
  ok("...reported as registered", r.out.includes("registered"), r.out.trim());
}

{ // 1b. A clean settings.json keeps every other key, and its hooks.
  const c = caseDirs(JSON.stringify({
    model: "opus[1m]",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff", async: true }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "/repo/bin/cockpit-auto-name.mjs", timeout: 20 }] }],
    },
    enabledPlugins: { "revdiff@revdiff": true },
    tui: "fullscreen",
  }, null, 2));
  doInstall(c);
  const s = read(c.settings);
  ok("every other top-level setting survives",
     s.model === "opus[1m]" && s.tui === "fullscreen" && s.enabledPlugins["revdiff@revdiff"] === true);
  ok("the Stop sound hook survives the merge",
     s.hooks.Stop[0].hooks[0].command === "afplay /System/Library/Sounds/Glass.aiff");
  ok("the auto-name UserPromptSubmit hook survives the merge",
     s.hooks.UserPromptSubmit[0].hooks[0].command === "/repo/bin/cockpit-auto-name.mjs");
  ok("...and our statusLine is added alongside", s.statusLine?.command === OURS);
}

{ // 2. A second install re-points a moved checkout; never duplicates or nests.
  const c = caseDirs(JSON.stringify({}, null, 2));
  doInstall(c, { command: "/old/place/bin/cockpit-usage-tap.mjs" });
  const r = doInstall(c, { command: "/new/place/bin/cockpit-usage-tap.mjs" });
  const s = read(c.settings);
  ok("a moved checkout is re-pointed", r.out.includes("re-pointed"), r.out.trim());
  ok("...leaving exactly our new command, a single object not a list",
     !Array.isArray(s.statusLine) && s.statusLine.command === "/new/place/bin/cockpit-usage-tap.mjs",
     JSON.stringify(s.statusLine));
}

{ // 2b. Re-running with the same command changes nothing.
  const c = caseDirs(JSON.stringify({ model: "opus" }, null, 2));
  doInstall(c);
  const first = readFileSync(c.settings, "utf8");
  const again = doInstall(c);
  ok("a same-command re-run says already registered", again.out.includes("already registered"), again.out.trim());
  ok("...and does not touch a byte of the file", readFileSync(c.settings, "utf8") === first);
}

{ // 3. A foreign statusLine is recorded and replaced; --uninstall restores it exactly.
  const foreign = { type: "command", command: "/usr/local/bin/my-statusline --fancy", padding: 0 };
  const c = caseDirs(JSON.stringify({ model: "opus", statusLine: foreign }, null, 2));
  const ins = doInstall(c);
  ok("a foreign statusLine install reports the recording", ins.out.includes("recorded"), ins.out.trim());
  const s = read(c.settings);
  ok("...ours replaces the foreign one", s.statusLine.command === OURS);
  ok("...the model key is still intact", s.model === "opus");
  ok("...and the foreign one is recorded in statusline-prev",
     existsSync(join(c.dir, "statusline-prev")) &&
     read(join(c.dir, "statusline-prev")).command === "/usr/local/bin/my-statusline --fancy");

  const un = doUninstall(c);
  ok("--uninstall reports the restore", un.out.includes("restored"), un.out.trim());
  const back = read(c.settings);
  ok("...restoring the foreign statusLine exactly, padding and all",
     JSON.stringify(back.statusLine) === JSON.stringify(foreign), JSON.stringify(back.statusLine));
  ok("...consuming statusline-prev so a second uninstall is a no-op",
     !existsSync(join(c.dir, "statusline-prev")));
  ok("...and leaving the model key untouched", back.model === "opus");
}

{ // 4. With no foreign statusLine, --uninstall removes the key entirely.
  const c = caseDirs(JSON.stringify({ model: "opus" }, null, 2));
  doInstall(c);
  ok("ours is present before uninstall", read(c.settings).statusLine?.command === OURS);
  const un = doUninstall(c);
  ok("--uninstall with no prior removes the key", un.out.includes("removed"), un.out.trim());
  const s = read(c.settings);
  ok("...statusLine is gone", !("statusLine" in s));
  ok("...but every other key stays", s.model === "opus");
  // A second uninstall is a clean no-op.
  const again = doUninstall(c);
  ok("a second uninstall is a no-op", again.out.includes("not registered"), again.out.trim());
}

{ // 4b. --uninstall never touches a statusLine that is not ours.
  const foreign = { type: "command", command: "/opt/theirs" };
  const c = caseDirs(JSON.stringify({ statusLine: foreign }, null, 2));
  const un = doUninstall(c);
  ok("uninstall leaves a foreign statusLine alone", un.out.includes("not registered"), un.out.trim());
  ok("...the foreign statusLine is exactly as it was",
     JSON.stringify(read(c.settings).statusLine) === JSON.stringify(foreign));
}

{ // 5. A malformed settings.json is refused, not overwritten.
  const broken = '{ "model": "opus", oops }';
  const c = caseDirs(broken);
  const r = doInstall(c);
  ok("a malformed settings.json is refused (non-zero exit)", r.code !== 0);
  ok("...and left exactly as it was", readFileSync(c.settings, "utf8") === broken);
  // Uninstall must refuse it too, not clobber it.
  const u = doUninstall(c);
  ok("uninstall also refuses a malformed file", u.code !== 0 && readFileSync(c.settings, "utf8") === broken);
}

{ // 6. --check reports the future tense and writes nothing (what install.sh runs first).
  const c = caseDirs(JSON.stringify({ model: "opus" }, null, 2));
  const before = readFileSync(c.settings, "utf8");
  const r = doInstall(c, { check: true });
  ok("--check says what it would do, in the future tense",
     r.code === 0 && r.out.includes("will register"), r.out.trim());
  ok("...and writes nothing", readFileSync(c.settings, "utf8") === before);
}

{ // 7. Atomic write, no temp left behind, editable, permissions preserved.
  const c = caseDirs(JSON.stringify({ model: "opus" }, null, 2));
  chmodSync(c.settings, 0o600);              // a user who locked their settings down
  doInstall(c);
  const raw = readFileSync(c.settings, "utf8");
  ok("the file is written indented and newline-terminated",
     raw.includes('\n  "statusLine"') && raw.endsWith("\n"));
  ok("...no temp file is left behind", !existsSync(`${c.settings}.tmp`));
  ok("...and the 0600 permissions are preserved", (statSync(c.settings).mode & 0o777) === 0o600,
     (statSync(c.settings).mode & 0o777).toString(8));
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
