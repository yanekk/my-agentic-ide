# agentic-ide

A terminal cockpit for reviewing what `claude agents` produce. Entering an agent
in the fleet view swaps in that agent's **own two panes** — its own revdiff on its
own worktree, and its own private shell. Both keep running while you are
elsewhere, so switching away and back resumes them mid-flight: nothing is retyped
and no diff is reparsed, which is what makes a return instant. Review comments
come back as a prompt typed into the agent's input box, left **unsent** so the
wording can be edited first.

```
┌──────────────────────────────────────────────────┐
│  revdiff — the attached agent's diff              │  42%
├─────────────────────────┬───────────────────┬────┤
│  claude agents (fleet)  │ shell @ worktree  │list│  58%
├─────────────────────────┴───────────────────┴────┤
│  ⌥t new · ⌥[ ⌥] switch · ⌥w close   (key legend)  │  1 row
└──────────────────────────────────────────────────┘
```

With **no agent attached** that top pane is split down the middle instead: the
cockpit's greeting on the left, a **notes list** on the right, newest first.
Entering an agent parks the whole pane and revdiff comes back at full width, so
nothing about the agent view changes.

```
┌──────────────────────┬───────────────────────────┐
│                      │ NOTES                  4  │
│  agentic-ide         │ ───────────────────────── │
│  cockpit             │ 5c4f  2h   rebase before… │
│                      │ 0665  Mon  skipped the f… │
│                      │ … +7 more · note ls       │
├────────────────┬─────┴──────────────────────┬────┤
│ claude agents  │ shell @ repo               │list│
└────────────────┴────────────────────────────┴────┘
```

Notes are added from **`note`**, which exists in every cockpit terminal and
nowhere else: `note "rebase before the PR"` adds, bare `note` lists, `note edit
a3f9` / `note rm a3f9` change and remove. Each has a **stable short id** (any
unique prefix resolves), a date and an author. The agents inherit the command
too, so an agent can leave you a note — those carry its name, so a note you were
handed never reads like one you wrote.

Each agent has **many** terminals, not one — VSCode's terminal-tab model. The
narrow strip on the right edge lists them and marks the active one; `⌥t` opens
another, `⌥[` / `⌥]` cycle, `⌥w` closes. The strip is also **clickable**: clicking a
terminal row's label makes that terminal active (a `select-<n>` verb naming it by
number — so a click jumps straight to any terminal, parked or not, where `⌥[`/`⌥]`
would have to cycle); each row also carries a right-aligned `[x]` that closes that
one (by number, so a parked terminal can be closed too, not only the shown one),
and a `[+ add]` line below the list opens another — the same
click→verb-on-the-`cmd`-channel path as the footer's diff-mode labels. The last
terminal has no `[x]` (closing it is refused anyway). Every terminal of every agent keeps
running while parked, so all of them resume mid-flight on a return, not just the
one that was on screen. A thin full-width **footer** along the bottom always shows
that key legend, so the gestures are discoverable without memorising them.

The diff has **three modes**, toggled with the same `⌥[` / `⌥]` — but only while the
**diff pane is focused**; focused on a terminal, those keys still cycle terminals.
`uncommitted` (the default) is `HEAD` → working tree, the agent's uncommitted work;
`lastcommit` is `HEAD~1` → `HEAD`, just the most recent commit; `custom` is an
arbitrary branch/SHA → working tree (`revdiff --untracked <ref>`, the same shape as
`uncommitted` against a base you name). Cycling **into** `custom` pops an ASCII
"modal" (drawn in the diff pane by `cockpit-custom-prompt.mjs`) that asks for the
ref every time, **pre-filled** with that agent's last one; a ref git cannot resolve
re-shows the prompt with an error. The mode is **per agent** and **session-only**:
each agent has its own, kept in memory, and a brand-new agent — and every agent
after a cockpit rebuild — starts at the `uncommitted` default. Toggling one agent's
mode never touches another's. Only the custom **ref** is persisted (per agent, to
`~/.claude/cockpit/custom-refs.json`), so re-entering `custom` pre-fills the last
branch/SHA even though the mode itself resets.

Host is **WezTerm** — terminal and multiplexer in one, chosen for its pane-
targeting CLI (`wezterm cli send-text --pane-id N --no-paste`), which is what
makes typing-without-submitting possible.

## Working agreements

- **Work in the main checkout.** Do not create git worktrees unless explicitly
  asked. (`.claude/settings.json` disables background-session auto-isolation so
  this holds for background jobs too.)
- Commit to `main` directly unless a PR is asked for, and **push it**. This is
  a private repo that sets up one person's development environment: there is no
  shared branch to protect, and an unpushed commit is just work waiting to be
  lost with the machine.
- `.claude/worktrees/` is gitignored — agent worktrees live there and must not
  appear in reviews.

## Running it

