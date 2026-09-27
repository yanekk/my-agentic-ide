# Prompt: make the cockpit test suite fast again

Run from this checkout: `pir plan "$(sed -n '/^---8<---$/,/^--->8---$/p' docs/pir-prompts/test-suite-speed.md | sed '1d;$d')"`, or paste the block into `/pir-plan`. Plan it **after** `test-daemon-leaks.md` has landed: leaked daemons inflate every timing this plan would measure. Do not start building while a pir run that edits `spikes/cockpit-test/run.sh` is still open.

---8<---
Cut the wall time of agentic-ide's `spikes/cockpit-test/run.sh` (the suite every pir worker must run before handing off) without making it flaky, and let a worker iterate on a few sections without paying for the whole suite each time.

Why: in the pir-pane parallel run (2026-09-27) one full suite run took 5–8 minutes (longer with four workers testing at once), and it dominated every task: T02's build and T02's review each ran it three times, ~24 minutes of each ~30-minute session. The T04 worker worked around it by hand by cutting a temporary copy of the suite down to the sections it touched.

What the suite already has: `COCKPIT_TEST_SPEED` (default 0.5) scales the daemon's timers through COCKPIT_TIME_SCALE and every `nap N` the script takes; the comment above it measured ~69s for the whole suite at 0.5 when it was introduced, and warns section 9c flakes below 0.3. `waitfor <pattern> <file> <seconds>` polls a log for an announcement. Since then the suite has grown to ~65 sections, ~2900 lines, ~550–600 checks, and the new sections mostly use plain `sleep N` — 91 of them, ~218 s of literal unscaled sleep (several `sleep 5`/`sleep 6` in sections 11–12 alone). That, not computation, is where the time went.

Wanted:
1. Measure first: per-section wall time of a clean run (no leaked daemons, no parallel workers), so the plan attacks the biggest sections and can show the before/after.
2. Replace fixed sleeps that wait for something to happen with a bounded poll for the observable effect (`waitfor`, `grew`, or a new helper for non-log conditions such as a pane table or a file's contents), with a timeout generous enough that a loaded machine is slower but still passes. Sleeps that prove something does NOT happen (a cooldown, a grace window, "no relaunch within X") cannot become polls; convert those to `nap` so COCKPIT_TEST_SPEED governs them, and keep them only as long as the window they prove.
3. A section filter so a worker can run just the sections it is working on (e.g. `ONLY=13b,15m bash spikes/cockpit-test/run.sh`, or by heading pattern), with the shared setup still run, and printing clearly that it was a partial run so it can never be mistaken for the test command. The full suite remains the test command and still runs once before hand-off.
4. Optional, only if 1–3 leave it well over ~2 minutes: running independent sections concurrently (the agenda/dashboard sections already use their own daemon and scratch folder; the main-daemon sections share one and are sequential). Say in the plan whether it is worth it given the measurements.

Constraints: no check may be dropped or weakened to save time; the check count must not fall. Timing-sensitive checks are the risk: prove stability by running the finished suite repeatedly (e.g. 10 times, and a few times with 4 copies in parallel to mimic a pir run) with zero failures, and record those numbers. Keep the output contract (`ALL PASS (N checks)` / FAIL lines and non-zero exit, no colour). Update the suite's own timing comment and the time quoted in CLAUDE.md / plan DESIGN.md Environment sections that say "about 6 minutes".

Check: the before/after per-section timings, and the repeat runs, in the plan's FINDINGS.md.
--->8---
