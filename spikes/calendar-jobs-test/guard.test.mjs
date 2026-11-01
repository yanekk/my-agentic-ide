// The write guard (calendar-agent-sandbox DESIGN 2.3, 3.3): the rule directly, then
// the hook spawned with real stdin against real files and symlinks.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { section, ok, eq, done } from "../agenda-test/harness.mjs";
import { guardVerdict } from "../../bin/cockpit-guard-model.mjs";

const v = (resolvedPath, toolName = "Write", root = "/a/wt") => guardVerdict({ root, resolvedPath, toolName }).allow;

section("guardVerdict directly");
{
  ok("the root itself", v("/a/wt"));
  ok("a file inside", v("/a/wt/src/x.js"));
  ok("a sibling sharing the prefix refused", !v("/a/wt2/x"));
  ok("the parent refused", !v("/a"));
  ok(".claude/other allowed", v("/a/wt/.claude/other"));
  ok(".gitignore allowed", v("/a/wt/.gitignore"));
  ok("a file named like a setting elsewhere allowed", v("/a/wt/src/settings.json"));
  ok("empty path refused", !v(""));
  ok("undefined path refused", !v(undefined));
  ok("relative path refused", !v("wt/x"));
  ok("unresolved .. refused", !v("/a/wt/../b"));
  ok("empty root refused", !v("/a/wt/x", "Write", ""));
  ok("root / refused", !v("/x", "Write", "/"));
  ok(".git/hooks/x refused", !v("/a/wt/.git/hooks/x"));
  ok(".git itself refused", !v("/a/wt/.git"));
  ok(".GIT refused, the disk ignores case", !v("/a/wt/.GIT/config"));
  ok("a nested .git refused", !v("/a/wt/sub/.git/config"));
  ok(".claude/settings.json refused", !v("/a/wt/.claude/settings.json"));
  ok(".claude/settings.local.json refused", !v("/a/wt/.claude/settings.local.json"));
  ok(".CLAUDE/SETTINGS.JSON refused", !v("/a/wt/.CLAUDE/SETTINGS.JSON"));
  ok(".claude/\u017Fettings.json refused, the disk folds \u017F to s", !v("/a/wt/.claude/\u017Fettings.json"));
  for (const t of ["Write", "Edit", "NotebookEdit"]) ok(`${t} known`, v("/a/wt/x", t));
  for (const t of ["Bash", "MultiEdit", "", undefined, "constructor"]) ok(`${t} refused`, !guardVerdict({ root: "/a/wt", resolvedPath: "/a/wt/x", toolName: t }).allow);
  const refused = guardVerdict({ root: "/a/wt", resolvedPath: "/secret/name", toolName: "Write" });
  ok("a reason names the rule, not the path", refused.reason.includes("outside") && !refused.reason.includes("secret"));
}

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "cockpit-jobs-guard.mjs");
// tmpdir() is itself behind a link on macOS; realpath it except where a test wants the link.
const raw = mkdtempSync(join(tmpdir(), "guard-"));
const base = realpathSync(raw);
const wt = join(base, "wt");
const out = join(base, "outside");
mkdirSync(join(wt, "src"), { recursive: true });
mkdirSync(join(wt, ".claude"));
mkdirSync(out);
mkdirSync(join(base, "wt2"));
writeFileSync(join(wt, "src", "a.js"), "x");
writeFileSync(join(out, "target"), "x");

const run = (input, args = ["--root", wt], cwd = base) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { input, encoding: "utf8", cwd });
  return { code: r.status, err: r.stderr, out: r.stdout };
};
const ask = (path, { tool = "Write", field = "file_path", root = wt, cwd, extra } = {}) =>
  run(JSON.stringify({ tool_name: tool, tool_input: { [field]: path, ...extra }, ...(cwd ? { cwd } : {}) }), ["--root", root]).code;

