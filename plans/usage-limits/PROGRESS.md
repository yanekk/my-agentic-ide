# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-16 — 6 fixed, 1 decided with the user

**Status:** Plan written, reviewed 2026-09-16. T00/T01 done; T02 implemented, awaiting review.
**Last updated:** 2026-09-16
**Next `pir-work` will:** review T02 (`cockpit-usage-model.mjs`, implemented). T03/T05 depend on it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Capture the real `rate_limits` stdin shape | you | — | ✅ | |
| T01 | `cockpit-usage-store.mjs` (cache read/write) | auto | — | ✅ | |
| T02 | `cockpit-usage-model.mjs` (pure: normalize + renderUsage) | auto | T00 | 🔍 | Model + 22 model tests; purity grep added to run.sh. `used_percentage` float rounded (Math.round) in normalize so cache holds ints. Weekday via fixed array, not Intl, to keep the string locale-free. Tests pin TZ=UTC. |
| T03 | `cockpit-usage-tap.mjs` (statusline command) | auto | T00, T01, T02 | ⬜ | |
| T04 | Register statusline in settings.json (`--install`/`--uninstall`) | auto | T03 | ⬜ | Tests use a scratch dir (`COCKPIT_DIR`); the real settings.json edit is T06, human-driven. |
| T05 | Footer usage segment in `cockpit-strip.mjs` | auto | T01, T02 | ⬜ | Off the critical path; parallel with T03/T04. |
| T06 | Install and verify on the live subscription | you | T04, T05 | ⬜ | Hand-verified with the user. No code; the automated half is green from the other tasks, this half is real-world only. |

**Review queue:** T02

## Blocked on the user

Nothing yet. T00 and T06 will each need the user's live personal subscription (and a Bedrock
session for T06); the implementing session raises the exact command when it reaches them.
