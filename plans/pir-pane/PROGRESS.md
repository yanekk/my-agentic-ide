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
| T00 | swap-spike | — | ✅ | |
| T01 | pir-model | — | ✅ | |
| T02 | footer-switch | — | ✅ | |
| T03 | program-swap | T00 | ✅ | |
| T04 | pir-follow | T01, T03 | ✅ | |
| T05 | docs | T04 | ✅ | |
| T06 | pir-pane-drill | T02, T04 | ✅ | |
| T07 | live-check | T05, T06 | 🔍 | `rig-check.sh`: installed pir on its conversation rig, 47 checks, state file per §2.4 each step, gone on quit. Live window verified by hand 2026-09-27 (clicks first try) by pointing `config.lua` `repo` at the T07 worktree, then restored. Deviation: rig repo `git init`ed so `run.cwd` is a path. |

**Review queue:** T07

## Blocked on the user

Nothing. The person should reopen the cockpit window once more so it loads main's code again.
