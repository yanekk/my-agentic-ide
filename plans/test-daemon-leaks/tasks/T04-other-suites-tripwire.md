# T04 — other-suites-tripwire

**Phase:** 2 · **Depends on:** T01 · **Weight:** light

## Goal

Give every other suite the same exit sweep and end-of-run tripwire, so a daemon added to any of them
later fails that suite the day it is written instead of leaking quietly. None of them starts a daemon
today, so this changes no result.

## Design sections this implements

DESIGN §2.3, §2.5.

## Files

- `spikes/agenda-test/run.sh`, `spikes/notes-test/run.sh`, `spikes/bitbucket-test/run.sh`,
  `spikes/browse-test/run.sh`, `spikes/usage-test/run.sh`, `spikes/auto-name-test/run.sh`,
  `spikes/stop-notify-test/run.sh`
- `spikes/pir-pane-test/run.sh` only if it exists on `main` when this task starts; if it does not,
  say so in the commit and log it in FINDINGS for whoever creates it.

## Interface

In each: source `spikes/lib/test-daemons.sh`; the existing EXIT trap gains `daemon_sweep "$T"` before
its `rm -rf`; `daemon_tripwire "$T" || <that suite's own failure flag>` right before its result line.
`stop-notify-test` names its scratch folder `$SHIM`, so its calls use that. Suites whose result comes
from node test files keep their own counting; only the flag the result line reads is set.

## Tests

- [ ] Every edited suite still prints `ALL PASS` with its check count unchanged, or one higher if the
      tripwire is counted; the commit says which.
- [ ] For one suite (agenda-test), a temporary fake daemon (`COCKPIT_DIR="$T/x" node
      $T/bin/cockpitd.mjs &` with a plain `setInterval` script) left running makes it print the
      `LEAK` line and `FAILURES` and leave nothing behind. Revert; report the run in the commit.

## Done when

- [ ] All seven (or eight) suites print `ALL PASS`, each sources the helper and calls the tripwire.
