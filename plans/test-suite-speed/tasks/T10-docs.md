# T10 — docs

**Phase:** 4 · **Depends on:** T09 · **Weight:** light

## Goal

Make every document that quotes the suite's time or how to run it agree with what T09 measured,
so no later session plans around "about 6 minutes".

## Files

- `spikes/cockpit-test/run.sh`: the `--- test speed ---` comment (its ~69s/~119s figures), and a
  short usage note at the top naming `ONLY=`, `SECTIONS=1`, `TIMINGS=1`, `stress.sh`.
- `CLAUDE.md`: the `spikes/cockpit-test/` line (check count), and a line saying a partial run is
  not the test command.
- `plans/*/DESIGN.md` Environment sections that quote the time (pir-pane §5 "about 6 minutes"),
  and this plan's §5.
- `plans/test-suite-speed/FINDINGS.md`

## Tests

- [ ] `grep -rn '6 minutes' CLAUDE.md plans/*/DESIGN.md spikes/cockpit-test/run.sh` finds nothing
  that describes this suite.
- [ ] Every figure quoted matches T09's FINDINGS row.

## Done when

- [ ] The grep above is clean and the quoted time and check count match T09.
- [ ] Full suite passes.
