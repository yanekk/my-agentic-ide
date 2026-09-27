# Findings log

**What the build taught.** Read the rows touching the task you pick up. **Newest first. Forty words
a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | `bin/cockpit-layout.sh` runs `pkill -f "cockpitd.mjs"`, so rebuilding the cockpit kills every test daemon of every running suite and pir worktree. Out of scope (DESIGN §7). |
| 2026-09-27 | 📌 | browse-test runs the real `cockpit-layout.sh`, but only the missing-tool paths, which exit at lines 50–59 before that `pkill` at 184. A test reaching past line 184 would kill the real daemon. |
| 2026-09-27 | 📌 | Measured: SIGTERM to only the suite shell ran its trap, deleted `$T`, left 2 of 3 wrapped daemons alive. SIGKILL left all 3 and `$T`. SIGINT to the group left none. |
