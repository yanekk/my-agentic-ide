// Registering the hook in settings.json. This file is the user's, not ours: it
// holds their model, their plugins and their own hooks, and a settings.json that
// fails to parse silently disables EVERY setting in it. So the bar here is not
// "our entry appears" but "nothing else moved".

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const HOOK = join(ROOT, "bin", "cockpit-auto-name.mjs");
const T = mkdtempSync(join(process.env.COCKPIT_DIR || tmpdir(), "install-"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); if (detail) console.log(`       got [${detail}]`); }
};

let seq = 0;
function settingsFile(contents) {
  const p = join(T, `settings${++seq}.json`);
  if (contents !== undefined) writeFileSync(p, contents);
  return p;
}

// Returns { out, code }; never throws, so a refusal is assertable.
function install(settingsPath, { command = "/repo/bin/cockpit-auto-name.mjs", check = false } = {}) {
  const args = [HOOK, check ? "--check" : "--install", "--settings", settingsPath, "--command", command];
  try {
    return { out: execFileSync("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const ourCommands = (s) => (s.hooks?.UserPromptSubmit ?? [])
  .flatMap((g) => g.hooks ?? [])
  .filter((h) => String(h.command).endsWith("cockpit-auto-name.mjs"))
  .map((h) => h.command);

console.log("== install ==");

{ // A machine with no settings.json at all.
  const p = settingsFile();
  const r = install(p);
  ok("creates settings.json when there is none", r.code === 0 && existsSync(p));
  ok("...with exactly our hook in it", JSON.stringify(ourCommands(read(p))) === '["/repo/bin/cockpit-auto-name.mjs"]');
}

{ // The real shape: other settings, and a hook of their own on another event.
  const p = settingsFile(JSON.stringify({
    model: "opus[1m]",
    hooks: { Stop: [{ hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff", async: true }] }] },
    enabledPlugins: { "revdiff@revdiff": true },
    tui: "fullscreen",
  }, null, 2));
  install(p);
  const s = read(p);
  ok("every other top-level setting survives",
     s.model === "opus[1m]" && s.tui === "fullscreen" && s.enabledPlugins["revdiff@revdiff"] === true);
  ok("...and so does a hook on another event",
     s.hooks.Stop[0].hooks[0].command === "afplay /System/Library/Sounds/Glass.aiff");
  ok("...while ours is added", ourCommands(s).length === 1);
}

{ // Re-running the installer is the normal case, not the exception.
  const p = settingsFile(JSON.stringify({ model: "opus" }, null, 2));
  install(p);
  const first = readFileSync(p, "utf8");
  const again = install(p);
  ok("a second run reports it is already registered", again.out.includes("already registered"), again.out.trim());
  ok("...and does not touch a byte of the file", readFileSync(p, "utf8") === first);
}

{ // A checkout that moved, or was cloned under another name.
  const p = settingsFile(JSON.stringify({}, null, 2));
  install(p, { command: "/old/place/bin/cockpit-auto-name.mjs" });
  const r = install(p, { command: "/new/place/bin/cockpit-auto-name.mjs" });
  const cmds = ourCommands(read(p));
  ok("a moved checkout is re-pointed", r.out.includes("re-pointed"), r.out.trim());
  ok("...leaving exactly one registration, not two",
     cmds.length === 1 && cmds[0] === "/new/place/bin/cockpit-auto-name.mjs", JSON.stringify(cmds));
}

{ // Somebody else's UserPromptSubmit hook must not be collateral damage.
  const theirs = { type: "command", command: "/usr/local/bin/log-my-prompts" };
  const p = settingsFile(JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [theirs] }] } }, null, 2));
  install(p);
  const all = (read(p).hooks.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);
  ok("another UserPromptSubmit hook is kept", all.includes("/usr/local/bin/log-my-prompts"));
  ok("...alongside ours", all.filter((c) => c.endsWith("cockpit-auto-name.mjs")).length === 1);
  // And re-pointing ours later must still not disturb theirs.
  install(p, { command: "/moved/bin/cockpit-auto-name.mjs" });
  const after = (read(p).hooks.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);
  ok("...and survives a re-point", after.includes("/usr/local/bin/log-my-prompts") && after.length === 2,
     JSON.stringify(after));
}

{ // Refusing beats guessing: overwriting a broken file would trade one dead
  // feature for all of them.
  const broken = '{ "model": "opus", oops }';
  const p = settingsFile(broken);
  const r = install(p);
  ok("a malformed settings.json is refused", r.code !== 0);
  ok("...and left exactly as it was", readFileSync(p, "utf8") === broken);
}

{ // --check is what bin/install.sh reports with before it writes anything.
  const p = settingsFile(JSON.stringify({ model: "opus" }, null, 2));
  const before = readFileSync(p, "utf8");
  const r = install(p, { check: true });
  ok("--check says what it would do, in the future tense",
     r.code === 0 && r.out.includes("will register"), r.out.trim());
  ok("...and writes nothing", readFileSync(p, "utf8") === before);
}

{ // The file stays something a person can open and edit.
  const p = settingsFile();
  install(p);
  const raw = readFileSync(p, "utf8");
  ok("the file is written indented, and newline-terminated",
     raw.includes('\n  "hooks"') && raw.endsWith("\n"));
  ok("...and no temp file is left behind", !existsSync(`${p}.tmp`));
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
