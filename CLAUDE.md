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
│                      │ ───────────────────────── │
│                      │ TODAY · Wed 26 Aug  14:20 │
│                      │ ▌ ALL DAY Kasia off  home │
│                      │ ▌ NOW     standup    work │
│                      │   └ until 14:30           │
│                      │ … +2 more · agenda        │
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

Below the notes, behind a rule, is **today's calendar**, from **`agenda`** — the
same cockpit-only publication as `note`. `agenda add work` signs in to a Google
account and attaches **one** of its calendars, picked from a list: a work schedule
usually lives on a shared team calendar, not on `primary`. Sign-in is per
*account*, calendars are per *slug*, so a second calendar from an account already
signed in opens no browser. Only what is **left** of the day is shown, the event
happening now pinned at the top as `NOW` with `└ until HH:MM`; when today empties
the column rolls on to tomorrow, which is why the fetch window is two days wide.
The **daemon** fetches every minute and on return to the fleet list, writing
`agenda-cache.json`; the pane only draws, so `cockpit-welcome.mjs` stays pure
display and `cockpitd` can keep owning it as a diff slot. A failed fetch keeps the
last events and adds one dim `last updated 22m ago · offline`; a revoked sign-in
replaces that one calendar's rows with `home  sign-in expired · agenda add home`
and leaves the others alone.

