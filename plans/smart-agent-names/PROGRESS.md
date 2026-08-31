# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — 1 fixed, 4 decided with the user.

**Status:** T01, T02, T03 reviewed. T03 had one fix (a coincident-text name failed to freeze).
Four tasks, two phases. Only T04 remains.
**Last updated:** 2026-08-31
**Next `pir-work` will:** implement T04 — relink the `config` symlink, write the docs, and run
the hands-on checks (the `COCKPIT_REPO` gate first, DESIGN 5.1). T04 is the plan's only
person-verified task; nothing before it is blocked on the user.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Haiku topic-namer and label guard | — | ✅ | Clean. Model-alias + live label quality are T04 (5.1). |
| T02 | `config` command and key store | — | ✅ | Clean, no fix commit. All 7 task checks defend (masking test fails if the length-1 cap is dropped — verified). Probed: masking at lengths 0–5 (a 1-char key reveals nothing), unknown-setting exit, empty-file reads as off, realpath entrypoint guard (import runs no CLI). 0600 atomic write; read path masks. `config` name is a T04 hands-on check. |
| T03 | Wire into the hook: gate, hold, freeze | T01, T02 | ✅ | One fix: a real name (candidate/summary) whose text equalled the placeholder hit `decide`'s "title unchanged" early-out and never froze — endless re-fetch/climb; the freeze-crossing now persists (defended, fails pre-fix). Probed: `candidateTopic` mirrors `decide`'s guards so a settled session is never held; empty input never spends. Daemon untouched. Suite 70+13. |
| T04 | Relink, docs, hands-on verify | T03 | ⬜ | Verifies the `COCKPIT_REPO` gate first (DESIGN 2.4) |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty — nothing is waiting on a person yet. T04 will need hands-on checks; the seatbelt is
the capped key.)*
