# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they
walk past.

**Plan reviewed:** 2026-10-09 — 3 fixed, 2 decided with the user

**Status:** T00-T06 ✅. Plan complete.
**Last updated:** 2026-10-09
**Next `pir-work` will:** nothing; the plan is built.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | claude-status-spike | — | ✅ | |
| T01 | status-model | T00 | ✅ | |
| T02 | status-gather | T00 | ✅ | |
| T03 | picker-render | — | ✅ | |
| T04 | picker-wiring | T01, T02, T03 | ✅ | |
| T05 | picker-status-drill | T04 | ✅ | |
| T06 | docs | T05 | ✅ | Review: one fix, README now says the picker needs pir installed. Every doc claim checked against code, spike RESULTS and FINDINGS (timeouts, `kind`/`blocked`, `--all`, strings, ordering, 0.15-0.19s); fleet-picker-test rerun, 593 checks. README-had-no-picker deviation held. No mutation: docs only. |

**Review queue:** empty

## Blocked on the user

Nothing. Outside this plan: the pir `endedAt` change ([pir-ended-at.md](pir-ended-at.md)) is the
person's to start in the pir repo when they choose.
