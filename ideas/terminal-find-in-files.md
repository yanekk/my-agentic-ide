# Find in files, in the terminal

Parked brainstorm, 2026-08-25. The want: VSCode's `Ctrl+Shift+F` and `Ctrl+P`
without VSCode -- and an editor that is not `nano` and not modal.

## The idea

VSCode gives you one window, so it reads as one feature. In a terminal it is
three separate tools, and conflating them is what makes people bounce off:

| VSCode gesture | what it actually is | tool |
|---|---|---|
| `Ctrl+P` | jump to a file by name | `fzf` over `rg --files`, fuzzy |
| `Ctrl+Shift+F` | grep the repo, browse hits with context | `fzf` live-reloading `rg`, regex |
| the editor | change the line | `micro` (undecided) |

The engine (`rg`) and the interactive layer (`fzf`) are separate; the glue is
about fifteen lines of shell. That glue is the whole feature.

## What was installed

- **fzf 0.74.3** -- was genuinely missing.
- **ripgrep 15.2.0** -- the buried problem. The `rg` visible inside a Claude
  session is a *shim* Claude Code injects into its own shell, dispatching into
  the `claude` binary (it shadows `find` and `grep` the same way, with embedded
  `bfs`/`ugrep`). None of that exists in a cockpit terminal, so real ripgrep had
  to be installed before any of this could work outside an agent.

Still **not** installed, and the open decision: `bat` (syntax-highlighted
preview; the scripts fall back to `cat -n` without it) and `micro`.

## The editor question, unresolved

`micro` is the recommendation: `Ctrl+S`/`Ctrl+Q`/`Ctrl+C`/`Ctrl+V`/`Ctrl+Z`,
mouse click-to-position, drag-select, syntax highlighting, no modes, single Go
binary, and `micro +42 file` opens at a line -- which is what makes the
search-to-editor jump work at all. `helix` is better software but modal, i.e.
a vim-shaped thing to learn. `vim` and `nano` are both already rejected.

Until something is installed, `enter` falls back to **vim**. The workaround is
to not use it: `ctrl-o` opens the file in **revdiff** instead, which is the
better loop anyway -- search to *read* code, annotate, `O`, and the comment
lands in the agent's prompt box unsent. Option 2 below is therefore live: find
out whether an editor is even wanted before installing one.

Open options:
1. `brew install micro`, `enter` opens a VSCode-shaped editor at the line.
2. Leave `enter` alone, live on `ctrl-o` -> revdiff. Costs nothing.
3. Point `$EDITOR` somewhere; the scripts pick it up.

## Find *and replace* across files -- not started

Its own tool, deliberately deferred until search proves itself.
`scooter` (0.9.1, brew) is the closest thing to VSCode's replace-all panel:
rg-backed search, tick which hits to apply, preview the diff, then commit.
`serpl` is the same idea, rougher. `sad` is the pipe-friendly version.

## Cockpit integration

- **Publishing them is already solved.** `~/.claude/cockpit/bin` is first on
  every cockpit terminal's PATH and `bin/cockpit-layout.sh` only ever `ln -sf`s
  `note` into it -- it does not wipe the directory, so anything else dropped
  there survives a rebuild. `ff`/`fp` are scoped to the cockpit for free, and
  the agents inherit them exactly like `note`.
- **revdiff as the reader.** `ctrl-o` is bound to it. Better than an editor for
  the read-only case, and it closes the loop into the review gesture.
- **Wilder, parked:** WezTerm `hyperlink_rules` matching `file.ts:42:` would
  make *every* pane's output click-to-open -- rg hits, stack traces, test
  failures, compiler errors. The thing VSCode does that is most missed.

## Gotchas found the hard way

| | |
|---|---|
| `rg` inside a Claude session is not ripgrep | It is a shim function from the shell snapshot that re-execs the `claude` binary. `command -v rg` prints `rg`, not a path. Check `/opt/homebrew/bin/rg` before believing ripgrep is installed. |
| The empty query must be guarded | `rg -- ''` matches every line of every file. `test -n {q} &&` in front of the reload keeps an empty prompt empty instead of dumping the repo. |
| The glob has to survive `sh` | fzf runs the reload through `sh -c`, so `-g "!**/.git/**"` is quoted *inside* the command string. Unquoted it is exposed to the shell's own globbing. |
| `ctrl-p` was the wrong toggle key | It is fzf's built-in "move up". Preview toggle moved to `ctrl-/` and `alt-p`; both validated (`bogus-key` is rejected by fzf, so the check is real). |
| zsh applies `:t` inside double quotes | `"$k:toggle-preview"` silently became `ctrl-oggle-preview` -- the `:t` history modifier fired on an *unbraced* variable. Use `"${k}:..."`. Bit a test, not the scripts. |
| Width | The attached agent's terminal is ~47 columns. `--preview-window up,60%` stacks vertically and survives; a side preview would not. Roomier in a fresh `⌥t` terminal. |

