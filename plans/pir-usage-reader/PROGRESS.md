# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-30 — 9 fixed, 4 decided with the user

**Status:** Planned 2026-09-30. Nothing built.
**Last updated:** 2026-10-01
**Next `pir-work` will:** implement T05.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | pir-reading-decision | — | ✅ | |
| T02 | pir-usage-reader | T01 | ✅ | |
| T03 | daemon-poll | T01, T02 | ✅ | |
| T04 | install-report | T02 | ✅ | |
| T05 | docs | T03, T04 | ⬜ | |
| T06 | live-check-script | T02, T03 | ✅ | Reviewed: two fixes, each reproduced by a test red on the implementing commit. Step 1 said differ on a reading with no drawable window, now no reading. Follow's integer-only bash compare passed a 5-minute-stale cache when observed_at was fractional, now jq. Probed retry, log grep, scratch cleanup. Step 1 differ path still untested. Not run live. |

**Review queue:** empty

## Blocked on the user

Nothing.

## Outstanding after the merge

PLAN § After the merge, not yet run. It waits on this plan merged and on pir's service installed
from `~/src/plan-implement-review`; it needs a yes to `pir service off`/`on` and the cockpit
window reopened.
