# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 9 fixed, 3 decided with the user

**Status:** Planned. Nothing built. The pir-side change is a separate plan started from
[PIR-PROMPT.md](PIR-PROMPT.md); only T07 waits for it.
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T06 (pir-pane-drill); T07 follows once T05 and T06 are done.

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
| T05 | docs | T04 | ✅ | Reviewed clean, no fix commit. Every doc claim checked against cockpitd, layout, cockpit-pir.sh and the model; install.sh --check run for real; a mutation (die + MISSING in the pir branch) turned three installer checks red; table still thirty rows. Suites 79 and 750 pass. |
| T06 | pir-pane-drill | T02, T04 | ⬜ | |
| T07 | live-check | T05, T06 | ⬜ | The pir side landed and is installed (pir `d4f2e7e`, 2026-09-27). |

**Review queue:** empty

## Blocked on the user

Nothing yet. T07 will need a rebuild of the live cockpit window.
