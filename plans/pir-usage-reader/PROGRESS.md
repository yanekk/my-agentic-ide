# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-30 — 9 fixed, 4 decided with the user

**Status:** Planned 2026-09-30. T01–T04 done.
**Last updated:** 2026-10-01
**Next `pir-work` will:** implement T05 or T06; both have their dependencies done.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | pir-reading-decision | — | ✅ | |
| T02 | pir-usage-reader | T01 | ✅ | |
| T03 | daemon-poll | T01, T02 | ✅ | Review clean, no fix commit. Both recorded deviations accepted (`$TP` keeps `$T2` fakes unmatched; 8 launches). Probed: gutting the in-flight guard turns §15 red (run); hang window fits the 2 s limit; `ONLY=15` green; four full runs, one flaked in 5f/7 (see FINDINGS); daemon-leak 59 green, no daemon left. |
| T04 | install-report | T02 | ✅ | |
| T05 | docs | T03, T04 | ⬜ | |
| T06 | live-check-script | T02, T03 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.

## Outstanding after the merge

PLAN § After the merge, not yet run. It waits on this plan merged and on pir's service installed
from `~/src/plan-implement-review`; it needs a yes to `pir service off`/`on` and the cockpit
window reopened.
