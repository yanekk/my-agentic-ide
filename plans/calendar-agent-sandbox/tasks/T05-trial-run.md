# T05 — trial-run

**Phase:** 2 · **Depends on:** T04 · **Weight:** medium

## Goal

Let the skill try a job inside the real wall before scheduling it, in a copy that cannot leave anything behind.

## Design sections this implements

§2.10.

## Files

`bin/cockpit-jobs.mjs` (or a small `bin/cockpit-jobs-trial.mjs` it imports, builder's call), `bin/cockpit-jobs-model.mjs` (trial argv and instructions, pure), `spikes/calendar-jobs-test/trial.test.mjs` (new), `spikes/calendar-jobs-test/fake-claude`.

## Interface

```
node bin/cockpit-jobs.mjs --trial --project <name> --root <projects root> [--limit-min 10] --commands-file <file>
  stdout: the agent's final message
  exit 0 trial ran (blocks are in the text); 1 could not run; 2 usage
```

```js
buildTrialArgs({ settings, commands })  // -> argv for `claude -p`, small model, same wall flags
```

The worktree is `{project}/.claude/worktrees/wall-trial-{id}` on a new branch from the base. The instructions: run these commands in order, do not fix or commit anything, and list per command whether it passed and each thing the wall blocked. It uses `execFile`, kills at the limit, and removes worktree and branch in `finally`, including on SIGINT and SIGTERM. The preflight of T04 applies. The commands reach only argv.

## Tests

- [ ] Fake `claude` receives dontAsk, the wall settings, that project's exceptions, and a cwd in the throwaway worktree.
- [ ] Worktree and branch gone after success, a fake failing, the limit passing, and SIGTERM.
- [ ] Prints the final message; exit codes per case.
- [ ] Preflight failure: exit 1 with its line, no agent.
- [ ] No ledger, no note, no calendar read: scratch files unchanged, with a jobs calendar configured.
- [ ] Bad project name refused.

## Done when

- [ ] `spikes/calendar-jobs-test/run.sh` passes.
- [ ] The argv's wall comes from the same `buildWallSettings` call path as a real start, shown by a test comparing the two.
