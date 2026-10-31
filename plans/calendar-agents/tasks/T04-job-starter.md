# T04 — job-starter

**Phase:** 2 · **Depends on:** T02, T03 · **Weight:** medium

## Goal

The world-touching half: keep the ledger, run `claude --bg`, and write notes. Everything is exercised against a fake `claude` in a throwaway directory.

## Design sections this implements

DESIGN §2.4, §2.6, §2.7, §3.5, §5.2.

## Files

`bin/cockpit-jobs-store.mjs`, `bin/cockpit-jobs.mjs`, `spikes/calendar-jobs-test/run.sh`, `spikes/calendar-jobs-test/tick.test.mjs`, `spikes/calendar-jobs-test/fake-claude`, `spikes/calendar-jobs-test/live-check.sh`.

## Interface

```js
// cockpit-jobs-store.mjs
readLedger() -> { version, notBefore?, entries, authNoted, corruptedTo? }
writeLedger(ledger)            // temp + rename, 0600
pruneLedger(ledger, now)       // pure helper, 30 days

// cockpit-jobs.mjs
jobsTick({ now, projectsRoot, zone, notesRepo, log }) -> Promise<void>
recoverStarting({ now, notesRepo, log })   // starting -> unknown, one note each
```

```
node bin/cockpit-jobs.mjs --once [--fetch] [--root DIR]
  # one tick outside the daemon. --fetch first fetches jobs calendars itself into
  # COCKPIT_DIR's cache, reusing the agenda's google client.
  # --root is the projects root and notes key, default `repo` from panes.json in COCKPIT_DIR;
  # a scratch directory has no panes.json, so live-check.sh passes it.
  # COCKPIT_JOBS_DRY_RUN=1 prints decisions and argv only.
```

`jobsTick` writes `starting` before it runs Claude, `started` with the id parsed from `backgrounded · {id} · {name}` on exit 0, and `failed` with the first line of output otherwise. It uses `execFile` with a 60 s limit and no shell, and has an in-flight guard. It reads calendars with `readState({ rescue: false })`, because a timer must not quarantine a corrupt `agenda.json` with nobody to tell (`CLAUDE.md`, the resting-pane row). Instructions never reach a log line, because they may hold anything; only slug, project and state do.

`live-check.sh <calendarId> <account>` copies `agenda.json` and `agenda-client.json` to a `0600` scratch `COCKPIT_DIR`, adds to the scratch copy a calendar row `agents` with that id and account, `jobs: true` and `jobsSince` now, refuses if the account has no sign-in there, runs `--once --fetch` first in dry run, then for real, then for real again to show the same entry does not start twice, prints each result and the scratch notes, because those die with the directory, and always deletes the scratch directory. The scratch is needed because the live daemon runs older code and overwrites the real cache without descriptions.

## Tests

- [ ] Ledger holds `starting` at the moment the fake `claude` is invoked (the fake reads it).
- [ ] Fake exits 0: `started` with id. Exit 1 with the trust message: `failed`, a note with that line, no retry on the next tick.
- [ ] Unparseable success output: `started` with no id, not a failure.
- [ ] Two ticks, one start. A tick overlapping a running tick does nothing.
- [ ] `recoverStarting`: `unknown`, one note, never restarted.
- [ ] Corrupt ledger: moved aside, one note, `notBefore` set so nothing re-runs (DESIGN §2.7).
- [ ] Auth or gone error on a jobs calendar: one note across many ticks; a new note after a success and a second failure. Network error: no note.
- [ ] A corrupt `agenda.json` is left in place by a tick.
- [ ] Notes carry author `calendar` and are visible through `readNotes(notesRepo)`.
- [ ] Dry run: no fake invocation, no ledger write, no note.
- [ ] Hostile instructions (`$(touch x)`, quotes, newlines) reach the fake byte-exact and run nothing; they appear in no log.
- [ ] `run.sh` fails if the real `~/.claude/cockpit` ledger changed, and if `claude` on `PATH` is not the fake.

## Done when

- [ ] `bash spikes/calendar-jobs-test/run.sh` passes.
- [ ] `COCKPIT_JOBS_DRY_RUN=1 node bin/cockpit-jobs.mjs --once` against a fixture prints the expected argv.
- [ ] No change to `cockpitd.mjs`; T05 owns that.
