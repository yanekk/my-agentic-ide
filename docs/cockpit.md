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
   mode** — `uncommitted` (`HEAD` → working tree) → `lastcommit` (`HEAD~1` →
   `HEAD`, just the most recent commit) → `custom` (an arbitrary branch/SHA →
   working tree). Cycling into `custom` pops an ASCII prompt in the diff pane
   asking for the ref, pre-filled with that agent's last one; an unresolvable ref
   re-prompts. The footer shows which mode is active (and the custom base). The
   mode is per agent and session-only — a new agent, and every agent after a
   cockpit rebuild, starts in `uncommitted`; only the custom ref is remembered per
   agent (so re-entering `custom` pre-fills it). (Focused on a terminal, the same
   keys still cycle terminals.)
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
| `revdiff --wrap` | The diff slot is only ~half the window wide when a terminal shares its row, so long code and prose lines would clip at the pane edge and scroll off horizontally. Wrapping keeps the whole line on screen. |
| Diff range is `HEAD`, passed symbolically | `revdiff [base] [against]` defaults `against` to the working tree, so `revdiff HEAD` diffs `HEAD` → working tree: the agent's **uncommitted** work, an empty diff on a clean tree, matching `git status`. Passing `HEAD` rather than a resolved SHA lets a reload re-read it, so committing drops work out of the diff. (A merge-base base — the old R3 — froze at launch and kept showing committed work.) |
| Merge base is discovered, not `main` | Agents branch from wherever they started. Tries `@{upstream}`, then `origin/HEAD`, then `main`, then `master`. |
| Auto-reload pauses once you annotate | `R` drops annotations. The pane freezes the moment you start commenting, so text cannot shift under you. |
| `--no-confirm-reload` deliberately **not** passed | So an auto-reload with unflushed annotations prompts instead of silently discarding them. |
| Long reviews sent as bracketed paste | Over ~10 lines the prompt box collapses them to a `[Pasted text +N lines]` chip. Shorter ones stay expanded and directly editable. |
| Watchers torn down *before* switching agents | Quitting revdiff flushes its annotations; that write must not be mistaken for a review of the agent being switched to. |
| `⌥[` / `⌥]` are routed by pane focus | The keys append `next`/`prev` to the command channel regardless of focus; the daemon reads the cockpit tab's active pane (`is_active` from `wezterm cli list`) and hands them to the diff-mode switch when the **diff** pane is focused, the terminal cycler otherwise. `⌥t`/`⌥w` are always terminals. |
| Switching diff mode restarts revdiff | `R` only reloads the same range, so a *range* change means quitting revdiff (`q`) back to its shell and relaunching it with the new args — never while the annotation editor is open, where `q` would land in the comment. `diffLaunchedMode` tracks the range each parked pane was launched with, so returning to an agent relaunches only when its own mode/ref has changed since; otherwise the pane comes back untouched. The mode is **per agent** and in-memory (`diffModeByAgent`), defaulting to `uncommitted` — a new agent is never carried into another's mode, and there is no global `diff-mode` file. Only the custom ref persists (`~/.claude/cockpit/custom-refs.json`); because a mode can only change while its agent is attached, a parked pane essentially always comes back untouched. |
| The custom-range prompt runs in the diff pane | There is no channel for free-form text — `cmd` carries fixed verbs and the daemon only writes into panes — so `custom` mode types `cockpit-custom-prompt.mjs` into the diff pane. It reads the ref off its TTY, validates it with `git rev-parse` against the worktree, and appends `custom-ok`/`custom-cancel` to `cmd`. While it is open `customPromptOpen` suppresses `healQuitDiff` (which would otherwise read the plain node process as a quit revdiff and type over it) and swallows `⌥[`/`⌥]`. |

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

