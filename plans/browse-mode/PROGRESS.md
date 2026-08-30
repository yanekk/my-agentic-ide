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

**Status:** **T05 is reviewed and closed. T06 is next.** The pair parks as a unit — browser and
viewer together in one tab — and comes back unrelaunched through every entry point: the keys, the
footer's labels, an agent switch, a cancelled custom-range prompt, an empty-slot rebuild. **One
defect fixed at review:** handing a parked revdiff back left its launch record still saying
`browse`, so the next agent switch quit and relaunched the very revdiff the park had saved.
`spikes/cockpit-test` **295 checks** (was 289); browse (238), agenda and notes green.

**Each agent now owns up to three panes in the diff slot's world** — its revdiff, its browser and
its viewer — and only one pair may be on screen. `diffs` still means "the pane holding the slot",
so showDiff, the healer and the reaper read as before; `browsePairs` and `parkedDiffs` hold
whatever is parked out of it, each carrying the worktree it was launched in. That worktree is what
rebuilds a browser rooted in a directory the agent has left, and relaunches a revdiff whose range
moved while it sat parked.

**Focus follows the pair, never takes it** (T04's review), and **neither micro nor broot sets a
terminal title** — probed through `script(1)`, so **T06 can rely on title-only detection**. Below
the daemon: broot's Enter verb runs `cockpit-open <file> [line]` on a text file and previews
anything else; `cockpit-open` refuses unless `panes.json` carries all three viewer keys in the
right shape. Both are hard prerequisites in the installer and the layout script.

**T06 inherits two crude fallbacks, both deliberate.** A half that has *died* rebuilds the whole
pair on the next attach (killing the healthy half with it), and an orphaned viewer whose browser
is gone is disposed of. Healing **one** half in place, without touching the other, is T06's whole
job — DESIGN §2.n, "two halves, two independent heals".

**`spikes/cockpit-test` is timing-based end to end.** A red run at
`COCKPIT_TEST_SPEED=1.0` on a loaded machine is evidence about the machine: re-run it before
believing it. Confirmed again at T04's review: at load **97** twelve checks failed across
**section 1**, at load 31 one failed in **5g**, and at load 10 the same tree ran **221/221
green** — the flake moves with the load, never with the code. `notes-test` did it once too.
T05's review ran the whole tree twice at load ~2 with no flake at all.
**Two clean runs at low load are the standard**, not one red run at high. Re-run `agenda-test`
**alone** for the same reason. `browse-test` needs the **broot binary** and `script(1)`; so does
`cockpit-test` now, for the footer-click checks.

**All four suites are quiet by default** (main's `282d075`, cherry-picked here, plus the same
convention applied to `browse-test`). A green run prints one line — `ALL PASS (295 checks)` —
instead of a line per assertion; failures still print in full. `VERBOSE=1` restores the old
listing. The counts are unchanged, and so are the `ALL PASS` / `FAILURES` sentinels: **a waiter
must watch for `FAILURES`, never `CHECKS FAILED`**, which no suite has ever printed.

**Last updated:** 2026-08-30
**Next `pir-work` will:** **implement T06** — heal one quit half in place without touching the
other, and reap a dead agent's pair (including its `viewer-tabs.json` entry, which the reaper does
*not* drop yet). The two crude fallbacks named above are what it replaces. Note that the
per-pane cooldown T06 asks for does not exist yet: `diffLaunchedAt` is per agent.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Pair-in-the-slot spike + promote the planning probes | — | ✅ | Reviewed: all five probes re-run from a clean checkout, **80 checks** green, no mux server or temp dir left behind, an inherited `WEZTERM_UNIX_SOCKET` ignored. Two defects fixed — the 26-vs-19 ms swap timing did not reproduce (REPS 6→20; direction holds, figure does not), and the 47/72 divider is **re-imposed** each restore, not preserved (T05's to decide). Deviations accepted. |
| T01 | `cockpit-open-model.mjs` — the pure decision | — | ✅ | Reviewed: every doc row verified, both deviations accepted (`realpath` is genuinely T02's), and the boundary grep proven able to fail against a control module that imports `node:fs`. One defect fixed — `..` climbing past `/` was carried upward, emitting a real `..` chain against a root of `/`. Probed empty/CR paths → T02. **62 checks**, not the 59 claimed (was 57). |
| T02 | `cockpit-open.mjs` — pane lookup, locked state, sending | T01 | ✅ | Reviewed: four suites green, three deviations accepted, **two defects fixed — both in the refusals.** `viewer` was *coerced*: `""`, `" "`, `false`, `[]` all became pane **0** and the push went out (probed). The `\r` guard read the argument, not the realpath — a symlink into a `we\rird/` dir sent `open we`. Plus an unwritable state dir threw a stack trace. **176 checks**; every new one proven to fail against the unfixed code. |
| T03 | The broot verb layer + micro/broot as prerequisites | T02 | ✅ | Reviewed, two defects fixed: the `--conf` chain was backwards (the **first** file wins) and `{line}` is `0`, not empty. Enter is pressed for real. **238 checks**. |
| T04 | `browse` as the fourth mode; both halves, focus, strip, footer, detection | — | ✅ | Reviewed, two defects fixed: `enterBrowse` always seized the keyboard, and a failed `leaveBrowse` left `panes.viewer` naming a killed pane. **221 checks**. |
| T05 | Park/restore the pair instead of killing it | T00, T04 | ✅ | Reviewed, all deviations accepted, **one defect fixed**: the untouched path relaunched nothing but left the launch record saying `browse`, so the next agent switch quit and relaunched the very revdiff the park saved. Probed beyond the doc: the reap, migration and prompt-cancel paths, and the three maps' consistency. **295 checks** (new 11o proven to fail first). Geometry and broot's filter text stay **unverified** → T07. |
| T06 | Heal a quit half; reap a dead agent's pair | T05 | ⬜ | Two independent heals: never rebuild the pair to fix one half. |
| T07 | Verified by hand with the user | T03, T06 | ⬜ | Cannot be closed by any test. The session waits for the answer. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** *(empty.)* T05 was reviewed and closed on 2026-08-30 by a session that did not
write it. T06 is next, and is an implement.

## Blocked on the user

*(Nothing.)* The question the T03 review raised — what Enter should do on a file broot calls
**binary**, given `apply_to: text_file` was leaving it to macOS — was answered on 2026-08-29:
**show it in broot's own preview panel.** Built, tested and recorded in DESIGN §7.

The one open question the planning session left — the `browse` command name — was resolved at plan
review by removing the command: the browser now arrives with the mode, so there is nothing to name
and nothing to type.
