# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The cell is an index for the next session; the account is the commit message. **Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-10-31 — 15 fixed, 7 decided with the user

**Status:** T00 to T04 reviewed.
**Last updated:** 2026-10-31
**Next work will:** T05, the daemon wiring, then T06.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | long-command-spike | — | ✅ | |
| T01 | cockpit-suite-flake | — | ✅ | |
| T02 | job-decisions | T00 | ✅ | |
| T03 | jobs-calendar | — | ✅ | |
| T04 | job-starter | T02, T03 | ✅ | Review fixed: SIGTERM-ignoring claude wedged the tick (SIGKILL added), relative `--root` misfiled notes, vacuous scratch checks, guard test that passed without the guard. Each reproduced, fixed, test locks it. Probed real start line, signal cleanup; five mutations. Real `claude` unrun: T06. |
| T05 | daemon-wiring | T01, T03, T04 | ⬜ | |
| T06 | live-check | T00, T05 | ⬜ | |

A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** empty

## Blocked on the user

Nothing yet.
