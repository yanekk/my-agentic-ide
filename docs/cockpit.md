# The cockpit — running it

Implements `requirements.md` on the architecture settled in `tool-selection-rev2.md`.

```
┌──────────────────────────────────────────────────┐
│  revdiff — HEAD → working tree, --untracked       │  55%
├─────────────────────────┬───────────────────┬────┤
│  claude agents (fleet)  │ THIS agent's term │list│  45%
├─────────────────────────┴───────────────────┴────┤
│  ⌥t new · ⌥[ ⌥] switch · ⌥w close   (key legend)  │  footer
└──────────────────────────────────────────────────┘
```

The bottom-right is not one terminal but a *set* — VSCode's terminal-tab model.
The active one fills the slot; the narrow strip on the right edge lists them all
and marks it, and a full-width footer along the bottom shows the keys. `⌥t` new,
`⌥[`/`⌥]` cycle, `⌥w` close. See [Multiple terminals per
agent](#multiple-terminals-per-agent).

## Install

```bash
bin/install.sh                    # or: bin/install.sh --start-dir ~/git
```

Idempotent, and `--check` reports without writing anything. It does three things:
verifies the tools below **through a login shell** (the PATH a GUI-launched
WezTerm actually gets, which is not the one your interactive shell has), writes
`~/.claude/cockpit/config.lua` recording this checkout and the projects root the
fleet view opens in, and points `~/.wezterm.lua` at `wezterm/cockpit.lua`.

Nothing here assumes where the repo lives or what the clone is called. The
projects root is remembered, so later runs need `--start-dir` only when it
changes -- `~/src` on one machine, `~/git` on another.

An existing `~/.wezterm.lua` of your own is never replaced silently: the
installer stops and tells you to either launch with `--config-file` or re-run
with `--force`, which keeps a copy at `~/.wezterm.lua.before-cockpit`.

### Prerequisites

| tool | install |
|---|---|
| `wezterm` | `brew install --cask wezterm` |
| `revdiff` | `brew tap umputun/apps && brew install revdiff` (third-party tap) |
| `node` | `brew install node` |
| `claude` | [claude.com/product/claude-code](https://claude.com/product/claude-code), then sign in |
| `git` | `xcode-select --install` |

## Start it

```bash
wezterm --config-file <checkout>/wezterm/cockpit.lua start
```

**Opening the window *is* starting the cockpit** — `wezterm/cockpit.lua` sets
`default_prog` to the layout script, so the panes build themselves and the fleet
view comes up in `~/src`. Nothing else to run.

That form needs no installer and is how to try it without disturbing your
existing setup. `bin/install.sh` is what makes it your normal terminal.

Or drive it by hand from inside any WezTerm pane:

```bash
<checkout>/bin/cockpit-layout.sh ~/src/some-repo
```

Either way it splits the panes, records their ids in
`~/.claude/cockpit/panes.json`, starts one daemon (killing any previous), and
`exec`s `claude agents --debug-file` into the bottom-left pane. The
`--debug-file` is required — it is what the daemon follows.

The fleet view is scoped with `--cwd` to the directory you launch against, so a
cockpit for `~/src` shows every agent under it and one for a single repo shows
only that repo's. `COCKPIT_ALL_AGENTS=1` disables the filter.

WezTerm panes die with the window, so re-running this *is* the recovery path. It
is deliberately cheap.

## Using it

1. Enter an agent in the fleet view. The diff pane retargets to that agent's
   worktree and the bottom-right pane becomes *that agent's own terminal* — its
   own shell, history, scrollback and running jobs, opened in the worktree the
   first time and resumed every time after. `⌥t` opens more terminals for the
   same agent; the strip on the right edge lists them. No action needed to start.
2. Read the diff. While you have not annotated anything, it auto-reloads as the
   agent writes.
3. Annotate with `a`. Type, `Enter`.
4. Press **`O`** — flush. The review is typed into the agent's prompt box and
   **left unsent**. Edit the wording if you like, then press Enter yourself.
5. Keep going. The pane never closes; `R` reloads by hand after the agent works.
6. Focus the diff pane (`⌥`+arrow) and press `⌥[` / `⌥]` to switch the **diff
   mode** — `uncommitted` (`HEAD` → working tree) ↔ `lastcommit` (`HEAD~1` →
   `HEAD`, just the most recent commit). The footer shows which is active. The
   choice is one global preference, persisted, so it survives reopening the
   cockpit and applies to every agent. (Focused on a terminal, the same keys still
   cycle terminals.)
7. Go back to the list. The daemon stops following that agent, and the terminal
   pane returns to the repo-root shell. The agent's own terminal keeps running in
   the background — enter that agent again and you are back in it, mid-flight.

## Why the details are the way they are

Each of these is a measured finding, not a preference — sources in
`spikes/pty-inject/RESULTS.md` and `tool-selection-rev2.md`.

| Choice | Reason |
|---|---|
| Payload has every `\r` replaced with `\n` | `\r` is what Enter sends and **submits**. `\n` merely inserts a newline. This one substitution is the whole reason the review can arrive unsent. |
| Injection only while attached | The fleet **list** has its own prompt box that dispatches a *new agent*. Typing a review there would spawn one. |
| `revdiff --untracked` | `git diff` does not report untracked files, and agents create new files constantly. Without this, new files are invisible. |
| Diff range is `HEAD`, passed symbolically | `revdiff [base] [against]` defaults `against` to the working tree, so `revdiff HEAD` diffs `HEAD` → working tree: the agent's **uncommitted** work, an empty diff on a clean tree, matching `git status`. Passing `HEAD` rather than a resolved SHA lets a reload re-read it, so committing drops work out of the diff. (A merge-base base — the old R3 — froze at launch and kept showing committed work.) |
| Merge base is discovered, not `main` | Agents branch from wherever they started. Tries `@{upstream}`, then `origin/HEAD`, then `main`, then `master`. |
| Auto-reload pauses once you annotate | `R` drops annotations. The pane freezes the moment you start commenting, so text cannot shift under you. |
| `--no-confirm-reload` deliberately **not** passed | So an auto-reload with unflushed annotations prompts instead of silently discarding them. |
| Long reviews sent as bracketed paste | Over ~10 lines the prompt box collapses them to a `[Pasted text +N lines]` chip. Shorter ones stay expanded and directly editable. |
| Watchers torn down *before* switching agents | Quitting revdiff flushes its annotations; that write must not be mistaken for a review of the agent being switched to. |
| `⌥[` / `⌥]` are routed by pane focus | The keys append `next`/`prev` to the command channel regardless of focus; the daemon reads the cockpit tab's active pane (`is_active` from `wezterm cli list`) and hands them to the diff-mode switch when the **diff** pane is focused, the terminal cycler otherwise. `⌥t`/`⌥w` are always terminals. |
| Switching diff mode restarts revdiff | `R` only reloads the same range, so a *range* change means quitting revdiff (`q`) back to its shell and relaunching it with the new args — never while the annotation editor is open, where `q` would land in the comment. `diffLaunchedMode` tracks the range each parked pane was launched with, so returning to an agent relaunches only when the global mode has changed since; otherwise the pane comes back untouched. The preference lives in `~/.claude/cockpit/diff-mode`. |

## Multiple terminals per agent

Each agent owns a *list* of terminals, not one — R1's "list of terminals on its
right edge and a way to add more (VSCode's terminal-tab UX)". Only the active one
is in the slot; the rest are parked in tabs of their own, still running. A narrow
**strip** on the right edge (`bin/cockpit-strip.mjs`) lists them and marks the
active one.

| Gesture | Verb | Effect |
|---|---|---|
| `⌥t` | `new`   | Open another terminal for this agent, in its worktree, and show it. |
| `⌥]` | `next`  | Show the next terminal in the list (wraps). |
| `⌥[` | `prev`  | Show the previous one (wraps). |
| `⌥w` | `close` | Close the shown terminal and drop back to a neighbour. The **last** one cannot be closed — the slot must always hold a terminal. |

The keybindings do not move panes themselves. Each appends one verb to
`~/.claude/cockpit/cmd`; the daemon tails that file (the same rotation-safe reader
as the fleet log) and does every swap, so every terminal stays tracked and
parked. A raw `SplitPane` binding — what `⌥t` used to be — makes an untracked pane
the daemon then shuffles around, which is the old "extra panes are not managed"
limit, now gone.

Switching terminals uses the **same** move as switching agents: the incoming
terminal is split *into* the outgoing one and the outgoing is parked afterwards,
so it inherits the exact slot between the fleet pane and the strip. Splitting off
the fleet pane (what the single-terminal build did) no longer lands full-width
once the strip is on the edge. When the slot is momentarily empty — the visible
terminal was killed — the strip is parked so the replacement can come off the
fleet pane, then the strip is moved back. All measured; see
`spikes/pane-swap/live-terminals.sh`.

The strip is **never parked**: it is pure display (it renders `terminals.json`,
written by the daemon on every change) and clings to the right edge for every
agent. The one exception is a diff-slot rebuild, which parks the terminal *and*
the strip so the full-width split can come off the fleet pane alone.

### The key legend is a footer pane

The gestures need to be discoverable, but WezTerm's status bar lives in the tab
bar — and the tab bar is off, because parked terminals live in tabs and a visible
one would look like the cockpit had vanished. So the legend is its own thin
full-width pane along the bottom (`cockpit-strip.mjs footer`, the same renderer in
a horizontal mode). It is split off **first**, while the fleet pane still fills
the window, so it spans the full width; every later split happens in the region
above it and leaves it untouched — including the diff-slot rebuild, which the
footer sits entirely below. It renders the same `terminals.json` as the strip, so
it also shows the attached agent's name and terminal count. Pure display, never
parked, never managed by the daemon (`panes.json` records its id as `foot` only
for debugging).

#### Keeping it one line tall

WezTerm has no fixed-size pane: every pane holds a **share** of the window, and
that share is re-applied on every window resize and every font-size change. Split
with `--percent 5` the legend was 2 rows on a 40-row window to begin with, and it
crept taller from there — a one-line legend that had grown to eat several rows of
the fleet view. So the split is `--cells 1`, and the footer puts itself back
whenever it notices it is taller than one row.

Correcting it is more awkward than it sounds, because `adjust-pane-size
--pane-id` is **ignored** by wezterm 20240203: it resizes whatever pane is
*active*. Aiming it at the footer from elsewhere squashed the bottom row —
fleet, terminal and strip — to a single line instead (measured). What works is
to focus the footer, shrink it, and hand focus straight back to the pane that
had it:

```
wezterm cli activate-pane     --pane-id <foot>
wezterm cli adjust-pane-size  --amount <rows-1> Down     # over-shrinking is clamped
wezterm cli activate-pane     --pane-id <previously active>
```

`cockpit-strip.mjs` does this itself, in `footer` mode only. It is the one thing
either display pane touches besides its own screen, and it only ever moves its
own boundary — the daemon still owns every pane swap. The correction is driven by
SIGWINCH (`process.stdout.rows`), debounced 250ms so a window drag is corrected
once at the size it settles at, and each drift height is attempted **once**:
focus is borrowed for ~100ms per attempt, so a drift that cannot be fixed (no
`wezterm` on PATH, a pane already at its minimum) must not be retried on every
tick. Measured settling time from a 9-row drift back to 1: ~300ms.

Pane swaps were ruled out as a cause first: parking and restoring the diff pane,
the terminal, and a full diff-slot rebuild all leave the footer's height exactly
where it was (`spikes/pane-swap/RESULTS.md`).

## Per-agent panes

Each agent gets its own terminals **and its own revdiff**, and so does the fleet
list (cwd = the cockpit repo). Only the diff and the active terminal are on screen
at a time, in the two slots; the strip is always present on the terminal's edge.

Switching does **not** open a new shell, `cd` a shared one, or restart revdiff.
The outgoing pane is moved into a tab of its own and the incoming pane is moved
back into the slot:

```
switch away:   wezterm cli move-pane-to-new-tab --pane-id <outgoing>
switch back:   wezterm cli split-pane --right --percent 50 \
                   --pane-id <fleet> --move-pane-id <incoming>
```

WezTerm never tears the PTY down across a move, which is the whole reason this
works: start `sleep 60`, switch away, come back 30 seconds later, and it has 30
seconds left. Scrollback, cwd, shell history and any running job come back with
the pane.

Parked terminals live in tabs of the cockpit window, and `enable_tab_bar = false`
keeps them off screen — activating one would fill the window with a bare shell
and look exactly like the cockpit had vanished. They are still titled
(`cockpit: <job id>`), so `wezterm cli list` is readable while debugging.

A pane is killed only when its agent leaves the fleet, and only after **two**
consecutive `claude agents --json` reads fail to mention it — one bad read must
not take out a shell with a build running in it. The repo-root panes are never
reaped.

### The diff slot swaps in the opposite order

Starting revdiff costs a couple of seconds of git and parsing, and that used to
be paid on every switch: the top of the cockpit went blank and then redrew. A
parked revdiff is already sitting on that agent's diff, so returning to an agent
types **nothing at all** — no `cd`, no `revdiff`, no reparse.

The order of the swap is not a style choice. The terminal is a leaf in the bottom
row, so it can be parked and then re-split from the fleet pane. The diff pane
spans the window, so its geometry *is* the slot: park it first and the only thing
left to split is the fleet pane's half-width region, which brings revdiff back at
59 of 120 columns. So the incoming pane is split **into** the outgoing one and the
outgoing one is disposed of afterwards — removing it collapses the split, and the
incoming pane inherits the whole slot at exactly the original size.

```
switch:   wezterm cli split-pane --top --percent 50 \
              --pane-id <outgoing diff> --move-pane-id <incoming>
          wezterm cli move-pane-to-new-tab --pane-id <outgoing diff>
```

If the diff pane dies outright there is nothing to split into, and the naive
rebuild gives that same half-width pane. Parking the *terminal* leaves the fleet
pane alone in the tab, so `split-pane --top` spans the window again; the terminal
is then moved back.

That path needs something to trigger it, because the reconcile poll returns early
while the attached agent is still the one showing — so a pane lost mid-attachment
(quit revdiff with `q`, then exit its shell) would leave the slot empty until the
next switch. A check on the reap interval notices the missing pane and forgets
`attached`, and the next poll rebuilds both slots. It is skipped while a reconcile
is in flight: attaching creates the two panes one after the other, and a check
landing in that gap sees a missing terminal and restarts an attach that was
already half done.

### Parked diffs keep following their worktree

Each agent's worktree watcher stays alive while its diff pane is parked, so the
pane reloads in the background and is **already current** when it comes back.
Without that, instant switching would just mean instantly showing a stale diff.

Two things must be true before an `R` is sent, and only the first was needed when
the pane was rebuilt on every switch:

1. **Nothing flushed yet** — `R` drops annotations, so the diff stops moving the
   moment you start commenting.
2. **The annotation editor is not open** — revdiff reads every keystroke as
   comment text while it is, so `R` would be typed *into* the comment as a literal
   `R`. On a visible pane you would see that happen; in a parked one you would
   not. The editor is detected by its footer, `[enter] save`.

With a saved annotation and no editor open, revdiff protects itself: it asks
`Annotations will be dropped — press y to confirm`, and a second `R` counts as
"any other key" and cancels. Prompts cannot pile up in a parked pane.

### "Is revdiff still running?" needs two signals

A restored pane must not have the revdiff command retyped into it — in a running
revdiff every character is a keybinding. WezTerm titles a pane after its
foreground process, which looks like the answer, but the title **lags** the launch
by about a second and longer across a move; believing a stale `bash` would type
`cd … && revdiff …` into a live revdiff. So the screen is consulted too: revdiff
frames its tree and diff, giving 19 lines that begin with `│` within half a second
of launch and 0 at a shell prompt. Either signal saying "revdiff" is enough.

### Measured, on wezterm 20240203

Against a headless `wezterm-mux-server` (an isolated `daemon_options.pid_file` and
socket, so no window had to be disturbed to find any of this out):

| Question | Answer |
|---|---|
| Does a parked pane keep running? | Yes. A 1/s counter accrued 21 ticks while its pane sat in a background tab, and kept climbing after it was moved back. |
| What does `split-pane --move-pane-id` return? | The **moved** pane's id, not a new one. The 50/50 bottom row is restored. |
| Does scrollback survive? | Yes — text written before the park is still in the pane after it returns. |
| Does killing a parked pane leave an empty tab? | No, `kill-pane` disposes of the tab too. |
| What does the pane experience? | Resize to the full tab and back: two SIGWINCHes per switch. Line output is unaffected; a full-screen TUI reflows. |

And for the diff slot (`spikes/pane-swap/probe.sh`, same setup):

| Question | Answer |
|---|---|
| Park the diff pane, then re-split from the fleet pane? | **59x22** — half a 120-column window, because the bottom row is a horizontal split. |
| Split the incoming pane in first, then park the outgoing one? | **120x22**, bottom row untouched at 59x17 / 60x17. |
| Rebuilding an empty slot? | Park the terminal → `split-pane --top` from the fleet pane → move the terminal back. Lands at 120x22 over 59x17 / 60x17. |
| Does a parked revdiff keep its state? | Yes — selected file, scroll position, annotation count and **unflushed annotations**. `O` on the restored pane wrote an annotation made before it was parked. |
| Is the screen identical afterwards? | No. The pane is resized to the full tab and back, so revdiff reflows and redraws. Nothing is lost. |
| Pane title while revdiff runs | `revdiff`, but **lagging**: still `bash` at t+0.5s, `revdiff` from t+1.0s, and stale for longer after a move. Back to `bash` after `q`. |
| Framed lines on screen (`^│`) | 19 within half a second of launch, 0 at a shell prompt, 19 while a status message covers the status bar, 0 after `q`. |
| `R` while the annotation editor is open | Typed into the comment: `comment on A` became `comment on AR`. |
| `R` with a saved annotation, then `R` again | `Annotations will be dropped — press y to confirm` → `Reload canceled`, annotation intact. |

## Configuration

| Env | Effect |
|---|---|
| `COCKPIT_AUTO_RELOAD=0` | Never auto-reload the diff; `R` by hand only. |
| `COCKPIT_DIR` | State directory (default `~/.claude/cockpit`). Used by the tests. |
| `COCKPIT_REAP_MS` | How often to check whether a terminal's agent still exists (default 15000). Two consecutive misses kill it. The tests drive this down so the wait is seconds. |

## Testing

```bash
spikes/cockpit-test/run.sh
```

Stubs `wezterm` with a shim that records argv and stdin **and models a pane
table** (`list`, `split-pane`, `move-pane-to-new-tab`, `kill-pane`), builds two
throwaway git repos, and drives attach → review → switch → switch back → detach →
reap. 55 assertions. Beyond the review-injection ones it asserts that entering an
agent *opens* a terminal and a diff pane in its worktree rather than `cd`-ing or
restarting shared ones, that switching *parks* both outgoing panes instead of
killing them, that switching back *moves the same panes in* — with **no revdiff
command retyped**, which is the whole point — that a parked agent's diff still
reloads when its worktree changes but *not* while its annotation editor is open,
and that both panes are reaped only once their agent has left the fleet.

The stub models pane **titles** too, and deliberately reports a stale one on the
switch-back so the framed-screen check has to carry that decision. Making
`diffPaneStatus` title-only fails exactly those two assertions.

```bash
spikes/pane-swap/probe.sh          # what wezterm and revdiff actually do
spikes/pane-swap/live.sh           # the real daemon, real mux, real geometry
spikes/pane-swap/live-terminals.sh # the multiple-terminals feature, end to end
```

`live-terminals.sh` builds the layout *with* the strip and footer and drives the
real daemon through the command channel: it asserts the strip renders and stays on
the edge, the footer renders the key legend full-width and survives a switch
untouched (naming the attached agent), that `⌥t`/`⌥[`/`⌥]`/`⌥w` add/cycle/close
terminals, that the active terminal keeps its geometry (47 cols beside a 12-col
strip and a 59-col fleet pane), that every terminal survives a switch to another
agent and back, and that the last terminal cannot be closed.

The stub cannot see geometry, so `live.sh` drives the **real daemon** against a
headless `wezterm-mux-server` with two throwaway worktrees and a fake `claude
agents`, and asserts the sizes: 20 checks that both slots come back at 120x22
over 59x17 / 60x17 on every switch, that each agent's revdiff keeps drawing while
parked, and that a return *restores* rather than opens.

One trap the shim has to avoid, written down because it cost a debugging round:
only `send-text` carries stdin, and reading stdin for the other subcommands hangs
— node's async `execFile` leaves the stdin pipe open, so `cat` blocks until the
daemon's 4s timeout on *every* poll, which looks exactly like a dead mux.

## Verified live

Driven end to end on 2026-08-23 against a real WezTerm window, not a stub:

| Step | Observed |
|---|---|
| Launch | Three panes built themselves — diff 25×200 on top, fleet and shell 20 rows below |
| Attach an agent | `enter 64793781 … → …/worktrees/requirements-and-tool-selection` in the daemon log |
| Diff pane | revdiff up on the agent's `HEAD` → working-tree diff, file tree populated, untracked `? cockpit.lua` listed |
| Shell pane | `cd`'d into the agent's worktree, branch showing in the prompt |
| Flush a review | `injected 9 lines into 64793781 (unsent)` — text sitting in the prompt box, **not** submitted |
| Detach, then flush again | Nothing typed. The new-session box stayed empty and the daemon logged no injection |

Per-agent terminals were driven end to end the same day, against a real mux with
the real daemon (not the stub):

| Step | Observed |
|---|---|
| Enter agent *alpha* | Repo shell parked to a tab of its own; `opened terminal pane 6 … at …/wtA` |
| Start a 1/s counter in it | 3 ticks recorded |
| Switch to agent *beta* | `opened terminal pane 7 … at …/wtB`; alpha's pane 6 parked, **counter still climbing** (7, then 24) |
| Switch back to *alpha* | `restored terminal pane 6` — the same pane, counter unbroken at 28, `ALPHA-SCROLLBACK` still on screen |
| Back to the fleet list | `restored terminal pane 5 for repo`; both agent terminals still alive and parked |
| Remove *beta* from the fleet | `reaped terminal pane 7 — agent bbb22222 is gone`, and its tab with it |

Three things the live run taught that the stubbed test could not:

1. **`default_prog` recursion.** With the layout script as `default_prog`, every
   `split-pane` would inherit it and re-run the script forever. Both splits (and
   the ALT+t binding) now name a login shell explicitly.
2. **Stale WezTerm socket.** Killing `wezterm-gui` rather than quitting leaves
   `default-org.wezfurlong.wezterm` symlinked to a dead instance, and every
   `wezterm cli` call then fails with `failed to connect`. The layout script now
   detects this and repoints the symlink at the newest live socket.
3. **Clearing an injected review takes several keystrokes.** `ctrl+u` kills one
   line at a time, so discarding a multi-line review means holding it down.
   `ctrl+y` pastes it back if you overshoot.

## How switching is detected

Three signals exist. The daemon uses the two that carry identity, and ignores the
one that does not.

| Signal | Identifies the agent? | Used |
|---|---|---|
| **Fleet pane's own header** — `wezterm cli get-text` on the pane we own | ✅ by name | **source of truth**, polled every 800ms |
| `[FV-attach]` in `--debug-file` | ✅ by job id | latency hint only — triggers an early reconcile |
| `~/.claude/daemon/attach-journal/*.json` | ❌ **nothing** | unused |

**The attach journal cannot drive this.** It records a `gestureId`, the attaching
client's pid, and timings — but no job id, session id, cwd, or agent name. It can
tell you *that* something was attached, never *which*, and each attach gets a
fresh `gestureId` so consecutive attaches of one agent cannot even be correlated.
It is a crash beacon for attach telemetry, not a navigation log.

What replaced it is better: the fleet view **renders the attached agent's name in
its own header**, and the cockpit owns that pane —

```
──────────────────────────── polish psychiatric hotline voiceover ─
```

so `wezterm cli get-text` reads it through a supported interface, and
`claude agents --json` maps the name to the job id and worktree. When the pane is
back at the list it says `describe a task for a new session` instead, which is how
detach is detected.

This makes the daemon **self-correcting**: it reconciles what the panes show
against what it believes, so it recovers from a missed event, a restart
mid-session, or a fleet view started without `--debug-file`. The debug log is now
only an optimisation — losing it costs up to 800ms of latency, not correctness.

Two deliberate refusals: if the header name matches **no** agent, or **more than
one**, the daemon leaves the panes where they are rather than guessing.

## Known limits

- **Agent names must be unique to be resolvable.** Two agents sharing a name make
  the header ambiguous; the daemon logs it and does nothing rather than pointing
  the panes at a coin flip. The debug log still resolves those correctly by job
  id, so this only bites if that log is unavailable *and* names collide.
- **A very narrow fleet pane could truncate the header name**, which reads as
  "no match" and stops following. The panes stay put; widening the window fixes it.
- **Unflushed annotations are invisible.** The daemon only learns of a review when
  you press `O`, so auto-reload's "have you started annotating?" check is based on
  the flushed file. revdiff's own confirmation prompt is the backstop.
- **One agent at a time**, by design (R6).
- **A parked pane is resized to the full tab and back**, so revdiff reflows twice
  per switch. Nothing is lost, but the redraw is visible.
- **Panes live and die with the window.** Closing the cockpit kills every agent
  terminal and every agent's revdiff; nothing survives a rebuild. This is the deliberate trade for not
  putting a detached-session multiplexer (`screen`, `dtach`) between you and every
  shell, with its own scrollback, escape key and resize quirks.
- **A parked terminal that is *not* the active one is only pruned, never
  rebuilt.** If a background terminal's PTY dies (its shell exited), the daemon
  drops it from the agent's list on the next reconcile; only the death of the
  *visible* terminal triggers a slot rebuild. This is intended — a background
  terminal is expected to come and go.
- **Each terminal is named by its foreground process** (`zsh` at a prompt,
  `node`/`npm`/`vim` while a command runs), not by the pane title — that only
  reflects the shell's prompt string (usually the cwd), which makes a useless
  name. The strip resolves the process from the tty (`ps -t`) on every repaint,
  so the label tracks the running command live. Two terminals running the same
  program are told apart by their number. The strip is ~12 columns, so a long
  process name is clipped.