## Usage, once it is unparked

`ff`'s query goes **straight to ripgrep** -- regex, smart-case, and a space is a
literal space, not "and". `fp` is the opposite, normal fzf fuzzy. That
asymmetry is deliberate: file *names* you half-remember, file *contents* you
usually know exactly.

```
ff healQuitDiff          literal
ff 'diffMode|customRef'  alternation
ff 'function \w+Diff'    regex -> relaunchDiff, rebuildDiffSlot, showDiff
fp ckpd                  fuzzy -> bin/cockpitd.mjs
```

Keys: type to re-search live; `↑`/`↓` move; `shift-↑`/`shift-↓` scroll the
preview; mouse scroll and click work; `enter` opens at the line; `ctrl-o` sends
the file to revdiff; `ctrl-/` or `alt-p` toggles the preview; `esc` quits.

## The scripts

Verified working headlessly (rg pipeline, empty-query guard, `sh` re-parse, key
names, `zsh -n`). The **interactive** run was never tried -- fzf needs a TTY.

They currently live in a Claude job tmp dir, with symlinks at
`~/.claude/cockpit/bin/{ff,fp}` pointing there. **That directory is deleted when
the job is** -- at which point the symlinks dangle. The source below is the
durable copy; to make the working ones durable too:

```sh
cp ~/.claude/jobs/21f4a8b0/tmp/{ff,fp} ~/.claude/cockpit/bin/
```

### `ff` -- find in files

```sh
#!/bin/zsh
# ff — find in files. VSCode Ctrl+Shift+F, in a terminal.
#   ff              open empty, type to search
#   ff foo          open pre-filled with "foo"
# enter  open the hit in your editor, at that line
# ctrl-o review the file in revdiff instead
# ctrl-p toggle the preview pane
# esc    quit, change nothing

RG='rg --line-number --no-heading --color=always --smart-case --hidden -g "!**/.git/**"'

if command -v bat >/dev/null 2>&1; then
  PREVIEW='bat --style=numbers --color=always --highlight-line {2} -- {1}'
else
  PREVIEW='cat -n -- {1}'
fi

if command -v micro >/dev/null 2>&1; then
  OPEN='micro +{2} {1}'
elif [ -n "$EDITOR" ]; then
  OPEN="$EDITOR +{2} {1}"
else
  OPEN='vim +{2} {1}'
fi

fzf --ansi --disabled --query "$*" \
    --delimiter : \
    --bind "start:reload:test -n {q} && $RG -- {q} || true" \
    --bind "change:reload:sleep 0.05; test -n {q} && $RG -- {q} || true" \
    --bind "enter:become($OPEN)" \
    --bind "ctrl-o:become(revdiff {1})" \
    --bind 'ctrl-/:toggle-preview' --bind 'alt-p:toggle-preview' \
    --preview "$PREVIEW" \
    --preview-window 'up,60%,border-bottom,+{2}/2' \
    --prompt 'find in files > ' \
    --header 'enter edit · ctrl-o revdiff · ctrl-/ preview · esc quit' \
    --info inline
```

### `fp` -- find file by name

```sh
#!/bin/zsh
# fp — find file by name. VSCode Ctrl+P, in a terminal.
if command -v bat >/dev/null 2>&1; then
  PREVIEW='bat --style=numbers --color=always -- {}'
else
  PREVIEW='cat -n -- {}'
fi
if command -v micro >/dev/null 2>&1; then OPEN='micro {}'
elif [ -n "$EDITOR" ]; then OPEN="$EDITOR {}"
else OPEN='vim {}'; fi

rg --files --hidden --glob='!**/.git/**' \
  | fzf --query "$*" \
        --bind "enter:become($OPEN)" \
        --bind "ctrl-o:become(revdiff {})" \
        --bind 'ctrl-/:toggle-preview' --bind 'alt-p:toggle-preview' \
        --preview "$PREVIEW" \
        --preview-window 'up,60%,border-bottom' \
        --prompt 'find file > ' \
        --header 'enter edit · ctrl-o revdiff · ctrl-/ preview · esc quit' \
        --info inline
```
