# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-16 — 6 fixed, 1 decided with the user

**Status:** T00–T03 done. T04 implemented, awaiting review.
**Last updated:** 2026-09-16
**Next `pir-work` will:** review T04 (statusline register/uninstall + chaining). T05 (footer
segment) is unblocked and can run in parallel.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Capture the real `rate_limits` stdin shape | you | — | ✅ | |
| T01 | `cockpit-usage-store.mjs` (cache read/write) | auto | — | ✅ | |
| T02 | `cockpit-usage-model.mjs` (pure: normalize + renderUsage) | auto | T00 | ✅ | |
| T03 | `cockpit-usage-tap.mjs` (statusline command) | auto | T00, T01, T02 | ✅ | |
| T04 | Register statusline in settings.json (`--install`/`--uninstall`) | auto | T03 | 🔍 | Added `--install`/`--uninstall` to the tap (statusLine merge: atomic, refuses bad JSON, mode preserved, basename re-point), runtime chaining of a foreign statusline via `statusline-prev`, install.sh wiring. New install.test.mjs; chaining cases in tap.test.mjs. Deviations: 5s timeout on chained cmd (DESIGN 2.7 fast); preserve settings.json perms on rewrite. |
| T05 | Footer usage segment in `cockpit-strip.mjs` | auto | T01, T02 | ⬜ | Off the critical path; parallel with T03/T04. |
| T06 | Install and verify on the live subscription | you | T04, T05 | ⬜ | Hand-verified with the user. No code; the automated half is green from the other tasks, this half is real-world only. |

**Review queue:** T04

## Blocked on the user

Nothing yet. T00 and T06 will each need the user's live personal subscription (and a Bedrock
session for T06); the implementing session raises the exact command when it reaches them.
