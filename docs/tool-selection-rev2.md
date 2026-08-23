# Tool selection, revision 2 — terminal-native

Supersedes the recommendation in `tool-selection.md`. Written 2026-08-23 after
Conductor was tried and rejected, which added R8 (lightweight), R9 (monospaced
throughout) and R10 (keyboard-controlled).

## What changed

Two things, and both point the same way.

**1. VSCode no longer clears the bar.** R9 is fatal to it: VSCode renders tabs,
sidebars, and — critically — the comment-thread UI in a proportional font. That is
the exact surface the review would live in. R8 is a second strike (Electron). The
extension was the right answer to R1–R7; it is not the right answer to R1–R10.

**2. The blocker on the terminal path has disappeared.** Revision 1 dismissed the
terminal because *"no TUI diff viewer has inline commenting, so the diff pane
would have to be a browser."* **That is no longer true.** At least three tools now
do exactly this, all built for the agent workflow:

| | Language | Comments out | Notes |
|---|---|---|---|
| [revdiff](https://github.com/umputun/revdiff) | Go, MIT | stdout on quit, or `-o file` | Ships a Claude Code plugin; detects tmux/Zellij/wezterm/kitty/ghostty/iTerm2 |
| [tuicr](https://tuicr.dev/) | Rust, MIT | clipboard markdown / stdout / real forge review | vim keybindings; skill opens it in a tmux split |
| [octorus](https://github.com/ushironoko/octorus) | — | comments cached under `~/.cache/octorus/` | local + GitHub PR modes |

## revdiff, verified on this machine

Installed `v1.12.0` via `brew install umputun/apps/revdiff` and drove it through
the same PTY harness used for the injection spike. Not from docs — observed:

- **R3 satisfied natively.** `revdiff main...HEAD` renders the three-dot
  merge-base diff, file-tree sidebar and all. Also supports `--staged`, `HEAD~N`,
  `main..feature`, and non-VCS file pairs.
- **R5 payload confirmed.** Annotate with `a`, type, Enter, quit with `q`, and
  `-o` yields exactly:

  ```markdown
  ## docs/requirements.md:1 (+)
  this heading should name the agent
  ```

  File-and-line anchored markdown — precisely the prompt payload, and multi-line,
  so the `\r`-stripping rule from the injection spike applies unchanged.
- `--exit-code-on-annotations` exits **10** when annotations were captured, which
  is a clean contract for glue: run it, check for 10, inject.
- Go binary, single install, monospaced and keyboard-driven by construction.
  R8/R9/R10 satisfied for free.

### Trap: agent-created files are invisible by default

Found by testing against a real agent diff, and it would have been a serious bug
in the cockpit. `git diff` does not report **untracked** files, so a plain
`revdiff` shows only *modified* files. Agents create new files constantly — in the
test, two of the three files the agent produced were new, and neither appeared.

**The cockpit must always pass `--untracked`.** revdiff then lists them in the
tree with a `?` marker (`M` for modified):

```
docs/research/
 ? README.md
 M fleet-focus.py
 ? fleet_resolve.py
```

(`git add -N` also works and was verified, but it writes to the agent's index —
never mutate a worktree you are only supposed to be reviewing. Use the flag.)

### Getting R3's range exactly right

`revdiff [base] [against]` defaults `against` to the working tree, so a single
base argument gives *base → working tree*. That distinction decides R3:

| Command | Range | Includes uncommitted? |
|---|---|---|
| `revdiff main...HEAD` | merge-base → HEAD | ✗ committed only |
| `revdiff main` | main tip → working tree | ✓ but skewed if main moved |
| **`revdiff --untracked $(git merge-base main HEAD)`** | **merge-base → working tree** | ✓ **this is R3** |

Measured on this branch: `main...HEAD` reported 5 files / 827 insertions, while
diffing from the merge-base commit reported 6 / 828 — the difference being
uncommitted work. Resolve the merge-base per worktree rather than hardcoding
`main`, since agents branch from wherever they started.

**Its one gap is R4 (live).** There is no file watcher; `R` reloads manually, and
reload *drops* annotations (`--no-confirm-reload` only skips the prompt, it does
not preserve them).

That gap is smaller than it looks, and the resolution is arguably better UX than
the requirement as written: **auto-reload only until the first annotation.** While
you are still reading, the diff tracks the agent live; the moment you start
commenting, it freezes so the text cannot shift under you. The glue sends `R` to
the pane on a debounced file-watch event, and stops once annotations exist.

## The whole chain is now proven, end to end

Every link measured on this machine, no speculation left:

```
[FV-attach] debug log     →  which agent is attached        (undocumented, §2 of research doc)
claude agents --json      →  that agent's live worktree     (supported CLI)
revdiff main...HEAD -o …  →  file:line anchored markdown    (verified above)
strip \r, write to PTY    →  sits UNSENT in the prompt box  (verified in spikes/pty-inject)
```

## What is left to build

Only the glue. Not an editor, not a multiplexer, not a diff viewer, not a comment
UI — all of that is now off-the-shelf. A small daemon that:

1. tails the fleet debug log for `[FV-attach]`, resolves the job id via
   `claude agents --json`;
2. on **enter**, relaunches revdiff in the top pane scoped to that worktree, and
   points the bottom-right shell at it;
3. debounce-watches the worktree, sending `R` to the revdiff pane until the first
   annotation appears;
4. on revdiff exit 10, reads the annotations file, normalises `\r`, and writes it
   into the fleet pane — where it sits unsent for you to edit and send.

Call it a few hundred lines of Node (the only runtime already installed).

## Pane host: WezTerm — DECIDED 2026-08-23

**Chosen: WezTerm.** One window that is both terminal and multiplexer, the best
automation CLI of the candidates, and a deliberate move off the VSCode terminal.

Recorded for completeness: the analysis below leaned Zellij, on the grounds that
its always-visible keybinding bar suits someone with no multiplexer background,
its KDL layouts are declarative, and its sessions survive a window close. That
reasoning still stands on its own terms — it was outweighed by wanting a single
purpose-built window. Two consequences to design around:

- **No free session persistence.** WezTerm panes die with the window (a separate
  `wezterm-mux-server` would be needed). Already an explicit non-requirement, but
  it means the layout script must be cheap to re-run — treat relaunching the
  cockpit as the normal case, not the exception.
- **Keybindings are not discoverable on screen.** Worth defining a small, written-
  down set in `.wezterm.lua` rather than relying on defaults.

### The comparison, for the record

**WezTerm** — terminal *and* multiplexer in one binary, so it replaces Terminal.app
rather than nesting inside it. Its CLI is the best available for this kind of
automation: `wezterm cli send-text --pane-id N --no-paste` targets a pane
explicitly, `split-pane --cwd` and `cli list --format json` handle geometry and
discovery. Startup layout declared in Lua. Best automation story; Lua config and a
new terminal to learn.

**Zellij** — a multiplexer that runs inside whatever terminal you already have.
Its decisive advantage for someone with no tmux background is that it **shows its
keybindings on screen**, so it is learnable by use rather than by manual. Layouts
are declarative KDL files that would express the three-pane geometry directly, and
sessions survive the terminal closing. Pane targeting via `--pane-id` exists
(`paste` is documented as more robust than `write-chars`).

**Build our own TUI multiplexer** — total control, no learning curve, our own
keybindings. But hosting `claude agents` inside our own pane means embedding a
terminal emulator (node-pty + `@xterm/headless` and a redraw loop): writing a
mini-tmux to avoid installing one. Not recommended unless both above fail.

## Why the agent cannot open the review itself

The revdiff plugin launches its TUI by splitting the terminal, detecting it in the
order tmux → Zellij → herdr → kitty → wezterm → cmux → ghostty → iTerm2 → Emacs
vterm. If none matches it **hard-errors** — there is no inline fallback:

```
error: no overlay terminal available (requires agterm, tmux, zellij, herdr,
kitty, wezterm, cmux, ghostty, iTerm2, or emacs vterm)
```

Detection reads environment variables (`$TMUX`, `$ZELLIJ`, `$WEZTERM_PANE`, …) of
**the process running the skill**. For a *background* agent that process is the
daemon-side worker, and its environment is frozen at spawn time. Measured on the
test agent (pid 15650):

```
VSCODE_INJECTION=1
TERM=xterm-256color          # no WEZTERM_PANE, no TMUX, no ZELLIJ
```

Attaching to that agent from a WezTerm pane later does **not** change this — the
TUI is proxied to your terminal, but the agent's own tools still run in the
environment it was launched with. So `/revdiff` inside an attached background
agent fails, and no amount of choosing the right terminal fixes it.

**This is a design input, not just a testing nuisance.** It rules out the
"zero-glue" idea of letting the agent drive the review, and confirms the
architecture already chosen: **the cockpit owns the revdiff pane.** The human side
launches revdiff in a pane it controls, reads the annotations, and types them into
the agent — the agent is never asked to open a UI. The plugin remains useful for
*foreground* sessions started inside a supported terminal, which is how the loop
can be rehearsed before the daemon exists.

## Free stopgap, available tonight

revdiff ships a Claude Code plugin (`/plugin install revdiff@revdiff`). If the
*agent* runs `/revdiff main...HEAD`, it opens the TUI for you to annotate and the
annotations flow **back into that agent automatically** — no glue, no layout, no
code. That is not the cockpit (no auto-follow, no persistent diff pane; the review
is an overlay in the same pane), but it exercises the exact review loop and would
prove the workflow before anything gets built.
