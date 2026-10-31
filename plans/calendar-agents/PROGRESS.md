# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The cell is an index for the next session; the account is the commit message. **Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-10-31 — 15 fixed, 7 decided with the user

**Status:** Plan reviewed. Nothing built.
**Last updated:** 2026-10-31
**Next `pir-work` will:** review T03; T00 and T01 are unaffected.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | long-command-spike | — | ⬜ | |
| T01 | cockpit-suite-flake | — | ⬜ | |
| T02 | job-decisions | T00 | ⬜ | |
| T03 | jobs-calendar | — | 🔍 | Flag, both commands, event fields built; about 60 tests. Deviations: pane test in render.test.mjs, its natural home; a fresh sign-in survives a refused add --jobs, since tokens are costly; AGENDA_DRY_RUN also binds agenda jobs; help reads add <slug> [--jobs], because run.sh counts that line. |
| T04 | job-starter | T02, T03 | ⬜ | |
| T05 | daemon-wiring | T01, T03, T04 | ⬜ | |
| T06 | live-check | T00, T05 | ⬜ | |

A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** T03

## Blocked on the user

Nothing yet.
