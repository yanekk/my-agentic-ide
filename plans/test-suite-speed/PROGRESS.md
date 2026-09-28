# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. Whoever writes a cell also fixes the
over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** All tasks T01–T11 done.
**Last updated:** 2026-09-28
**Next `pir-work` will:** nothing; the plan is complete.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | section-runner | — | ✅ | |
| T02 | waituntil | — | ✅ | |
| T03 | convert-main-early | T01, T02 | ✅ | |
| T04 | convert-browse | T01, T02 | ✅ | |
| T05 | convert-footer-agenda | T01, T02 | ✅ | |
| T06 | convert-dashboard | T01, T02 | ✅ | |
| T07 | convert-pir-pane | T01, T02 | ✅ | |
| T08 | concurrent-chains | T03, T04, T05, T06, T07 | ✅ | |
| T09 | stability-proof | T08 | ✅ | |
| T10 | docs | T09 | ✅ | Review clean, no fix commit. Figures match T09 FINDINGS; grep for 6-minute claims clean; run.sh usage header checked against the runner (partial runs print PARTIAL RUN, SECTIONS=1 lists only); swept docs/ and other DESIGNs for stale times. Full suite ALL PASS 770 checks, 101s. |
| T11 | pir-state-backstop | T07; blocks T09 | ✅ | |

**Review queue:** empty

## Blocked on the user

Nothing.
