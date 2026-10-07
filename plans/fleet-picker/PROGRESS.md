# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-10-07 — 3 fixed, 3 decided with the user

**Status:** T00 implemented, awaiting review.
**Last updated:** 2026-10-07
**Next `pir-work` will:** review T00.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | keypress-spike | — | 🔍 | Spike in `spikes/fleet-picker-spike/`; all four gates pass, numbers in RESULTS.md; GUI run verified by the person. Deviations: added `probe.mjs`, `stub-daemon.mjs`, `stub-picker.mjs`, `stand-in.mjs` beside the named files; probe starts a scratch pir backend and runs claude from the main checkout (trust prompt). |
| T01 | key-binding | T00 | ⬜ | |
| T02 | picker-screen | — | ⬜ | |
| T03 | daemon-picker | T00, T02 | ⬜ | |
| T04 | picker-drill | T02, T03 | ⬜ | |
| T05 | docs | T01, T03 | ⬜ | |
| T06 | live-check | T04, T05 | ⬜ | |

**Review queue:** T00

## Blocked on the user

Nothing now. T06 needs a rebuild of the live window and approval to repoint `~/.wezterm.lua`.
