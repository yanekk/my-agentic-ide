# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-10-07 — 3 fixed, 3 decided with the user

**Status:** T00–T03 done; T04 awaiting review.
**Last updated:** 2026-10-07
**Next `pir-work` will:** review T04 (picker-drill); T05 may be built beside it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | keypress-spike | — | ✅ | |
| T01 | key-binding | T00 | ✅ | |
| T02 | picker-screen | — | ✅ | |
| T03 | daemon-picker | T00, T02 | ✅ | |
| T04 | picker-drill | T02, T03 | 🔍 | Drill steps 11–20 (picker phase), DRILL PASS 364 at both sizes; `DRILL_PICKER_ONLY=1`. Fix: picker ignores reads carrying Ctrl+D (WezTerm closing a pane wrote `\n`+^D, read as Enter); pty test added. Deviation: resize driven by `adjust-pane-size` on the slot, no window on a headless mux. Waits added to four flaky pir-phase checks. |
| T05 | docs | T01, T03 | ⬜ | |
| T06 | live-check | T04, T05 | ⬜ | |

**Review queue:** T04

## Blocked on the user

Nothing yet. T00 needs the person at the keyboard for about a minute; T06 needs a rebuild of the
live window and approval to repoint `~/.wezterm.lua`.
