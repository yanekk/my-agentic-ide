# T01 — wall-rules

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The pure statement of the wall: what settings a run gets, the new argv, the instructions and the note. Nothing runs differently yet, because the tick still has to supply the facts (T04), so `decideJobs` keeps working by a required `wallFor` argument that tick tests stub until T04 wires it.

## Design sections this implements

§2.1, §2.2, §2.4, §2.5, §2.6, §2.7 validation, §2.9 preamble, §3.1, §3.2.

## Files

`bin/cockpit-wall-model.mjs` (new), `bin/cockpit-jobs-model.mjs`, `spikes/calendar-jobs-test/wall-model.test.mjs` (new), `spikes/calendar-jobs-test/model.test.mjs`, `spikes/calendar-jobs-test/tick.test.mjs`, `spikes/calendar-jobs-test/run.sh` (purity grep on the new file), `.pir/settings.json` (add the `calendar-jobs-test` line).

## Interface

```js
// cockpit-wall-model.mjs
export const DEFAULT_SITES;     // registry.npmjs.org, pypi.org, files.pythonhosted.org
export const SECRET_DIRS;       // ~/.ssh ~/.aws ~/.claude/cockpit ~/.config/gh
export function buildWallSettings({ worktree, home, guardPath, commonDir, branches, remoteHosts, exceptions })
  // -> { settings, dropped: [{ project?, kind, value, why }] }
export function validateException(kind, value, { home })   // -> { ok } | { ok: false, why }

// cockpit-jobs-model.mjs
buildClaudeArgs({ event, project, item, instructions, zone, wall })
decideJobs({ ..., wallFor })   // wallFor(project, worktreeName) -> { settings, dropped } | { unavailable: reason }
noteText("wall", { title, line });  noteText("wall-list", { project });  noteText("wall-dropped", { project, value })
```

Argv, in this order so a variadic flag never meets the prompt:

```
--bg -n {name} --permission-mode dontAsk -w {worktree}
--settings {json, or T00's form} --strict-mcp-config --mcp-config {"mcpServers":{}}
--disallowedTools AskUserQuestion --append-system-prompt {preamble} {prompt}
```

The settings name T02's script by the `guardPath` argument and T00's command form, so T01 does not need T02's code.

The preamble drops "never touch" as the only protection and states: the machine enforces the wall, what is blocked, do not try to work around it, carry on with what you can, commit, and list each block in the final message.

## Tests

- [ ] Exact argv order; `--bg` flags kept; `bypassPermissions` absent.
- [ ] Settings hold every flag of §2.2; `Read()` rules start `~/` or `//`.
- [ ] A hostile description (`--settings`, JSON, newlines) leaves settings byte-identical.
- [ ] Each branch yields ref and `.lock`, plus `packed-refs` and `HEAD`; zero branches; a branch name with a slash.
- [ ] Exception widening merges; ports set `allowLocalBinding`; absent means the key is absent.
- [ ] `validateException` and the drop in `buildWallSettings`: `*`, `github.com`, `api.github.com`, remote host, `/`, home, `~/.ssh/x`, `~/.claude`, `.git`, relative path, path with `..`; a good site and folder pass.
- [ ] The hook entry uses T00's fail-shut command form with the given `guardPath` and worktree, and matches Write, Edit and NotebookEdit.
- [ ] `decideJobs` with `wallFor` returning `unavailable` starts nothing and records `failed`/`wall` with one note.
- [ ] Purity grep covers the new file and can fail.

## Done when

- [ ] `spikes/calendar-jobs-test/run.sh` passes with the new argv and all the above.
- [ ] `.pir/settings.json` runs the suite.
