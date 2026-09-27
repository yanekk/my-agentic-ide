# Findings log

**What the build taught.** Read the rows touching the task you pick up.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | T04 review: with the fence guard deleted, 11c'''' failed only 8 of 10 runs. Its "still starting" window (nap 1.5) can hold no healer pass, since ticks skip while reconcile holds the lock. Pre-existing; left for T09. |
| 2026-09-27 | 📌 | T04, load ~3.5, 0 orphans: 11–11p 146s before, 47s after; full run 457s, ALL PASS (767 checks). Agent switches poll `"agent":` in terminals.json, which showTerminal writes last. |
| 2026-09-27 | 🐞 | T04: 11c'''' "a browser sitting at a shell is never questioned" flaked at load 23. A healer tick that read the pane table before the retitle queried broot after the truncation. Now truncates once the daemon logs the shell status. |
| 2026-09-27 | 📌 | A wait on a stub ARGV line in `$CALLS` returns before the stub rewrites its pane table, so a test `retitle` just after can be lost (11c'''' never saw broot quit). Wait on the daemon's log line; it logs after the stub returns. |
| 2026-09-27 | 📌 | T01 review: `ONLY="11c'''"` failed section 7 "the vanished agent's diff pane too" at load 28 while a full run passed beside it. Section body untouched by T01; another load flake for T03. |
| 2026-09-27 | 📌 | T01 baseline, merged script, 0 orphans: 557s, 767 checks. Chains: main 303s, footer 134s, dashboard 69s, agenda 49s. Top ten: 12c 109, 14 34, 13 33, 14d 25, 12 20, 13b 16, 11k 12, 16n 11, 11p 11, 14b 10. |
| 2026-09-27 | 📌 | That baseline ran beside another suite, load 2.8 rising to 24; a load-5 run with six orphans took 560s, so wall time is wait-bound. Section 12c (pir-pane footer switch, ~0.8s per frame) alone is 109s. |
| 2026-09-27 | 🐞 | The EXIT trap named `D7PID`, set only in 15m; any run skipping 15m died on `set -u` in the trap, skipping `daemon_sweep` and `rm -rf $T`. T01 initialises it with the others. |
| 2026-09-27 | 📌 | Plan review: a fresh copy under `.claude/worktrees/` passed, 545 checks, 370s, load ~4.5, no escape bytes despite `FORCE_COLOR=3`. A copy under `$TMPDIR` fails 11's two broot `--conf` checks (path spelled differently); out of scope. |
| 2026-09-27 | 📌 | Leaked test cockpitd have parent pid 1; a running suite's daemon has its suite as parent. A temp-path match alone kills a sibling worker's live run, so hand cleanup matches orphans only (DESIGN §5.2). |
| 2026-09-27 | 🐞 | Planning baseline failed section 3b ("first flush injected", "the diff is reset (relaunched clean) on send") with 2 leaked cockpitd and load ~4. The suite already flakes under load; T03 owns it. |
| 2026-09-27 | 📌 | Planning baseline (pre-pir-pane main `d80b11f`, not clean): 6m13s, 13% CPU. Main 1–10 82s, 11–11p 145s, footer 25s, agenda 48s, dashboard 69s. Largest: 14 34s, 13 32s, 14d 25s, 12 20s, 13b 16s, 11k 12s. |
| 2026-09-27 | 📌 | Script has 90 fixed `sleep`s (218s) and 90 `nap`s (~116s at 0.5). Only 9 waits poll. `DIFF_RELAUNCH_COOLDOWN_MS` is scaled (1.5s at 0.5), so 11's "not scaled" 5s sleeps overshoot it ~3x. |
| 2026-09-27 | 📌 | Checks in 5g, 6b, 8, 9d, 11i, 11m, 11n, 11o grep lines an earlier section already wrote, so they pass whatever their section does. A `waitfor` on such a line returns at once (DESIGN §3.3). |
| 2026-09-27 | 📌 | Other suites: browse-test 110s, agenda 6s, notes 4s, the rest under 3s. browse-test is out of scope (DESIGN §7). |
