# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 6 fixed, 1 decided with the user

**Status:** Planned. Nothing built.
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T01 (test-daemons-lib), which everything else needs. Hold T02
and T03 while another open run edits `spikes/cockpit-test/run.sh`.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | test-daemons-lib | — | ✅ | |
| T02 | cockpit-test-adopt | T01 | ✅ | |
| T03 | owner-backstop | T01, T02 | ⬜ | |
| T04 | other-suites-tripwire | T01 | ✅ | |
| T05 | leak-free-check | T03, T04 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
