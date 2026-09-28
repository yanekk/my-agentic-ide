# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. Whoever writes a cell also fixes the
over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** Planned 2026-09-27. Nothing built. Building waits for pir-pane and then
`test-daemon-leaks` to merge to main, because all three edit `spikes/cockpit-test/run.sh` (DESIGN §5).
**Last updated:** 2026-09-28
**Next `pir-work` will:** implement T10.

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
| T09 | stability-proof | T08 | ✅ | Review: one defect, run under /bin/bash 3.2 stress.sh exited 0 with nothing run; reproduced with a stub suite, now refuses bash below 5. Probed pass/fail/mixed stub suites, arg errors, Ctrl-C with orphaned fake cockpitd (swept, exit 130, real daemon untouched). Real `--serial 1` and `--parallel 4 --rounds 1`: all pass, 770 checks. |
| T10 | docs | T09 | ⬜ | |
| T11 | pir-state-backstop | T07; blocks T09 | ✅ | |

**Review queue:** empty

## Blocked on the user

Nothing.
