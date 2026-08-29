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

**Status:** **Phase 2 has begun: T04 is reviewed and done.** `⌥[`/`⌥]` now reach `browse` as a
fourth stop, both halves launch into the slot (broot left, micro right at `--percent 60`), either
half routes the keys, the footer draws and clicks a `Browse` label, and `diffPaneStatus` reports a
healthy pair as *running* so the 1 s healer leaves it alone. The pair is **launched and disposed
of, not parked** — that is T05. `spikes/cockpit-test` **221 checks** (was 134); browse (238),
agenda (579) and notes (88) suites green.

**T04's review fixed two things and probed a third.** `enterBrowse` took `{focus}`: it had always
activated the browser, so a `followWorktreeMigration` rebuild — which fires on the *agent's*
schedule — dragged the keyboard out of the Claude pane and into broot's filter box. Focus now
**follows** the pair when the slot already had it and is never **taken**. And a failed
`leaveBrowse` split stopped advertising a killed viewer. Separately, micro and broot were probed
through `script(1)`: neither sets a terminal title (micro emits **zero** escape sequences even
with a file open), so title-only detection holds for a whole session — **T06 can rely on it.**

Everything below the daemon was already there:
broot's Enter verb runs `cockpit-open <file> [line]` on a text file and previews anything
else; `cockpit-open` finds the viewer, refuses unless
`panes.json` carries all three viewer keys *in the right shape*, and types micro's command bar
under `viewer-tabs.lock`. micro and broot are hard prerequisites in both the installer and the
layout script. `spikes/browse-test` **238 checks**; agenda, notes and cockpit suites green.
**Nothing launches it yet** — the `viewer` key and the two panes arrive with T04.

**T05 inherits a deliberate placeholder.** Entering browse splits the browser into the slot and
**disposes of** the outgoing revdiff pane; leaving disposes of both halves. The *order* is
already the measured one (RESULTS §1) and asserted, so T05's job is to replace two `kill-pane`
calls with a park — not to redesign the dance.

**`spikes/cockpit-test` is timing-based end to end.** A red run at
`COCKPIT_TEST_SPEED=1.0` on a loaded machine is evidence about the machine: re-run it before
believing it. Confirmed again at T04's review: at load **97** twelve checks failed across
**section 1**, at load 31 one failed in **5g**, and at load 10 the same tree ran **221/221
green** — the flake moves with the load, never with the code. `notes-test` did it once too.
**Two clean runs at low load are the standard**, not one red run at high. Re-run `agenda-test`
**alone** for the same reason. `browse-test` needs the **broot binary** and `script(1)`; so does
`cockpit-test` now, for the footer-click checks.

**Last updated:** 2026-08-29
**Next `pir-work` will:** **implement T05** — park and restore the pair instead of killing it. The
enter/leave order it needs is already built and asserted; the job is to replace the `kill-pane`
calls with a park, not to redesign the dance.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Pair-in-the-slot spike + promote the planning probes | — | ✅ | Reviewed: all five probes re-run from a clean checkout, **80 checks** green, no mux server or temp dir left behind, an inherited `WEZTERM_UNIX_SOCKET` ignored. Two defects fixed — the 26-vs-19 ms swap timing did not reproduce (REPS 6→20; direction holds, figure does not), and the 47/72 divider is **re-imposed** each restore, not preserved (T05's to decide). Deviations accepted. |
| T01 | `cockpit-open-model.mjs` — the pure decision | — | ✅ | Reviewed: every doc row verified, both deviations accepted (`realpath` is genuinely T02's), and the boundary grep proven able to fail against a control module that imports `node:fs`. One defect fixed — `..` climbing past `/` was carried upward, emitting a real `..` chain against a root of `/`. Probed empty/CR paths → T02. **62 checks**, not the 59 claimed (was 57). |
| T02 | `cockpit-open.mjs` — pane lookup, locked state, sending | T01 | ✅ | Reviewed: four suites green, three deviations accepted, **two defects fixed — both in the refusals.** `viewer` was *coerced*: `""`, `" "`, `false`, `[]` all became pane **0** and the push went out (probed). The `\r` guard read the argument, not the realpath — a symlink into a `we\rird/` dir sent `open we`. Plus an unwritable state dir threw a stack trace. **176 checks**; every new one proven to fail against the unfixed code. |
| T03 | The broot verb layer + micro/broot as prerequisites | T02 | ✅ | Reviewed, four deviations accepted, **two defects fixed**: the `--conf` chain was the wrong way round (the **first** file wins, so a user's own `enter` beat the cockpit's), and `{line}` is `0`, not empty. Enter is now pressed **for real** — push, `c/` line, directory descent, binary and unreadable files. **223 → 238 checks**, each proven to fail. Enter on a non-text file now opens broot's preview, **per the user**. |
| T04 | `browse` as the fourth mode; both halves, focus, strip, footer, detection | — | ✅ | Reviewed, six deviations accepted, **two defects fixed**: `enterBrowse` always seized the keyboard, so an agent moving worktree mid-review put your next keystrokes in broot; and a failed `leaveBrowse` left `panes.viewer` naming a killed pane. Probed micro/broot for title escapes — neither sets one. Added the untested browse→custom path. **221 checks**, the focus one mutant-proven. |
| T05 | Park/restore the pair instead of killing it | T00, T04 | ⬜ | Heavy. The slot has always held one pane per agent. |
| T06 | Heal a quit half; reap a dead agent's pair | T05 | ⬜ | Two independent heals: never rebuild the pair to fix one half. |
| T07 | Verified by hand with the user | T03, T06 | ⬜ | Cannot be closed by any test. The session waits for the answer. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** *(empty)* — T04 is closed. The next thing to review is **T05**, once it is built.

## Blocked on the user

*(Nothing.)* The question the T03 review raised — what Enter should do on a file broot calls
**binary**, given `apply_to: text_file` was leaving it to macOS — was answered on 2026-08-29:
**show it in broot's own preview panel.** Built, tested and recorded in DESIGN §7.

The one open question the planning session left — the `browse` command name — was resolved at plan
review by removing the command: the browser now arrives with the mode, so there is nothing to name
and nothing to type.
