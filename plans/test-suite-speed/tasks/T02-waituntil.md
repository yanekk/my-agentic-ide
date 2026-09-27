# T02 — waituntil

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Add the one missing wait helper: a bounded poll for a condition that is not a log line, such as
a cache file's JSON, the stub's pane table or a call count, so the conversions have a single way
to wait for those. Touches only the helper block, so it can be built alongside T01.

## Design sections this implements

DESIGN §3.1, §3.3.

## Files

- `spikes/cockpit-test/run.sh`: the helper block (after `waitmore`).

## Interface

```
waituntil <seconds> <description> <command…>
  # runs <command…> every 0.1s until it exits 0 → returns 0, no output
  # after <seconds> (NOT scaled by SPEED) → prints
  #   "  FAIL timed out after <seconds>s waiting for: <description>", sets fail=1, returns 1
  # does not count as a check: the assertion that follows it does
```

Also give `waitfor` and `waitmore` callers the same failure line through an optional
`<description>` argument, so a timed-out log wait reports what it waited for rather than only
the check after it failing.

## Tests

- [ ] A throwaway section (removed before commit) shows: a true condition returns at once; one
  that becomes true after 1s returns in ~1s; one that never does fails after the limit with the
  message and the run carries on.
- [ ] The full suite still passes with the same check count.

## Done when

- [ ] `waituntil` exists with the interface above and a comment saying why the limit is unscaled.
- [ ] Full suite passes, count unchanged.