Once per machine: `bin/install.sh`. It checks the seven tools, records where this
checkout is and which projects root to open in, and points `~/.wezterm.lua` here.
`--start-dir ~/git` for a machine that keeps repos somewhere else; re-runs
remember it. It never replaces a `~/.wezterm.lua` of your own without `--force`.

After that, just open WezTerm. `~/.wezterm.lua` symlinks to `wezterm/cockpit.lua`,
whose `default_prog` builds the layout, starts the daemon, and launches the fleet
view. Re-opening the window is the supported way to rebuild everything.

```
bin/install.sh          per-machine setup: prerequisites, config.lua, the symlink
bin/cockpit-layout.sh   splits panes (incl. the strip), records ids, starts daemon
bin/cockpitd.mjs        follows the fleet view, retargets panes, injects reviews
bin/cockpit-strip.mjs   renders the terminal list (strip) and key legend (footer)
bin/cockpit-welcome.mjs renders the fleet list's top pane: greeting | notes column
bin/cockpit-note.mjs    the `note` command (cockpit terminals only)
bin/cockpit-notes.mjs   the notes store, shared by the command and the renderer
bin/cockpit-custom-prompt.mjs  the ASCII branch/SHA prompt for the "custom" diff mode
bin/cockpit-browse-verbs.hjson broot's Enter verbs: push a text file, preview the rest
bin/cockpit-browse-conf.mjs    builds broot's --conf chain (yours first, ours last)
wezterm/cockpit.lua     window config; default_prog is the layout script
spikes/cockpit-test/    integration test, wezterm stubbed (134 assertions)
spikes/notes-test/      the `note` command and the notes column (39 assertions)
spikes/pty-inject/      PTY harness used to settle how injection behaves
spikes/pane-swap/       headless-mux probes: swapping the full-width diff pane,
                        and why the footer would not stay one line high
docs/requirements.md    what this had to do, and why VSCode and Conductor didn't
docs/cockpit.md         how it works and why; read before changing the daemon
```