The strip is also **clickable**, so the actions can be reached with the mouse:
clicking a terminal row's **label area** makes that terminal active (a `select-<n>`
verb naming it by number), each row carries a right-aligned `[x]` that closes *that*
terminal (a `close-<n>` verb), and a `[+ add]` line below the list opens another
(the `new` verb, same as `⌥t`). The label's select zone stops one column short of
`[x]`, so a click is never both. The `[x]` is drawn only when there is more than one
terminal — the last has none, since closing it is refused anyway (a lone terminal's
whole row is still its select zone, though selecting the only terminal is a no-op).
Unlike `⌥[`/`⌥]`, which *cycle* to the neighbouring terminal, `select-<n>` jumps
straight to any one — parked or shown; like `close-<n>`, and unlike
`⌥w`, which closes whatever is on screen, it names a **parked** terminal outright,
so the daemon can bring it back (or, for close, kill it) without needing it on
screen first. The
click→verb mapping is the same mechanism as the footer's clickable diff-mode labels
(`enableMouse`, SGR mouse reporting scoped to the strip's own pane); the strip needs
the click's **row** as well as its column, since it is a column of rows.

The keybindings and the clicks do not move panes themselves. Each appends one verb to
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

## Notes

The fleet view's top pane is split down the middle: the cockpit's greeting on the
left, a **notes list** on the right, newest first.

```
┌──────────────────────┬───────────────────────────────────────────┐
│                      │ NOTES                                  4  │
│                      │ ───────────────────────────────────────── │
│                      │ 5c4f  2h    rebase before opening the PR  │
│  agentic-ide         │ 0665  Mon   skipped the flaky test  — tidy│
│  cockpit             │ d29d  Aug 3 check the footer at 120 cols  │
│                      │ … +7 more · note ls                       │
└──────────────────────┴───────────────────────────────────────────┘
```

Notes are added, edited and removed with **`note`**, from any cockpit terminal:

```bash
note "rebase before opening the PR"    # add — the short form
note add flaky test in run.sh:212      # add — quotes optional
note                                   # list, newest first
note show a3f9                         # one note, in full
note edit a3f9 [new text]              # replace it; without text, $EDITOR
note rm a3f9                           # remove it
```

A note is **one line** of text, a **stable short id**, a date and an author. The
id is minted at creation and survives edits, so a hash read off the pane keeps
working; any unique **prefix** resolves, so the four characters on screen are
usually the whole handle. The column is a *summary* — when the notes overrun the
pane it says how many are hidden and points at `note ls`, which is the full view.

### Why the notes column is drawn, not split

It is a **virtual pane**: `cockpit-welcome.mjs` draws both halves in the one pane
it already owns. A real second pane would have to be parked and restored on every
agent switch, and the diff slot's swap works by parking *exactly one* pane and
splitting the incoming one into it (see [the diff slot](#the-diff-slot-swaps-in-the-opposite-order)) — a
second pane up there would turn every swap into a two-pane dance for a list that
nothing ever types into. Drawing it costs one string; splitting it would cost the
invariant. So **the agent view is unchanged**: attaching parks the whole pane and
revdiff comes back at full width exactly as before.

### Why `note` exists only inside the cockpit

There is no install step and nothing lands on your normal `PATH`.
`bin/cockpit-layout.sh` symlinks `bin/cockpit-note.mjs` to
`~/.claude/cockpit/bin/note` and puts *that* directory on the `PATH` of the shells
the cockpit spawns. Outside a cockpit window `note` is simply not a command.

It cannot be inherited, either: `wezterm cli split-pane` spawns from the **mux
server**, whose environment dates from whenever WezTerm started — not from the
layout script or the daemon. So every terminal is spawned through `/usr/bin/env`
naming `PATH` and `COCKPIT_REPO` explicitly (`spawnTerminal` in `cockpitd.mjs`,
and the shell split in the layout script). `env` *execs* the shell rather than
wrapping it, so `ps` still reports `zsh` and the idle-terminal check is unaffected.

`COCKPIT_REPO` travels with it because an agent terminal sits in a **worktree**,
where `git rev-parse --show-toplevel` would answer with the worktree path and file
those notes under a second, phantom repo.

### The agents can write notes too

They run under the fleet pane, so its environment is theirs — `note add` works
inside an agent session for free, and an agent can hand you something worth
keeping ("skipped the flaky test, see run.sh:212"). Those notes carry the agent's
**name**, so a note you were handed never reads like one you wrote. The author is
decided by `CLAUDECODE` (the only reliable marker — `CLAUDE_CODE_AGENT` holds the
agent *type*, `claude`, not the name in the fleet list) and named from
`terminals.json`, which the daemon keeps pointed at the attached agent.

Because you and the agents share one file, every mutation is a read-modify-write
under a lock file, with a stale-lock break at 5s; without it two adds landing
together would both read the same list and the second would write the first away.

### Where notes live, and why not in the repo

`~/.claude/cockpit/notes.json`, keyed by repo root:

```json
{ "version": 1, "repos": { "/Users/you/src/proj": [ { "id", "text", "ts", "author" } ] } }
```

Not in the repo — a checked-in notes file would show up in
`revdiff --untracked HEAD`, which is the *very diff the agent is being reviewed
on*, so every note you wrote would become a change the agent thinks it has to
explain. Written atomically (temp + rename) like every other cockpit state file,
so the pane watches the **directory** and never goes deaf on a replaced inode.

## Agenda

Below NOTES in that same right column, separated by a rule, is **today's calendar**.

```
┌──────────────────────┬───────────────────────────────────────────┐
│                      │ NOTES                                  4  │
│                      │ ───────────────────────────────────────── │
│                      │ 5c4f  2h    rebase before opening the PR  │
│  agentic-ide         │ 0665  Mon   skipped the flaky test  — tidy│
│  cockpit             │ ───────────────────────────────────────── │
│                      │ TODAY · Wed 26 Aug                  14:20 │
│                      │ ▌ ALL DAY  Kasia off              home    │
│                      │ ▌ NOW      standup                work    │
│                      │   └ until 14:30                           │
│                      │ ▌ 15:00    design review        ? work    │
│                      │ … +2 more · agenda                        │
└──────────────────────┴───────────────────────────────────────────┘
```

**A slug is one calendar, not one account.** A Google account holds many — your own, plus every
one you subscribed to: holidays, birthdays, a shared team calendar. `agenda add work` signs in
and then gives you a **numbered list to pick one from**. A work schedule usually lives on a
shared team calendar rather than on `primary`, and merging the whole account would drag in
Company Holidays and every room you were ever added to, into a list a handful of rows tall.

Sign-in is per **account**; calendars are per **slug**. Adding a second calendar from an
account you already signed in to reuses the stored sign-in and opens no browser.

```bash
agenda                    # today, as the column shows it, plus per-calendar state
agenda add home           # sign in if needed, pick a calendar, attach it
agenda rm home            # detach it
agenda ls                 # the configured calendars, one per line
agenda color home         # reroll its colour
agenda setup ~/Downloads/client_secret_….json   # the Google registration, once
agenda help
```

**It is `agenda`, not `cal`.** `/usr/bin/cal` already exists, and the cockpit *prepends* its bin
directory to `PATH` — so a `cal` symlink would shadow the month grid in every cockpit terminal
**and in every agent**, which inherits that PATH. An agent reaching for `cal` out of habit and
silently getting something else is a debugging cost paid at the worst possible moment.

**`agenda rm` matches the slug exactly**, deliberately unlike `note rm a3f9`. A note removed by
mistake is one line retyped; a calendar removed by mistake is the whole browser sign-in again.
A note id is machine-minted and worth prefixing; a slug is a word you chose and can type in full.

**Agents may read; agents may not connect.** `agenda`, `agenda ls` and `agenda help` work
anywhere in the cockpit. `agenda add`, `rm`, `color` and `setup` refuse when `CLAUDECODE` is
set, saying why — the refusal names the reason that is true of the verb, since `rm` and `color`
open no browser and telling somebody one is coming sends them hunting for a window that is
never going to appear.

### What the column shows

**Only what is left.** An event is finished when its end time is at or before now, and a
finished event is dropped. The list shortens through the day rather than growing, which is what
keeps it inside a few rows.

**The event happening now is pinned at the top, marked `NOW`,** with a second line
`└ until HH:MM`. At 14:20 the first thing you want is not the next meeting but confirmation of
the one you are in and when it lets you go. If several overlap, the earliest start takes the
label and the rest follow as ordinary rows.

**All-day events sit above the timed ones**, marked `ALL DAY`. They have no start time to sort
by and they do not finish until the day does; a week off appears on every day it covers.

**When today has nothing left the column rolls on to tomorrow** — the header becomes
`TOMORROW · Thu 27 Aug`. This is why the fetch window is two days wide: rolling over at 18:05
must not need a network round trip. With both days empty it says `nothing today or tomorrow`.

**Overflow says how much it is hiding**: `… +N more · agenda`, the same contract the notes
column keeps. Stopping silently at the fold reads as "that is all of them", and here that is a
false statement about your afternoon.

Declined events are hidden — you are not going, and a row is scarce. Cancelled ones are hidden
unconditionally; they are tombstones in the API response, not entries on your calendar.
Unanswered invitations **are** shown, marked `?`: they are real claims on your time until you
deal with them, and hiding one shows an 11:00 as free when it is not. So are events you marked
"free" — Google's busy/free flag is about availability, not about whether you meant to do the
thing, and focus blocks are half of what this is for.

**The colour** is drawn at random from a fixed palette of eight mid-brightness terminal colours
when a calendar is added, and no two configured calendars share one while a free colour remains.
It renders as a `▌` bar down the left of each row *and* the slug at the right: the bar is what
you read at a glance, the slug is what survives a colourblind reader, a monochrome terminal and
a piped `--no-color`.

### When it cannot fetch

The failures split by whether waiting fixes them.

**Transient** — no network, a 5xx, a timeout. The last events fetched **stay on screen** and one
dim line is added: `last updated 22m ago · offline`. It heals itself within a minute, events
rarely change inside twenty, and an agenda that turns into an error message every time a laptop
wakes from sleep teaches you to ignore the line that matters.

**Permanent** — the sign-in was revoked or expired, the consent was granted without the calendar
permission, or the calendar is gone. That calendar's rows are replaced by **one loud line naming
the command that fixes it**, and the other calendars are unaffected and keep showing their
events:

```
home  sign-in expired · agenda add home
home  calendar permission not granted · agenda add home
home  calendar gone · agenda rm home
```

**The command on that line is the command you type**, and for an expired sign-in that means
`agenda add <slug>` **repairs** it: it signs the account in again and leaves the calendar exactly
as it was — same slug, same colour, same place in the list, none of which `agenda rm` followed by
`agenda add` would have kept. What broke is the *account's* sign-in, so every calendar sharing it
is re-fetched too and all their loud lines clear at once rather than a tick apart. The sign-in is
**probed before any browser opens**: a calendar that is actually fine still refuses ("its sign-in
works — `agenda rm` first"), and a failure that is not an expiry (wifi off, a 5xx) says so and
changes nothing rather than spending a browser round trip on something it cannot fix. Signing in
as a different account is refused too, since that would store a second sign-in and leave this
calendar pointing at the dead one.

The middle one earns its own case. Google's consent screen carries a **per-scope checkbox**, and
leaving the calendar box unticked yields a perfectly valid token whose calendar calls fail. That
is a consent mistake, not a dead calendar — telling somebody to `agenda rm` a calendar that is
fine would destroy the configuration and fix nothing.

**Staleness is only reported when a fetch has actually failed.** A cache a minute or two old
during normal operation is not stale, it is current; saying "5m ago" every time would make the
line meaningless.

### Refreshing: the daemon fetches, the pane only draws

**Every minute, and on return to the cockpit if the last fetch is older than a minute.** "On
return" is the transition back to the fleet *list* — you opened the window, or you stepped out of
an agent. Opening the window counts, and `onExit` does not fire for it, so there is an explicit
refresh at start-up as well.

It was five minutes until 2026-08-29, when an event added by hand took up to six minutes to
appear — precisely the moment the delay is least acceptable.

**One tick, not two timers.** The 60-second tick fetches any calendar whose last fetch is older
than a minute, and the on-return trigger calls the same function; a single "is anything stale?"
predicate is easier to reason about than a periodic timer racing an event. One fetch is in
flight at a time, guarded like `reconcile` already is — overlapping fetches would interleave
cache writes and burn quota on a slow network. **With no calendars configured the tick returns
immediately and writes nothing**, so the feature costs nothing until it is used.

`cockpit-welcome.mjs` is **pure display by construction** — it never runs a command and never
moves a pane, which is what lets `cockpitd` own it as a diff slot. So the daemon writes
`agenda-cache.json` and the pane watches the state directory and redraws, exactly as the strip
already consumes `terminals.json`. Network I/O in the pane would not break the pane machinery
today, but it would break the rule, and the rule is load-bearing.

### Why the agenda is drawn, not given a pane

The same reason as [the notes column](#why-the-notes-column-is-drawn-not-split), and it has not
changed: the diff slot swaps by parking *exactly one* pane, so a real agenda pane would turn
every agent switch into a three-pane dance for a list nothing ever types into.

**How the column divides.** The agenda is capped at half the column's rows; if it wants fewer it
gives the slack back to notes, and notes never fall below three. Not a fixed half, because in
the evening the agenda is two lines and a fixed half would show `nothing left today` above four
blank rows while notes overflowed below it. With no calendars configured the section shows
`no calendars` and `agenda add home` rather than nothing — a blank region with no explanation
reads as a bug. Below the narrow-pane threshold the whole pane already falls back to a single
centred greeting, and the agenda is not drawn there either; `agenda` in a terminal still reads it.

### The Google registration, once per machine

Google requires the cockpit to identify itself with a client ID and secret that you create in
the Google Cloud console. **They are not in this repository and never will be** — they live in
`~/.claude/cockpit/agenda-client.json`, mode `0600`, in a **separate file from the sign-ins** so
that a corrupt state file, or `agenda rm` on everything, cannot cost you the console setup.

`agenda setup` takes **the path to the JSON Google gave you**, not two typed values: a client
secret is a long opaque string and one mistyped character produces a sign-in failure
indistinguishable from every other sign-in failure. The download is parsed, the two values are
copied out, and your download is left where it is. Google emits a **nested** file —
`{ "installed": { "client_id": …, "client_secret": … } }` for a Desktop client, `"web"` for a web
one — so the parse accepts `installed`, `web` and flat, in either key style, and stores the
normalised flat shape. What is on disk is ours; what is read is Google's.

**Two things in the console will bite you, and nothing warns you at the moment they matter:**

- **Add each account as a test user.** A client in *Testing* publishing status refuses to sign in
  any account not on that list, and the refusal happens in the browser, not in the terminal.
- **Tick the calendar checkbox on the consent screen.** It is a *per-scope* checkbox and it is
  not ticked for you. Leaving it produces a valid sign-in whose calendar calls fail; the column
  then says `calendar permission not granted`, and the fix is to run `agenda add` again and tick
  it.

Sign-in is the **loopback flow with PKCE**. The redirect is `http://127.0.0.1:<port>` with the
port taken by binding port 0 and reading back what the OS gave — Google permits any loopback
port for a Desktop client, and hard-coding one would fail whenever it was already in use. The
listener **closes after 180 seconds or the first request**, so a browser tab you abandon cannot
leave a process listening. `access_type=offline` and `prompt=consent` are both passed: without
them Google returns a refresh token only on the *first ever* consent, and a re-add after
`agenda rm` would silently produce an account that cannot refresh.

Scopes are `calendar.readonly` plus `openid email` — the second only so the tool can name which
account signed in, which is what makes "you are already signed in to this account" possible.

### Where the agenda lives, and why not in the repo

Three files in `~/.claude/cockpit/`, all mode `0600` — the cache included, because it holds your
meeting titles:

```
agenda-client.json   { version, clientId, clientSecret }
agenda.json          { version, accounts: { "<email>": { refreshToken, addedAt } },
                       calendars: [ { slug, account, calendarId, title, colour, addedAt } ] }
agenda-cache.json    { version, calendars: { "<slug>": { fetchedAt, events, error } } }
```

Not in the repo, for the same reason as notes: a checked-in file here would show up in
`revdiff --untracked HEAD` — the very diff the agent is being reviewed on — so your calendar
would become a change the agent thinks it has to explain, and it would put refresh tokens in git.

Writes are atomic (temp + rename) and taken under **one** lock covering all three files, with a
stale break at 5s — you, an agent and the daemon all write them, and the three are written
together often enough (attach a calendar, prime its cache) that separate locks would only buy
interleavings to reason about. The lock is **reentrant by depth**: one lock across three files
makes nesting the ordinary case, and without the depth count a compound write spun its whole
retry budget against a lock the same process held, then broke it as stale — leaving the rest of
the transaction running with no lock at all.

A corrupt file starts clean rather than crashing the pane, with one exception: **`agenda.json` is
moved aside** to `agenda.json.corrupt-<ts>` first, and the CLI says so. It holds the sign-ins,
and silently discarding a refresh token costs two browser round trips.

### If it goes wrong

- `agenda` in any cockpit terminal prints the state of every calendar and why. Nothing here can
  break the fleet view or an agent.
- **Start over, keeping the console setup:**
  `rm ~/.claude/cockpit/agenda.json ~/.claude/cockpit/agenda-cache.json`. You sign in again from
  `agenda add`; you do not go back to the Google console. Notes, panes and agents are untouched.
- **Start over including the registration:** `rm ~/.claude/cockpit/agenda*.json` — the glob takes
  `agenda-client.json` too, so this one costs you the console setup as well.
- **Revoke the cockpit's access** to an account from that account's
  [third-party access page](https://myaccount.google.com/connections). The column then says
  `sign-in expired`, which is correct.
- **The feature is in the way.** `agenda rm` every slug: with nothing configured the tick returns
  immediately, nothing is fetched, and the column falls back to notes alone.

## Session names

The fleet list's rows are labelled with each session's **name**. Left alone,
`claude agents` writes that name itself: a one-line summary Claude makes of your
first message, so a session comes up as `read handoff document`. Read on its own
it is fine. Read in a list of six it is not — nothing says which repo it belongs
to, and two agents in different projects can look identical.

`bin/cockpit-auto-name.mjs` supplies the missing half. Every session **in a git
repo** becomes:

```
<repo folder> / <what it is doing>

agentic-ide / cockpit-agenda            a /pir-work slug
agentic-ide / browse-mode-review        the worktree it sits in
real-screen-time / read handoff document    Claude's own summary
```

Outside a git repo nothing is named at all — there is no left half to build.

### Where a name can come from at all

There is exactly one channel: a **`UserPromptSubmit` hook** may return
`hookSpecificOutput.sessionTitle`. Measured against the 2.1.251 binary, that field
appears in no other hook event — not `SessionStart`, not `Stop`. `claude agents`
has no `--name`, and the model has no tool to rename itself, so a rule written
into CLAUDE.md cannot do this. The hook is the whole mechanism, which is also why
the first name has to be computable from the prompt being submitted.

Registered in `~/.claude/settings.json` by `bin/install.sh`, which calls the
script's own `--install`. That keeps the knowledge of *where* it hooks in the same
file as the hook, and lets `spikes/auto-name-test` drive the same code path the
installer runs rather than a copy of it that would drift.

Unlike `note` and `agenda`, this is deliberately **not** cockpit-only. Those are
published as symlinks in a directory only cockpit shells have on `PATH`; this must
apply to every claude session on the machine, because an agent dispatched from the
fleet view is an ordinary session and naming it is the entire point.

### Which signal wins

Strongest first. A stronger signal may later overwrite a weaker one; the reverse
never happens.

| | signal | example |
|---|---|---|
| 3 | a `/pir-work`, `/pir-plan` or `/pir-review-plan` slug | `agentic-ide / cockpit-agenda` |
| 2 | the worktree the session sits in | `agentic-ide / browse-mode-review` |
| 1 | Claude's own summary of the session | `real-screen-time / read handoff document` |
| 0 | the opening words of the first prompt | `real-screen-time / read the handoff doc…` |

The name **follows the work**: a session that later runs `/pir-work`, or creates a
worktree and moves into it, is renamed to match. Rank 0 is the exception — it is a
first-naming device only. Re-applying the opening words on every prompt would
rename the session continuously, so once anything is set, rank 0 never applies
again.

### Why the opening words, and not just Claude's summary

Because the summary does not exist yet. The hook runs when a prompt is
**submitted**; the `{"type":"ai-title"}` record lands in the transcript after the
first reply. And `session_title` in the hook input carries only a *custom* title —
never the summary — so the hook cannot even read it at that moment.

That would suggest waiting a prompt. But a custom title, once set, **permanently
suppresses** the summary: whatever the hook writes is what the list shows from then
on. So naming immediately with the opening words and upgrading from the transcript
on a later prompt is the only arrangement that gets both a correct name from the
first second and Claude's better wording once it exists.

### Why the repo half is `--git-common-dir`

An agent sits in `.claude/worktrees/<name>`, where `git rev-parse --show-toplevel`
answers with the **worktree** — which would file that agent under a second, phantom
repo. It is the same trap `COCKPIT_REPO` exists for in `cockpit-note.mjs`.
`--git-common-dir` points into the main checkout's `.git` from a worktree *and*
from the checkout itself, so its parent directory is the real repo either way.

### A name you typed is final

The hook cannot tell its own last title from a human's by inspection — both are
just "a custom title" on the session. So it records what it set and compares. A
mismatch means a person typed one (`/rename`, or the fleet list), and `backedOff`
is written for that session and never cleared.

Without this the rule would undo your `/rename` on your very next prompt, which is
worse than never having named anything. The same test covers sessions that were
already named when the hook was installed: they have a title and no record of ours,
so they are left alone permanently.

### State, and why one file per session

`~/.claude/cockpit/auto-names/<session id>.json` — what the hook last called the
session and at which rank, or `backedOff`.

One small file each rather than a single JSON keyed by session id, because every
agent runs its own copy of the hook concurrently: a shared file would need the same
read-modify-write lock `notes.json` needs, and a file each needs no lock at all.
Written atomically like every other cockpit state file, and pruned at 30 days on
the first write of a session — once per session, never once per prompt.

### It may never block a prompt

It runs on every prompt of every session, so a crash here is a crash in the prompt
box. Every failure path exits 0 with no output: unparseable input, a missing git,
an unreadable transcript, a state directory it cannot write. `run.sh` asserts the
exit code for a spread of malformed inputs rather than trusting it.

The one place it deliberately exits **non-zero** is `--install` against a
`settings.json` it cannot parse. That file is the user's, and a malformed one
silently disables *every* setting in it — so it is refused, never overwritten on a
guess.

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

The worktree watch alone misses **commits**, though: `git commit` changes no
working-tree file (the bytes on disk are untouched), it moves `HEAD` — which
lives in `.git/` (ignored by that watch) and, for a *linked* agent worktree,
entirely *outside* the worktree, in `<main>/.git/worktrees/<name>/`. So a second
watch follows the git **reflog** (`logs/HEAD`), appended on every HEAD movement.
It must watch the `logs/` **directory**, not the file: git writes the reflog with
a lock-file + rename, so the file lands under a new inode each time and a file
watch goes deaf — the same trap as the annotation watch. With it, committing
correctly empties the `uncommitted` diff and advances `lastcommit`.

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
| `COCKPIT_REPO` | Which repo's notes a terminal sees. Exported into every cockpit-spawned shell; `note` falls back to `panes.json` when it is absent. Not something to set by hand. |
| `COCKPIT_BIN` | Where the cockpit's own commands live (`~/.claude/cockpit/bin`). Set by the layout script; on the `PATH` of cockpit shells only. |
| `AGENDA_DRY_RUN=1` | `agenda add` prints the sign-in URL it *would* open and stops — binds no port, opens no browser, writes nothing. The safe way to inspect the flow. |
| `COCKPIT_AGENDA_TICK_MS` | How often the daemon looks for a stale calendar (default 60000). |
| `COCKPIT_AGENDA_STALE_MS` | How old a fetch must be before that tick refetches it (default 60000). |
| `AGENDA_ORIGIN` | Re-point Google's endpoints at a loopback stub. The tests' whole reason for existing offline; never set by hand. |
| `AGENDA_BROWSER` | The opener, instead of `/usr/bin/open`. Used by the tests to record what would have been launched. |
| `AGENDA_TTY` | Where `agenda add`'s prompts are read from, instead of `/dev/tty`, so the picker is drivable in a test. |

## Testing

```bash
spikes/cockpit-test/run.sh
```

```bash
spikes/notes-test/run.sh        # the `note` command and the right column
spikes/agenda-test/run.sh       # the agenda's store, model, Google client, command
spikes/auto-name-test/run.sh    # session naming and its settings.json merge
```

`spikes/auto-name-test` needs no WezTerm — the naming hook is a plain
stdin/stdout filter — so it runs standalone. Its seatbelt is `~/.claude/settings.json`:
no suite may write the real one, and `run.sh` fingerprints it before and after
rather than trusting that. 50 assertions, over a real git repo with a real linked
worktree (the worktree rules are the ones most easily got wrong by a fake): what
each signal names, that a stronger signal overwrites a weaker one and never the
reverse, that a name typed by hand stops the rule dead and keeps it stopped, that
the hook stays silent on malformed input instead of failing a prompt, and — for the
merge — that every other setting and every other `UserPromptSubmit` hook survives,
that a re-run does not touch a byte, that a moved checkout is re-pointed rather
than duplicated, and that a `settings.json` which cannot be parsed is refused
rather than overwritten.

Stubs `wezterm` with a shim that records argv and stdin **and models a pane
table** (`list`, `split-pane`, `move-pane-to-new-tab`, `kill-pane`), builds two
throwaway git repos, and drives attach → review → switch → switch back → detach →
reap. 174 assertions. Beyond the review-injection ones it asserts that entering an
agent *opens* a terminal and a diff pane in its worktree rather than `cd`-ing or
restarting shared ones, that switching *parks* both outgoing panes instead of
killing them, that switching back *moves the same panes in* — with **no revdiff
command retyped**, which is the whole point — that a parked agent's diff still
reloads when its worktree changes but *not* while its annotation editor is open,
that an agent which *changes directory* mid-life (checkout → worktree) has its
idle, untouched terminal `cd`'d forward on return while a busy or hand-navigated
one is left alone, that quitting revdiff (Shift+Q, which discards annotations)
is reinstated on the same diff rather than leaving the pane at a bare shell, and
that both panes are reaped only once their agent has left the fleet.

Since the agenda it also covers the daemon's half of that feature: that the
60-second tick refetches a calendar the moment its cache is a minute old and
leaves a younger one alone however many ticks pass, that a return to the fleet
list does the same, that **with no calendars configured no cache file is written
at all**, that a network failure keeps the previous events and only adds an error
while an auth failure classifies differently, that one pass runs at a time
(~5 ticks behind a held-open request start nothing), that a corrupt `agenda.json`
is *not* quarantined by the daemon — that is the CLI's job alone — and that
**neither an access token nor a meeting title ever reaches `daemon.log`**, which
gets pasted into conversations.

The stub models pane **titles** too, and deliberately reports a stale one on the
switch-back so the framed-screen check has to carry that decision. Making
`diffPaneStatus` title-only fails exactly those two assertions.

```bash
spikes/notes-test/run.sh
```

The notes feature, standalone — the column is drawn inside the welcome pane
rather than being a pane of its own, so it needs no mux stub. 90 assertions over
the `note` command and the rendered column: that the command refuses outside a
cockpit but still answers `help`, that a bare `note "text"` adds while `note ls`
lists, that a pasted newline is collapsed rather than splitting a note, that
**nothing is written into the repo** (the file that would otherwise appear in the
agent's own diff), that an id survives an edit and resolves from a 2-character
prefix while an unknown one is refused, that an agent's note carries its name and
yours carries no byline, that two repos keep separate lists, that **10 concurrent
adds all survive** the shared-file lock, and that the column renders its header,
ids, ages, empty state, the `+N more` line when it overruns, and drops back to a
single column when the pane is too narrow to split.

Since T06 it also owns the **right column as a whole** — NOTES over a rule over
AGENDA — because both halves are drawn by the same pane. It sweeps 1–40 rows
against four widths and asserts the height is exact, that no line ever runs over
the width, that the agenda is never drawn above the notes, that notes never fall
below three rows, and that a hostile event title cannot write control sequences
into the pane. Its frame harness **freezes the clock and fixes `TZ`**, so `NOW`,
`└ until 15:00` and the wall clock are one string on any machine at any hour —
with a real clock an event three hours out crosses midnight for anyone running
the suite in the evening.

```bash
spikes/agenda-test/run.sh
```

The agenda's own core: the state files and their lock, the event model, the
column renderer, the Google client and the `agenda` command. 611 assertions, and
**it never touches the network** — `AGENDA_ORIGIN` points Google's endpoints at a
loopback stub, so the OAuth exchange, the refresh and the event fetch are all
driven for real against a server the test owns. It asserts that a corrupt
`agenda.json` is **moved aside** rather than discarded (it holds the sign-ins)
while a corrupt cache is not, that a **stale lock is broken and a nested one does
not stall**, that an offset-less `dateTime` is not read in the machine's zone,
that a declined event is hidden while an unanswered one is shown and marked, that
a 403 naming an insufficient scope says `calendar permission not granted` rather
than `calendar gone`, that a hostile calendar title cannot escape into the
terminal, that `agenda add __proto__` is refused, that `agenda add`/`rm`/`color`/`setup`
refuse for an agent **with a reason that is true of the verb**, and that `agenda`
is a command inside a cockpit terminal and not outside one.

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
