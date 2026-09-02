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

**Status:** **T07 is under way and has answered most of its questions.** It found **T08** (the
detection defect) and prompted **T09** (the fence) and the **80/20 split**. **T08 and T09 are now
reviewed and done**; only **T10** still awaits review. `spikes/cockpit-test` **368 checks** (was
295), two clean runs at load ~3 after the T09 review; browse (55 bash + its node suites), agenda
and notes green.

**Much of the plan is now PERSON-PROVEN** (T07, 2026-09-02, on the review branch): the tree is
usable, the fence helps rather than fights, descending is left alone, focus never leaves the
tree, the redraw is acceptable, the footer still fits, the heals were seen firing three times,
and the `--conf` layering does not shadow the user's own keys. **The split was judged wrong and
changed** — 60 → 80, to match revdiff's own file list. Still unanswered: the mouse-free question,
tabs across a park and an agent switch, and the `c/` jump landing on the right line.

**Each agent now owns up to three panes in the diff slot's world** — its revdiff, its browser and
its viewer — and only one pair may be on screen. `diffs` still means "the pane holding the slot",
so showDiff, the healer and the reaper read as before; `browsePairs` and `parkedDiffs` hold
whatever is parked out of it, each carrying the worktree it was launched in. That worktree is what
rebuilds a browser rooted in a directory the agent has left, and relaunches a revdiff whose range
moved while it sat parked.

