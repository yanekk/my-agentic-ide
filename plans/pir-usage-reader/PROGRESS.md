# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — run `/pir-review-plan` before the first `/pir-work`

**Status:** Planned 2026-09-30. Nothing built.
**Last updated:** 2026-09-30
**Next `pir-work` will:** implement T01, the only task with no dependency.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | pir-reading-decision | — | ⬜ | |
| T02 | pir-usage-reader | T01 | ⬜ | |
| T03 | daemon-poll | T01, T02 | ⬜ | |
| T04 | install-report | T02 | ⬜ | |
| T05 | docs | T03, T04 | ⬜ | |
| T06 | live-check | T03, T04 | ⬜ | Also waits on pir's `plans/api-service` built and installed: `pir service` must print `running at`. |

**Review queue:** (empty)

## Blocked on the user

Nothing yet. T06 will need pir's service installed from `~/src/plan-implement-review`, a yes to
`pir service off`/`on`, and the cockpit window reopened on the new code.
