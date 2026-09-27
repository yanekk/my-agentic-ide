# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. Whoever writes a cell also fixes the
over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** T01 implemented, awaiting review. T02 can build in parallel.
**Last updated:** 2026-09-27
**Next `pir-work` will:** review T01.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | section-runner | — | 🔍 | `section`/`CHAIN_OF`, `ONLY`/`SECTIONS`/`TIMINGS`; 767 checks, identical list. Deviations: headings 12c and 13 now get the blank line the others had; a startup check refuses a `CHAIN_OF` out of step with headings; `D7PID` initialised (trap crashed on partial runs). Baseline in FINDINGS. |
| T02 | waituntil | — | ⬜ | |
| T03 | convert-main-early | T01, T02 | ⬜ | |
| T04 | convert-browse | T01, T02 | ⬜ | |
| T05 | convert-footer-agenda | T01, T02 | ⬜ | |
| T06 | convert-dashboard | T01, T02 | ⬜ | |
| T07 | convert-pir-pane | T01, T02 | ⬜ | |
| T08 | concurrent-chains | T03, T04, T05, T06, T07 | ⬜ | |
| T09 | stability-proof | T08 | ⬜ | |
| T10 | docs | T09 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing.
