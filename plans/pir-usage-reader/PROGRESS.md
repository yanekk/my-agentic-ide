# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**: read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index; the account is the
commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-30 — 9 fixed, 4 decided with the user

**Status:** T01, T02 done.
**Last updated:** 2026-10-01
**Next `pir-work` will:** implement T03 or T04, both now unblocked.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | pir-reading-decision | — | ✅ | |
| T02 | pir-usage-reader | T01 | ✅ | Review clean, no fix commit; three suites green. Accepted deviations: CLI prints `http 500`, matching DESIGN §2.5's `http {status}`; the `os.homedir()` fallback is pir's own `index-store` rule. Probed: mutations dropping `redirect: "error"` or the newer-only write each fail the suite; api.json as a directory reads `bad-file`. |
| T03 | daemon-poll | T01, T02 | ⬜ | |
| T04 | install-report | T02 | ⬜ | |
| T05 | docs | T03, T04 | ⬜ | |
| T06 | live-check-script | T02, T03 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.

## Outstanding after the merge

PLAN § After the merge, not yet run. It waits on this plan merged and on pir's service installed
from `~/src/plan-implement-review`; it needs a yes to `pir service off`/`on` and the cockpit
window reopened.
