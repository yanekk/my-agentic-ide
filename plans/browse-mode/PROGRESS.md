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

**Status:** Phase 0 and T01 reviewed; **T02 built and awaiting review**. The whole push now
exists end to end below the daemon: broot's Enter would run `cockpit-open <file> [line]`, which
finds the viewer, refuses unless `panes.json` carries all three viewer keys, and types micro's
command bar under `viewer-tabs.lock`. All four contracts FINDINGS handed T01's caller are
honoured and asserted. `spikes/browse-test` **148 checks**; agenda, cockpit and notes suites
green. **Nothing launches it yet** — the `viewer` key is published by T04, the verb by T03.

**Last updated:** 2026-08-29
**Next `pir-work` will:** **review T02** — `bin/cockpit-open.mjs`, the `withLock` change in
`bin/cockpit-agenda-store.mjs`, and `spikes/browse-test/open.test.mjs`. Re-run `agenda-test`
**alone** before believing a red one. Worth a hard look: the lock now covers the sending, and a
`viewerRoot` that cannot be resolved degrades instead of refusing.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Pair-in-the-slot spike + promote the planning probes | — | ✅ | Reviewed: all five probes re-run from a clean checkout, **80 checks** green, no mux server or temp dir left behind, an inherited `WEZTERM_UNIX_SOCKET` ignored. Two defects fixed — the 26-vs-19 ms swap timing did not reproduce (REPS 6→20; direction holds, figure does not), and the 47/72 divider is **re-imposed** each restore, not preserved (T05's to decide). Deviations accepted. |
| T01 | `cockpit-open-model.mjs` — the pure decision | — | ✅ | Reviewed: every doc row verified, both deviations accepted (`realpath` is genuinely T02's), and the boundary grep proven able to fail against a control module that imports `node:fs`. One defect fixed — `..` climbing past `/` was carried upward, emitting a real `..` chain against a root of `/`. Probed empty/CR paths → T02. **62 checks**, not the 59 claimed (was 57). |
| T02 | `cockpit-open.mjs` — pane lookup, locked state, sending | T01 | 🔍 | Built: the push, every refusal, `withLock` given a lock-file argument and per-file depth. **148 checks** (was 62); agenda, cockpit and notes suites green. Three deviations: the lock covers the **send** too, not just the read-modify-write (else two pushes both `open`); the stubbed `wezterm` lives in `open.test.mjs`, not `run.sh`; an unresolvable `viewerRoot` degrades to a long label rather than refusing. |
| T03 | The broot verb layer + micro/broot as prerequisites | T02 | ⬜ | The `browse` command is **gone** — the daemon launches broot. Touches `install.sh`, `cockpit-layout.sh`, `CLAUDE.md`. |
| T04 | `browse` as the fourth mode; both halves, focus, strip, footer, detection | — | ⬜ | Carries the pane detection T06 used to own — without it the 1 s healer types over a healthy pair. |
| T05 | Park/restore the pair instead of killing it | T00, T04 | ⬜ | Heavy. The slot has always held one pane per agent. |
| T06 | Heal a quit half; reap a dead agent's pair | T05 | ⬜ | Two independent heals: never rebuild the pair to fix one half. |
| T07 | Verified by hand with the user | T03, T06 | ⬜ | Cannot be closed by any test. The session waits for the answer. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** **T02** — `cockpit-open.mjs`, the `withLock` lock-file argument, and
`spikes/browse-test/open.test.mjs`.

## Blocked on the user

*(Nothing.)* The one open question the planning session left — the `browse` command name — was
resolved at plan review by removing the command: the browser now arrives with the mode, so there
is nothing to name and nothing to type.
