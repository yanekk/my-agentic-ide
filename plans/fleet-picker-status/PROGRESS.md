# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they
walk past.

**Plan reviewed:** 2026-10-09 — 3 fixed, 2 decided with the user

**Status:** Plan written; nothing built.
**Last updated:** 2026-10-09
**Next `pir-work` will:** review T02; T04 once T01, T02 and T03 are ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | claude-status-spike | — | ✅ | |
| T01 | status-model | T00 | ⬜ | |
| T02 | status-gather | T00 | 🔍 | `cockpit-fleet-status.mjs` (gatherClaude/Pir/All) and `fetchPirRuns`, sharing `findPirService`/`getJson` with `fetchPirUsage`. 59 checks in `usage-test/fleet-status.test.mjs`. Deviations: claude limit is an own timer, not execFile's, so a grandchild holding stdout cannot delay it; ids not matching a plain-name pattern are never read; gatherAll takes `claudeTimeoutMs`/`pirTimeoutMs`/`alive`. |
| T03 | picker-render | — | ✅ | |
| T04 | picker-wiring | T01, T02, T03 | ⬜ | |
| T05 | picker-status-drill | T04 | ⬜ | |
| T06 | docs | T05 | ⬜ | |

**Review queue:** T02

## Blocked on the user

Nothing. Outside this plan: the pir `endedAt` change ([pir-ended-at.md](pir-ended-at.md)) is the
person's to start in the pir repo when they choose.
