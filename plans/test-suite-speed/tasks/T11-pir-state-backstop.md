# T11 — pir-state-backstop

**Phase:** 2 · **Depends on:** T07; blocks T09 · **Weight:** medium

Added 2026-09-27 during T07, with the person's approval. Unlike every other task in this plan it
changes `bin/cockpitd.mjs` (DESIGN §4 reserves a daemon change for the person's decision; this
is that decision).

## Goal

Make the daemon follow every change to `pir-dashboard.json`, even one the directory watch never
reports, and then take out the spacing T07 had to add to the suite's pir writes.

T07 measured it: macOS's `fs.watch` on the state directory sometimes delivers **no event at all**
for a second change to `pir-dashboard.json` made ~0.4s after the first (5 of 384 lost under 4
concurrent suites; 0 of 288 with a 1.5s gap). A lost change is never acted on, so the real
cockpit keeps showing a stale pir view until pir writes again. Both a temp-then-rename write and
an in-place write were lost; a delete never was.

## Files

- `bin/cockpitd.mjs`: the pir-state watch and the reconcile tick's pir branch.
- `spikes/cockpit-test/run.sh`: remove `pirspace`/`pirmark` (sections 16a, 16m, 16o); add the
  test below.
- `plans/test-suite-speed/FINDINGS.md`

## Interface

The watch stays the fast path. The backstop: while pir is shown, the reconcile tick (`POLL_MS`,
where `pirFolderGone` already runs) compares `pir-dashboard.json`'s identity (mtime, size, inode,
or absent) with what the last `onPirState` read, and calls `schedulePirState()` when it differs.
`onPirState` records that identity when it reads the file. No new log line on the fast path; one
line when the backstop fires (`pir: pir-dashboard.json changed without a watch event`), so a test
and a person can both see it happen.

## Tests

- [ ] A change the watch cannot see is still followed: with pir shown and a run attached, change
  the file so the watch drops it (or, if that cannot be forced, stop the watch through a
  test-only seam and say so) and poll for the exit to the list within 10s.
- [ ] With `pirspace`/`pirmark` removed, `ONLY=16m` with its loop repeated 8 times passes in 3
  rounds of 4 concurrent copies (the reproduction T07 used), zero failures.
- [ ] `ONLY=15o` passes 5 times in a row and 3 times with 4 copies at once.
- [ ] `spikes/pir-pane-test/run.sh` still passes.

## Done when

- [ ] Full suite passes; check count ≥ the T07 count plus the new check(s).
- [ ] The spacing is gone and FINDINGS records the before/after time for 16a–16p.
- [ ] The T07 FINDINGS row on dropped watch events names this task as where it went.
