# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — 1 fixed, 4 decided with the user.

**Status:** T01 built and awaiting review. The `claude -p` versus API spike is already done
(FINDINGS, 2026-08-31): the API with Haiku 4.5 is ~1s and its labels are good, `claude -p`
is 3.5–10s. Four tasks, two phases.
**Last updated:** 2026-08-31
**Next `pir-work` will:** review T01 (the topic-namer and label guard) — lowest-numbered 🔍.
After that, T02 is the next dependency-free ⬜.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Haiku topic-namer and label guard | — | 🔍 | `fetchTopic`+`asLabel` added, +30 suite checks; `decide`/`runHook` untouched |
| T02 | `config` command and key store | — | ⬜ | |
| T03 | Wire into the hook: gate, hold, freeze | T01, T02 | ⬜ | |
| T04 | Relink, docs, hands-on verify | T03 | ⬜ | Verifies the `COCKPIT_REPO` gate first (DESIGN 2.4) |

**Review queue:** T01

## Blocked on the user

*(Empty — nothing is waiting on a person yet. T04 will need hands-on checks; the seatbelt is
the capped key.)*
