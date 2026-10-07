# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-10-07 — 3 fixed, 3 decided with the user

**Status:** Planned. Nothing built.
**Last updated:** 2026-10-07
**Next `pir-work` will:** implement T00 (keypress-spike), the riskiest unknown; T02 has no
dependencies and may run beside it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | keypress-spike | — | ✅ | |
| T01 | key-binding | T00 | ✅ | |
| T02 | picker-screen | — | ✅ | |
| T03 | daemon-picker | T00, T02 | ✅ | |
| T04 | picker-drill | T02, T03 | ⬜ | |
| T05 | docs | T01, T03 | 🔍 | CLAUDE.md: ← picker sentences in the pir paragraph, file list (four bin/wezterm files, both suites, plus `spikes/fleet-picker-spike/`), `terminals.json` `pickerOpen`/`picker`, `panes.json` `picker`. docs/cockpit.md: new picker section. pir-pane DESIGN §2.1, §8 blockquotes. Docs only; ran both picker suites and pir-pane-test. Deviation: spike folder listed too, not named in the doc. |
| T06 | live-check | T04, T05 | ⬜ | |

**Review queue:** T05

## Blocked on the user

Nothing yet. T00 needs the person at the keyboard for about a minute; T06 needs a rebuild of the
live window and approval to repoint `~/.wezterm.lua`.
