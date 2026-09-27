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
**Next `pir-work` will:** implement T00 (swap-spike), the riskiest unknown; T01 and T02 have no
dependencies and may run beside it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | swap-spike | — | ⬜ | |
| T01 | pir-model | — | ⬜ | |
| T02 | footer-switch | — | 🔍 | Switch segment, `fleet-*` clicks, `reviewable:false` drops `O`; cockpit-test §12c, 47 checks, 592 green; no-fleet frame pinned by pre-T02 hashes. Deviation: at 140 cols the switch overflowed (145), so a fifth trim level drops the `Diff mode:` caption (person, 2026-09-27). Dimmed shown label keeps reverse video. |
| T03 | program-swap | T00 | ⬜ | |
| T04 | pir-follow | T01, T03 | ⬜ | |
| T05 | docs | T04 | ⬜ | |
| T06 | pir-pane-drill | T02, T04 | ⬜ | |
| T07 | live-check | T05, T06 | ⬜ | The pir side landed and is installed (pir `d4f2e7e`, 2026-09-27). |

**Review queue:** T02

## Blocked on the user

Nothing yet. T07 will need a rebuild of the live cockpit window.
