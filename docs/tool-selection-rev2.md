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

## The open question: what hosts the panes?

This is the one genuine fork left, and it is a preference call — both are
defensible, and it is the shell you would live in daily.

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

## Free stopgap, available tonight

revdiff ships a Claude Code plugin (`/plugin install revdiff@revdiff`). If the
*agent* runs `/revdiff main...HEAD`, it opens the TUI for you to annotate and the
annotations flow **back into that agent automatically** — no glue, no layout, no
code. That is not the cockpit (no auto-follow, no persistent diff pane; the review
is an overlay in the same pane), but it exercises the exact review loop and would
prove the workflow before anything gets built.
