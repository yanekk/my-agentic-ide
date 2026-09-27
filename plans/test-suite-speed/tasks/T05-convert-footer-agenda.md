# T05 — convert-footer-agenda

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Convert the waits in the footer chain (12, 12b, and pir-pane's 12c once merged) and the agenda chain (13, 13b, 13c), and make
the agenda daemons' ticks scale with `SPEED` so their windows can be `nap`s. Move each chain's
helpers to the top of its chain so a skipped chain cannot change another's behaviour.

## Design sections this implements

DESIGN §3.1, §3.2, §4.1.

## Files

- `spikes/cockpit-test/run.sh`: sections 12 through 13c only.
- `plans/test-suite-speed/FINDINGS.md`

## Interface

- `COCKPIT_AGENDA_TICK_MS` / `COCKPIT_AGENDA_STALE_MS` for D2/D3 derived from `SPEED`, beside
  `REAP_MS`, with a floor, so `nap` windows track them.
- 13's redefinition of `same()` moves above section 13's heading, inside the agenda chain's
  gate, or is reconciled with the top-level `same` (whichever keeps every message identical).
- The footer's `click`/`footer`/`ufooter` sleeps (0.8–2.6 s each) become polls on the render
  output where one exists.

## Tests

- [ ] Every wait classified in the commit message.
- [ ] "a fresh calendar is not re-fetched" and similar absences are windows of at least two ticks.
- [ ] `ONLY=13c` and `ONLY=12b` each pass 5 times in a row and 3 times with 4 copies at once.
- [ ] `ONLY=14c` (agenda skipped) still prints the same `same` failure format as a full run.

## Done when

- [ ] Full suite passes; check count ≥ T01 baseline.
- [ ] `TIMINGS=1` before/after for 12–13c recorded in FINDINGS.
- [ ] The repeat runs above passed with zero failures.
