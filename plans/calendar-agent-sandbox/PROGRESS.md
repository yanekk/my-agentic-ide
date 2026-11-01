# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, flat prose.

**Plan reviewed:** 2026-11-01 — 13 fixed, 5 decided with the user

**Status:** Plan written, nothing built. The live calendar stays on and unconfined until merge and window reopen.
**Last updated:** 2026-11-01
**Next `pir-work` will:** T00, because its measurements gate the design.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | wall-measurements | — | ✅ | |
| T01 | wall-rules | T00 | ✅ | |
| T02 | write-guard | T01 | ✅ | |
| T03 | exceptions-list | T01 | ✅ | |
| T04 | confined-start | T01, T02, T03 | ✅ | |
| T05 | trial-run | T04 | ✅ | |
| T06 | skill-refactor | T03, T05 | ✅ | |
| T07 | wall-check | T04, T05 | ✅ | |
| T08 | docs | T06, T07 | ✅ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing now. After the merge the owner runs `bin/install.sh`, reopens the window, and adds any exception T07 showed a job needs (DESIGN §5.3).