Sources for the measured claims: `docs/cockpit.md`, `spikes/pty-inject/RESULTS.md`
(injection, per-agent terminals) and `spikes/pane-swap/RESULTS.md` (the diff slot,
the footer's height).

State lives in `~/.claude/cockpit/`: `config.lua` (from the installer -- the one
file that is *not* regenerated), `panes.json` (now records the `strip` and `foot`
panes too), `fleet.log`, `daemon.log`, `review-<jobId>.md`, `terminals.json` (what
the strip and footer render — carries the visible agent's own `diffMode` and, in
custom mode, its `customRef`), `custom-refs.json` (the
per-agent branch/SHA for custom mode — the *only* persisted diff state; the mode
itself is per-agent and in-memory, so there is no `diff-mode` file any more),
`custom-ref-pending` (the handoff file the
custom prompt writes and the daemon reads), `notes.json` (the notes, keyed by repo
root — never in the repo, where they would land in the agent's own diff) with its
`notes.lock`, `bin/note` (a symlink to `cockpit-note.mjs`, relinked on every
rebuild — the whole of how the command is "inside the cockpit only"), and `cmd`
(the command channel
the terminal keybindings append to — the custom prompt appends `custom-ok`/
`custom-cancel` here too). Debug with `tail -f ~/.claude/cockpit/daemon.log`.

## Things that are true because they were measured

Do not "simplify" these away — each was found by getting it wrong first. Sources
in `docs/cockpit.md`, `spikes/pty-inject/RESULTS.md` and
`spikes/pane-swap/RESULTS.md`.

| | |
|---|---|
| `\r` → `\n` on every injected payload | `\r` is what Enter sends and **submits**; `\n` only inserts a newline. This one substitution is why a review can arrive unsent. |
| The flush→Claude focus jump rides on revdiff's `--post-flush-command`, **never** a WezTerm key | revdiff's flush gesture *is* uppercase `O` (`map O flush_output`). A `{ key = "O", mods = "SHIFT" }` binding therefore stole the key: the diff pane never flushed (no review reached the agent) and no other pane could type an `O` at all. So a *successful* flush runs `--post-flush-command`, which appends `focus-claude` to the `cmd` channel; the daemon then activates `panes.fleet` (the **Claude** pane, where the review was just injected — not `panes.shell`). One `O` both sends and lands you where you edit it, and `O` stays a normal key everywhere else. No focus gate is needed: only revdiff emits the verb, only on a real flush. |
| Never type unless attached to an agent | The fleet **list**'s prompt box dispatches a **new agent**; a review typed there would spawn one. |
| `revdiff --untracked` always | `git diff` omits untracked files and agents create new files constantly — without it, new files are invisible. |
| Diff range is `HEAD`, passed symbolically | `revdiff --untracked HEAD` diffs `HEAD` → working tree, so the review is the agent's **uncommitted** work and a clean tree shows an empty diff — it matches what the agent sees from `git status`. Passing `HEAD` (not a resolved SHA) means a reload re-reads it, so committing work drops it out of the diff instead of pinning it. A merge-base base was tried first (see the old R3) but froze at launch: it kept showing committed work forever, and on an agent sitting on the trunk it degenerated to `HEAD` anyway. |
| Watch the review file's **directory** | revdiff flushes atomically (write temp + rename), so the path gets a new inode each time and a file watch goes deaf after one flush. |
| A **commit** reloads the diff via a second watch on the git **reflog** | The worktree watch never sees a commit: `git commit` touches no working-tree file (disk bytes unchanged), it moves `HEAD` — which lives in `.git/` (that watch ignores it) and, for a *linked* agent worktree, entirely *outside* the worktree in `<main>/.git/worktrees/<name>/`. So `watchHead` watches `logs/HEAD` (the reflog, appended on every commit/reset/checkout). It watches the `logs/` **directory**, not the file: git rewrites the reflog with a lock-file + rename, so the file gets a new inode each time and a file watch goes deaf — the same inode trap as the review-file watch. Without this, committing left `uncommitted` showing already-committed work and `lastcommit` a commit behind. |
| Reviews trigger on mtime+size, not content | `O` is an explicit "send this" gesture, so pressing it twice must inject twice even if nothing changed. |
| `--no-confirm-reload` deliberately **not** passed | So an auto-reload with unflushed annotations prompts instead of silently discarding them. |
| `--no-confirm-discard` **is** passed, and a quit revdiff is reinstated | Opposite call to `--no-confirm-reload`, for the opposite reason: `R` fires *automatically*, so it must prompt; Shift+Q (`discard_quit`) is an *explicit human* "throw all annotations away" gesture, so the confirm is just friction. To stop Q from leaving the diff pane at a bare shell, `healQuitDiff` watches the attached agent's diff pane and relaunches revdiff on the same range the moment it drops to a shell — so Q reads as "clear all annotations and keep reviewing". Cooldown-guarded (`DIFF_RELAUNCH_COOLDOWN_MS`): revdiff looks like a shell for ~1s while it paints, and relaunching in that gap would type the command into a starting revdiff where every key is a binding. |
| Splits name their program explicitly | They would otherwise inherit `default_prog` and re-run the layout script forever. |
| The checkout's path is recorded, not derived | A symlinked `~/.wezterm.lua` makes `wezterm.config_file` report the **symlink**, so the config cannot locate its own repo. It used to guess `~/src/agentic-ide`, which is wrong for any other clone name or projects root. `bin/install.sh` writes both paths to `~/.claude/cockpit/config.lua`; the old guesses remain as fallbacks so an un-installed checkout still runs. |
| Layout failures `exec` a shell, never exit | As `default_prog` it is the window's only pane; exiting closes the window and takes the error message with it. |
| Agent **diffs** are moved too, never restarted | Starting revdiff costs seconds of git and parsing, which used to be paid on every switch — the top of the cockpit went blank and redrew. A parked revdiff comes back with its selected file, scroll position and unflushed annotations, so a return types nothing at all. |
| The diff slot swaps in the **opposite order** to the terminal slot | The diff pane spans the window, so its geometry *is* the slot. Park it first and the only thing left to split is the fleet pane's half-width region — revdiff comes back at 59 of 120 columns. Split the incoming pane *into* the outgoing one and dispose of the outgoing one afterwards; the split collapses and the incoming pane inherits the full slot. |
| Rebuilding an empty diff slot parks the **terminal** first | Same reason. With the fleet pane alone in the tab, `split-pane --top` spans the window; the terminal is then moved back. |
| Parked diffs keep their worktree watcher | Otherwise instant switching would just mean instantly showing a stale diff. The pane reloads in the background and is current when it returns. |
| Never send `R` while the annotation editor is open | revdiff reads every keystroke as comment text, so `R` lands *in* the comment (`comment on A` → `comment on AR`). Detected by its footer, `[enter] save`. On a visible pane you would see it; in a parked one you would not. |
| "Is a pane running X" takes **three** signals, and the pane TITLE is the weakest | The title is not a name for what a pane runs — it is whatever last wrote it. On a headless mux nothing does, so WezTerm falls back to the process name and the title reads `revdiff`; on a real machine the **shell** writes it from a `preexec` hook, as the command's **first word**. Measured 2026-09-02: a pane running revdiff titled `cd` (launched `cd <wt> && revdiff …`), an idle shell titled its cwd. Even where the fallback does apply the title lags the launch by ~1s, longer after a move, and believing a stale `bash` retypes the whole command into a live revdiff where every character is a keybinding. So the **framed screen** is counted (19 lines starting with `│`, 0 at a prompt) and, when neither of those answers, the tty's **foreground process GROUP** (`ps -t`) — a pane is running the program if **any** member of that group is it, never merely the last one. Any one of the three signals is enough. revdiff survives on its frame alone; broot and micro draw none, so for them the title was the whole decision and it was wrong for the entire life of browse mode — the healer retyped broot's launch command into broot's filter box every 3s. Reading only the **last** member of the group left that same symptom behind, intermittently, on every Enter: broot spawns its Enter verb's `cockpit-open` **in its own process group** rather than a new one, so mid-push the pane answers `broot`, `/bin/sh` and `ps`, all three foreground (measured under `script(1)`, 2026-09-04) — and last-wins read a live broot as a quit shell. `terminalIsIdle` makes the same `ps` call and still reads the **last**, deliberately: a terminal's job takes a *new* process group and the shell drops out of the foreground, so there the question really is which single one is in front. |
| Agent terminals are **moved**, never respawned | `move-pane-to-new-tab` parks the outgoing pane and `split-pane --move-pane-id` brings the incoming one back. WezTerm never tears the PTY down, so a `sleep 60` left running has ~30s left when you return 30s later. Measured: a 1/s counter accrued 21 ticks while its pane sat parked. |
| The terminal slot swaps like the diff slot, **not** by splitting the fleet pane | Once the strip sits on the terminal's right edge, `split-pane --pane-id <fleet>` no longer lands full-width in the slot. The incoming terminal is split **into the outgoing one** and the outgoing is parked afterwards, so it inherits the exact slot regardless of the fleet/strip neighbours. Measured against a headless mux: active terminal returns at 47 cols, strip at 12, fleet at 59. |
| The strip is **never parked** | It is a pure display pane (`cockpit-strip.mjs` renders `terminals.json`); it stays on the right edge for every agent. A diff-slot rebuild is the one exception — it parks the terminal *and* the strip so the full-width split can come off the fleet pane alone, then moves both back. |
| Terminal gestures go through the **daemon**, never a raw split | `⌥t`/`⌥[`/`⌥]`/`⌥w` append a verb to `~/.claude/cockpit/cmd`; the daemon owns every pane swap. A direct `SplitPane` keybinding (what `⌥t` used to be) makes an untracked pane the daemon then shuffles around it. |
| Closing the **last** terminal is refused | The slot must always hold a terminal; `⌥w` on a lone terminal is a no-op, logged. |
| The key legend is a **footer pane**, not a status bar | WezTerm's status bar lives in the tab bar, which is off (parked terminals live in tabs). So the legend is a thin full-width pane split off the bottom *first*, while the fleet pane still fills the window — every later split happens above it and leaves it untouched. Pure display; the daemon never manages it. |
| The footer is split with `--cells 1`, and **pins itself back** to one row | WezTerm has no fixed-size pane: `--percent` asks for a *share* of the window, re-applied on every resize and font-size change, so the one-line legend crept taller until it ate rows of the fleet view. The pane swaps were ruled out first — diff swap, terminal swap and a full slot rebuild all leave its height alone. `--cells 1` starts it right; `cockpit-strip.mjs` puts it back when it drifts. |
| Shrinking the footer means **borrowing focus**, because `adjust-pane-size --pane-id` is ignored | wezterm 20240203 resizes whatever pane is *active*. Aimed at the footer from elsewhere it squashed the **bottom row** — fleet, terminal, strip — to one line instead. So the footer focuses itself, shrinks, and hands focus straight back to the pane that had it. Over-shrinking is clamped, and only its own boundary moves, so the daemon still owns every pane swap. |
| Each drift height is corrected **once** | Focus is borrowed for ~100ms per attempt. A drift that cannot be fixed (no `wezterm` on PATH, a pane at its minimum) must not steal focus again on every 2s tick — only a *new* height is worth another go. Debounced 250ms so a window drag is corrected once, at the size it settles at. |
| The tab bar is **off** (`enable_tab_bar = false`) | Parked terminals live in tabs of the cockpit window. Clicking one would fill the window with a bare shell and look exactly like the cockpit had vanished. |
| Parking re-activates the cockpit tab | In the GUI the newly created tab becomes the active one, which would swap the whole cockpit off screen. |
| Reaping a terminal needs **two** consecutive misses | One failed `claude agents` read must not be enough to kill a shell with someone's build running in it. |
| `⌥[` / `⌥]` route by **which pane is focused** | The keys append `next`/`prev` to `cmd` unconditionally; the daemon reads the cockpit tab's active pane (`is_active`) and sends them to the diff-mode switch when the **diff** pane holds focus, to the terminal cycler otherwise. `⌥t`/`⌥w` are always terminals. |
| Switching diff mode **restarts** revdiff (`q` then relaunch) | `R` only reloads the *same* range, so changing the range means quitting revdiff back to its shell and relaunching with the new args. Never while the annotation editor is open — `q` and the whole command would land in the comment (same rule as auto-reload). |
| The diff mode is **per agent**, in-memory, defaulting to `uncommitted` | `diffModeByAgent` (jobId → mode) holds each agent's own choice; absent means the default, so a brand-new agent — and every agent after a cockpit rebuild — opens in `uncommitted` and is never carried into whatever mode another agent was left in. There is no global `diff-mode` file. Only the custom **ref** persists (`custom-refs.json`), so re-entering `custom` pre-fills the last branch/SHA even though the mode resets. |
| A parked diff is relaunched on return **only if its own mode/ref/worktree changed** | `diffLaunchedMode`/`diffLaunchedRef`/`diffLaunchedCwd` record what a parked pane was launched with. The mode/ref are per-agent and can only change while the agent is *attached*, so on those alone a parked pane essentially always comes back untouched — the whole point of parking. But the **worktree can move while parked** (the agent keeps working and may enter a worktree it just created), and `followWorktreeMigration` only follows the *attached* agent — so the `diffLaunchedCwd` comparison is what catches a parked agent that moved, relaunching its revdiff (and re-pointing its worktree/reflog watch, which `watchWorktree` otherwise leaves on the old dir since it no-ops when a watch already exists) in the new worktree the moment you return. |
| The custom prompt is a **script in the diff pane**, handing back through `cmd` | There is no channel for free-form user text: `cmd` carries only fixed verbs and the daemon otherwise only ever *writes* into panes. So `custom` mode quits revdiff and types `cockpit-custom-prompt.mjs` into the same pane; the prompt reads the ref off its own TTY, validates it with `git rev-parse` against the agent's worktree, then appends `custom-ok`/`custom-cancel` to `cmd` for the daemon to relaunch revdiff. |
| While the prompt is open, `healQuitDiff` is **suppressed** and `⌥[`/`⌥]` are swallowed | The prompt is a plain node process, so `diffPaneStatus` reads it as a bare `shell` — indistinguishable from a quit revdiff. Without the `customPromptOpen` guard the 1s healer (and any further mode-cycle keypress) would type revdiff *over* the live prompt, where every character is an editor keystroke. The prompt owns the pane until it resolves; Enter confirms, Esc cancels back to the previous mode. |
| Cycling **into** custom always re-prompts; switching **agents** does not | Answer to "ask me each time": the prompt fires on the `⌥[`/`⌥]` transition *into* `custom`, pre-filled with the agent's stored ref. Attaching to a different agent while already in `custom` is not "entering the mode" — it reuses that agent's stored ref silently, and only prompts if the agent has none yet (it cannot diff against nothing). |
| The notes column is **drawn**, not a second pane | The diff slot swaps by parking *exactly one* pane and splitting the incoming one into it. A real notes pane up there would make every agent switch a two-pane dance — for a list nothing ever types into. `cockpit-welcome.mjs` draws both halves in the one pane it already owns, so attaching still parks one pane and revdiff still returns at full width: **the agent view is unchanged**. |
| `note` is published by a **symlink in a directory only cockpit shells have on PATH** | "Available inside the cockpit but not outside" needs no wrapper, no shell function and no edit to your `~/.zshrc`: `~/.claude/cockpit/bin/note` points at `cockpit-note.mjs`, and only shells the cockpit spawns get that directory. Outside a cockpit window `note` is simply not a command. Relinked on every rebuild, so a moved checkout repairs itself. |
| Terminals are spawned through `/usr/bin/env`, because a split **inherits nothing** | `wezterm cli split-pane` spawns from the **mux server**, whose environment dates from whenever WezTerm started — not from the layout script or the daemon. So nothing either of them exports reaches a new pane; `PATH` and `COCKPIT_REPO` are named on the command line instead. `env` *execs* the shell rather than wrapping it, so `ps` still reports `zsh` and the idle-terminal check is untouched. |
| `COCKPIT_REPO` travels with every terminal | An agent terminal sits in a **worktree**, where `git rev-parse --show-toplevel` answers with the worktree path — which would file that agent's notes under a second, phantom repo. The env var is the only thing that knows the cockpit's actual root from inside a worktree. |
| Notes live in `~/.claude/cockpit`, **never in the repo** | A checked-in notes file appears in `revdiff --untracked HEAD` — the very diff the agent is being reviewed on — so every note you wrote would become a change the agent thinks it has to explain. |
| The note id is **minted at creation**, not hashed from the text | The id is the handle you retype off the screen (`note rm a3f9`). A content hash would change on every edit, so the hash you just read would be stale the moment you used it. Any unique **prefix** resolves, and an ambiguous one is refused rather than guessed. |
| Every note write takes a **lock** | The agents share the file with you. Two `note add`s landing together would otherwise both read the same list and the second would write the first away. Stale locks are broken at 5s so a process killed mid-write cannot wedge it forever. |
| An agent's note carries the agent's **name**, from `CLAUDECODE` + `terminals.json` | Being handed a note must not read like something you wrote. `CLAUDECODE` is the only reliable "an agent is running this" marker — `CLAUDE_CODE_AGENT` holds the agent *type* (`claude`), not the name in the fleet list, which comes from `terminals.json` instead. |
| The column says how much it is **hiding** | It is a summary in half a pane; stopping silently at the fold would read as "that is all of them". An overrun ends in `… +N more · note ls`. |
| A terminal is `cd`'d forward when its agent **changed directory**, but only if **idle and untouched** | An agent's `cwd` migrates — it can start in the checkout and later create and enter a worktree — but a terminal is spawned once and thereafter only moved between tabs, never re-`cd`'d, so it freezes at the old directory (revdiff is re-pointed too — see the next row). `termSpawnCwd` records where each shell was put; on return, if the agent has moved and the shell is still sitting at its spawn cwd (untouched — checked against WezTerm's reported `cwd`) **and** idle (foreground process is the login shell, via `ps -t`), a `cd` is typed in. A shell the user navigated or one with a job running is left alone — a stray `cd` mid-command is worse than a stale prompt. |
| revdiff follows the agent's worktree even **mid-attach**, not only across switches | `reconcile()` short-circuits on a matching fleet-header name, so a `cwd` migration under a *continuously* attached agent (it creates and enters a worktree without any detach) was never noticed: `attached.worktree` is captured once at `onEnter`, and revdiff, its worktree/reflog watches and the terminal all stayed pinned to the launch dir. Shift+R could not fix it — revdiff's reload re-runs the **same range in the same directory**. So on the same-name poll branch, `followWorktreeMigration` re-reads the agent's live `cwd` (`claude agents --json` reports it, measured), and on a change relaunches revdiff (`cd` + revdiff, not `R`), re-points the worktree/reflog watches, and re-syncs the terminal. Throttled (each check spawns `claude`) and cooldown-guarded against a still-painting revdiff / open annotation editor, exactly like `healQuitDiff`; runs under the reconcile lock so it never races a pane swap. |
| The left button belongs to **claude, whole** — bind no part of it | claude does its own text selection: it turns on full mouse reporting (measured: `?1000h ?1002h ?1003h ?1006h`), draws its own highlight, and on release copies with **OSC 52**, announcing "copied N chars to clipboard". Driven with synthetic press/motion/release on a pty it does exactly that, and WezTerm honours the write (probed: BEL-terminated `ESC ] 52 ; c ; <base64>` lands in the pasteboard). Two attempts at helping made it worse. Binding Down+Drag+Up under `mouse_reporting = true` gave WezTerm the selection and left claude blind — nothing in the pane was clickable. Binding only Drag+Up, meant to leave claude the press, broke it twice over: claude dispatches a *click* on the **release** (`onClickAt`), not the press, so swallowing the release swallowed every click; and because the release never reached `pane.mouse_event`, wezterm-term's `current_mouse_buttons` still held Left, so `mouse_report_button_number` kept encoding every later mouse *move* as a held-button drag — claude never saw the hover that ends a drag (`py()`: motion with no button), so its selection followed the pointer forever and the next click started another. The gesture is **indivisible**: press, motion, release and the button-up bookkeeping are one transaction, and WezTerm can take all of it or none. It takes none. Shift still bypasses reporting entirely for a plain terminal selection (`bypass_mouse_reporting_modifiers`, at its SHIFT default) — the way to copy what claude's own selection cannot reach. |
| Both `swallow_mouse_click_on_*_focus` are **off** | A drag whose press was eaten is the one way claude's copy fails silently: with no `onSelectionStart` there is no anchor, so the release finds nothing to copy even though a highlight appeared. macOS WezTerm eats exactly that press by default on the click that focuses the window. |

## How agent switching is detected

The fleet pane renders the attached agent's name in its own header
(`──── some agent name ─`), and the cockpit owns that pane, so
`wezterm cli get-text` reads it and `claude agents --json` maps the name to a job
id and live worktree. That poll is the **source of truth**; the undocumented
`[FV-attach]` line in `--debug-file` is only a latency hint.

`~/.claude/daemon/attach-journal/` is **not** usable for this — it records a
gestureId, pid and timings but no job id, cwd or name, so it can say *that*
something was attached, never *which*.

## Known limits

- Agent names must be unique to resolve from the pane header; ambiguity is logged
  and the panes are left alone rather than pointed at a guess.
- Agent panes live and die with the cockpit **window**. Closing it kills every
  agent terminal and every agent's revdiff; nothing survives a rebuild.
  (Deliberate — the alternative is a detached-session multiplexer between you and
  every shell.)
- A parked pane is resized to the full tab and back, so it takes two SIGWINCHes
  per switch. Line-oriented output does not care; revdiff reflows and redraws —
  nothing is lost, but the redraw is visible.
- Unflushed annotations are invisible to the daemon, so auto-reload's "have you
  started commenting?" check is based on the flushed file.
- One agent at a time, by design.


---

<!-- ─────────────────────────────────────────────────────────────────────────
     Appended by plan-implement-review. Everything above this line is the
     project's own CLAUDE.md; everything below is the shared working method.
     ───────────────────────────────────────────────────────────────────────── -->

# How we work together

Work on this project is planned once and then executed one task at a time, by sessions that
alternate between building and reviewing. Two commands drive it:

| Command | What it does |
|---|---|
| `/pir-plan` | Brainstorm, settle the requirements, get the tech right, split the work into tasks, and write it all down under `plans/{slug}/` |
| `/pir-work {slug}` | Do exactly one unit of work on that plan — implement the next task, or review the last one — then stop |

**Read `plans/{slug}/DESIGN.md` before changing behaviour.** Every rule in it was decided
deliberately and most carry a rationale. If you disagree with one, say so — do not quietly
implement something else.

---

## Who you are talking to

I am the product manager. I own **what** gets built and **why**. I do not read the code and
I do not want to — that part is yours.

### Write to me in plain English

No jargon in anything you say to me. When something technical actually matters to a
decision, explain it in ordinary words: keep the reasoning, drop the vocabulary. The test
is whether a sentence would make sense to someone who has never opened this project.

"The app writes each line to the log in one go, so two copies running at once can't garble
each other's" — good. "`O_APPEND` plus a single `write(2)` gives atomicity" — same fact,
useless to me.

If I need a term to make the decision, teach me the term in one line and then use it.

**This applies to what you say, not to what you write down.** Code, comments, commit
messages and everything under `plans/` stay exactly as technical as they are — those are
written for the next session, and dumbing them down would cost the project real accuracy.
The conversation is mine; the files are yours.

### Who decides what

**You decide how.** Technical problems are yours to solve as you meet them — a bug, a bad
structure, a test that needs writing, a better way to build the thing we agreed on. Do not
ask permission to do your job well. Tell me afterwards, in one plain line, that you found
it and fixed it.

**I decide what.** The plan is mine. Come to me *before* you act when:

- the plan itself needs to change — a task split, reordered, dropped or added
- a design rule in `DESIGN.md` is wrong, or is about to be contradicted
- something is **not specified, or half-specified** — especially anything a user of this
  thing would see, hear or do
- there is a genuine choice about how it should behave, and either answer is defensible

Never invent a rule to get unblocked, and never quietly pick whichever is easier to build.
An underspecified requirement is not a gap for you to fill in silently — it is the exact
thing I am here for.

### How to ask me

One decision at a time, laid out like this:

- what you are trying to do, in a sentence
- the options, in plain words, with what each one costs
- **your recommendation**, because you know the machine and I do not
- what you will do if I say nothing

Do everything that does not depend on my answer while you wait. Only stop dead when
guessing wrong would waste the work or be unsafe.

### I am your hands on the real machine

Anything that needs a screen, a camera, a second account, a login, a reboot, a real device,
a paid API or a browser I will run for you — that is not a gap in the project, it is my job
in it. Give me the exact command and tell me what to look for. The full rule and the
handover format are in [Anything the tests cannot establish](#anything-the-tests-cannot-establish-is-verified-with-me-not-asserted)
below; it binds every session and this section does not soften it.

**Stop and wait for me.** The moment the work needs my eyes, ask — and then hold there
until I answer. Do not finish the session around it, do not build anything further on top
of an assumption I have not confirmed, and do not leave the check as homework in the final
report. Everything that genuinely does not depend on my answer can be finished first, but
the session ends when the answer is in, not before.

The cost of this is real and I accept it: a session may sit paused while I am away, and
you may need me to start it going again. That is cheaper than a task built on a guess.

---

## The `pir-work` command

**When I say `pir-work`, invoke the `pir-work` skill.** It reads
`plans/{slug}/PROGRESS.md`, picks the one task the queue says is next, and dispatches to
`pir-implement` or `pir-review`:

```
read plans/{slug}/PROGRESS.md
  ├─ any task marked 🔍 ?  → REVIEW the lowest-numbered one
  ├─ else any task 🟡 ?    → FINISH it
  └─ else                  → IMPLEMENT the next ⬜ whose dependencies are ✅
```

Then update `PROGRESS.md`, commit, report, **and stop.** One unit of work per `pir-work`.

That is the whole point: the session that reviews a task is never the session that wrote
it. A reviewer holding the implementation in context is not a reviewer, and the alternation
is what buys the fresh eyes.

The skills live in `.claude/skills/` and hold the procedures — the dispatch and the
blocked-task rule in `pir-work`, the step-by-step in `pir-implement` and `pir-review`.
**Do not invoke `pir-implement` or `pir-review` directly**: `pir-work` chooses the task,
and that choice is what guarantees the alternation. If you want a specific task built or
reviewed out of order, say so to me first.

The rest of this file holds the rules that bind **every** session — the ones that arrived
through `pir-work` and the ones that did not.

### Scope is strict

Touch only the task you picked up. Anything else you notice — a missing test in an earlier
task, a stale doc, a better way to do something — goes in the **findings log**,
`plans/{slug}/FINDINGS.md`, and is left alone.

This keeps commits matched to tasks, keeps the review boundary meaningful, and stops a
session sprawling into a rewrite. The findings log exists for exactly this.

### Anything the tests cannot establish is verified with me, not asserted

**The project's test command is the only evidence a session may produce on its own.** It is
named in `DESIGN.md § Environment`, along with the table of what that command cannot reach.
If a claim can only be established by taking the screen, logging in as somebody else,
rebooting, pointing a camera at something, calling a paid service or watching a real user,
then this session cannot establish it — and must not write it down as though it had. Say
what you built, say what it has not been shown to do, and hand me the exact command.

**How to hand it over.** Raise it the moment you need it and **wait for the answer** — see
[I am your hands on the real machine](#i-am-your-hands-on-the-real-machine); it is not
homework left at the end of a report. One block: the exact command including its flags,
what should happen, what to look at, and what to tell you back.

```
Needs you — I cannot see this from here:

  <the exact command, with its seatbelt>

Expect: <what should happen>
Tell me: <the one or two things only a person can answer>
```

**Always with a seatbelt, if the plan defines one.** Anything that can take the machine, the
screen, the account or the money gets a bound on it — a time limit, a dry-run flag, a
spending cap, a scratch account — and you never ask me to run the unbounded version to find
something out. `DESIGN.md § Environment` names this project's seatbelts. **And do not run
the dangerous thing yourself to save me the trouble**: the seatbelt is what stands between a
test and a power cycle.

**Mark it unverified, in `PROGRESS.md` and in the report.** A task whose automated half is
green and whose hands-on half is unchecked is not ✅ on the strength of the tests — say
which half is which, so the next session and I both know what has actually been seen. When
you get an answer back, it goes in **`FINDINGS.md`** with the date: "verified by hand" is
worth as much as any test, and only if it is written down.

Because a session waits for me, a task should rarely *end* with that half unchecked. It
stays a live state for the minutes between asking and hearing back — not a way to close a
session with the question still open.

### Commit messages

```
T05: policy decision function          ← implementation
T05 review: fix warning threshold      ← a fix found while reviewing
T05 review: clean                      ← review found nothing; the PROGRESS update is the commit
```

### Where sessions run

**Work in the main checkout, on the main branch. Always.** One checkout, one branch, commits
straight onto it — no worktrees, no branch per task, and so nothing to merge, ever. The
review boundary here is the *session*, not the branch: `pir-work` already guarantees that
whoever reviews a task did not write it, and a branch per task buys nothing on top of that
while costing a merge every time.

**If you nevertheless find yourself on a branch or in a worktree, stop and say so.** Folding
it back is a decision about history and it is mine to make — never reach for a merge, a
rebase or a reset on your own initiative.

---

## The files

Each plan is a folder under `plans/`. `ls plans/` lists them.

1. **`plans/{slug}/PROGRESS.md`** — task states and the queue. Always current.
   **Sixty words to a Notes cell**: it is the index, and the account is the commit message.
2. **`plans/{slug}/FINDINGS.md`** — what the build taught, newest first, about forty words a
   row. **Where "verified by hand with the user" is written down**, and therefore the only
   record that anything was ever seen working for real.
3. **`plans/{slug}/PLAN.md`** — the task list, its phases and dependencies. Written once,
   at plan time; changed only by a decision of mine.
4. **`plans/{slug}/tasks/`** — one file per task: goal, files, interface, acceptance criteria.
5. **`plans/{slug}/DESIGN.md`** — why everything is the way it is, plus the environment and
   the verification contract.

`PROGRESS.md` is the handoff and `FINDINGS.md` is the memory. A stale one of either costs
the next session more than it saved this one.

**Both are read at the start of every session, so both are kept short on purpose.** The word
limits above are what stop them growing into a history of the project: when a note wants a
paragraph, the paragraph goes in the commit message. In the project this method came from
they were one file, and it reached 175 000 characters — three quarters of it history about
tasks long closed, re-read in full by every session before it could start.

---

## Rules on coding

### Comments explain *why*

The code says what it does. Comments are for the reason, and especially for the non-obvious
constraint — the API that returns success on a bad argument, the option that only holds
while the window is frontmost, the call that must not happen on the main thread. Dense where
something is surprising, absent where it is not.

### Small commits, one per task

Commit message references the task: `T04: budget ledger and gap classification`.

### Never reach for a clock, a random number or the network from the core

Whatever this project's tested core is, it takes its inputs as parameters and returns
decisions. The current time arrives as an argument, never from the system. That single rule
is what makes a day of behaviour testable in milliseconds. `DESIGN.md § Architecture` names
where the boundary runs here and how it is enforced.

