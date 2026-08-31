# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — 1 fixed, 4 decided with the user.

**Status:** T01, T02, T03 reviewed. T04 in progress: docs written and committed; the four
hands-on checks (DESIGN 5.1) are handed to the user and awaiting answers — the load-bearing
`COCKPIT_REPO` gate first.
**Last updated:** 2026-08-31
**Next `pir-work` will:** finish T04 — record the user's hands-on answers in FINDINGS with the
date, then mark T04 ✅ (or, if the gate check fails, rework the gate and revisit T03).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Haiku topic-namer and label guard | — | ✅ | Clean. Model-alias + live label quality are T04 (5.1). |
| T02 | `config` command and key store | — | ✅ | Clean, no fix commit. All 7 task checks defend (masking test fails if the length-1 cap is dropped — verified). Probed: masking at lengths 0–5 (a 1-char key reveals nothing), unknown-setting exit, empty-file reads as off, realpath entrypoint guard (import runs no CLI). 0600 atomic write; read path masks. `config` name is a T04 hands-on check. |
| T03 | Wire into the hook: gate, hold, freeze | T01, T02 | ✅ | One fix: a real name (candidate/summary) whose text equalled the placeholder hit `decide`'s "title unchanged" early-out and never froze — endless re-fetch/climb; the freeze-crossing now persists (defended, fails pre-fix). Probed: `candidateTopic` mirrors `decide`'s guards so a settled session is never held; empty input never spends. Daemon untouched. Suite 70+13. |
| T04 | Relink, docs, hands-on verify | T03 | 🟡 | Docs done: CLAUDE.md naming para (Haiku topic, set-once-frozen, "follows the work" retired for the label), `config`+key+`bin/config` in inventory, two key limits in Known limits. `config` symlink already relinked in T02. Measured table left as-is (no new row worth retiring one). Hands-on verify (4 checks, gate first) handed to user — awaiting answers. |

**Review queue:** *(empty)*

## Blocked on the user

T04's four hands-on checks (DESIGN 5.1) are with the user, seatbelt is the spend-capped key:
1. **Load-bearing gate** — in a fleet-dispatched agent's shell, `env | grep -i cockpit_repo`
   is set. If not, T03's gate must change; stop.
2. Key never a variable — `env | grep -i anthropic` is empty in that agent.
3. Live naming + hold — capped key set, fresh agent, ordinary first message: fleet shows
   `<repo> / <1-3 word topic>` within ~2s, prompt briefly held then answers. Report the
   label, the hold feel, any slowness.
4. `config` confinement — runs in a cockpit terminal, "command not found" in a plain shell.
