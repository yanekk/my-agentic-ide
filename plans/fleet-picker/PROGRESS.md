# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-10-07 — 3 fixed, 3 decided with the user

**Status:** Planned. Nothing built.
**Last updated:** 2026-10-07
**Next `pir-work` will:** implement T04 (picker-drill), now that T02 and T03 are ✅; T05 once T01 is ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | keypress-spike | — | ✅ | |
| T01 | key-binding | T00 | ⬜ | |
| T02 | picker-screen | — | ✅ | |
| T03 | daemon-picker | T00, T02 | ✅ | Review clean, no fix commit. Ran ONLY=17i,15m (647) and pir-pane-test; mutations caught: bb-review picker guard (17h), switch dim while open (17c). Probed fs.watch on macOS: names `cmd`, ~24ms. Verb contract with the real picker matched. Lock-timeout dropping a picker answer logged, unreproduced. Strip click gate read-only. |
| T04 | picker-drill | T02, T03 | ⬜ | |
| T05 | docs | T01, T03 | ⬜ | |
| T06 | live-check | T04, T05 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing yet. T00 needs the person at the keyboard for about a minute; T06 needs a rebuild of the
live window and approval to repoint `~/.wezterm.lua`.
