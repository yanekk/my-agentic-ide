# T07 — convert-pir-pane

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Convert the waits in the sections pir-pane added to the main chain (15a–15o on the pir-pane
branch, 2026-09-27), which sit between 11p and 12 and are new since the planning baseline.
pir-pane's 12c is in the footer chain and belongs to T05.

## Design sections this implements

DESIGN §3.1, §3.2, §3.3.

## Files

- `spikes/cockpit-test/run.sh`: the pir-pane sections only, whatever their ids on main.
- `plans/test-suite-speed/FINDINGS.md`

## Interface

As T03.

## Tests

- [ ] Every wait classified in the commit message.
- [ ] `ONLY=<last pir-pane section>` passes 5 times in a row and 3 times with 4 copies at once.
- [ ] If pir-pane's own `spikes/pir-pane-test/run.sh` exists, it still passes (untouched).

## Done when

- [ ] Full suite passes; check count ≥ T01 baseline.
- [ ] `TIMINGS=1` before/after for these sections recorded in FINDINGS.
- [ ] The repeat runs above passed with zero failures.
