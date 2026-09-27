# Findings log

**What the build taught.** Read the rows touching the task you pick up.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 🐞 | 3b baseline flake ("first flush injected"): re-attach re-arms the annotation watch by emptying the review file, wiping a flush written earlier. Reproduced by cutting that wait to 0.3s. T03 polls for the emptied file. |
| 2026-09-27 | 🐞 | A wait ending at an attach's relaunch let section 10 rewrite `$PANESTATE` while the attach's later stub calls rewrote it too; the edit was lost and no heal came. Wait for terminals.json's `agent`, the attach's last write. |
| 2026-09-27 | 📌 | T03: sections 1–10 went 82.5s (load 3) to 27.6s quiet, 32.5s at load 25; 152 checks. Full run ALL PASS 767 at load 22–28. Under 8 copies plus 16 `yes` burners: new 16/16 pass, old failed 1–2. |
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
