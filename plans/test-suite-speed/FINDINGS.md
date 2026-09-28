# Findings log

**What the build taught.** Read the rows touching the task you pick up.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 🐞 | T07: macOS `fs.watch` dropped a second `pir-dashboard.json` change made ~0.4s after the first: 5/384 lost under 4 concurrent suites, 0/288 at 1.5s. The suite spaces pir writes (`pirspace`); T11, added with the person's yes, is the daemon backstop. |
| 2026-09-27 | 📌 | T07 pir sections 15a–16p, 15m–15o, `TIMINGS=1`: before 75.7s (load ~40), after 46.6s (load ~2); 21.7s before the spacing. 16m and 16n stay ~9s each, mostly spacing. 554 checks unchanged. |
| 2026-09-27 | 📌 | T04 review: with the fence guard deleted, 11c'''' failed only 8 of 10 runs. Its "still starting" window (nap 1.5) can hold no healer pass, since ticks skip while reconcile holds the lock. Pre-existing; left for T09. |
| 2026-09-27 | 📌 | T04, load ~3.5, 0 orphans: 11–11p 146s before, 47s after; full run 457s, ALL PASS (767 checks). Agent switches poll `"agent":` in terminals.json, which showTerminal writes last. |
| 2026-09-27 | 🐞 | T04: 11c'''' "a browser sitting at a shell is never questioned" flaked at load 23. A healer tick that read the pane table before the retitle queried broot after the truncation. Now truncates once the daemon logs the shell status. |
| 2026-09-27 | 📌 | A wait on a stub ARGV line in `$CALLS` returns before the stub rewrites its pane table, so a test `retitle` just after can be lost (11c'''' never saw broot quit). Wait on the daemon's log line; it logs after the stub returns. |
| 2026-09-27 | 🐞 | 3b baseline flake ("first flush injected"): re-attach re-arms the annotation watch by emptying the review file, wiping a flush written earlier. Reproduced by cutting that wait to 0.3s. T03 polls for the emptied file. |
| 2026-09-27 | 🐞 | A wait ending at an attach's relaunch let section 10 rewrite `$PANESTATE` while the attach's later stub calls rewrote it too; the edit was lost and no heal came. Wait for terminals.json's `agent`, the attach's last write. |
| 2026-09-27 | 📌 | T03: sections 1–10 went 82.5s (load 3) to 27.6s quiet, 32.5s at load 25; 152 checks. Full run ALL PASS 767 at load 22–28. Under 8 copies plus 16 `yes` burners: new 16/16 pass, old failed 1–2. |
| 2026-09-27 | 🐞 | T05 review: cockpitd calls the wezterm stub (`list`, first `get-text`) before `refreshAgenda("start")` reads state, so "stub was called" is not "booted". D3 now waits for a second fleet poll. Other daemon-boot polls should use the same signal. |
| 2026-09-27 | 📌 | T05 TIMINGS before→after (load 3–26): 12 20.0→1.6, 12b 5.9→1.2, 12c 110.5→10.7, 13 32.4→8.9, 13b 16.2→3.4; footer+agenda 185s→26s. Full run 402s, 767 checks. Old clicks waited 4s each for script(1) to exit. |
| 2026-09-27 | 📌 | T05 stability: `ONLY=13c` and `ONLY=12b` 5× serial, and 13c/12b/12c 3 rounds of 4 concurrent, all passed at load 6–14. Mutants (stale 300ms, in-flight guard removed, stale w3 on return, a live press expected empty) all failed. |
| 2026-09-27 | 📌 | T06 review: 14's in-flight window is a fixed 1.5s but `BB_TICK_MS` grows with SPEED; at 1.0 (800ms) about one tick lands behind the held pass, at 2.0 none, making the check vacuous. Mutant still caught at 1.0; left. |
| 2026-09-27 | 📌 | T06 dashboard chain, `TIMINGS=1`, load ~3: before 14 33.5s, 14d 24.5s, 14b 10.2s, total 68.4s; after 9.5, 3.9, 2.1, 16.0s. 85 checks unchanged. `ONLY=14c` 5 serial and 3×4 concurrent runs passed, load up to 11. |
| 2026-09-27 | 📌 | bitbucket `refreshPRs` logs each repo, then writes the cache once at pass end. A poll on the log line can read the previous pass's cache; T06 polls the cache (`bqtrue`) or waits for a second log line. |
| 2026-09-27 | 📌 | T01 review: `ONLY="11c'''"` failed section 7 "the vanished agent's diff pane too" at load 28. T03 made that wait a poll on the reap log. |
| 2026-09-27 | 📌 | T01 baseline, merged script, 0 orphans: 557s, 767 checks. Chains: main 303s, footer 134s, dashboard 69s, agenda 49s. Top ten: 12c 109, 14 34, 13 33, 14d 25, 12 20, 13b 16, 11k 12, 16n 11, 11p 11, 14b 10. |
| 2026-09-27 | 📌 | That baseline ran beside another suite, load 2.8 rising to 24; a load-5 run with six orphans took 560s, so wall time is wait-bound. Section 12c (pir-pane footer switch, ~0.8s per frame) alone is 109s. |
| 2026-09-27 | 🐞 | The EXIT trap named `D7PID`, set only in 15m; any run skipping 15m died on `set -u` in the trap, skipping `daemon_sweep` and `rm -rf $T`. T01 initialises it with the others. |
| 2026-09-27 | 📌 | Plan review: a fresh copy under `.claude/worktrees/` passed, 545 checks, 370s, load ~4.5, no escape bytes despite `FORCE_COLOR=3`. A copy under `$TMPDIR` fails 11's two broot `--conf` checks (path spelled differently); out of scope. |
| 2026-09-27 | 📌 | Leaked test cockpitd have parent pid 1; a running suite's daemon has its suite as parent. A temp-path match alone kills a sibling worker's live run, so hand cleanup matches orphans only (DESIGN §5.2). |
| 2026-09-27 | 📌 | Planning baseline (pre-pir-pane main `d80b11f`, not clean): 6m13s, 13% CPU. Main 1–10 82s, 11–11p 145s, footer 25s, agenda 48s, dashboard 69s. Largest: 14 34s, 13 32s, 14d 25s, 12 20s, 13b 16s, 11k 12s. |
| 2026-09-27 | 📌 | Script has 90 fixed `sleep`s (218s) and 90 `nap`s (~116s at 0.5). Only 9 waits poll. `DIFF_RELAUNCH_COOLDOWN_MS` is scaled (1.5s at 0.5), so 11's "not scaled" 5s sleeps overshoot it ~3x. |
| 2026-09-27 | 📌 | Checks in 11i, 11m, 11n, 11o grep lines an earlier section already wrote, so they pass whatever their section does (5g, 6b, 8, 9d made count-based in T03). A `waitfor` on such a line returns at once (DESIGN §3.3). |
| 2026-09-27 | 📌 | Other suites: browse-test 110s, agenda 6s, notes 4s, the rest under 3s. browse-test is out of scope (DESIGN §7). |
