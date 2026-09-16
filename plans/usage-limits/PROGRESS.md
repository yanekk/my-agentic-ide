# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — run `/pir-review-plan usage-limits` before the first `/pir-work`

**Status:** Plan written 2026-09-16, direction confirmed against the prototype. Nothing built.
Awaiting the plan review before any task starts.
**Last updated:** 2026-09-16
**Next `pir-work` will:** nothing yet — `/pir-review-plan usage-limits` must run first. After
that, implement T00 (the only task with no dependencies and the one that gates the cache shape).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Capture the real `rate_limits` stdin shape | — | ⬜ | Hand-verified: needs the user's live subscription. Gates T02's parse and the cache shape. |
| T01 | `cockpit-usage-store.mjs` (cache read/write) | — | ⬜ | |
| T02 | `cockpit-usage-model.mjs` (pure: normalize + renderUsage) | T00 | ⬜ | Carries the purity grep. Bulk of the logic and tests. |
| T03 | `cockpit-usage-tap.mjs` (statusline command) | T00, T01, T02 | ⬜ | |
| T04 | Register statusline in settings.json (`--install`/`--uninstall`) | T03 | ⬜ | |
| T05 | Footer usage segment in `cockpit-strip.mjs` | T01, T02 | ⬜ | Off the critical path; parallel with T03/T04. |
| T06 | Install and verify on the live subscription | T04, T05 | ⬜ | Hand-verified with the user. Automated half is green from the other tasks; this half is real-world only. |

**Review queue:** *(empty)*

## Blocked on the user

Nothing yet. T00 and T06 will each need the user's live personal subscription (and a Bedrock
session for T06); the implementing session raises the exact command when it reaches them.
