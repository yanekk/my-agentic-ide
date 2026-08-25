# agentic-ide

A terminal cockpit for reviewing what `claude agents` produce.

One WezTerm window, three panes: the agent's diff across the top, the fleet list
bottom-left, the agent's own shell bottom-right. Read the diff, annotate it,
press **Shift+O** — the review lands in that agent's prompt box, unsent, with
the cursor already there.

```
┌──────────────────────────────────────────────────┐
│  revdiff — the attached agent's diff              │  42%
├─────────────────────────┬───────────────────┬────┤
│  claude agents (fleet)  │ shell @ worktree  │list│  58%
├─────────────────────────┴───────────────────┴────┤
│  ⌥t new · ⌥[ ⌥] switch · ⌥w close   (key legend)  │  1 row
└──────────────────────────────────────────────────┘
```

## Why this exists

I stopped writing the code. The agents write it; my job is to read what came
back and say what's wrong with it.

That turned VSCode into mostly dead weight. The extension host, the language
servers, the debugger, the refactoring engine, IntelliSense, the test explorer,
the source control graph, the marketplace — all of it exists to help a person
*type code into a file*. I don't do that any more. What I kept using was a diff
view, a terminal, and a place to type a sentence back to Claude. Everything else
was chrome I was paying for in startup time, RAM, proportional-font UI and a
sidebar full of things I never clicked.

And the diff — the one part of it I still wanted — was the part VSCode couldn't
actually give me. A VSCode window is bound to a folder, and that folder was the
main checkout; the agents work in git worktrees, so everything they wrote landed
outside the tree the window was open on. The source control panel had nothing to
show. The only dependable way to see an agent's changes was to have it commit and
push, and then read the diff on BitBucket — a trip out through a remote to look
at work sitting on the same disk, and even then a diff of *committed* work only,
which is the wrong thing to be reading when the whole point is to catch something
before it lands. So the cockpit's diff pane belongs to the attached agent's
worktree and shows uncommitted work by default: nothing has to be committed,
pushed or opened in a browser to be reviewed.

The other half of it is that even where there is a diff on screen, it and the
agent live in different worlds. The diff is a tab; the agent is a terminal
somewhere below it; getting a comment from one to the other means selecting text, copying
it, clicking into the terminal, pasting, and retyping the file and line number
you just lost. That round trip is the *entire* job, repeated a few hundred times
a day, and it was the slowest part of the day.

I tried the heavier answer first (Conductor, 2026-08-23) and it went the wrong
way: more app, its own harness, not monospaced, not keyboard-first. So this went
the other way — strip the surface down to exactly the two activities that remain
(**read the diff**, **comment back**) and make the path between them one
keystroke. It is deliberately **not an IDE**: no editing, no LSP, no debugger,
no extensions. `docs/requirements.md` records the interview this came out of.

## The three panes

The layout is fixed, not a workspace you arrange:

- **Top — the diff.** `revdiff --untracked HEAD` against the attached agent's
  worktree: its *uncommitted* work, so a clean tree shows an empty diff, exactly
  matching what the agent sees from `git status`. It auto-reloads as the agent
  writes files, and stops reloading the moment you start annotating so text
  cannot shift under you.
- **Bottom-left — the fleet.** `claude agents`, the list of running agents.
  Entering one here is the only navigation gesture there is; the other two panes
  follow it with no further action.
- **Bottom-right — that agent's own shell**, opened in that agent's worktree.
  Not one terminal but a set, VSCode's terminal-tab model: `⌥t` opens another,
  `⌥[` / `⌥]` cycle, `⌥w` closes, and the narrow strip on the right edge lists
  them and marks the active one. A thin full-width footer along the bottom shows
  the key legend so nothing has to be memorised.

Attaching to a different agent **moves** those panes rather than restarting
them. Every terminal of every agent, and every agent's revdiff, keeps running
while parked — with its selected file, scroll position and unflushed
annotations intact. Switching away and back resumes mid-flight: nothing is
retyped and no diff is reparsed, which is what makes a return instant instead of
a two-second blank redraw.

With no agent attached, the top pane splits into a greeting and a **notes**
column, newest first. `note "rebase before the PR"` adds one, bare `note` lists,
`note edit a3f9` / `note rm a3f9` change and remove. The command exists in
cockpit terminals and nowhere else. Agents inherit it too, so an agent can leave
you a note — those carry its name, so a note you were handed never reads like
one you wrote.

## Shift+O — the whole review loop

1. Enter an agent in the fleet list. Diff and terminal retarget themselves.
2. Read. Press `a` on a line to annotate, type the comment, `Enter`.
3. Press **`O`** (Shift+O). Two things happen at once:
   - the annotations are composed into a prompt and **typed into that agent's
     prompt box without submitting it**, and
   - focus jumps to the Claude pane, where the text is already waiting.
4. Edit the wording if you want, then press Enter yourself. Or don't send it.

The unsent part is the point, and it is why the host is WezTerm rather than a
GUI app: `wezterm cli send-text --pane-id N --no-paste` can write bytes into
another pane's PTY, and every `\r` in the payload is replaced with `\n` before
it goes. `\r` is what Enter sends and would submit the review; `\n` only inserts
a newline. That single substitution is the reason a review arrives pre-filled
and editable instead of already gone.