**Focus follows the pair, never takes it** (T04's review). **Detection does NOT use the pane
title** — T07 found by hand that a shell's `preexec` hook writes the title itself, to the
command's first word, so a live broot's title reads `cd` and every healthy half was read as a
quit shell (T08). A half is running if its screen is framed, if the title happens to name the
program, or — the only signal that is always true — if the tty's foreground process is one.

Below the daemon: broot's Enter verb runs `cockpit-open <file> [line]` on a text file and previews
anything else; `cockpit-open` refuses unless `panes.json` carries all three viewer keys in the
right shape. Both are hard prerequisites in the installer and the layout script.

**The healer's cooldown is per PANE (`paneLaunchedAt`), not per agent.** A single per-agent
stamp is set by the first heal and reads as "something was just launched here", so with both
halves quit at once the second sits at a bare prompt for the **whole cooldown** — three seconds,
then it heals (measured at T06's review; the earlier "indefinitely" was wrong). The per-agent
`diffLaunchedAt` is untouched and still governs revdiff and the migration follower. The browse
branch is dispatched *before* that per-agent gate for exactly this reason.

**A half that is GONE is still not the healer's.** `showDiff`/`healMissingPanes` prune a dead
pane; a dead viewer leaves the browser alone (the next entry spawns a fresh micro beside it) and
a dead browser disposes the pair, since the viewer cannot hold the slot. Only a half quit to a
**shell** is healed in place.

**`spikes/cockpit-test` is timing-based end to end.** A red run at
`COCKPIT_TEST_SPEED=1.0` on a loaded machine is evidence about the machine: re-run it before
believing it. Confirmed again at T04's review: at load **97** twelve checks failed across
**section 1**, at load 31 one failed in **5g**, and at load 10 the same tree ran **221/221
green** — the flake moves with the load, never with the code. `notes-test` did it once too.
T05's review ran the whole tree twice at load ~2 with no flake at all; T06's review saw
**section 7** (the terminal reap) fail once at load ~3 and pass on the next two runs.
**Two clean runs at low load are the standard**, not one red run at high. Re-run `agenda-test`
**alone** for the same reason. `browse-test` needs the **broot binary** and `script(1)`; so does
`cockpit-test` now, for the footer-click checks.

**All four suites are quiet by default** (main's `282d075`, cherry-picked here, plus the same
convention applied to `browse-test`). A green run prints one line — `ALL PASS (295 checks)` —
instead of a line per assertion; failures still print in full. `VERBOSE=1` restores the old
listing. The counts are unchanged, and so are the `ALL PASS` / `FAILURES` sentinels: **a waiter
must watch for `FAILURES`, never `CHECKS FAILED`**, which no suite has ever printed.

**Last updated:** 2026-09-02
**Next `pir-work` will:** **review T10** (the 60 → 80 split, which rode into T07's commit `96c33ce`). After that, **finish T07** — only three questions are left (mouse-free drive, tabs across a park and an agent switch, the `c/` line jump), plus confirming by hand that browse mode is now usable, which is what T08 fixed and no suite can say. The cockpit still points at this worktree, so the window only has to be re-opened. **The session asks and waits.**

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Pair-in-the-slot spike + promote the planning probes | — | ✅ | Reviewed: five probes re-run from a clean checkout, **80 checks**, nothing left behind. Two defects fixed — the 26-vs-19 ms swap timing did not reproduce (direction holds, figure does not), and the 47/72 divider is **re-imposed** on each restore, not preserved. |
| T01 | `cockpit-open-model.mjs` — the pure decision | — | ✅ | Reviewed: every doc row verified and the boundary grep proven able to fail against a control module. One defect fixed — `..` climbing past `/` emitted a real `..` chain. **62 checks**, not the 59 claimed. |
| T02 | `cockpit-open.mjs` — pane lookup, locked state, sending | T01 | ✅ | Reviewed: **two defects fixed, both in the refusals.** `viewer` was coerced, so `""`, `false` and `[]` all became pane **0** and the push went out; the `\r` guard read the argument, not the realpath. **176 checks**, every new one proven to fail against the unfixed code. |
| T03 | The broot verb layer + micro/broot as prerequisites | T02 | ✅ | Reviewed, two defects fixed: the `--conf` chain was backwards (the **first** file wins) and `{line}` is `0`, not empty. Enter is pressed for real. **238 checks**. |
| T04 | `browse` as the fourth mode; both halves, focus, strip, footer, detection | — | ✅ | Reviewed, two defects fixed: `enterBrowse` always seized the keyboard, and a failed `leaveBrowse` left `panes.viewer` naming a killed pane. **221 checks**. |
| T05 | Park/restore the pair instead of killing it | T00, T04 | ✅ | Reviewed; one defect fixed (a handed-back revdiff still recorded as `browse`). 295 checks. |
| T06 | Heal a quit half; reap a dead agent's pair | T05 | ✅ | Reviewed, three defects fixed (a double kill of the browser, per-agent records surviving a reap, an undefended §11c''). **353 checks.** |
| T07 | Verified by hand with the user | T03, T06 | 🟡 | **Most of it answered 2026-09-02** — see FINDINGS. It found **T08** (broot unusable) and prompted **T09** (the fence) and the **80/20 split**, all on the user's decisions. Still open: mouse-free drive, tabs across a park + agent switch, the `c/` line jump. Cockpit still points at the worktree. |
| T08 | Judge a half by its foreground process, not its title | T07 | ✅ | Reviewed, one defect fixed: the `ps` stub answered in bare names, so the basename reduction was defended by nothing. 11b' now asserts through a path. |
| T09 | Fence the browser to the agent's worktree | T08 | ✅ | Reviewed, one defect fixed: the guard keeping the fence off a quit or still-starting browser was defended by nothing — firing it unconditionally left all 365 green. New 11c'''' watches three bounded windows; `!== "shell"` tightened to `=== "running"` (a dead pane reads `absent`). Probed the migration paths and, live, broot's spaced `:focus` and dead-socket exit. **368 checks.** Hands-on half already ✅ under T07. |
| T10 | The tree matches revdiff's width (60 → 80) | T07 | 🔍 | **Committed inside T07's commit `96c33ce`, which was a mistake** — T07 writes no product code by rule, so this gets its own row rather than riding along unreviewed. `BROWSE_VIEWER_PERCENT` 60 → 80 plus ten moved assertions. revdiff's `--tree-width` is a *share* (2 of 10), measured live at 65 of 319 columns. **365 checks.** |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** **T10**, and nothing else. T08 and T09 are reviewed and done. Then finish T07, which is what prompted all three. **T10 lives in commit `96c33ce`** — a T07 commit, which is why it needs its own row: T07 is not supposed to carry product code.

## Blocked on the user

*(Nothing.)* The question T06's review raised — T07's script never quit either half, so the
recovery task would have closed having been seen by nobody, and *nothing has ever confirmed that
a real pane stops reporting `micro` when micro exits*, which is the one signal every heal fires
on — was answered on 2026-08-30: **add the steps.** T07 now carries **10 and 11** (quit the
reader, quit the tree, hands off, watch) and the two questions that go with them.

The question the T03 review raised — what Enter should do on a file broot calls
**binary**, given `apply_to: text_file` was leaving it to macOS — was answered on 2026-08-29:
**show it in broot's own preview panel.** Built, tested and recorded in DESIGN §7.

The one open question the planning session left — the `browse` command name — was resolved at plan
review by removing the command: the browser now arrives with the mode, so there is nothing to name
and nothing to type.
