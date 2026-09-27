# T08 — concurrent-chains

**Phase:** 3 · **Depends on:** T03, T04, T05, T06, T07 · **Weight:** medium

## Goal

Decide on measurement whether to run the footer, agenda and dashboard chains alongside the main
chain, and build it only if the full run is still over 2 min 30 s (DESIGN §3.6).

## Design sections this implements

DESIGN §3.6, §3.7.

## Files

- `spikes/cockpit-test/run.sh`: the chain dispatch and the result tail.
- `plans/test-suite-speed/FINDINGS.md`

## Interface

```
CONCURRENT=0   # env; forces the serial order, for debugging a chain's output live
# each side chain: ( …chain… ) > "$T/chain-<name>.out"; pass/fail written to
# "$T/chain-<name>.count" as "<pass> <fail>"; parent waits, cats in section order, sums
```

## Tests

- [ ] First: three quiet full runs, `TIMINGS=1`. If the median is ≤ 150 s, record it, write
  "not needed" in FINDINGS and PROGRESS, and stop here without code.
- [ ] Otherwise: output order identical to a serial run's (headings in section order).
- [ ] A FAIL inside a side chain makes the whole run print `FAILURES` and exit 1.
- [ ] `ONLY=` still works, and a partial run of one side chain does not spawn the others.
- [ ] Interrupting the run (Ctrl-C) leaves no side-chain subshell running.

## Done when

- [ ] The measurement and the decision are in FINDINGS.
- [ ] If built: full suite passes, count unchanged, wall time recorded, `CONCURRENT=0` works.