The focus jump rides on the same keystroke rather than a second binding: `O` is
revdiff's own flush key, so a *successful* flush runs revdiff's
`--post-flush-command`, which tells the daemon to activate the Claude pane. One
key sends the review and lands you where you'd edit it, and `O` stays an
ordinary letter in every other pane.

### Diff modes

With the **diff pane** focused, `⌥[` / `⌥]` cycle what's being diffed (focused on
a terminal, the same keys still cycle terminals):

| mode | range |
|---|---|
| `uncommitted` (default) | `HEAD` → working tree — the agent's uncommitted work |
| `lastcommit` | `HEAD~1` → `HEAD` — just the most recent commit |
| `custom` | an arbitrary branch/SHA → working tree |

Cycling into `custom` pops an ASCII prompt in the diff pane asking for the ref,
pre-filled with that agent's last one. The mode is **per agent** and
session-only — a new agent, and every agent after a rebuild, starts at
`uncommitted`, and toggling one agent's mode never touches another's. Only the
custom ref persists.

### Keys

| key | does |
|---|---|
| `O` | flush the review into the agent's prompt box, unsent, and focus it |
| `a` / `Enter` | annotate the selected line (revdiff) |
| `R` / `Shift+Q` | reload the diff by hand / drop all annotations and keep reviewing |
| `⌥t` | new terminal for this agent |
| `⌥[` `⌥]` | cycle terminals — or diff modes, if the diff pane is focused |
| `⌥w` | close terminal (refused on the last one) |
| `⌘⌥`+arrows | move focus between panes |
| `⌥z` | zoom the focused pane |

## Installation

macOS, and five command-line tools:

| tool | install |
|---|---|
| `wezterm` | `brew install --cask wezterm` |
| `revdiff` | `brew tap umputun/apps && brew install revdiff` (third-party tap) |
| `node` | `brew install node` |
| `claude` | [claude.com/product/claude-code](https://claude.com/product/claude-code), then sign in |
| `git` | `xcode-select --install` |

Then, once per machine:

```bash
bin/install.sh                    # or: bin/install.sh --start-dir ~/git
```

It is idempotent, and `--check` reports what it would do without writing
anything. Three steps: verify those tools **through a login shell** (the PATH a
GUI-launched WezTerm actually gets, which is not your interactive shell's),
write `~/.claude/cockpit/config.lua` recording where this checkout lives and
which projects root the fleet view opens in, and point `~/.wezterm.lua` at
`wezterm/cockpit.lua`. The projects root is remembered, so later runs need
`--start-dir` only when it changes.

An existing `~/.wezterm.lua` of your own is never replaced silently — the
installer stops and tells you to either use `--force` (which keeps a copy at
`~/.wezterm.lua.before-cockpit`) or launch without the symlink:

```bash
bin/install.sh --no-link
wezterm --config-file <checkout>/wezterm/cockpit.lua start
```

### Running it

Just open WezTerm. `~/.wezterm.lua` points here, and `wezterm/cockpit.lua` sets
`default_prog` to the layout script — the panes build themselves, the daemon
starts, and the fleet view comes up. Re-opening the window is the supported way
to rebuild everything, and it is deliberately cheap.

Agent panes live and die with the window: closing it kills every agent terminal
and every agent's revdiff. The agents themselves are daemon-backed and survive
independently, so relaunching the cockpit picks them straight back up.

## Layout of the repo

```
bin/install.sh          per-machine setup: prerequisites, config.lua, the symlink
bin/cockpit-layout.sh   splits panes (incl. the strip), records ids, starts daemon
bin/cockpitd.mjs        follows the fleet view, retargets panes, injects reviews
bin/cockpit-strip.mjs   renders the terminal list (strip) and key legend (footer)
bin/cockpit-welcome.mjs renders the fleet list's top pane: greeting | notes column
bin/cockpit-note.mjs    the `note` command (cockpit terminals only)
bin/cockpit-notes.mjs   the notes store, shared by the command and the renderer
bin/cockpit-custom-prompt.mjs  the ASCII branch/SHA prompt for the "custom" diff mode
wezterm/cockpit.lua     window config; default_prog is the layout script
spikes/cockpit-test/    integration test, wezterm stubbed (82 assertions)
spikes/notes-test/      the `note` command and the notes column (39 assertions)
spikes/pty-inject/      PTY harness used to settle how injection behaves
spikes/pane-swap/       headless-mux probes for the diff slot and the footer height
docs/requirements.md    what this had to do, and why VSCode and Conductor didn't
docs/cockpit.md         how it works and why; read before changing the daemon
```

Run the tests with `spikes/cockpit-test/run.sh` and `spikes/notes-test/run.sh`.

State lives in `~/.claude/cockpit/` — `config.lua` (the only file not
regenerated), `panes.json`, `terminals.json`, `custom-refs.json`, `notes.json`,
the `cmd` channel the keybindings append to, and the logs. Debug with
`tail -f ~/.claude/cockpit/daemon.log`.

## Known limits

- Agent names must be unique to resolve from the fleet pane's header; ambiguity
  is logged and the panes are left alone rather than pointed at a guess.
- Nothing survives closing the window — see above. Deliberate: the alternative
  is a detached-session multiplexer sitting between you and every shell.
- A parked pane is resized to the full tab and back, so revdiff visibly reflows
  and redraws on return. Nothing is lost.
- One agent at a time, by design.
