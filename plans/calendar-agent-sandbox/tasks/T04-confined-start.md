# T04 — confined-start

**Phase:** 2 · **Depends on:** T01, T02, T03 · **Weight:** heavy

## Goal

Every calendar start now carries the wall, and one that cannot be confined leaves a note and does not run. This is the task that plugs the rules into the running program.

## Design sections this implements

§2.7 unreadable list, §2.9, §3.4.

## Files

`bin/cockpit-jobs.mjs`, `spikes/calendar-jobs-test/tick.test.mjs`, `spikes/calendar-jobs-test/fake-claude`, `spikes/calendar-jobs-test/live-check.sh` (expects the new argv).

## Interface

```js
wallFacts(project, worktreeName, { projectsRoot, home })  // git for-each-ref, rev-parse, remote; exceptions
preflight({ guardPath })   // -> { ok } | { ok: false, line }: sandbox-exec no-op, guard readable
export { wallFacts, preflight, buildWallFor };            // T05 reuses them
```

`jobsTick` runs the preflight once per pass with something to start, and hands `decideJobs` a `wallFor` that returns `{ unavailable }` on failure. Dropped and unreadable rows add a note per start. The guard path comes from `import.meta.url`. Git commands use `execFile` with a time limit, and a failure there is `unavailable` rather than a start with an empty branch list.

Dry run prints the argv and settings, so a person can read the wall without starting anything.

## Tests

- [ ] With a fake `claude`, argv holds dontAsk, settings, strict MCP; a real temporary git repo's branches appear in `denyWrite`.
- [ ] Preflight failure (stubbed `sandbox-exec` or missing guard): no fake-claude run, ledger `failed` with `wall`, one note, no second note next tick.
- [ ] `git` failing for that project: same; another project's entry in the pass still starts.
- [ ] Corrupt `jobs-wall.json`: starts with defaults, one note. A forbidden hand-edited row: dropped, one note, not in settings.
- [ ] An exception reaches that project's settings and not another's.
- [ ] Dry run writes nothing and prints the settings.
- [ ] Existing crash, `starting`, and untrusted-project tests still pass.

## Done when

- [ ] `spikes/calendar-jobs-test/run.sh` and `spikes/cockpit-test/run.sh` pass.
- [ ] `node bin/cockpit-jobs.mjs --once` under `COCKPIT_JOBS_DRY_RUN=1` with a scratch `COCKPIT_DIR` prints the full wall.
