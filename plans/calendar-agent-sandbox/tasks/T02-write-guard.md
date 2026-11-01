# T02 — write-guard

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

The hook that stops the file tools writing outside the worktree, which the sandbox does not cover (measured). It fails shut, and its rule is a pure function so the rule is a millisecond test.

## Design sections this implements

§2.3, §3.3.

## Files

`bin/cockpit-guard-model.mjs` (new, pure, added to the purity grep in `spikes/calendar-jobs-test/run.sh`, which T01 also edits, hence the dependency), `bin/cockpit-jobs-guard.mjs` (new), `spikes/calendar-jobs-test/guard.test.mjs` (new).

## Interface

```
// cockpit-guard-model.mjs
guardVerdict({ root, resolvedPath, toolName })   // -> { allow, reason }

node bin/cockpit-jobs-guard.mjs --root <worktree>
  stdin: Claude's PreToolUse JSON { tool_name, tool_input: { file_path | notebook_path } }
  exit 0 allowed; exit 2 refused with one line on stderr naming the rule, not the content
```

Resolves symlinks of the deepest existing parent, then the remainder, because the target of a Write often does not exist yet. Any thrown error, malformed JSON, a missing `--root` or unknown tool shape exits 2. The command form (T00) is what covers a missing script or node, and T01 writes that form.

## Tests

Spawned with real stdin:

- [ ] `guardVerdict` directly: the root itself, sibling with a shared prefix (`/a/wt` vs `/a/wt2`), `.claude/other` allowed, empty path refuses.
- [ ] New file inside; existing file inside; deep new folder inside.
- [ ] Absolute outside; `..` out; relative path resolved against the root and not the guard's cwd.
- [ ] Symlink file inside to outside; symlinked parent folder to outside; chain of two.
- [ ] Root reached through a symlink (`/tmp` to `/private/tmp`) still allowed.
- [ ] `.git/hooks/x`, `.claude/settings.local.json` refused.
- [ ] `notebook_path` is checked the same.
- [ ] Malformed JSON, empty stdin, no `--root`, no path: exit 2.
- [ ] Stderr holds no file content from `tool_input`.

## Done when

- [ ] `spikes/calendar-jobs-test/run.sh` passes with this suite.
- [ ] The file has no decision of its own: rules live in `guardVerdict`.
