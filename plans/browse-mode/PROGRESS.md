# Progress

> ## ⚠️ READ FIRST — this plan is built in a worktree, not on `main`
>
> **`CLAUDE.md § Where sessions run` is suspended for the whole of this plan.** The user lifted
> it deliberately on 2026-08-29, for the duration of browse-mode's execution and no longer.
>
> | | |
> |---|---|
> | Worktree | `.claude/worktrees/browse-mode-review` |
> | Branch | `worktree-browse-mode-review` |
> | Commit and push | **there**, on every task, exactly as the main rule says — just not to `main` |
> | `main` | **do not touch it.** No commit, no merge, no rebase, no fast-forward |
>
> **If your session did not start in that worktree, enter it before doing anything else** —
> `EnterWorktree` with that path, or work from that directory. A task committed to `main` by
> accident is history the user then has to unpick.
>
> **Folding back into `main` at the end is the user's decision, not a session's.** When T07 is
> done, say so and stop. Do not merge, and do not offer to as though it were routine — the whole
> reason this file says so is that it is a decision about history.
>
> **The trap this creates, and it is not theoretical:** the live cockpit runs whatever
> `~/.claude/cockpit/config.lua` records, which today is the **main checkout**
> (`/Users/jan.krolikowski/src/agentic-ide`), and `~/.wezterm.lua` symlinks into it. So a
> re-opened WezTerm window runs `main`'s code, **not this branch's**. Every automated test is
> unaffected — they run from the checkout you are in — but **T07's hands-on verification would
> silently check the wrong code.** T07 carries the fix; do not improvise one.

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Plan reviewed:** 2026-08-29 — 6 fixed, 5 decided with the user, one of them a reversal of the
architecture. **Read DESIGN §3.1 and §7 before T04.**

**Status:** planned, nothing built. Browse mode splits the diff slot in two — browser left,
viewer right — and nothing is typed. The mechanism was measured against real WezTerm panes and a
headless mux, at planning and again at review: the push, tab accumulation, the line jump, focus
retention, micro surviving park/restore, and **the pair parking and restoring at identical
geometry**. **Read FINDINGS before T00.**

**Last updated:** 2026-08-29
**Next `pir-work` will:** **implement T00** — the pair-slot spike, plus promoting the four
planning probes into `spikes/browse-mode/` with a RESULTS.md. It gates T05 and therefore the
whole of Phase 2. Every pane probe runs against a **headless mux**, never the live cockpit
window (DESIGN §5.2).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Pair-in-the-slot spike + promote the planning probes | — | ⬜ | Gates T05. Core round trip already measured green at review; T00 adds two agents, the empty-slot rebuild, a resize while parked, and swap timing. |
| T01 | `cockpit-open-model.mjs` — the pure decision | — | ⬜ | |
| T02 | `cockpit-open.mjs` — pane lookup, locked state, sending | T01 | ⬜ | Reuses the agenda store's `withLock` (given a lock-file argument), rather than writing a third copy. `spikes/agenda-test` must stay green. |
| T03 | The broot verb layer + micro/broot as prerequisites | T02 | ⬜ | The `browse` command is **gone** — the daemon launches broot. Touches `install.sh`, `cockpit-layout.sh`, `CLAUDE.md`. |
| T04 | `browse` as the fourth mode; both halves, focus, strip, footer, detection | — | ⬜ | Carries the pane detection T06 used to own — without it the 1 s healer types over a healthy pair. |
| T05 | Park/restore the pair instead of killing it | T00, T04 | ⬜ | Heavy. The slot has always held one pane per agent. |
| T06 | Heal a quit half; reap a dead agent's pair | T05 | ⬜ | Two independent heals: never rebuild the pair to fix one half. |
| T07 | Verified by hand with the user | T03, T06 | ⬜ | Cannot be closed by any test. The session waits for the answer. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** *(empty)*

## Blocked on the user

*(Nothing.)* The one open question the planning session left — the `browse` command name — was
resolved at plan review by removing the command: the browser now arrives with the mode, so there
is nothing to name and nothing to type.
