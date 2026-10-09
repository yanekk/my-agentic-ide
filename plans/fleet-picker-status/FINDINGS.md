# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify. A ✅ row is the entire record that something was seen working
for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

**Whoever appends, compacts.** Over 60 rows or 15 KB, shrink it first: merge repeats, drop rows
now enforced by code or a test (say where), never drop a ✅ row or a greppable term.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-09 | 🐞 | T03 review: the picker's `width()` counts code points, so a CJK or emoji name overflows the slot (a 39-column line drew ~55 cells). The agenda's `visibleLen` shares the assumption. Open, not fixed. |
| 2026-10-09 | 🐞 | T03 review sweep: `bin/cockpit-strip.mjs` draws the attached agent's name (`nameSeg`) in the footer without scrubbing control characters, unlike the picker (fixed in T03) and the agenda's `safeText`. Open, not fixed. |
| 2026-10-09 | 🐞 | Plan review: `lastTerminalAt` in `~/.claude/jobs/{id}/state.json` is an ISO 8601 string in all nine files, not epoch ms. It differs from `firstTerminalAt` in six, so it moves on later finishes. Two job folders have no `state.json`. |
| 2026-10-09 | 🐞 | `claude --bg --help` does not print help: it dispatched an empty background session (`fe851138`). Never probe `--bg` with flags; the person was asked to `claude stop` it, as the classifier refused the planner's stop. |
| 2026-10-09 | 📌 | `claude agents --json` omits background agents whose process exited; `--all` includes them (no `pid`, no `status`). Finished agents carry `lastTerminalAt` in `~/.claude/jobs/{id}/state.json`; the list itself has no finish time. |
| 2026-10-09 | 📌 | pir's `GET /v2/runs` needs `Authorization: Bearer $(cat ~/.pir/api-key)`; RunSummary has `waitingForYou`, `display.state`, `state`, but no start or end time. |
| 2026-10-09 | 📌 | `spikes/cockpit-test/run.sh` failed once in a fresh measurement worktree (177s) and passed on rerun (926 checks). Not in this plan's test block; it does not run the picker. |
| 2026-10-09 | 🔄 | Clean finishes were first hidden outright; the person changed it the same day to show them for one hour, in both programs. |
