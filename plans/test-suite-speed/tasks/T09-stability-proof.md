# T09 — stability-proof

**Phase:** 4 · **Depends on:** T08 · **Weight:** medium

## Goal

Prove the finished suite is stable, not just fast, and record it: 10 consecutive full runs and
3 rounds of 4 concurrent full runs with zero failures, plus the final before/after table. Build
the repeat-run script with the leak seatbelt so this can be re-run by any later session.

## Design sections this implements

DESIGN §2, §5.2.

## Files

- `spikes/cockpit-test/stress.sh` (new)
- `plans/test-suite-speed/FINDINGS.md`

## Interface

```
bash spikes/cockpit-test/stress.sh [--serial N] [--parallel K --rounds R]
  # each copy: TMPDIR=<scratch>/<copy>, output to <scratch>/<copy>.out
  # prints one line per copy: "<copy> PASS|FAIL <seconds>s <N> checks"
  # then "stress: <passed>/<total> passed, median <s>s, max <s>s"; exit 1 on any failure
  # on exit (trap, Ctrl-C included): source spikes/lib/test-daemons.sh and call
  # `daemon_sweep <scratch>` (the leak plan's, DESIGN §5.2), then remove <scratch>;
  # never pkill by name, never a matcher of its own
```

## Tests

- [ ] `--serial 1` passes and leaves no cockpitd whose env names the scratch folder.
- [ ] Ctrl-C mid-run: same, and the real cockpit's daemon (if running) is untouched.
- [ ] A copy that fails is reported FAIL with its output path kept.

## Done when

- [ ] `stress.sh --serial 10` and `stress.sh --parallel 4 --rounds 3`: zero failures, recorded
  in FINDINGS with median/max and load average.
- [ ] FINDINGS has the before/after table per chain, T01 baseline against the final run.