try {
  section("the hook: inside");
  eq("existing file", ask(join(wt, "src/a.js")), 0);
  eq("new file", ask(join(wt, "src/new.js")), 0);
  eq("deep new folder", ask(join(wt, "n/e/w/x.js")), 0);
  eq("a relative path", ask("src/new.js"), 0);
  eq("allowed prints nothing", run(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: join(wt, "x") } })).err, "");

  section("the hook: outside");
  eq("absolute", ask(join(out, "x")), 2);
  eq("shared prefix", ask(join(base, "wt2/x")), 2);
  eq("`..` out", ask(join(wt, "src/../../outside/x")), 2);
  eq("relative `..` out", ask("../outside/x"), 2);
  eq("relative reads the root, not the guard's cwd",
    run(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x" } }), ["--root", wt], out).code, 0);
  eq("relative is refused when the agent's own folder is outside", ask("x", { cwd: out }), 2);
  eq("relative is fine with the agent's folder inside", ask("x", { cwd: join(wt, "src") }), 0);
  eq("~ is refused: the tool expands it", ask("~/.zshrc"), 2);
  eq("leading space is refused: the tool trims it", ask(` ${join(out, "x")}`), 2);

  section("the hook: links");
  symlinkSync(join(out, "target"), join(wt, "file-link"));
  eq("file link to outside", ask(join(wt, "file-link")), 2);
  symlinkSync(out, join(wt, "dir-link"));
  eq("linked parent to outside", ask(join(wt, "dir-link/new/x")), 2);
  symlinkSync(join(wt, "dir-link"), join(wt, "chain"));
  eq("chain of two", ask(join(wt, "chain/x")), 2);
  symlinkSync(join(out, "not-yet"), join(wt, "dangling"));
  eq("dangling link to outside", ask(join(wt, "dangling")), 2);
  symlinkSync("../outside", join(wt, "rel-link"));
  eq("relative link target", ask(join(wt, "rel-link/x")), 2);
  symlinkSync("loop-b", join(wt, "loop-a"));
  symlinkSync("loop-a", join(wt, "loop-b"));
  eq("a loop", ask(join(wt, "loop-a")), 2);
  symlinkSync(join(wt, "src"), join(wt, "in-link"));
  eq("link staying inside", ask(join(wt, "in-link/x")), 0);
  symlinkSync(out, join(wt, "src", "up"));
  eq("`..` after a link follows the target", ask(`${wt}/src/up/../x`), 2);
  mkdirSync(join(wt, "d1/d2/d3"), { recursive: true });
  symlinkSync(join(wt, "d1/d2/d3"), join(wt, "deep"));
  eq("`..` after a link: inside by the disk, outside by the letters", ask(`${wt}/deep/../../../../outside/x`), 2);
  symlinkSync(join(wt, ".claude"), join(wt, "c-link"));
  eq("a link onto .claude/settings", ask(join(wt, "c-link/settings.json")), 2);

  section("the hook: a root behind a link");
  const linkedBase = join(base, "via");
  symlinkSync(wt, linkedBase);
  eq("root given through a link, path real", ask(join(wt, "x"), { root: linkedBase }), 0);
  eq("root real, path through a link to it", ask(join(linkedBase, "x")), 0);
  eq("both through the link", ask(join(linkedBase, "x"), { root: linkedBase }), 0);
  eq("outside still refused through a linked root", ask(join(out, "x"), { root: linkedBase }), 2);
  eq("/tmp style: the unresolved temp folder", ask(join(raw, "wt/x"), { root: join(raw, "wt") }), 0);

  section("the hook: inside but refused");
  eq(".git/hooks/x", ask(join(wt, ".git/hooks/x")), 2);
  eq(".claude/settings.local.json", ask(join(wt, ".claude/settings.local.json")), 2);
  eq(".claude/other", ask(join(wt, ".claude/other")), 0);
  eq("the folded name, not yet on disk", ask(join(wt, ".claude/\u017Fettings.json")), 2);
  mkdirSync(join(wt, "c-real"));
  mkdirSync(join(wt, "nest"));
  symlinkSync("../c-real", join(wt, "nest/.claude"));
  eq(".claude as a link: the name it is used by counts", ask(join(wt, "nest/.claude/settings.json")), 2);
  eq(".claude as a link: other files still fine", ask(join(wt, "nest/.claude/other")), 0);
  symlinkSync("../c-real/x", join(wt, ".claude/settings.json"));
  eq("settings.json as a link", ask(join(wt, ".claude/settings.json")), 2);
  symlinkSync("../c-real", join(wt, "nest/.git"));
  eq(".git as a link", ask(join(wt, "nest/.git/config")), 2);

  section("the hook: notebook_path");
  const nb = (p, extra) => ask(p, { tool: "NotebookEdit", field: "notebook_path", extra });
  eq("inside", nb(join(wt, "n.ipynb")), 0);
  eq("outside", nb(join(out, "n.ipynb")), 2);
  eq("through a link", nb(join(wt, "dir-link/n.ipynb")), 2);
  eq("a harmless file_path does not vouch for it", nb(join(out, "n.ipynb"), { file_path: join(wt, "x") }), 2);
  eq("Write with only notebook_path is no path", ask(join(wt, "x"), { field: "notebook_path" }), 2);

  section("the hook: fails shut");
  const good = JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(wt, "x") } });
  eq("malformed JSON", run("{nope").code, 2);
  eq("empty stdin", run("").code, 2);
  eq("JSON null", run("null").code, 2);
  eq("no --root", run(good, []).code, 2);
  eq("--root with no value", run(good, ["--root"]).code, 2);
  eq("relative --root", run(good, ["--root", "wt"]).code, 2);
  eq("no path", run(JSON.stringify({ tool_name: "Write", tool_input: {} })).code, 2);
  eq("no tool_input", run(JSON.stringify({ tool_name: "Write" })).code, 2);
  eq("a path that is not a string", run(JSON.stringify({ tool_name: "Write", tool_input: { file_path: ["x"] } })).code, 2);
  eq("an unknown tool", run(JSON.stringify({ tool_name: "Bash", tool_input: { file_path: join(wt, "x") } })).code, 2);
  eq("a path under a file", ask(join(wt, "src/a.js/x")), 2);
  eq("the sanity case passes", run(good).code, 0);

  section("the hook: stderr");
  const SECRET = "hunter2-do-not-print";
  const refusedRuns = [
    run(JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(out, "x"), content: SECRET } })),
    run(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: join(wt, ".git/x"), new_string: SECRET } })),
    run(`{"tool_name":"Write","tool_input":{"content":"${SECRET}"`),
    run(JSON.stringify({ tool_name: "Bash", tool_input: { command: SECRET } })),
    run(JSON.stringify({ tool_name: "Write", tool_input: { file_path: `${SECRET}\n`, content: SECRET } })),
  ];
  for (const [i, r] of refusedRuns.entries()) {
    eq(`refusal ${i} exits 2`, r.code, 2);
    ok(`refusal ${i} holds no content`, !r.err.includes(SECRET));
    eq(`refusal ${i} is one line`, r.err.trimEnd().split("\n").length, 1);
    ok(`refusal ${i} says something`, r.err.startsWith("cockpit guard: "));
    eq(`refusal ${i} leaves stdout empty`, r.out, "");
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}

done();
