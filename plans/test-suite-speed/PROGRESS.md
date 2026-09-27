# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. Whoever writes a cell also fixes the
over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** Planned 2026-09-27. Nothing built. Building waits for pir-pane and then
`test-daemon-leaks` to merge to main, because all three edit `spikes/cockpit-test/run.sh` (DESIGN §5).
**Last updated:** 2026-09-27
**Next `pir-work` will:** T01, once pir-pane and then test-daemon-leaks have merged (the person
starts it); it re-takes the baseline on the merged script.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | section-runner | — | ✅ | |
| T02 | waituntil | — | ✅ | |
| T03 | convert-main-early | T01, T02 | 🔍 | Sections 1–10: 62 fixed waits became 60 polls and 5 `nap` windows; 5g/6b/8/9d/10 log checks count-based; 152 checks, 82.5s to 27.6s. 3b cause in FINDINGS. Deviations: negated polls use `sh -c '! grep'` (no new helper); the startup `sleep 1` before section 1 is left, it is shared setup. |
| T04 | convert-browse | T01, T02 | ⬜ | |
| T05 | convert-footer-agenda | T01, T02 | ⬜ | |
| T06 | convert-dashboard | T01, T02 | ⬜ | |
| T07 | convert-pir-pane | T01, T02 | ⬜ | |
| T08 | concurrent-chains | T03, T04, T05, T06, T07 | ⬜ | |
| T09 | stability-proof | T08 | ⬜ | |
| T10 | docs | T09 | ⬜ | |

**Review queue:** T03

## Blocked on the user

Nothing.
