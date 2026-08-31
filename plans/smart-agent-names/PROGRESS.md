# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — 1 fixed, 4 decided with the user.

**Status:** T01 reviewed clean. T02 is the next dependency-free ⬜. Four tasks, two phases.
**Last updated:** 2026-08-31
**Next `pir-work` will:** implement T02 (the `config` command and key store) — the next ⬜
with no unmet dependencies. T03 stays blocked until T01 and T02 are both ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Haiku topic-namer and label guard | — | ✅ | Clean, no fix commit. Every listed test present and defending (timeout test hangs, not passes, if abort is dropped); +30 checks. Boundary/guard/2s-timeout per DESIGN; timer cleared in finally. Probed: non-string content blocks → null; the kebab guard also means a prompt-injection first message can't poison the name. Model-alias + label quality deferred to T04 (5.1). |
| T02 | `config` command and key store | — | ⬜ | |
| T03 | Wire into the hook: gate, hold, freeze | T01, T02 | ⬜ | |
| T04 | Relink, docs, hands-on verify | T03 | ⬜ | Verifies the `COCKPIT_REPO` gate first (DESIGN 2.4) |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty — nothing is waiting on a person yet. T04 will need hands-on checks; the seatbelt is
the capped key.)*
