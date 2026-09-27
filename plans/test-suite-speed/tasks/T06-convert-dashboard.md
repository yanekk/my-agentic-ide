# T06 — convert-dashboard

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Convert the waits in the dashboard chain (14, 14d, 14b, 14c): 69 s in the planning baseline,
mostly `sleep 2` before a `bq` cache query and `sleep 1` after each click verb.

## Design sections this implements

DESIGN §3.1, §3.2, §4.1.

## Files

- `spikes/cockpit-test/run.sh`: sections 14 through 14c only.
- `plans/test-suite-speed/FINDINGS.md`

## Interface

- `COCKPIT_BITBUCKET_TICK_MS` for D4/D5/D6 derived from `SPEED` where the section does not
  deliberately set an hour-long tick (14b's "an hour-long tick fetches nothing" keeps its hour).
- Click verbs (`bb-tab`, `bb-page`, `bb-open`, `bb-review`) wait with `waituntil` on
  `bitbucket-view.json` or the log line they produce.
- 14's slow-repo sequence (`sleep 5`, `1.5`, `4`) keeps its ordering proof: the 1.5 s window
  stays under the stub's 2 s hold.
- `stopbb` and the `sleep 0.5` after it: replace the sleep with a wait for the node child to exit.

## Tests

- [ ] Every wait classified in the commit message.
- [ ] `ONLY=14c` passes 5 times in a row and 3 times with 4 copies at once.

## Done when

- [ ] Full suite passes; check count ≥ T01 baseline.
- [ ] `TIMINGS=1` before/after for 14–14c recorded in FINDINGS.
- [ ] The repeat runs above passed with zero failures.