The fleet list's **names** are written for you too. Left alone, `claude agents`
labels a session with a one-line summary Claude writes from your first message
("read handoff document") — fine on its own, poor in a list of six, because
nothing says which repo it belongs to and two agents in different projects can
read identically. `cockpit-auto-name.mjs` supplies the missing half: every session
in a git repo becomes **`<repo folder> / <topic>`**, and the topic is the strongest
signal available at the moment the session is first named — a name **you** typed, else
a `/pir-work` slug, else the worktree it sits in, else a **one-to-three-word label
Claude Haiku 4.5 infers from the first message** (`implement the OAuth loopback flow`
→ `oauth-loopback`), else the opening words of the prompt as a placeholder. To get that
Haiku label the hook holds the first prompt for up to ~2s, calls the model and releases
with the topic already set; a greeting or content-free message returns no label and just
keeps the placeholder. The label is **set once and then frozen**: the first real name
(slug, worktree, Haiku topic, or Claude's own summary when there is no key) locks it, and
after that only *you* rename it (`/rename` or the fleet list). The old "follows the work"
rule — re-naming a session when it later ran `/pir-work` or entered a worktree — is
**retired for the label**, because a good Haiku label makes that just the machine
shuffling your labels around; only a placeholder still climbs to a real name on a later
prompt. (The daemon's pane migration still follows the work — that is a different concern.)

The Haiku call, and any use of the key, is confined to **cockpit sessions** — the hook is
registered globally in `~/.claude/settings.json` by `bin/install.sh` (an agent dispatched
from the fleet view is an ordinary claude session, so naming it needs the global hook), but
it only calls the model when `COCKPIT_REPO` is present in its environment. The key comes
from **`config anthropic-api-key`** (below); with no key, or in a non-cockpit terminal, the
naming degrades silently to today's summary behaviour — no hold, no spend, no error.

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
one that was on screen. **The fleet list has its own terminals too**, on the same
strip with the same gestures — a new one opens at the cockpit checkout rather than
an agent's worktree, and they park and come back on a switch exactly like an
agent's. A thin full-width **footer** along the bottom always shows
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

Once per machine: `bin/install.sh`. It checks the five tools, records where this
checkout is and which projects root to open in, points `~/.wezterm.lua` here, and
registers the session-naming hook in `~/.claude/settings.json`.
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
bin/cockpit-auto-name.mjs  names every session "<repo> / <topic>"; registers itself; the Haiku call
bin/cockpit-config.mjs  the `config` command and the API-key store (cockpit terminals only)
bin/cockpit-note.mjs    the `note` command (cockpit terminals only)
bin/cockpit-notes.mjs   the notes store, shared by the command and the renderer
bin/cockpit-agenda.mjs  the `agenda` command (cockpit terminals only)
bin/cockpit-agenda-store.mjs   the agenda's three state files, its lock, atomic writes
bin/cockpit-agenda-model.mjs   pure: normalise Google's events, decide what shows, draw it
bin/cockpit-agenda-google.mjs  OAuth loopback+PKCE, token refresh, the events REST call
bin/cockpit-custom-prompt.mjs  the ASCII branch/SHA prompt for the "custom" diff mode
wezterm/cockpit.lua     window config; default_prog is the layout script
spikes/cockpit-test/    integration test, wezterm stubbed (174 assertions)
spikes/notes-test/      the `note` command and the right column, notes + agenda (90)
spikes/agenda-test/     the agenda's store, model, Google client and command (637)
spikes/auto-name-test/  session naming and its settings.json merge (50 assertions)
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
`notes.lock`, `agenda-client.json` (the Google registration you create once — kept
apart from the state so `agenda rm` or a corrupt file cannot cost you the console
setup), `agenda.json` (the sign-ins and the attached calendars — a corrupt one is
**moved aside** to `agenda.json.corrupt-<ts>` rather than discarded, because
throwing a refresh token away costs two browser round trips) and
`agenda-cache.json` (the fetched events, written by the daemon and watched by the
pane), `auto-names/` (one small file per session — what the naming hook last called
it, whether it has **frozen** on a real name, and whether it has stood down because you
renamed it by hand; a file each rather
than one shared JSON so concurrent agents need no lock, pruned at 30 days),
`anthropic-api-key` (the key `config anthropic-api-key` writes — plain text, `0600`, atomic
temp-then-rename; an absent file simply means the Haiku naming is off, and it is read
directly by the hook, never exported as a variable), all three agenda files `0600` — the cache included, it holds your meeting titles — under
one shared `agenda.lock`, `bin/note`, `bin/agenda` and `bin/config` (symlinks to
`cockpit-note.mjs`, `cockpit-agenda.mjs` and `cockpit-config.mjs`, relinked on every
rebuild — the whole of how the commands are "inside the cockpit only"), and `cmd`
(the command channel
the terminal keybindings append to — the custom prompt appends `custom-ok`/
`custom-cancel` here too). Debug with `tail -f ~/.claude/cockpit/daemon.log`.

## Things that are true because they were measured

Do not "simplify" these away — each was found by getting it wrong first.

**Thirty rows, and it is not a history.** A line earns its place only while a
session that does not know it would re-break something expensive; adding one
means retiring one. The workings, the dates and every row that was once here live
in `docs/cockpit.md`, `spikes/pty-inject/RESULTS.md`, `spikes/pane-swap/RESULTS.md`,
the plans' `FINDINGS.md`, and a comment at the code itself. Those are the record;
this is the index.

| | |
|---|---|
| `\r` → `\n` on every injected payload | `\r` is what Enter sends and **submits**; `\n` only inserts a newline. This one substitution is why a review can arrive unsent. |
| Never type unless attached to an agent | The fleet **list**'s prompt box dispatches a **new agent**; a review typed there would spawn one. |
| Bind none of revdiff's keys — the flush→Claude jump rides on `--post-flush-command` | revdiff's flush gesture *is* uppercase `O` (`map O flush_output`), so a `{ key = "O", mods = "SHIFT" }` binding stole it: the diff pane never flushed and no pane could type an `O` at all. A *successful* flush instead appends `focus-claude` to the `cmd` channel and the daemon activates `panes.fleet` (the **Claude** pane, where the review was injected — not `panes.shell`). One `O` both sends and lands you where you edit it. Only revdiff emits the verb, only on a real flush, so no focus gate is needed. |
| `revdiff --untracked` always, and the range is `HEAD` passed **symbolically** | `git diff` omits untracked files and agents create them constantly. `HEAD` → working tree is the agent's **uncommitted** work, matching what it sees from `git status`; passing `HEAD` rather than a resolved SHA means a reload re-reads it, so committing drops work *out* of the diff instead of pinning it. A merge-base base was tried and froze at launch, showing committed work for ever. |
| Watch the **directory**, never the file — the review file and the git reflog alike | revdiff flushes atomically (write temp + rename) and git rewrites `logs/HEAD` with a lock-file + rename, so both get a new inode every time and a file watch goes deaf after one event. That reflog watch is also the only way a **commit** reloads the diff: `git commit` touches no working-tree file, it moves `HEAD` — which for a linked agent worktree lives outside the worktree entirely. Reviews trigger on mtime+size, never content: `O` is an explicit "send this", so pressing it twice must inject twice. |
| `--no-confirm-reload` **not** passed, `--no-confirm-discard` **is** | Opposite calls for opposite reasons: `R` fires *automatically*, so it must prompt rather than silently discard unflushed annotations; Shift+Q is an *explicit human* "throw them away", so the confirm is friction. `healQuitDiff` relaunches revdiff the moment the pane drops to a shell, making Q read as "clear all annotations and keep reviewing" — cooldown-guarded, because revdiff looks like a shell for ~1s while it paints and a relaunch in that gap types into a starting revdiff where every key is a binding. |
| Never send `R`, `q` or a relaunch while the annotation editor is open | revdiff reads every keystroke as comment text (`comment on A` → `comment on AR`), and switching diff mode **restarts** revdiff (`q` then relaunch — `R` only reloads the *same* range), so the whole command would land in the comment. Detected by the editor's footer, `[enter] save`. On a visible pane you would see it; in a parked one you would not. |
| "Is revdiff running" takes **two** signals | The pane title becomes `revdiff` but lags the launch by ~1s, longer after a move. Believing a stale `bash` retypes the whole command into a live revdiff, where every character is a keybinding. So the framed screen (19 lines starting with `│`, 0 at a prompt) is counted too; either signal is enough. |
| The layout script names every split's program, and `exec`s a shell rather than exiting | A split that names no program inherits `default_prog` and re-runs the layout script for ever. And as `default_prog` the script is the window's only pane, so exiting on a failure closes the window and takes the error message with it. |
| Panes are **moved**, never restarted — diffs and terminals alike | Starting revdiff costs seconds of git and parsing, once paid on every switch. `move-pane-to-new-tab` parks the outgoing pane and `split-pane --move-pane-id` brings the incoming one back, so WezTerm never tears the PTY down: a parked revdiff returns with its selected file, scroll position and unflushed annotations, and a `sleep 60` left running has ~30s left when you return 30s later (measured: a 1/s counter accrued 21 ticks while parked). Parked diffs keep their worktree watcher, or instant switching would just mean instantly showing something stale. Those parked panes live in **tabs** of the cockpit window, which is why the tab bar is off (`enable_tab_bar = false`) — clicking one would fill the window with a bare shell and look exactly like the cockpit had vanished — and why parking re-activates the cockpit tab, since in the GUI the newly created tab becomes the active one. |
| Both slots swap by splitting the **incoming** pane into the outgoing one | The diff pane spans the window, so its geometry *is* the slot: park it first and the only thing left to split is the fleet pane's half-width region — revdiff comes back at 59 of 120 columns. Splitting *into* the outgoing pane and disposing of it afterwards makes the incoming one inherit the slot. Same for the terminal, once the strip sits on its right edge (measured: terminal 47 cols, strip 12, fleet 59). Rebuilding an **empty** diff slot is the exception: park the terminal *and* the strip so `split-pane --top` comes off the fleet pane alone, then move both back. The strip is otherwise **never parked** — it is pure display and stays on the right edge for every agent. |
| Terminal gestures go through the **daemon**, never a raw split, and are **not** agents-only | `⌥t`/`⌥[`/`⌥]`/`⌥w` append a verb to `~/.claude/cockpit/cmd` and the daemon owns every pane swap; a direct `SplitPane` binding (what `⌥t` used to be) makes an untracked pane it then shuffles around. `terminalCommand` used to return early with no agent attached, on the assumption the fleet list held one repo shell — but `terminals` is keyed for the list exactly as for an agent, and the strip drew `[+ add]` and `[x]` off it anyway, so every one of those buttons visibly did nothing. A new list terminal opens at `panes.repo` (the cockpit checkout), never at some agent's worktree. Closing the **last** terminal is refused: the slot must always hold one. |
| `⌥[`/`⌥]` route by **focus**, but unattached they always mean terminals | The keys append `next`/`prev` to `cmd` unconditionally; the daemon reads the cockpit tab's active pane and sends them to the diff-mode switch when the **diff** pane holds focus **and an agent is attached**, to the terminal cycler otherwise. At the fleet list that pane is the welcome/notes display, not a revdiff — there is no mode to cycle, so focus sitting there used to swallow the keys into a no-op and terminals could be opened up there but not switched between. `⌥t`/`⌥w` are always terminals. |
| The key legend is a **footer pane** at `--cells 1` that pins itself back by borrowing focus | WezTerm's status bar lives in the tab bar, which is off, so the legend is a thin full-width pane split off the bottom *first*, while the fleet pane still fills the window — every later split happens above it. `--percent` asks for a *share* of the window, re-applied on every resize and font-size change, so the one-line legend crept taller until it ate rows of the fleet view. And `adjust-pane-size --pane-id` is ignored by wezterm 20240203 — it resizes whatever pane is *active*, squashing the bottom row instead — so the footer focuses itself, shrinks, and hands focus straight back. Each drift height is corrected **once** (focus is borrowed ~100ms per attempt; a fix that cannot work must not steal it every tick), debounced 250ms so a window drag is corrected at the size it settles at. |
| A parked diff is relaunched on return **only if its own mode/ref/worktree changed** | `diffLaunchedMode`/`diffLaunchedRef`/`diffLaunchedCwd` record what a parked pane was launched with. Mode and ref can only change while the agent is *attached*, so on those alone a parked pane essentially always comes back untouched — the whole point of parking. The **worktree can move while parked**, though, and `followWorktreeMigration` only follows the *attached* agent, so the `diffLaunchedCwd` comparison is what catches it and re-points the worktree/reflog watches (which `watchWorktree` otherwise leaves on the old directory, since it no-ops when a watch already exists). |
| The custom prompt is a **script in the diff pane**, handing back through `cmd`, and suppresses the healer while open | There is no channel for free-form user text: `cmd` carries fixed verbs and the daemon otherwise only ever *writes* into panes. So `custom` mode quits revdiff, types `cockpit-custom-prompt.mjs` into the same pane, and the prompt validates the ref with `git rev-parse` before appending `custom-ok`/`custom-cancel`. Being a plain node process it reads as a bare `shell` — indistinguishable from a quit revdiff — so without the `customPromptOpen` guard the 1s healer (and any further mode-cycle keypress) would type revdiff *over* the live prompt, where every character is an editor keystroke. |
| The agent's `cwd` **migrates**, and everything pinned to it must follow | `reconcile()` short-circuits on a matching fleet-header name, so an agent that creates and enters a worktree while *continuously* attached was never noticed: revdiff, its watches and the terminal all stayed at the launch directory, and Shift+R could not fix it (a reload re-runs the same range in the same directory). So `followWorktreeMigration` re-reads the live `cwd` from `claude agents --json`, relaunches revdiff (`cd` + revdiff, not `R`), re-points the watches and re-syncs the terminal — throttled, cooldown-guarded and under the reconcile lock. The terminal is `cd`'d forward **only if idle and untouched** (still at its `termSpawnCwd`, foreground process the login shell): a stray `cd` mid-command is worse than a stale prompt. |
| Inside a worktree git lies about the repo — `--show-toplevel` answers the **worktree** | Which would file that agent's notes, and that agent's session name, under a second phantom repo. `COCKPIT_REPO` (named on each terminal's command line) is the only thing that knows the cockpit's actual root from inside a worktree; the session namer uses `--git-common-dir`, which points into the main checkout's `.git` from both places, so its parent is the real repo. |
| Terminals are spawned through `/usr/bin/env`, because a split **inherits nothing** | `wezterm cli split-pane` spawns from the **mux server**, whose environment dates from whenever WezTerm started — not from the layout script or the daemon, so nothing either exports reaches a new pane and `PATH` and `COCKPIT_REPO` must be named on the command line. `env` *execs* the shell rather than wrapping it, so `ps` still reports `zsh` and the idle-terminal check is untouched. |
| The left button belongs to **claude, whole** — bind no part of it | claude turns on full mouse reporting, draws its own highlight and copies with **OSC 52** on release, which WezTerm honours. Two attempts at helping made it worse. Binding Down+Drag+Up gave WezTerm the selection and left claude blind — nothing in the pane was clickable. Binding only Drag+Up broke it twice over: claude dispatches its *click* on the **release**, so swallowing the release swallowed every click; and with the release never reaching `pane.mouse_event`, wezterm-term still believed Left was held and encoded every later *move* as a drag, so the selection followed the pointer for ever. The gesture is indivisible and WezTerm takes none of it. Shift bypasses reporting for a plain terminal selection. Both `swallow_mouse_click_on_*_focus` are **off** too: macOS WezTerm otherwise eats the press that focuses the window, and a drag whose press was eaten copies nothing while still drawing a highlight. |
| `note` and `agenda` are published as **symlinks in a directory only cockpit shells have on `PATH`** — and the command is `agenda`, never `cal` | "Inside the cockpit but not outside" needs no wrapper, no shell function and no edit to `~/.zshrc`; outside a cockpit window they are simply not commands. Relinked on every rebuild, so a moved checkout repairs itself. The cockpit **prepends** that directory, so a `cal` symlink would shadow `/usr/bin/cal` in every cockpit terminal *and every agent* that inherits the `PATH` — silently getting something else is a debugging cost paid at the worst moment. |
| Notes live in `~/.claude/cockpit`, **never in the repo** | A checked-in notes file appears in `revdiff --untracked HEAD` — the very diff the agent is being reviewed on — so every note you wrote would become a change the agent thinks it has to explain. |
| One lock covers all three agenda files, and `withLock` counts **depth** | The agents share these files with you, so every write locks (stale locks broken at 5s, so a process killed mid-write cannot wedge it for ever). One lock over three files makes nesting the *ordinary* case — attaching a calendar and priming its cache is one `withLock` around calls that each take it again. Measured before the guard, that compound write took **5035ms**: the inner call spun its whole retry budget against a lock **this process** held, then broke it as stale and unlinked it, leaving the rest of the transaction with **no lock at all** — the opposite of what wrapping it was for. (The session-naming state needs no lock for the opposite reason: one small file per session, never a shared one.) |
| Google's downloaded client JSON is **nested**, and the parse must accept it | A Desktop client downloads as `{ "installed": { "client_id": … } }` — snake_case, one level down — and a web client uses `"web"`; the plan assumed a flat `{ clientId, clientSecret }` and the spike **rejected the real file**. So `agenda setup` accepts `installed`, `web` and flat, in either key style, and stores the normalised flat shape: what is on disk is ours, what is read is Google's. |
| A 403 carrying `ACCESS_TOKEN_SCOPE_INSUFFICIENT` is `auth`, **not** `gone` — and the repair must probe with the **events** call | Google's consent screen has a **per-scope checkbox**, so an unticked calendar box yields a token that refreshes perfectly and 403s only on events. Rendering `calendar gone` would send you to `agenda rm` — destroying a working configuration and fixing nothing. `agenda add <slug>` on a calendar that already exists is therefore a **repair**, not a refusal: it re-signs-in the *account*, leaves the calendar row alone and re-fetches everything sharing that sign-in, so all the loud lines clear at once. It probes first — a working calendar still refuses, a `gone` one is sent to `agenda rm`, a transient failure changes nothing — and the probe fetches **events**, because a token-only probe answers "the sign-in works" and refuses, the exact dead end the repair exists to close. The verdict is read with the model's own `errorKind`, so the command and the line that sent you to it cannot drift apart. |
| `AGENDA_DRY_RUN=1` binds the **repair** too, with its own check | The repair branch is decided before `add` reaches its dry-run block, so a dry run aimed at an already-connected slug opened a real browser and signed in for real — the opposite of what the flag promises, on one of the two seatbelts every hands-on check in this project is handed over under. |
| The **resting pane must not rescue** a corrupt `agenda.json` | `readState()` *quarantines* a corrupt file to `agenda.json.corrupt-<ts>`. The pane repaints every 2s, so it always won that race and moved the sign-ins aside **with nobody to tell** — killing the announcement the CLI exists to make. The pane reads with `rescue: false`; quarantining is the `agenda` command's job alone, where a person is watching. |
| An all-day event is a **civil date**, and an offset-less `dateTime` is not in the machine's zone | DST makes a local day 23 or 25 hours long, so "today plus 86400000" is wrong twice a year, and an all-day event carries `date` (not `dateTime`) precisely because it has no instant — the day bounds are computed in the calendar's zone. Google can also return a local wall-clock time whose zone lives in a sibling field; parsing that with the machine's zone silently shifts an event by hours, and it is a purity leak the grep cannot see, because `new Date(s)` is not a clock call. |
| A session title can only be set from a **`UserPromptSubmit`** hook, and Claude's own summary arrives too late for the first one | Measured against the 2.1.251 binary: `hookSpecificOutput.sessionTitle` appears in that event's schema and no other. There is no `--name` on `claude agents` and the model has no tool to rename itself, so instructions in CLAUDE.md cannot do this — only the hook can. The `{"type":"ai-title"}` record is written *after* the first reply and `session_title` in the hook input carries only a **custom** title, so the opening words of the prompt stand in and are replaced from the transcript on a later prompt. A custom title permanently suppresses the summary, so naming immediately and upgrading later is the only way to have both — and a name **you** type ends the rule for ever: the hook cannot tell its own last title from a human's by inspection, so it records what it set and compares, and a mismatch writes `backedOff`, never cleared. Without that, `/rename` would be undone on your next prompt. |
| `settings.json` is merged, never rewritten, and a malformed one is **refused** | It is the user's file — their model, their plugins, their own hooks — and one that fails to parse silently disables *every* setting in it. So `--install` drops only a previous registration of **ours** (matched on the script's basename, so a moved checkout is re-pointed rather than duplicated), leaves every other `UserPromptSubmit` hook alone, writes atomically, and exits non-zero rather than overwrite a file it could not parse. |

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
- The Anthropic key is guarded against **other users** by the file's `0600`, not against
  **your own** processes: an agent runs as you and can read
  `~/.claude/cockpit/anthropic-api-key` off disk. A real wall is the macOS Keychain, which
  fights "keep it small"; the mitigation is a **spend-capped** key, and this residual is
  accepted, not defended.
- `config anthropic-api-key <key>` takes the key as a command argument, so it also lands in
  your shell history — a second at-rest copy, no weaker than the disk read above. Accepted;
  clear the history entry, or set the key from a history-ignored shell, if you mind.


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

