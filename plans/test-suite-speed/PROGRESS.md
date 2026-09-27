# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. Whoever writes a cell also fixes the
over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** T01 done. T02 next; T03–T07 wait on it.
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T02.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | section-runner | — | ✅ | Review clean, no fix commit. Full run 767, ALL PASS at load ~15–28. Probed: `ONLY` nope/partial-nope exit 2, a forced FAIL under `ONLY=12` exits 1 with FAILURES, `ONLY=14c` prefix, a renamed heading refused by the `CHAIN_OF` check, no orphans left. Baseline ran beside another suite, not on a quiet machine. |
| T02 | waituntil | — | ⬜ | |
| T03 | convert-main-early | T01, T02 | ⬜ | |
| T04 | convert-browse | T01, T02 | ⬜ | |
| T05 | convert-footer-agenda | T01, T02 | ⬜ | |
| T06 | convert-dashboard | T01, T02 | ⬜ | |
| T07 | convert-pir-pane | T01, T02 | ⬜ | |
| T08 | concurrent-chains | T03, T04, T05, T06, T07 | ⬜ | |
| T09 | stability-proof | T08 | ⬜ | |
| T10 | docs | T09 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
