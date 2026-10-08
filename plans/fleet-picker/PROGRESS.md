# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-10-07 — 3 fixed, 3 decided with the user

**Status:** Built. Every task ✅; the whole suite runs once at pir's end gate.
**Last updated:** 2026-10-08
**Next `pir-work` will:** nothing; the plan is complete.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | keypress-spike | — | ✅ | |
| T01 | key-binding | T00 | ✅ | |
| T02 | picker-screen | — | ✅ | |
| T03 | daemon-picker | T00, T02 | ✅ | |
| T04 | picker-drill | T02, T03 | ✅ | |
| T05 | docs | T01, T03 | ✅ | |
| T06 | live-check | T04, T05 | ✅ | Review clean, no fix commit. Restore confirmed by readlink and config.lua read; person's answer backed by live daemon.log picker open/close lines over claude and pir 2026-10-08. Keys, picker, pir-pane suites rerun green; cockpit-test deferred to pir's end run (parallel rule). Feel and lag read-only, person's word. |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
