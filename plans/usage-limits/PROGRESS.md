# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-16 — 6 fixed, 1 decided with the user

**Status:** T00–T03 done. T04 and T05 next (parallel, both off the live path).
**Last updated:** 2026-09-16
**Next `pir-work` will:** implement T04 (`--install`/`--uninstall`) or T05 (footer segment).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Capture the real `rate_limits` stdin shape | you | — | ✅ | |
| T01 | `cockpit-usage-store.mjs` (cache read/write) | auto | — | ✅ | |
| T02 | `cockpit-usage-model.mjs` (pure: normalize + renderUsage) | auto | T00 | ✅ | |
| T03 | `cockpit-usage-tap.mjs` (statusline command) | auto | T00, T01, T02 | ✅ | Clean, no fix. All 7 task cases assert real behaviour (gutting the tap fails them). Bedrock gate first, skips inspection; no-clobber holds for absent/empty rate_limits; exit-0/empty on every path incl. unwritable dir; clock read in tap, model pure. Probed JSON primitives/arrays as stdin → all "". usage-test 63 green. |
| T04 | Register statusline in settings.json (`--install`/`--uninstall`) | auto | T03 | ⬜ | Tests use a scratch dir (`COCKPIT_DIR`); the real settings.json edit is T06, human-driven. |
| T05 | Footer usage segment in `cockpit-strip.mjs` | auto | T01, T02 | ⬜ | Off the critical path; parallel with T03/T04. |
| T06 | Install and verify on the live subscription | you | T04, T05 | ⬜ | Hand-verified with the user. No code; the automated half is green from the other tasks, this half is real-world only. |

**Review queue:** (empty)

## Blocked on the user

Nothing yet. T00 and T06 will each need the user's live personal subscription (and a Bedrock
session for T06); the implementing session raises the exact command when it reaches them.
