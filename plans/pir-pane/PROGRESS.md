# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 9 fixed, 3 decided with the user

**Status:** Building. T00, T01, T03 done; T04 awaiting review. The pir-side change is a separate plan started from
[PIR-PROMPT.md](PIR-PROMPT.md); only T07 waits for it.
**Last updated:** 2026-09-27
**Next `pir-work` will:** review T04 (pir-follow).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | swap-spike | — | ✅ | |
| T01 | pir-model | — | ✅ | |
| T02 | footer-switch | — | ⬜ | |
| T03 | program-swap | T00 | ✅ | |
| T04 | pir-follow | T01, T03 | 🔍 | onPirState/onEnterKey, pir reaper, inert reviews, `reviewable`; cockpit-test 16a–16p (700 checks). Deviations: start mode applied only when unset or custom, after showDiff; pir review file never truncated; `resolves` checks `^{commit}`; `moveAttachedTo` shared with agent migration; `reviewable:true` written for agents. |
| T05 | docs | T04 | ⬜ | |
| T06 | pir-pane-drill | T02, T04 | ⬜ | |
| T07 | live-check | T05, T06 | ⬜ | The pir side landed and is installed (pir `d4f2e7e`, 2026-09-27). |

**Review queue:** T04

## Blocked on the user

Nothing yet. T07 will need a rebuild of the live cockpit window.
