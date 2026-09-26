# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-26 | 📌 | `FORCE_COLOR=3` is set in this machine's session environment, contradicting usage-limits DESIGN §5. cockpit-test and notes-test still printed zero escape bytes. |
| 2026-09-26 | 📌 | cockpit-test takes about 6 minutes (545 checks); notes-test 4s. A fresh clone needs no setup and stays clean. |
| 2026-09-26 | 📌 | revdiff's `O` flush without `-o` writes to stdout and quits, so pir-followed diffs keep `-o review-{key}.md` and the daemon simply does not inject (DESIGN §2.7). |
| 2026-09-26 | 📌 | The pir dashboard exposes nothing outside its screen: no title escape, no state file, headers carry no path. Hence the `PIR_DASHBOARD_STATE` contract (DESIGN §2.4). |
