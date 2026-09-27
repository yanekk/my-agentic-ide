# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 6 fixed, 1 decided with the user

**Status:** T01–T04 done; T05 left.
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T05 (leak-free-check).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | test-daemons-lib | — | ✅ | |
| T02 | cockpit-test-adopt | T01 | ✅ | |
| T03 | owner-backstop | T01, T02 | ✅ | Review clean, no fix commit. All nine suites pass (daemon-leak-test 58, cockpit-test 546); pgrep of cockpitd identical before and after. Probed: shutdown is declared before the interval fires, log is synchronous so the gone line lands before exit, the launch fence counts six real launches. Two-miss reset is untested. |
| T04 | other-suites-tripwire | T01 | ✅ | |
| T05 | leak-free-check | T03, T04 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
