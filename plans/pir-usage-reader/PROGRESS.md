# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-30 — 9 fixed, 4 decided with the user

**Status:** Planned 2026-09-30. Nothing built.
**Last updated:** 2026-10-01
**Next `pir-work` will:** review T06.

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
| T06 | live-check-script | T02, T03 | 🔍 | `live-check.sh` and 36 checks. Deviations: follow counts a sample with no service reading as unchecked, all unchecked exits 2 `no reading`; step 1 brackets `--once` with two GETs, retrying if `observed_at` moved; scratch dir under `TMPDIR`; step 1 `differ` path untested, its jq checked by hand. |

**Review queue:** T06

## Blocked on the user

Nothing.

## Outstanding after the merge

PLAN § After the merge, not yet run. It waits on this plan merged and on pir's service installed
from `~/src/plan-implement-review`; it needs a yes to `pir service off`/`on` and the cockpit
window reopened.
