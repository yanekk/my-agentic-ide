# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, flat prose.

**Plan reviewed:** 2026-11-01 — 13 fixed, 5 decided with the user

**Status:** T00 implemented, awaiting review. The live calendar stays on and unconfined until merge and window reopen.
**Last updated:** 2026-11-01
**Next `pir-work` will:** review T00.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | wall-measurements | — | 🔍 | Every item answered in `spikes/calendar-wall-spike/RESULTS.md`; five owner decisions in DESIGN §7. Deviations: branch refusals on a copy of superfrog's git store; real daemon restart not done; Apple Events control weak; extra probes `tools`, `closing`, `keyblock`. |
| T01 | wall-rules | T00 | ⬜ | |
| T02 | write-guard | T01 | ⬜ | |
| T03 | exceptions-list | T01 | ⬜ | |
| T04 | confined-start | T01, T02, T03 | ⬜ | |
| T05 | trial-run | T04 | ⬜ | |
| T06 | skill-refactor | T03, T05 | ⬜ | |
| T07 | wall-check | T04, T05 | ⬜ | |
| T08 | docs | T06, T07 | ⬜ | |

**Review queue:** T00

## Blocked on the user

Nothing now. After the merge the owner runs `bin/install.sh`, reopens the window, and adds any exception T07 showed a job needs (DESIGN §5.3).
