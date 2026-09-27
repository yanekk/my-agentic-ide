# T04 — convert-browse

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

Convert the waits in sections 11–11p (browse mode, 145 s in the planning baseline, the largest
chain segment). Many of these are windows proving the healer or fence stays quiet, so the work
is mostly sizing each window to the timer it proves and turning its "then it happens" half into
a poll.

## Design sections this implements

DESIGN §3.1, §3.2, §3.3.

## Files

- `spikes/cockpit-test/run.sh`: sections 11 through 11p only.
- `plans/test-suite-speed/FINDINGS.md`

## Interface

As T03. The "Not scaled" comments in 11b–11c''''' are wrong about the relaunch cooldown
(`DIFF_RELAUNCH_COOLDOWN_MS = ms(3000)` is scaled). Correct them where the wait is converted.

## Tests

- [ ] Every wait in 11–11p classified in the commit message, as T03.
- [ ] 11c''' and 11c'''': the "inside the window" `nap` stays below the cooldown/grace with a
  stated margin; the "after" half becomes a `waitmore`/`waituntil`.
- [ ] The vacuous checks in 11i, 11m, 11n, 11o become count-based.
- [ ] 11l's `last_parked_diff` and 11p's `TRMD` still read the right line.
- [ ] `ONLY=11p` passes 5 times in a row, and 3 times with 4 copies running at once.

## Done when

- [ ] Full suite passes; check count ≥ T01 baseline.
- [ ] `TIMINGS=1` before/after for 11–11p recorded in FINDINGS.
- [ ] The repeat runs above passed with zero failures.
