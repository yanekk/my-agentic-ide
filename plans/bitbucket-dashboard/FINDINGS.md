# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the entire record that something was seen
working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-03 | 📌 | BitBucket list PR call with `fields=%2Bvalues.participants,%2Bvalues.reviewers` returns approvals (`participants[].approved`), reviewers, `comment_count`, `updated_on`, `author`, branches and `links.html` in one call. Confirmed against the public API. So per-repo = one GET; counts and sort are free. |
| 2026-09-03 | 📌 | The default PR list response omits `participants` and `reviewers`; both need the field expansion above. `q=state="OPEN"` filtering works. `pagelen` up to 50, follow `next`. |
| 2026-09-03 | 📌 | The fleet view runs at the projects root (`start_dir` in `~/.claude/cockpit/config.lua`, passed by `wezterm/cockpit.lua`), so a spawned agent's cwd is that root and `@{slug}` resolves to the local clone. T00 must confirm this reference form in the live box. |
| 2026-09-03 | 🔄 | User first chose Review/Address buttons leave the prompt unsent, then changed to auto-start a running agent, wanting the spawn built as a reusable primitive for another feature. Recorded in DESIGN §2.8, §7. |
| 2026-09-03 | ✅ | Direction mock (two tabs, columns, 75/25 split) approved by the user before design. User added the paging-on-overflow requirement (DESIGN §2.5). Mock parked at `prototype/`. |
