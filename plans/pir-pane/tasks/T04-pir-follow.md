# T04 — pir-follow

**Phase:** 2 · **Depends on:** T01, T03 · **Weight:** heavy

## Goal

Make the cockpit follow what pir reports. Watch `pir-dashboard.json`, run it through T01's
decision, and attach or detach `pir.` keys through the same `showDiff`/`showTerminal`/watch
path an agent uses, with the run key starting at custom-against-main. Make reviews inert for
those keys, skip them in the agent-only machinery, and reap their parked panes when their folder
is gone. After this the pir pane is fully a second fleet view.

## Design sections this implements

DESIGN §2.2 (pir's `switchable`), §2.4 (reading), §2.5, §2.6, §2.7, §2.9, §2.11.

## Files

- `bin/cockpitd.mjs`
- `spikes/cockpit-test/run.sh` (new sections; tests write `$COCKPIT_DIR/pir-dashboard.json`)

## Interface

```js
// attached gains a source; agents keep today's shape plus source: "claude"
attached = { jobId: key, worktree: cwd, reviewFile, name: label, source: "pir" | "claude" }

async function onPirState()   // debounced 150ms; only acts while fleetProgram === "pir"
                              // readPirState → decidePir → onEnterKey(...) | onExit()
async function onEnterKey(key, cwd, label, { source, startMode })
                              // onEnter's body minus the agents() lookup; onEnter(jobId)
                              // becomes a wrapper that looks the agent up and calls this
fleetSwitchable()             // pir: readPirState(...).view === "list"
```

`healMissingPanes`, which detaches and leaves the re-attach to the gated `reconcile()`, calls
`onPirState` instead while pir is shown (DESIGN §2.9). The run key's default `main` is set in
memory only, never written to `custom-refs.json` (DESIGN §2.6). That default is the fork point:
`git merge-base main HEAD` in the run's folder, abbreviated with `git rev-parse --short`, run on
every attach of the run key and passed to `startingMode` as `forkPoint` (null on failure).
`writeTerminals` writes `reviewable: false` while a `pir.` key is attached (DESIGN §2.7).

`isAlive(pid)` is `process.kill(pid, 0)` in the daemon. `startingMode` gets
`resolves(ref)` from `git rev-parse --verify` in the key's folder. On switching to pir, the
current file is read once immediately, so a pir that is already inside a run is followed without
waiting for its next write.

## Tests

- [ ] File says `run` with an existing git cwd → diff slot and terminal slot move to key
      `pir.{key}`; revdiff launched as custom against the fork point with no prompt.
- [ ] `main` advanced past the fork point after the run branched → the diff's base is still the
      fork point, so `main`'s new commit is absent from the diff.
- [ ] `terminals.json` has `reviewable:false` with a pir key attached, and not with an agent.
- [ ] Custom ref stored for the run key → that ref used; unresolvable ref → uncommitted, logged.
- [ ] Attaching a run key with no stored ref leaves `custom-refs.json` without that key.
- [ ] `git merge-base` failing (no `main`) → uncommitted, logged.
- [ ] A pir key's diff pane killed while shown → re-attached by the heal, without a new file write.
- [ ] File says `worker` → key `pir.{key}.{id}` at the worker cwd, `uncommitted`.
- [ ] Back to `run` → the run key's parked diff and terminals return without relaunch.
- [ ] Back to `list` → welcome pane and repo terminals.
- [ ] Worker cwd deleted → run key shown; both gone → list; not a git repo → list.
- [ ] Same key, new `cwd` → revdiff relaunched there, watches moved.
- [ ] Dead pid in the file → list; corrupt file → list; no file → list.
- [ ] `⌥]` with the diff focused on a pir key cycles its modes; modes are per key.
- [ ] A revdiff flush on a pir key → nothing typed into any pane, log line, review file kept.
- [ ] Footer `switchable` false while the file says `run`/`worker`, true at `list`.
- [ ] While claude is shown, writes to the file do nothing.
- [ ] A pir key whose folder is removed and is not shown is reaped; the shown one is not.
- [ ] Agent attach, review injection and migration sections still pass unchanged.

## Done when

- [ ] All new sections and the whole cockpit-test suite pass.
- [ ] Every row of DESIGN §2.5 has a daemon-level check.
- [ ] `injectReview`, `followWorktreeMigration` and the agent reaper refuse or skip `pir.` keys.

## End to end (the worker drives this)

- suite: `spikes/cockpit-test` · the stub `pir` stands in; tests drive it by writing the state
  file the way the real pir will (temp + rename)
- [ ] each state transition above → the panes and `terminals.json` listed
