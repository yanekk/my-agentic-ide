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

**Status:** **Phase 1 is built and reviewed.** Everything below the daemon now exists:
broot's Enter verb runs `cockpit-open <file> [line]` on a text file and previews anything
else; `cockpit-open` finds the viewer, refuses unless
`panes.json` carries all three viewer keys *in the right shape*, and types micro's command bar
under `viewer-tabs.lock`. micro and broot are hard prerequisites in both the installer and the
layout script. `spikes/browse-test` **238 checks**; agenda, notes and cockpit suites green.
**Nothing launches it yet** — the `viewer` key and the two panes arrive with T04.

**T04 owes `viewer` as a number or null** — never `""` or `false`. The review found those
coercing to pane 0 and pushing there; see FINDINGS.

**T04 launches broot with `browseConfChain(home, repo)`** from `bin/cockpit-browse-conf.mjs`,
and needs `~/.claude/cockpit/bin` on the browser's PATH — that is where `cockpit-open` is
published, and the verb calls it by that name. **The cockpit's verb file is FIRST in that
chain, not last** — broot takes the first matching verb, so do not "fix" the order.

**Last updated:** 2026-08-29
**Next `pir-work` will:** **implement T04** — `browse` as the fourth mode: both halves, focus, strip, footer and the pane detection that keeps the 1 s healer off a healthy pair. `spikes/browse-test/run.sh` needs the **broot binary** and `script(1)`; re-run `agenda-test` **alone** before believing a red one (it reproduced again, red beside another suite, green twice alone), and `cockpit-test` at `COCKPIT_TEST_SPEED=1.0` (~2 min).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Pair-in-the-slot spike + promote the planning probes | — | ✅ | Reviewed: all five probes re-run from a clean checkout, **80 checks** green, no mux server or temp dir left behind, an inherited `WEZTERM_UNIX_SOCKET` ignored. Two defects fixed — the 26-vs-19 ms swap timing did not reproduce (REPS 6→20; direction holds, figure does not), and the 47/72 divider is **re-imposed** each restore, not preserved (T05's to decide). Deviations accepted. |
| T01 | `cockpit-open-model.mjs` — the pure decision | — | ✅ | Reviewed: every doc row verified, both deviations accepted (`realpath` is genuinely T02's), and the boundary grep proven able to fail against a control module that imports `node:fs`. One defect fixed — `..` climbing past `/` was carried upward, emitting a real `..` chain against a root of `/`. Probed empty/CR paths → T02. **62 checks**, not the 59 claimed (was 57). |
| T02 | `cockpit-open.mjs` — pane lookup, locked state, sending | T01 | ✅ | Reviewed: four suites green, three deviations accepted, **two defects fixed — both in the refusals.** `viewer` was *coerced*: `""`, `" "`, `false`, `[]` all became pane **0** and the push went out (probed). The `\r` guard read the argument, not the realpath — a symlink into a `we\rird/` dir sent `open we`. Plus an unwritable state dir threw a stack trace. **176 checks**; every new one proven to fail against the unfixed code. |
| T03 | The broot verb layer + micro/broot as prerequisites | T02 | ✅ | Reviewed, four deviations accepted, **two defects fixed**: the `--conf` chain was the wrong way round (the **first** file wins, so a user's own `enter` beat the cockpit's), and `{line}` is `0`, not empty. Enter is now pressed **for real** — push, `c/` line, directory descent, binary and unreadable files. **223 → 238 checks**, each proven to fail. Enter on a non-text file now opens broot's preview, **per the user**. |
| T04 | `browse` as the fourth mode; both halves, focus, strip, footer, detection | — | ⬜ | Carries the pane detection T06 used to own — without it the 1 s healer types over a healthy pair. |
| T05 | Park/restore the pair instead of killing it | T00, T04 | ⬜ | Heavy. The slot has always held one pane per agent. |
| T06 | Heal a quit half; reap a dead agent's pair | T05 | ⬜ | Two independent heals: never rebuild the pair to fix one half. |
| T07 | Verified by hand with the user | T03, T06 | ⬜ | Cannot be closed by any test. The session waits for the answer. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** *(empty.)* T04 is next, and is implemented — not reviewed — by the session that picks it up.

## Blocked on the user

*(Nothing.)* The question the T03 review raised — what Enter should do on a file broot calls
**binary**, given `apply_to: text_file` was leaving it to macOS — was answered on 2026-08-29:
**show it in broot's own preview panel.** Built, tested and recorded in DESIGN §7.

The one open question the planning session left — the `browse` command name — was resolved at plan
review by removing the command: the browser now arrives with the mode, so there is nothing to name
and nothing to type.
