# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | pir `d4f2e7e` publishes `PIR_DASHBOARD_STATE` (installed). Driven on its conversation rig: list, run, worker, back twice, quit all match §2.4; file removed on Esc. Back is ←; Esc in a worker view interrupts, not back. |
| 2026-09-27 | 📌 | pir's run key is `{repo}__{record.slug}`, and a planning run's slug is its run id until the rename, so the rename changes the key, not only `cwd` (§2.11). The cockpit sees a new run; the old key is reaped. |
| 2026-09-27 | 📌 | pir moved to `4e209ad` (plan-only: a new-plan box on the runs list); the installed engine matches its source. The engine parser keeps YAML-style quotes on a test line, so a quoted line runs as one command name (exit 127). |
| 2026-09-26 | 📌 | `FORCE_COLOR=3` is set in this machine's session environment, contradicting usage-limits DESIGN §5. cockpit-test and notes-test still printed zero escape bytes. |
| 2026-09-26 | 📌 | cockpit-test takes about 6 minutes (545 checks); notes-test 4s. A fresh clone needs no setup and stays clean. |
| 2026-09-26 | 📌 | revdiff's `O` flush without `-o` writes to stdout and quits, so pir-followed diffs keep `-o review-{key}.md` and the daemon simply does not inject (DESIGN §2.7). |
| 2026-09-26 | 📌 | The pir dashboard exposes nothing outside its screen: no title escape, no state file, headers carry no path. Hence the `PIR_DASHBOARD_STATE` contract (DESIGN §2.4). |
