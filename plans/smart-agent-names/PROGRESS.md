# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — 1 fixed, 4 decided with the user.

**Status:** T01 and T02 reviewed clean. T03 now unblocked. Four tasks, two phases.
**Last updated:** 2026-08-31
**Next `pir-work` will:** implement T03 (wire Haiku into the hook: gate on `COCKPIT_REPO`,
hold the first prompt, freeze once named). T01 and T02 are both ✅, so its deps are met.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Haiku topic-namer and label guard | — | ✅ | Clean (+30 checks); boundary/guard/2s-timeout per DESIGN. Model-alias + label quality deferred to T04 (5.1). |
| T02 | `config` command and key store | — | ✅ | Clean, no fix commit. All 7 task checks defend (masking test fails if the length-1 cap is dropped — verified). Probed: masking at lengths 0–5 (a 1-char key reveals nothing), unknown-setting exit, empty-file reads as off, realpath entrypoint guard (import runs no CLI). 0600 atomic write; read path masks. `config` name is a T04 hands-on check. |
| T03 | Wire into the hook: gate, hold, freeze | T01, T02 | ⬜ | |
| T04 | Relink, docs, hands-on verify | T03 | ⬜ | Verifies the `COCKPIT_REPO` gate first (DESIGN 2.4) |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty — nothing is waiting on a person yet. T04 will need hands-on checks; the seatbelt is
the capped key.)*
