# T02 — write-guard

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The hook that stops the file tools writing outside the worktree, which the sandbox does not cover (measured). It fails shut. If T01 has not landed, define `guardVerdict` here by T01's signature and let the merge reconcile; the signature in T01's doc is binding.

## Design sections this implements

§2.3, §3.3.

## Files

`bin/cockpit-jobs-guard.mjs` (new), `spikes/calendar-jobs-test/guard.test.mjs` (new).

## Interface

```
node bin/cockpit-jobs-guard.mjs --root <worktree>
  stdin: Claude's PreToolUse JSON { tool_name, tool_input: { file_path | notebook_path } }
  exit 0 allowed; exit 2 refused with one line on stderr naming the rule, not the content
```

Resolves symlinks of the deepest existing parent, then the remainder, because the target of a Write often does not exist yet. Any thrown error, malformed JSON, a missing `--root` or unknown tool shape exits 2. The command form (T00) is what covers a missing script or node, and T01 writes that form.

## Tests

Spawned with real stdin:

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
