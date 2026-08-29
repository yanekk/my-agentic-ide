# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** planned, nothing built. The mechanism was measured during planning against real
WezTerm panes and a headless mux — the push, tab accumulation, the line jump, focus retention,
and micro surviving park/restore — so Phase 1 and Phase 2 are building against numbers, not
guesses. **Read FINDINGS before T00.** The one genuinely unproven thing is whether the diff
slot can hold two alternating panes per agent; that is T00 and it gates T05.

**Last updated:** 2026-08-29
**Next `pir-work` will:** **implement T00** — the two-pane-slot spike, plus promoting the four
planning probes into `spikes/browse-mode/` with a RESULTS.md. It gates T05 and therefore the
whole of Phase 2. Every pane probe runs against a **headless mux**, never the live cockpit
window (DESIGN §5.2).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Two-pane slot spike + promote the planning probes | — | ⬜ | Gates T05. If the slot cannot alternate two panes, DESIGN §2.6 is wrong — stop and ask. |
| T01 | `cockpit-open-model.mjs` — the pure decision | — | ⬜ | |
| T02 | `cockpit-open.mjs` — pane lookup, locked state, sending | T01 | ⬜ | |
| T03 | The `browse` command + broot verb layer | T02 | ⬜ | **Raise the `browse` name with the user before building** — it is an assumption, not a decision. |
| T04 | `browse` as the fourth mode; strip + footer | — | ⬜ | |
| T05 | Park/restore the viewer instead of killing it | T00, T04 | ⬜ | Heavy. The slot has always held one pane per agent. |
| T06 | Heal a quit viewer; reap a dead agent's viewer | T05 | ⬜ | |
| T07 | Verified by hand with the user | T03, T06 | ⬜ | Cannot be closed by any test. The session waits for the answer. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** *(empty)*

## Blocked on the user

**One thing, and it is not blocking yet:** the `browse` command name and its cockpit-only
publication (PLAN "Still open", DESIGN §2.3). T03 raises it. Everything before T03 proceeds
without an answer.
