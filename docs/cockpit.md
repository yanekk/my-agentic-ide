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

Open **WezTerm** (not the VSCode terminal — the layout script needs a real
WezTerm pane), then:

```bash
~/src/agentic-ide/bin/cockpit-layout.sh ~/src/some-repo
```

That splits the panes, records their ids in `~/.claude/cockpit/panes.json`,
starts the daemon, and finally `exec`s `claude agents --debug-file` into the
bottom-left pane. The `--debug-file` is required — it is what the daemon follows.

WezTerm panes die with the window, so re-running this script *is* the recovery
path. It is deliberately cheap.

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

## Known limits

- **The attach signal is undocumented.** The daemon greps `[FV-attach]` out of the
  debug log; that format could change between Claude Code releases. Everything
  else (`claude agents --json`) is supported CLI. If focus-following silently
  stops after an upgrade, this is the first thing to check.
- **Unflushed annotations are invisible.** The daemon only learns of a review when
  you press `O`, so auto-reload's "have you started annotating?" check is based on
  the flushed file. revdiff's own confirmation prompt is the backstop.
- **One agent at a time**, by design (R6).
