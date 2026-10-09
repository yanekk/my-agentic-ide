# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they
walk past.

**Plan reviewed:** 2026-10-09 — 3 fixed, 2 decided with the user

**Status:** T00, T01, T03 done.
**Last updated:** 2026-10-09
**Next `pir-work` will:** T02, then T04 once T01, T02 and T03 are in.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | claude-status-spike | — | ✅ | |
| T01 | status-model | T00 | ✅ | Review clean, no fix commit. Four deviations held by tests. Probed the model on this machine's real `claude agents --json --all`, `state.json` times and `/v2/runs`; eight mutations (hour boundary, kind filter, order, future clamp, wait, progress, label, class order) all caught; purity grep bites. |
| T02 | status-gather | T00 | ⬜ | |
| T03 | picker-render | — | ✅ | |
| T04 | picker-wiring | T01, T02, T03 | ⬜ | |
| T05 | picker-status-drill | T04 | ⬜ | |
| T06 | docs | T05 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing. Outside this plan: the pir `endedAt` change ([pir-ended-at.md](pir-ended-at.md)) is the
person's to start in the pir repo when they choose.
