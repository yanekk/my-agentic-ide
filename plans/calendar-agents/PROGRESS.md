# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The cell is an index for the next session; the account is the commit message. **Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-10-31 — 15 fixed, 7 decided with the user

**Status:** Plan reviewed. Nothing built.
**Last updated:** 2026-10-31
**Next `pir-work` will:** T00, because the instructions every agent gets depend on its answer. T01 and T03 can run beside it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | long-command-spike | — | ⬜ | |
| T01 | cockpit-suite-flake | — | 🔍 | Two test races fixed in `run.sh`: footer chain has its own settings file; hung polls are stamped. No check added, count stays 934. Deviation: repeated `ONLY=12b,15`, since `ONLY=15` alone never fails and `stress.sh` unsets `ONLY`. Two full runs, approved in session. |
| T02 | job-decisions | T00 | ⬜ | |
| T03 | jobs-calendar | — | ⬜ | |
| T04 | job-starter | T02, T03 | ⬜ | |
| T05 | daemon-wiring | T01, T03, T04 | ⬜ | |
| T06 | live-check | T00, T05 | ⬜ | |

A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** T01

## Blocked on the user

Nothing yet.
