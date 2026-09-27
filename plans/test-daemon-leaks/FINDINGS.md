# Findings log

**What the build taught.** Read the rows touching the task you pick up. **Newest first. Forty words
a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | T05 checks: all nine suites pass (daemon-leak-test 58, cockpit-test 546). Real cockpitd pid 74362 unchanged before, after and between every check. Interrupting cockpit-test ~20s in by SIGINT to its group, SIGTERM to its shell, or SIGKILL to its shell leaves no daemon (≤1.5s). |
| 2026-09-27 | 📌 | A suite backgrounded from a non-interactive bash ignores SIGINT, so a scripted Ctrl-C check passes vacuously by running to completion. Reset it (`perl -e '$SIG{INT}="DEFAULT"; setpgrp(0,0); exec @ARGV'`) and confirm the log has no result sentinel. |
| 2026-09-27 | 📌 | Pre-fix orphans stopped by pid, user-approved after the auto-mode classifier blocked it: 1045 1124 8838 9703 28339 57263 60663 66244 69702 76391 86102 87693 93694 94699 (16m–2h20m, tmp HOME, ppid 1), plus T01's fake `stubborn` 31176. |
| 2026-09-27 | 🐞 | cockpit-test stubs `ps` on PATH, so the helpers read the stub: tripwire passed a leaked daemon, `daemon_stop` always waited 2s. Helper now calls `/bin/ps` and `/usr/bin/pgrep` (T02). |
| 2026-09-27 | 📌 | cockpit-test section 13 "an auth failure classifies as auth" failed once (`<error>`) in three runs under load, passed the other two. Timing flake, untouched by T02. |
| 2026-09-27 | 📌 | `spikes/pir-pane-test/run.sh` did not exist on main when T04 ran, so it has no sweep or tripwire. Whoever creates it sources `spikes/lib/test-daemons.sh` and adds both (DESIGN §2.5). |
| 2026-09-27 | 📌 | `bin/cockpit-layout.sh` runs `pkill -f "cockpitd.mjs"`, so rebuilding the cockpit kills every test daemon of every running suite and pir worktree. Out of scope (DESIGN §7). |
| 2026-09-27 | 📌 | browse-test runs the real `cockpit-layout.sh`, but only the missing-tool paths, which exit at lines 50–59 before that `pkill` at 184. A test reaching past line 184 would kill the real daemon. |
| 2026-09-27 | 📌 | Measured: SIGTERM to only the suite shell ran its trap, deleted `$T`, left 2 of 3 wrapped daemons alive. SIGKILL left all 3 and `$T`. SIGINT to the group left none. |
