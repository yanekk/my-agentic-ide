# The cockpit — running it

Implements `requirements.md` on the architecture settled in `tool-selection-rev2.md`.

```
┌──────────────────────────────────────────────────┐
│  revdiff — merge-base → working tree, --untracked │  55%
├─────────────────────────┬────────────────────────┤
│  claude agents (fleet)  │  shell @ agent worktree │  45%
└─────────────────────────┴────────────────────────┘
```

## Prerequisites

`wezterm`, `revdiff`, `node`, `claude`, `git`. All installed.

## Start it

```bash
wezterm --config-file ~/src/agentic-ide/wezterm/cockpit.lua start
```

**Opening the window *is* starting the cockpit** — `wezterm/cockpit.lua` sets
`default_prog` to the layout script, so the panes build themselves and the fleet
view comes up in `~/src`. Nothing else to run.

To make it your normal terminal, merge `wezterm/cockpit.lua` into
`~/.wezterm.lua`; it is kept separate only so it can be tried without disturbing
your existing setup.

Or drive it by hand from inside any WezTerm pane:

```bash
~/src/agentic-ide/bin/cockpit-layout.sh ~/src/some-repo
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
   worktree and the shell pane `cd`s there. No action needed.
2. Read the diff. While you have not annotated anything, it auto-reloads as the
   agent writes.
3. Annotate with `a`. Type, `Enter`.
4. Press **`O`** — flush. The review is typed into the agent's prompt box and
   **left unsent**. Edit the wording if you like, then press Enter yourself.
5. Keep going. The pane never closes; `R` reloads by hand after the agent works.
6. Go back to the list. The daemon stops following that agent.

## Why the details are the way they are

Each of these is a measured finding, not a preference — sources in
`spikes/pty-inject/RESULTS.md` and `tool-selection-rev2.md`.

| Choice | Reason |
|---|---|
| Payload has every `\r` replaced with `\n` | `\r` is what Enter sends and **submits**. `\n` merely inserts a newline. This one substitution is the whole reason the review can arrive unsent. |
| Injection only while attached | The fleet **list** has its own prompt box that dispatches a *new agent*. Typing a review there would spawn one. |
| `revdiff --untracked` | `git diff` does not report untracked files, and agents create new files constantly. Without this, new files are invisible. |
| Diff range is a bare merge-base commit | `revdiff [base] [against]` defaults `against` to the working tree, so `revdiff <merge-base>` spans committed **and** uncommitted work. `main...HEAD` would miss the uncommitted part. |
| Merge base is discovered, not `main` | Agents branch from wherever they started. Tries `@{upstream}`, then `origin/HEAD`, then `main`, then `master`. |
| Auto-reload pauses once you annotate | `R` drops annotations. The pane freezes the moment you start commenting, so text cannot shift under you. |
| `--no-confirm-reload` deliberately **not** passed | So an auto-reload with unflushed annotations prompts instead of silently discarding them. |
| Long reviews sent as bracketed paste | Over ~10 lines the prompt box collapses them to a `[Pasted text +N lines]` chip. Shorter ones stay expanded and directly editable. |
| Watchers torn down *before* switching agents | Quitting revdiff flushes its annotations; that write must not be mistaken for a review of the agent being switched to. |

## Configuration

| Env | Effect |
|---|---|
| `COCKPIT_AUTO_RELOAD=0` | Never auto-reload the diff; `R` by hand only. |
| `COCKPIT_DIR` | State directory (default `~/.claude/cockpit`). Used by the tests. |

## Testing

```bash
spikes/cockpit-test/run.sh
```

Stubs `wezterm` with a shim that records argv and stdin, builds a throwaway git
repo with both a modified and an untracked file, and drives a full
attach → review → detach cycle. Asserts the panes are retargeted, the review
reaches the *fleet* pane carrying no `\r`, and that nothing is typed once the
fleet list is showing.

## Verified live

Driven end to end on 2026-08-23 against a real WezTerm window, not a stub:

| Step | Observed |
|---|---|
| Launch | Three panes built themselves — diff 25×200 on top, fleet and shell 20 rows below |
| Attach an agent | `enter 64793781 … → …/worktrees/requirements-and-tool-selection` in the daemon log |
| Diff pane | revdiff up on the agent's merge-base diff, file tree populated, untracked `? cockpit.lua` listed |
| Shell pane | `cd`'d into the agent's worktree, branch showing in the prompt |
| Flush a review | `injected 9 lines into 64793781 (unsent)` — text sitting in the prompt box, **not** submitted |
| Detach, then flush again | Nothing typed. The new-session box stayed empty and the daemon logged no injection |

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
