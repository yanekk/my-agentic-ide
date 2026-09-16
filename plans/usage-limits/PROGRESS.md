# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-16 — 6 fixed, 1 decided with the user

**Status:** T00, T01, T02, T05 done. T03/T04 not started.
**Last updated:** 2026-09-17
**Next `pir-work` will:** implement T03 (auto), then T04 (auto). Once T04 is ✅, the hand-verified
T06 on the live subscription (needs T05, now ✅).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Capture the real `rate_limits` stdin shape | you | — | ✅ | |
| T01 | `cockpit-usage-store.mjs` (cache read/write) | auto | — | ✅ | |
| T02 | `cockpit-usage-model.mjs` (pure: normalize + renderUsage) | auto | T00 | ✅ | |
| T03 | `cockpit-usage-tap.mjs` (statusline command) | auto | T00, T01, T02 | ⬜ | |
| T04 | Register statusline in settings.json (`--install`/`--uninstall`) | auto | T03 | ⬜ | Tests use a scratch dir (`COCKPIT_DIR`); the real settings.json edit is T06, human-driven. |
| T05 | Footer usage segment in `cockpit-strip.mjs` | auto | T01, T02 | ✅ | Reviewed clean, no fix commit. §12b's six cases assert real ANSI (roles green/amber/red, stale dim + colour-suppression), watch filter, narrow one-row width. Probed: no-usage byte-for-byte via §12 click tests, trim picks widest fitting level, gap fills to `cols` (no wrap), hit-zones from trimmed pre; purity held (clock in strip, model pure). Suites green (539+usage). |
| T06 | Install and verify on the live subscription | you | T04, T05 | ⬜ | Hand-verified with the user. No code; the automated half is green from the other tasks, this half is real-world only. |

**Review queue:** (empty)

## Blocked on the user

Nothing yet. T00 and T06 will each need the user's live personal subscription (and a Bedrock
session for T06); the implementing session raises the exact command when it reaches them.
