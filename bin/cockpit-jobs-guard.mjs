#!/usr/bin/env node
// cockpit-jobs-guard -- the PreToolUse hook keeping a calendar agent's file tools in
// its worktree; the sandbox covers shell commands only (calendar-agent-sandbox
// DESIGN 2.3, 3.3).
//
//   node bin/cockpit-jobs-guard.mjs --root <worktree>      stdin: the hook's JSON
//   exit 0 allowed; exit 2 refused, one line on stderr naming the rule
//
// Fails shut: only an explicit allow exits 0. A missing script or node is covered by
// the command form, `... || exit 2` (T00), since Claude lets any other failure through.
// Rules live in cockpit-guard-model.mjs; this file only reads the disk.

import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { guardVerdict, pathFieldFor, rawPathRefusal } from "./cockpit-guard-model.mjs";

const MAX_LINKS = 40; // the same bound the kernel uses, so a loop ends in a refusal

// Walks the path one piece at a time, the way the kernel will. Not realpath of the
// deepest existing parent: a link whose target does not exist yet makes a parent
// check call it "new file inside", and the write then lands at the target. Not
// path.resolve first either: `link/..` means the parent of the link's TARGET.
//
// `crossed` collects the path as it read at each link, with the link's own name: a
// `.claude` that is a link to `c2` makes the real target c2/settings.json, and the
// session still reads it as .claude/settings.json.
function resolveOnDisk(path, crossed = []) {
  const pending = path.split("/").filter(Boolean);
  let existing = "/";
  const missing = [];
  let links = 0;
  while (pending.length) {
    const piece = pending.shift();
    if (piece === ".") continue;
    if (piece === "..") {
      if (missing.length) missing.pop();
      else existing = dirname(existing);
      continue;
    }
    if (missing.length) { missing.push(piece); continue; }
    const next = join(existing, piece);
    let stat;
    try {
      stat = lstatSync(next);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      missing.push(piece);
      continue;
    }
    if (stat.isSymbolicLink()) {
      if (++links > MAX_LINKS) throw new Error("too many links");
      crossed.push(join(realpathSync.native(existing), piece, ...pending));
      const target = readlinkSync(next);
      if (isAbsolute(target)) existing = "/";
      pending.unshift(...target.split("/").filter(Boolean));
    } else {
      existing = next;
    }
  }
  // .native gives the name's real case, so /Users/ME/wt still matches a root of /Users/me/wt.
  return join(realpathSync.native(existing), ...missing);
}

function decide(argv, stdinText) {
  const at = argv.indexOf("--root");
  const rootArg = at >= 0 ? argv[at + 1] : undefined;
  if (!rootArg || !isAbsolute(rootArg)) return { allow: false, reason: "no usable worktree root" };
  const root = resolveOnDisk(rootArg);

  const input = JSON.parse(stdinText);
  const toolName = input?.tool_name;
  const field = pathFieldFor(toolName);
  if (!field) return guardVerdict({ root, resolvedPath: "", toolName });
  const raw = input.tool_input?.[field];
  const refusal = rawPathRefusal(raw);
  if (refusal) return { allow: false, reason: refusal };

  // A relative path is read against the root, never this process's cwd. The agent's
  // own directory can differ from the root, and Claude would resolve against that, so
  // when the hook reports one the path must be fine against it too. The lexical
  // reading is checked beside the physical one because the tool may normalise before
  // it writes, and `..` after a link lands somewhere else under each.
  const bases = isAbsolute(raw) ? [""] : [root, ...(typeof input.cwd === "string" && isAbsolute(input.cwd) ? [input.cwd] : [])];
  for (const base of bases) {
    const joined = base ? `${base}/${raw}` : raw;
    for (const candidate of [joined, resolve(joined)]) {
      const crossed = [];
      const resolved = resolveOnDisk(candidate, crossed);
      // Only names inside the root: a link on the way TO the root (/tmp) is no verdict.
      for (const resolvedPath of [resolved, ...crossed.filter((p) => p.startsWith(`${root}/`))]) {
        const verdict = guardVerdict({ root, resolvedPath, toolName });
        if (!verdict.allow) return verdict;
      }
    }
  }
  return { allow: true, reason: "inside the worktree" };
}

let verdict;
try {
  verdict = decide(process.argv.slice(2), readFileSync(0, "utf8"));
} catch {
  // No err.message: a JSON parse error quotes the input it choked on.
  verdict = { allow: false, reason: "the guard could not read this request" };
}
if (!verdict.allow) process.stderr.write(`cockpit guard: ${verdict.reason}\n`);
process.exitCode = verdict.allow ? 0 : 2;
