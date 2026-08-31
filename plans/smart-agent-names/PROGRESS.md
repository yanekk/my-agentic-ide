# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — 1 fixed, 4 decided with the user.

**Status:** T01, T02, T03 reviewed. T04 implemented and hands-on-verified: all four DESIGN
5.1 checks PASS (live name `agentic-ide / pizza-baking`). One T02 defect found & fixed
(`config` was non-executable), now test-guarded. T04 awaits fresh-eyes review — the last task.
**Last updated:** 2026-08-31
**Next `pir-work` will:** review T04 (docs accuracy, the executability guard, findings), then
mark it ✅ — which finishes the plan.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Haiku topic-namer and label guard | — | ✅ | Clean. Model-alias + live label quality are T04 (5.1). |
| T02 | `config` command and key store | — | ✅ | Clean, no fix commit. All 7 task checks defend (masking test fails if the length-1 cap is dropped — verified). Probed: masking at lengths 0–5 (a 1-char key reveals nothing), unknown-setting exit, empty-file reads as off, realpath entrypoint guard (import runs no CLI). 0600 atomic write; read path masks. `config` name is a T04 hands-on check. |
| T03 | Wire into the hook: gate, hold, freeze | T01, T02 | ✅ | One fix: a real name (candidate/summary) whose text equalled the placeholder hit `decide`'s "title unchanged" early-out and never froze — endless re-fetch/climb; the freeze-crossing now persists (defended, fails pre-fix). Probed: `candidateTopic` mirrors `decide`'s guards so a settled session is never held; empty input never spends. Daemon untouched. Suite 70+13. |
| T04 | Relink, docs, hands-on verify | T03 | 🔍 | Docs + one-line `chmod +x` + run.sh executability guard (16 bash checks). All four DESIGN 5.1 checks PASS: gate fires in a dispatched agent, key never a variable, live name `agentic-ide / pizza-baking`, `config` confined to cockpit shells. Found & fixed a T02 defect (`config` shipped `0644`). Measured table untouched. Awaiting review. |

**Review queue:** T04

## Blocked on the user

*(Empty — all four DESIGN 5.1 hands-on checks are verified and recorded in FINDINGS
with today's date.)*
