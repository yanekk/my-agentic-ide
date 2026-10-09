# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they
walk past.

**Plan reviewed:** 2026-10-09 — 3 fixed, 2 decided with the user

**Status:** Plan written; nothing built.
**Last updated:** 2026-10-09
**Next `pir-work` will:** T04 once T01 is ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | claude-status-spike | — | ✅ | |
| T01 | status-model | T00 | ⬜ | |
| T02 | status-gather | T00 | ✅ | Review: one fix, the pir stand-in served a bare array where the real `/v2/runs` answers `{ version, runs, counts }`. Probed the real claude and pir read-only; mutated the 401 split, done filter, deadline timer and usage header, each caught. Fake-claude argv and output checked against real. |
| T03 | picker-render | — | ✅ | |
| T04 | picker-wiring | T01, T02, T03 | ⬜ | |
| T05 | picker-status-drill | T04 | ⬜ | |
| T06 | docs | T05 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing. Outside this plan: the pir `endedAt` change ([pir-ended-at.md](pir-ended-at.md)) is the
person's to start in the pir repo when they choose.
