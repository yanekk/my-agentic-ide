# Findings log

**What the build taught.** Read the rows touching the task you pick up.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 🐞 | Planning baseline failed section 3 ("first flush injected", "the diff is reset (relaunched clean) on send") with 2 leaked cockpitd and load ~4. The suite already flakes under load; T03 owns it. |
| 2026-09-27 | 📌 | Planning baseline (pre-pir-pane main `d80b11f`, not clean): 6m13s, 13% CPU. Main 1–10 82s, 11–11p 145s, footer 25s, agenda 48s, dashboard 69s. Largest: 14 34s, 13 32s, 14d 25s, 12 20s, 13b 16s, 11k 12s. |
| 2026-09-27 | 📌 | Script has 90 fixed `sleep`s (218s) and 90 `nap`s (~116s at 0.5). Only 9 waits poll. `DIFF_RELAUNCH_COOLDOWN_MS` is scaled (1.5s at 0.5), so 11's "not scaled" 5s sleeps overshoot it ~3x. |
| 2026-09-27 | 📌 | Checks in 5g, 6b, 8, 9d, 11i, 11m, 11n, 11o grep lines an earlier section already wrote, so they pass whatever their section does. A `waitfor` on such a line returns at once (DESIGN §3.3). |
| 2026-09-27 | 📌 | Other suites: browse-test 110s, agenda 6s, notes 4s, the rest under 3s. browse-test is out of scope (DESIGN §7). |
