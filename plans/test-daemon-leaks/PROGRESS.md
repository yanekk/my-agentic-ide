# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 6 fixed, 1 decided with the user

**Status:** T01–T04 done; T05 awaiting review.
**Last updated:** 2026-09-27
**Next `pir-work` will:** review T05 (leak-free-check).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | test-daemons-lib | — | ✅ | |
| T02 | cockpit-test-adopt | T01 | ✅ | |
| T03 | owner-backstop | T01, T02 | ✅ | |
| T04 | other-suites-tripwire | T01 | ✅ | |
| T05 | leak-free-check | T03, T04 | 🔍 | Stopped 15 pre-fix orphans (14 per the rule, plus T01's fake `stubborn`, whose HOME was real: a deviation). All suites green, three interrupts clean, real pid unchanged; see FINDINGS. docs/cockpit.md section and CLAUDE.md listing added. No measured-facts row: no finding called for one. |

**Review queue:** T05

## Blocked on the user

Nothing.
