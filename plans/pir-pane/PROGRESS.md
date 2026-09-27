# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 9 fixed, 3 decided with the user

**Status:** Planned. Nothing built. The pir-side change is a separate plan started from
[PIR-PROMPT.md](PIR-PROMPT.md); only T07 waits for it.
**Last updated:** 2026-09-26
**Next `pir-work` will:** implement T00 (swap-spike), the riskiest unknown; T01 and T02 have no
dependencies and may run beside it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | swap-spike | — | ✅ | |
| T01 | pir-model | — | ✅ | |
| T02 | footer-switch | — | ✅ | |
| T03 | program-swap | T00 | ✅ | |
| T04 | pir-follow | T01, T03 | ✅ | |
| T05 | docs | T04 | ✅ | |
| T06 | pir-pane-drill | T02, T04 | ✅ | |
| T07 | live-check | T05, T06 | ✅ | Review: rig-check re-run green (47), both suites green (79, 766). Fixed teardown: its scratch-pir check grepped for `PIR_HOME` on the command line and could never match; now checks pir's own pid. Live window verified by hand 2026-09-27, clicks first try. Deviation accepted: rig repo `git init`ed so `run.cwd` is a path. |

**Review queue:** *(empty)*

## Blocked on the user

Nothing. The person should reopen the cockpit window once more so it loads main's code again.
