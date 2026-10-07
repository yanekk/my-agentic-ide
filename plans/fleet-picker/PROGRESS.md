# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-10-07 — 3 fixed, 3 decided with the user

**Status:** T00 done.
**Last updated:** 2026-10-07
**Next `pir-work` will:** implement T01 (key-binding) or T02 (picker-screen); both are unblocked.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | keypress-spike | — | ✅ | Spike in `spikes/fleet-picker-spike/`, all four gates pass, GUI run verified by the person. Review clean, no fix commit: reran probe.sh (numbers reproduce, watch beats poll), PROBE_FAIL exits 1 with teardown; gutting the mux kill was caught; decide self-test caught a mutation; ps found no leftover claude, pir or backend. |
| T01 | key-binding | T00 | ⬜ | |
| T02 | picker-screen | — | ⬜ | |
| T03 | daemon-picker | T00, T02 | ⬜ | |
| T04 | picker-drill | T02, T03 | ⬜ | |
| T05 | docs | T01, T03 | ⬜ | |
| T06 | live-check | T04, T05 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing now. T06 needs a rebuild of the live window and approval to repoint `~/.wezterm.lua`.
