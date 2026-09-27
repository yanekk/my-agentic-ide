# T03 — convert-main-early

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Convert the waits in sections 1–10 (the start of the main chain) per DESIGN §3.1–§3.3, and fix
the section-3b flake the planning baseline hit, so the fastest-iterated part of the suite is both
quicker and stable under load.

## Design sections this implements

DESIGN §3.1, §3.2, §3.3.

## Files

- `spikes/cockpit-test/run.sh`: sections 1 through 10 only.
- `plans/test-suite-speed/FINDINGS.md`

## Interface

No new helpers. Each converted wait is one of: `waitfor`/`waitmore` (log), `waituntil` (other),
or `nap N  # window: <timer>, <why this length>`.

## Tests

- [ ] Every `sleep`/`nap` in 1–10 is classified in the commit message: poll, or window with its
  timer. None left unclassified.
- [ ] The vacuous checks in 5g, 6b, 8 and 9d (FINDINGS) become count-based.
- [ ] The section-3b flake: reproduce it (e.g. `ONLY=3b` under 4 parallel copies), find the
  cause, fix the wait. Record cause and fix in FINDINGS.
- [ ] `ONLY=10` passes 5 times in a row, and 3 times with 4 copies running at once.

## Done when

- [ ] Full suite passes; check count ≥ T01 baseline.
- [ ] `TIMINGS=1` before/after for 1–10 recorded in FINDINGS.
- [ ] The repeat runs above passed with zero failures.
