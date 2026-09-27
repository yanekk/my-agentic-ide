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
**Next `pir-work` will:** implement T02 (footer-switch) or T04 (pir-follow); both are unblocked.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | swap-spike | — | ✅ | |
| T01 | pir-model | — | ✅ | |
| T02 | footer-switch | — | ⬜ | |
| T03 | program-swap | T00 | ✅ | Reviewed clean bar one misplaced comment (fixed). Suite green, 617. Probed: lock shared with terminal verbs, landmark on foot in every tab lookup, remaining panes.fleet uses mean claude, 15a–15o assert real calls. Pir pane dying while shown is logged in FINDINGS. |
| T04 | pir-follow | T01, T03 | ⬜ | |
| T05 | docs | T04 | ⬜ | |
| T06 | pir-pane-drill | T02, T04 | ⬜ | |
| T07 | live-check | T05, T06 | ⬜ | The pir side landed and is installed (pir `d4f2e7e`, 2026-09-27). |

**Review queue:** empty

## Blocked on the user

Nothing yet. T07 will need a rebuild of the live cockpit window.
