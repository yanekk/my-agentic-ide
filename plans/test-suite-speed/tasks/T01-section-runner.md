# T01 — section-runner

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Give `spikes/cockpit-test/run.sh` a section runner so a worker can run a few sections while
iterating (`ONLY=`), list them (`SECTIONS=1`) and time them (`TIMINGS=1`), and take the clean
per-section baseline every later task measures against. Start only after pir-pane and then
test-daemon-leaks have merged (DESIGN §5).

## Design sections this implements

DESIGN §3.4, §3.5, §3.7, §4.1, §5.2.

## Files

- `spikes/cockpit-test/run.sh`: the `section` helper, every heading, the main-daemon start, the
  result tail.
- `plans/test-suite-speed/FINDINGS.md`: the baseline row(s).

## Interface

```
section <id> "<title>"      # replaces: echo; echo "== <id>. <title> =="
                            # prints the same two lines when the section runs;
                            # returns 1 (skip) when ONLY excludes it
if section 11c "a quit VIEWER is healed …"; then
  …body unchanged…
fi
CHAIN_OF[<id>]=main|footer|agenda|dashboard   # declared once, in heading order
ONLY=11c,13b   SECTIONS=1   TIMINGS=1         # env inputs
```

Partial success line: `PARTIAL RUN (ONLY=<list>): N checks passed, <k> sections run. Not the
test command.` Unknown id: `unknown section: <id>` on stderr, exit 2, before the daemon starts.
Helpers a chain defines inside its first section (`cq`, `bq`, `stopbb`, `footer`, the redefined
`same`) are left where they are here; T05/T06 move them. Selecting a later section of a chain
runs its first section, so they are still defined.

## Tests

- [ ] Full run: output identical in shape to before (headings, `ALL PASS (N checks)`), same N.
- [ ] `ONLY=13b` runs 13 and 13b only, does not start the main daemon, prints `PARTIAL RUN`.
- [ ] `ONLY=11c'''` runs 1 through 11c''' and nothing after; ids with primes parse.
- [ ] `ONLY=14b` runs 14, 14d, 14b (prefix of its chain).
- [ ] `ONLY=nope` exits 2 with `unknown section: nope` and runs nothing.
- [ ] A partial run with a failing check prints `FAILURES` and exits 1, never `ALL PASS`.
- [ ] `SECTIONS=1` lists every id and title, exits 0, starts no daemon.
- [ ] `TIMINGS=1` prints one line per section run plus a total, after the result line.

## Done when

- [ ] The tests above pass by hand, and the full run's check count equals the pre-T01 count.
- [ ] FINDINGS.md has the clean baseline: per-chain seconds, the ten largest sections, check
  count, load average, taken with no leaked test daemons (DESIGN §5.2) and no other suite running.
- [ ] The chain table in DESIGN §4.1 matches the merged script (corrected there if not).
