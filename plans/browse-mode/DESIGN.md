# Browse mode — Design

> Read before changing any behaviour here. Every rule carries its reason; a rule without one
> gets overturned by the first session that finds it inconvenient.

## 1. Purpose

The cockpit can only show you files the agent **changed**. `revdiff --untracked HEAD` is a
diff, so an unchanged file is invisible — you cannot read the function the agent called, only
the line that calls it. Browse mode adds a fourth stop to the diff-slot cycle that **splits the
top pane in two: the file browser on the left, a tabbed read-only viewer on the right.** Enter
on a file in the browser opens it as a tab in the viewer beside it. Files accumulate as tabs and
survive cycling away.

One gesture, nothing to type. `⌥]` is the whole of the user interface.

For the one person who runs this cockpit. Not a general-purpose editor and not a second IDE.

### Success criteria

- `⌥]` from `custom` lands on `browse`; the top pane becomes **browser | viewer**, with the
  browser holding focus.
- Pressing Enter on a file in the browser makes it a tab in the viewer beside it, without
  spawning a second editor, and **the cursor follows it into the viewer** so the file can be
  read straight away. `⌘⌥←` goes back to the tree. *(Reversed at T11 on the user's decision of
  2026-09-03; it used to leave the cursor in the browser.)*
- A `c/` content search in the browser followed by Enter lands on the **matching line**.
- `⌥[`/`⌥]` leave browse mode from **either** half — you are never trapped in the browser.
- Cycling to another mode and back returns **both** panes, with every tab still open and the
  cursor where it was.
- Files cannot be modified from the viewer.

### Stance

- **Reading, not editing.** The viewer is read-only. The agent's working tree is the agent's;
  a stray keystroke must not become a change the agent then has to explain.
- **Nothing is restarted that can be parked.** The cockpit's whole promise is that returning
  is instant. Browse mode obeys it or it is not worth having.
- **Nothing is typed.** Browse mode is reached the same way the other three modes are, and it
  arrives complete. There is no command to remember and no second place to start it from.
- **The browser lives in the diff slot, beside the viewer.** See §3.1 — this reverses an earlier
  decision, and the measurement that reversed it is recorded there.

---

## 2. Behaviour specification

### 2.1 The fourth stop

`DIFF_MODES` becomes `["uncommitted", "lastcommit", "custom", "browse"]`. `⌥[`/`⌥]` cycle
through all four **while the diff pane holds focus**, exactly as today; focused on a terminal
they still cycle terminals. The mode stays **per agent and in memory** (`diffModeByAgent`),
so a new agent and every agent after a cockpit rebuild starts at `uncommitted`.

*Why a stop in the cycle rather than its own key:* the user chose it, having heard the
argument that browsing is a different activity from "which changes am I looking at" and would
be passed through on the way between diff modes. Recorded in §7.

**"The diff pane holds focus" now means either half.** In browse mode the slot holds two panes,
and `diffPaneFocused()` must answer true for **both** — otherwise `⌥[`/`⌥]` do nothing while the
browser has focus, which is where focus deliberately sits (§2.3), and the only way out of browse
mode would be to click the other half first. That is a trap, not a mode.

### 2.2 The viewer

`micro -readonly true`, occupying the **right-hand half of the diff slot**, beside the browser.

- **Read-only is not cosmetic.** Every buffer shows `[ro]`. Without it the viewer is an editor
  pointed at the agent's worktree, and an accidental save becomes a diff the agent must
  account for.
- **Started with no file.** micro with no argument opens an empty `No name` buffer. The first
  push therefore uses micro's `open` command (replacing that buffer) and every later push uses
  `tab` (adding one). Otherwise the tab bar carries a permanent empty first tab.
- **Tab labels are whatever path is passed**, so paths are made **repo-relative** before
  sending. Absolute paths fill the bar with `/Users/...` and nothing is readable.

### 2.3 The browser

`broot`, occupying the **left-hand half of the diff slot**, launched by the daemon when the
agent enters browse mode. **There is no `browse` command and nothing is typed** — entering the
mode is the whole gesture.

- **The split is `--percent 80` in the viewer's favour**, so the tree is the width of
  **revdiff's own file list** — 20% of the slot. *(Was 60; the user judged that too wide in a
  real cockpit at T07 and asked for it to match revdiff.)* revdiff's `--tree-width` is *"units
  (1-10, default 2 of 10)"*, a **share** rather than a column count, so ours is a share too and
  keeps matching at any window size; measured live, revdiff's box was 65 of 319 columns. The
  browse tree sits exactly where revdiff's tree sits and is read the same way, so matching it
  beats a width validated on its own.
- **The browser holds focus on entry.** You enter browse mode to find a file, so the keyboard
  starts where the finding happens: arrive, filter, Enter. From the Enter onwards the cursor is
  in the **viewer** (§2.4), and `⌘⌥←` — a cockpit-wide pane move that predates browse mode —
  brings it back to the tree for the next file. No mouse anywhere in the loop.
- The browser is **per agent**, like everything else in the slot, and parks with the viewer
  (§2.6).

*Why not a terminal:* it was, in the first draft of this design, and §3.1 records why that was
reversed and what was measured to reverse it.

### 2.4 The push

Enter on a file in broot runs `cockpit-open <file> <line>`, which sends keystrokes to the
viewer pane with `wezterm cli send-text --pane-id <viewer> --no-paste`:

| Step | Bytes | Why |
|---|---|---|
| open the command bar | `\x05` (Ctrl+E) | micro's command prompt |
| the command | `open <rel>` first, `tab <rel>` after | §2.2 |
| **submit** | **`\r`** | **`\n` only inserts a newline — the push silently does nothing** |
| jump to a line, if given | `\x05`, `goto <n>`, `\r` | for a content-search hit |

**The `\r` rule is the project's existing one, applied in reverse.** Everywhere else the
cockpit substitutes `\n` for `\r` so an injected review arrives *unsent*; here submission is
exactly what is wanted, so `\r` is correct and `\n` is the bug. It cost a failed run during
planning and it fails **silently**.

**Focus then follows the file into the viewer** — `wezterm cli activate-pane --pane-id <viewer>`,
after the last keystroke and outside the tab-list lock. *(T11, the user's decision of 2026-09-03.
The original rule was the opposite — measured, the browser stayed active through every push and
kept its filter text — and the user drove it by hand at T07 and asked for the reverse: "Pressing
Enter on broot changes focus to micro, so I immediately get to the file I opened." The cost was
put to them first: stacking several files into tabs without reading them now costs a `⌘⌥←`
between each Enter. An `Alt+Enter` that pushed without taking focus was offered as the way to
keep both and declined **twice**: once on 2026-09-03 without the evidence (no tab bar had been
seen when the question was asked) and again on **2026-09-04**, having driven the tab bar by hand.
Option B is **closed, not deferred** — do not build it back on the assumption it is still open.)*

All three pushes move it — `open`, `tab` and `tabswitch` alike: you asked for that file, so you
want to read it. The two failure cases are decided one each way:

| Case | Focus moves? | Why |
|---|---|---|
| A `send-text` failed part-way | **no** | The half-sent push leaves micro's command bar **open** with a half-typed command in it. Dropping the cursor there hands the user a live command bar they did not ask for, in a program they may not know, with no file to show for it |
| Every payload landed but `viewer-tabs.json` could not be written | **yes** | The opposite call for the opposite reason: the file **is** on screen. The command still exits 1 with its one line, but the cursor follows the file that actually opened |

**This is the only focus movement in browse mode that is not the daemon's.** T04's rule — *focus
follows the pair, never takes it* — governs pane swaps, heals, fences and worktree migrations,
none of which is a person pressing a key, and it is untouched.

### 2.5 Already-open files

Pushing a file that is already open must **switch to its tab**, not open a second copy. micro
has `tabswitch <n>` (1-based, in tab-bar order). The glue therefore remembers the ordered list
of files it has pushed per agent (§3.5) and decides between `open` / `tab` / `tabswitch` from
that list alone (§3.3).

*Why remembered rather than asked:* micro has no way to report its open buffers, so the only
available source of truth is what we ourselves sent.

### 2.6 Parking, not restarting

Cycling **out** of browse parks the browser **and** the viewer, as a pair; cycling **back in**
restores both. This differs from the other three modes, which quit revdiff and relaunch it,
because `R` only reloads the same range.

*Why the difference:* browse is a stop in a four-way cycle, so it is passed through
constantly. Killing micro on the way past would empty the tab bar every time and make tabs
pointless — which is the entire feature. Measured: a parked micro returns with all tabs, the
cursor on the same line, `[ro]` still set, and the pane at identical geometry.

**The pair parks as a unit, in a tab of its own.** `move-pane-to-new-tab` moves one pane, so
parking is two calls: move the browser to a new tab, then `split-pane --move-pane-id` the viewer
in beside it. Restoring is the mirror: split the browser into whatever holds the slot, dispose of
that, then split the viewer back to its right. **Measured at plan review, on a headless mux:**

```
pair in slot   broot 47x18   micro 72x18   fleet 120x11
parked         broot 47x30   micro 72x30   (their own tab)
restored       broot 47x18   micro 72x18   fleet 120x11    <- identical
```

micro came back holding its file with `[ro]` set and the cursor at (1,1); broot came back
drawing. See FINDINGS.

**Consequence, stated plainly:** the diff slot holds **two panes at once** in browse mode and one
in the other three, and its parking area holds **up to three panes per agent** — that agent's
revdiff, its browser and its viewer. The "park exactly one, split the incoming into it"
invariant becomes "park the outgoing **set**, split the incoming set into the slot"; the
geometry argument behind it is unchanged, because it is still the *outgoing* occupant that is
split into. T00 proves the whole dance before any of it is built.

### 2.7 What the strip shows

`terminals.json` already carries the visible agent's `diffMode` and the strip renders it. It
must render `browse` too, and the footer legend must not imply only three modes exist.

**`browse` gets a full, clickable fourth label — `Browse`** (decided at plan review). Concretely,
in `cockpit-strip.mjs`: `DIFF_ORDER` gains `"browse"` and `DIFF_MODE_LABELS` gains
`browse: "Browse"`.

*Why the label is not optional:* the footer picks its highlight with
`DIFF_MODE_LABELS[diffMode] ? diffMode : "uncommitted"`. A mode with no label entry does not
merely go unlisted — the bar highlights **Uncommitted Changes** while the agent is actually in
browse, which is worse than showing nothing.

*Why clickable rather than keyboard-only:* every diff-mode label in this footer is a button
(`DIFF_ORDER` is what builds the click hit-zones), and one that is drawn but inert is the kind of
inconsistency nobody remembers. Adding it to `DIFF_ORDER` makes `diff-browse` reachable on the
`cmd` channel, which `diffModeSet` accepts as soon as `browse` is in `DIFF_MODES` — so the click
path is live from T04 and **must park like the keyboard path does** once T05 lands (see T05).

*The cost, measured:* the footer already needs ~184 columns with three labels, a short agent name
and no custom ref; `Browse` adds ~11, and a long `Custom: <branch>` adds more on top. On a window
narrower than that the right-hand end is clipped. Accepted knowingly; T07 is where a person says
whether it reads badly.

### 2.n The unhappy paths

| Situation | Rule | Why |
|---|---|---|
| `cockpit-open` run when the slot is **not** in browse mode | Refuse; change nothing, send nothing | `panes.json.viewer` is null, so there is no viewer to push into — and typing into a revdiff pane would land in revdiff, where every character is a keybinding. Reachable now only from a stale broot left over from a mode change |
| `cockpit-open` run with **no agent attached** | Refuse the same way | Diff modes are per agent; with nothing attached the top pane is the greeting/notes pane |
| The user quits **micro** (`Ctrl+Q`) | The viewer half drops to a shell; relaunch micro **in that half**, leaving the browser alone — **and reset that agent's tab list**, because the tabs are gone | A bare shell in half the slot reads as the cockpit having broken; killing the browser too would lose the place in the tree for no reason |
| The user quits **broot** | The browser half drops to a shell; relaunch broot in that half, leaving the viewer and its tabs alone | Same reason, the other way round. Two halves, two independent heals |
| Both halves are quit | Each is healed independently by the rule above | Neither heal may assume the other half is alive |
| Healing races a still-painting micro | Same cooldown guard as `healQuitDiff` | micro looks like a shell for a moment while it starts |
| The healer meets a **healthy** browse pane | `diffPaneStatus` must report **both** halves as `running`, and today it reports neither — a live micro shows **0** framed lines and broot likewise draws no `│` frame, so revdiff's screen signal says nothing about either. Taught in **T04**, with the mode itself. **The pane TITLE is not the answer** — see the row below; the foreground process on the pane's tty is. **And the question is whether ANY of the foreground group is `broot`/`micro`/`revdiff`, never which of them is last** | Otherwise the 1 s healer types a command line into a live editor and a live browser from the moment browse mode is reachable. Detection cannot lag behind the mode that needs it. **The group, because broot keeps its Enter verb's child in its own process group** — measured under `script(1)` (T13): mid-push the pane answers `SNs+ broot · SN+ /bin/sh · RN+ ps`, all three foreground, so a last-wins reading answers `node` and a live broot reads as a quit shell. That is the user's 2026-09-04 report of broot's own launch command appearing in broot's filter box. A pane with broot in its foreground group has broot in it |
| The user browses **out of the agent's worktree** | The daemon asks the running broot where its root is and sends it back — `broot --listen <sock>` at launch, then `--get-root` / `--cmd :focus <worktree>` once a second. A root **below** the worktree is left alone; descending is not wandering | **broot cannot be confined and this was checked** (T09, broot 1.59): no jail option exists, and a verb of ours named `parent` does not shadow the built-in `:parent` — it still moved the root, with our file loaded cleanly and first in the chain. Blocking keys would not do it either, since `:parent` can be typed. So the **result** is fenced, not the route, which closes every way out at once instead of the ones somebody enumerated. Both paths are realpathed first: broot answers resolved (`/private/var/…`), a worktree usually is not (`/var/…`), and comparing raw would yank the tree once a second |
| Deciding whether a half is running **from the pane title** | **Never.** Ask the OS for the tty's foreground group (`ps -t`) and accept **any** member of it — the same call `terminalIsIdle` makes, read differently (T13: it wants the *last*, because a terminal's job takes a new process group and the shell drops out of the foreground; detection wants *any*, because broot's verb child does not). The title may still be *believed* when it says `broot`/`micro`/`revdiff`, but it may never be believed when it does not | A title is not a name for what a pane runs — it is whatever last wrote it. A shell with a `preexec` hook (zsh's usual setup) rewrites it to the **first word of the command line**, and both halves are launched `cd <worktree> && …`, so the title reads `cd` for the whole of their lives. **Measured on the live cockpit 2026-09-02** (T07): a pane running revdiff reported the title `cd` while `ps` reported `S+ revdiff`; an idle shell reported its cwd. The original measurement was taken against a headless mux whose bare shell set no title at all, where WezTerm falls back to the process name — a fallback that never happens on a real machine |
| The agent is reaped while its pair is parked | Dispose **both** panes and drop its tab list | Otherwise parked panes and stale state accumulate for the life of the window |
| Two pushes land together (an agent and you) | Take a lock around the read-modify-write of the tab list; break a stale lock at 5s | The agents share these files with you. Uses the agenda store's exported `withLock` (§3.5), not a third copy |
| A push **fails part-way through its keystrokes** | Send no more, update no tab list, and **leave the cursor in the tree** (§2.4) | Focus follows a file that opened, and here none did. The failure leaves micro's command bar open with a half-typed command in it, so arriving there means a live command bar, in a program the user may not know, with nothing to show for it. Staying in the tree keeps the damage to one missing file. A *refused* push — no viewer, no such file — likewise activates nothing: there is no viewer pane to go to |
| The **focus move itself** fails — a dead pane, no `wezterm` on PATH | Swallow it. Exit 0, nothing on stderr, the tab list written as normal | The push landed and the file is open; turning a delivered file into exit 1 over the cursor is the worse trade. `cockpit-open`'s whole interface is exit 0, or exit 1 plus one line |
| A pushed file has since been deleted | Send nothing, report it on stderr | micro would open an empty buffer named after a file that does not exist |
| The tab list and micro disagree (micro restarted underneath us) | The list is reset whenever the viewer is launched, never merged | A wrong `tabswitch <n>` jumps to the wrong file silently; a duplicate tab is merely untidy |

---

## 3. Architecture

### 3.1 The boundary

```
bin/cockpit-open-model.mjs   pure — given the open-tab list and a request, returns the
                             keystroke payloads and the new list. No fs, no wezterm, no clock.
bin/cockpit-open.mjs         shell — reads state, calls the model, sends bytes, writes state.
bin/cockpitd.mjs             shell — owns every pane swap, as it already does.
```

This mirrors the split this repo already uses for the agenda (`cockpit-agenda-model.mjs` /
`cockpit-agenda.mjs`). **What enforces it:** `spikes/browse-test/run.sh` asserts that
`cockpit-open-model.mjs` imports nothing from `node:fs`, `node:child_process` or
`node:os`. If that test fails the fix is to **move the code, never to relax the test**.

Everything on the pure side is testable exhaustively in milliseconds; every rule that leaks
across becomes a rule only a person with a terminal can check.

**The browser IS in the diff slot, beside the viewer.** *(Reversed at plan review, 2026-08-29.)*

The first draft of this design put broot in a terminal and argued that broot *and* micro in the
slot "would make every agent switch a two-pane dance". That is true, and it is also the whole
cost — the dance is **one extra `wezterm cli` call in each direction**, not a broken invariant.
It was rejected without being measured; measured, it works:

```
pair in slot   broot 47x18   micro 72x18       parked   (their own tab)
restored       broot 47x18   micro 72x18       <- identical geometry
```

micro came back with its file and `[ro]` intact; broot came back drawing. FINDINGS has the run.

**Why the reversal is right, not merely possible.** The terminal version needed a `browse`
command, published on a cockpit-only PATH, that the user had to remember and type — a second
place to start a mode that already has a gesture. The user's requirement is one switch that
arrives complete (§1). Putting the browser where the mode already lives deletes the command, the
symlink, its PATH publication and the whole class of "you pressed `⌥]` but nothing is feeding
the viewer" states.

**What is genuinely given up:** the diff slot no longer holds exactly one pane per agent, so
every place that assumes "one pane, one agent" has to be found (T05), and an agent switch out of
browse mode costs two parks instead of one. The geometry rule itself is untouched — the incoming
occupant is still split *into* the outgoing one, which is what makes it inherit the slot.

### 3.2 Modules

| Module | Owns | Depends on |
|---|---|---|
| `bin/cockpit-open-model.mjs` | the open/tab/tabswitch decision, path relativisation | nothing |
| `bin/cockpit-open.mjs` | viewer pane lookup, tab-list persistence + lock, sending | the model, `wezterm cli`, the agenda store's `withLock` |
| `bin/cockpit-browse-verbs.hjson` | the Enter verb only | — |
| `bin/cockpitd.mjs` | the fourth mode, launching **both** halves, pair park/restore, healing, reaping | wezterm |

There is **no `bin/cockpit-browse.sh`**. The daemon launches broot itself when the agent enters
browse mode, so there is nothing to publish on a PATH and nothing to type. The `--conf` chain and
the `PATH`/`COCKPIT_REPO` that the verb's `cockpit-open` needs are named on the daemon's
`split-pane` command line — a split inherits **no** environment (`CLAUDE.md`), so this is the
same `/usr/bin/env` shape the terminals already use.

### 3.3 The decision function

```js
// cockpit-open-model.mjs
export function planPush({ openTabs, file, line, repoRoot })
// openTabs : string[]  repo-relative paths, in tab-bar order, as WE last sent them
// file     : string    absolute or relative path of the file being opened
// line     : number|null
// repoRoot : string
// returns  : { payloads: string[], openTabs: string[], rel: string }
//            payloads are sent in order, verbatim, one send-text each.
```

A function of its arguments and nothing else. It never asks micro what is open (§2.5) and
never touches the filesystem — the caller resolves and checks the path.

### 3.4 Data flow

```
broot (a terminal)  --Enter-->  cockpit-open <file> <line>
                                   | reads panes.json .viewer / .viewerAgent / .viewerRoot
                                   | reads viewer-tabs.json (under lock)
                                   | planPush(...)
                                   v
                                wezterm cli send-text --pane-id <viewer> --no-paste
                                   |
                                   v
                                micro in the diff slot
```

`cockpitd` publishes **three keys together** into `panes.json`, all of them set while the
**attached** agent is in browse mode and all of them `null` otherwise:

| Key | Value | Why the glue needs it |
|---|---|---|
| `viewer` | the viewer's pane id | where to send the keystrokes |
| `viewerAgent` | that agent's **jobId** | the key into `viewer-tabs.json` (§3.5) |
| `viewerRoot` | that agent's **worktree** | `repoRoot` for the model, so tab labels are short |

The glue reads them and refuses when `viewer` is null (§2.n).

*Why an explicit `viewer` key rather than reusing `.diff`:* `.diff` is whatever occupies the
slot, which is usually revdiff. A separate process cannot safely infer which. Publishing it
makes the daemon the single authority, as it already is for every pane swap.

*Why `viewerAgent` rather than reading `terminals.json`:* `terminals.json` carries `agent`, but
that field holds the agent's **display name** (`writeTerminals`: `attached?.name ?? visibleKey`),
not its jobId — and `viewer-tabs.json` is keyed by jobId, as is every reap path in the daemon.
Keying the tab list by name would mean the entry a reap tries to drop never matches the one a
push wrote, so tab lists would leak for the life of the window. Names are also only required to
be *unique*, never stable.

*Why `viewerRoot` rather than reusing `panes.json.repo`:* `.repo` is whatever directory the
layout script was launched with — the **projects root** (measured on this machine:
`/Users/jan.krolikowski/src`), not a repo root. Relativising against it yields
`agentic-ide/.claude/worktrees/<name>/bin/cockpitd.mjs` on a tab label, which is exactly the
unreadable-tab problem §2.2 exists to avoid. The agent's worktree is the directory micro is
already launched in (§2.2), so it is the only correct base.

All three are written by the same `publishPanes()` call, so a reader never sees a pane id
without the agent and root that go with it.

*Why a file and not an environment variable:* a `wezterm cli split-pane` inherits **no**
environment — the mux server's env dates from whenever WezTerm started. Already documented in
`CLAUDE.md`; it applies here exactly.

### 3.5 Storage

| Path | Contents | On crash mid-write |
|---|---|---|
| `~/.claude/cockpit/viewer-tabs.json` | `{ "<jobId>": ["bin/a.mjs", "docs/b.md"] }` | written to a temp file and renamed, as `panes.json` and `terminals.json` already are |
| `~/.claude/cockpit/viewer-tabs.lock` | held across read-modify-write; stale-broken at 5s, using the **agenda store's exported `withLock`**, not a third copy (T02) | same rule and same 5s as `notes.lock` |
| `~/.claude/cockpit/panes.json` | gains `viewer`, `viewerAgent`, `viewerRoot` (§3.4) | existing atomic write |

Never in the repo. A file written into the worktree appears in `revdiff --untracked HEAD` —
the very diff the agent is being reviewed on.

---

## 4. Testing

| Layer | Proves | Cannot prove |
|---|---|---|
| `spikes/browse-test/run.sh` (new) | the model's decisions, exhaustively; the boundary import check; the glue's refusals and locking against a stubbed `wezterm` | that any of it draws correctly |
| `spikes/cockpit-test/run.sh` (existing, must stay green) | the daemon's mode cycling, park/restore and healing, with `wezterm` stubbed | the same |
| `spikes/browse-mode/` (T00, headless mux) | that the slot can alternate revdiff and the browser+viewer pair, with real geometry, for two agents at once | what it looks like |

None of them prove the thing is usable. That is §5.1.

---

## 5. Environment — read this before running anything

**This plan is built in a worktree, not on `main`.** `CLAUDE.md § Where sessions run` is
suspended for its duration by the user's decision of 2026-08-29: work, commit and push on
`worktree-browse-mode-review` in `.claude/worktrees/browse-mode-review`, and leave `main` alone.
The full rule, and the trap it creates for T07's live check, are at the top of
[PROGRESS.md](PROGRESS.md). Folding back is the user's decision, never a session's.

| | |
|---|---|
| OS | macOS 26.5.1 (25F80), Apple Silicon |
| Runtime | node v24.2.0 |
| Toolchain | wezterm 20240203-110809-5046fc22 (+ `wezterm-mux-server`), git 2.50.1 |
| New dependencies | **micro 2.0.15**, **broot 1.59.0** — both installed during planning, both single binaries from Homebrew. **Both are hard prerequisites** (decided at plan review): `install.sh` refuses without them and `cockpit-layout.sh` guards on them, exactly like the five that came before. With `micro` absent the top pane would sit at a failed command that the 1 s healer retries forever — a warning is not enough. T03 |
| Also present | revdiff v1.12.0, ripgrep, fzf, bat, fd |
| **Deliberately absent** | No IDE, no GUI editor, no tmux. `timeout(1)` **does not exist** on this machine — scripts must not use it. `micro` is the editor; `helix`/`vim` are rejected as modal |

**The test command.**

```
spikes/browse-test/run.sh && spikes/cockpit-test/run.sh
```

`spikes/browse-test/run.sh` does not exist until **T01 creates it**; until then the test
command is `spikes/cockpit-test/run.sh` alone. Every task from T01 onward runs both.

**It is the only evidence a session may produce on its own.** `spikes/notes-test/run.sh` and
`spikes/agenda-test/run.sh` belong to other features and must also stay green if a shared file
is touched.

**Dependencies.** No new runtime dependencies beyond micro and broot, both already installed.
No npm packages: this project has no `package.json` and is not acquiring one. Anything else
is a decision for the user, not a session.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| That the split *looks* right — browser left, viewer right | Nothing here can see a screen |
| That `⌥[`/`⌥]` actually reach the daemon, **from both halves** | The stub tests the daemon's reaction to a verb, not WezTerm's delivery of the keystroke |
| That `⌥p`/`⌥o` still work in broot inside WezTerm | macOS and WezTerm both sit between the key and the app — and the cockpit now adds its own file to the same `--conf` chain those keys come from |
| That the redraw on return from parking is acceptable rather than merely correct | A judgement, not an assertion |
| ~~That **60/40 is the right split**~~ **Answered 2026-09-02: it was not.** The user judged the tree too wide and it now matches revdiff at 80/20 | Legible was measured; comfortable is a judgement — and the judgement went against the measured number, which is why the row existed |

Every row belongs to **T07**, and T07 asks all of them.

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| `micro -readonly true` | always on | the agent's files cannot be modified from the viewer |
| headless `wezterm-mux-server` with its own socket + pid file | used by every pane spike | probes never touch the live cockpit window |
| `cockpit-open` refuses unless `panes.json.viewer` is set | always | keystrokes can never be typed into a revdiff pane, where each one is a keybinding |

**Never ask the user to run a probe against their live cockpit window to find something out,
and never do it yourself.** Every pane experiment goes to a headless mux.

---

## 6. Recovery

- **The viewer or the browser is stuck or wrong.** `⌥[` back to `uncommitted`; the slot returns
  to revdiff and the pair is parked, not lost. `⌥]` back into browse brings both back.
- **Either half is a bare shell.** The daemon heals that half within a second, leaving the other
  alone. If it does not, re-open the WezTerm window — the supported way to rebuild everything.
- **broot behaves oddly.** The cockpit's verb layer is a separate file passed with `--conf`;
  the user's own `~/.config/broot/` is never written to by the cockpit. Removing
  `bin/cockpit-browse-verbs.hjson` from the `--conf` list restores stock broot.
- **Tab state is confused.** Delete `~/.claude/cockpit/viewer-tabs.json`; it is a cache of
  what we sent, and the next relaunch resets it anyway.

---

## 7. Decisions and rationale

| Date | Decision | Alternative, and why it lost |
|---|---|---|
| 2026-08-29 | Browse is a **fourth stop** in the `⌥[`/`⌥]` cycle | Its own key was recommended, on the grounds that browsing is not an answer to "which changes am I looking at" and would be passed through on the way between modes. **The user chose the fourth stop having heard that.** §2.6 exists because of the consequence. |
| 2026-08-29 | Viewer parks rather than restarts | Killing and relaunching matches the other three modes, but empties the tab bar on every pass through the cycle, which makes tabs pointless |
| 2026-08-29 | ~~broot in a **terminal**, micro in the diff slot~~ | ~~Both in the diff slot was the user's first instinct; it breaks the "park exactly one pane" invariant that keeps agent switching cheap~~ **Reversed at plan review the same day — see the next row.** |
| 2026-08-29 *(plan review)* | **Both in the diff slot: browser left, viewer right.** Entering browse mode splits the top pane in two; there is no `browse` command and nothing is typed | The user's first instinct, restored. The plan-review session put the two-pane cost to them plainly and they chose it anyway, then it was **measured**: the pair parks and restores at identical geometry (§2.6, §3.1, FINDINGS). The "breaks the invariant" objection had been asserted, never tested; the real cost is one extra `wezterm cli` call per direction. It also deletes the `browse` command, its symlink and its PATH publication — a second place to start a mode that already had a gesture |
| 2026-08-29 *(plan review)* | `⌥[`/`⌥]` work from **either** half of the slot | Gating on a single diff pane id would trap the user in the browser, which is exactly where focus deliberately starts. §2.1 |
| 2026-08-29 *(plan review)* | ~~The split is **`--percent 60`** to the viewer — browser 47 columns, viewer 72, on a 120-column window~~ | ~~47 is the width broot was already measured usable at during planning~~ **Overturned at T07 — see the next row. The question was asked of T07 deliberately and T07 answered it.** |
| 2026-09-02 *(T07)* | The split is **`--percent 80`** to the viewer, so the tree matches **revdiff's own file list** | **The user saw 60 in a real cockpit and judged the tree too wide**, asking for it to be as wide as revdiff's browser. revdiff's `--tree-width` is *"units (1-10, default 2 of 10)"* — a **share**, not a column count — so ours is a share too and keeps matching at every window size; measured live, revdiff's box was 65 of 319 columns (20.4%). The old reasoning ("47 is a width broot was validated usable at") missed that this tree sits where revdiff's tree sits and is read the same way: looking like it beats a width measured on its own |
| 2026-09-03 *(T07 → T11)* | **Enter takes the cursor to the reader**, reversing "a push never takes focus" | The old rule was measured working and then **judged wrong by the user driving it**: browse mode is for reading a file, and every Enter needed a second gesture before the file could be read. Option B — `Alt+Enter` to stack a tab without moving — was offered and declined **twice**: on 2026-09-03 without the evidence (no tab bar had been seen), and again on **2026-09-04** with one driven by hand, which **closes** it rather than deferring it. The return trip needs nothing new: `⌘⌥←` is a cockpit-wide pane move that predates browse mode, and the footer gains no label (it only just fits four modes as it is) |
| 2026-08-29 | **broot + micro** rather than `revdiff --all-files` | revdiff's own browse mode has an identical look and keeps annotations, but: no directory folding (2,251 rows on a real repo), **6–12 s** to open that repo against broot's instant, and its search covers only the currently-open file. broot folds, opens instantly and searches across files |
| 2026-08-29 | You **cannot comment** on a browsed file | A second broot key opening the file in revdiff would close the loop, and is the better end state. The user chose to leave it: it introduces a fifth diff-slot state that is not a stop in the cycle, and muddies the model just decided. See §8 |
| 2026-08-29 | The cockpit ships its **own** broot verb file, layered with `--conf` | Editing the user's `~/.config/broot/verbs.hjson` would fight their own settings. Measured: `--conf a;b;c` **layers**, it does not replace |
| 2026-08-29 *(T03 review)* | The cockpit's file goes **first** in the chain | "Ours last, so ours wins" was assumed and is **backwards**: broot takes the first verb that matches, across the whole chain, so the earlier file wins — measured both ways round. Shipped last, an `enter` the user had bound themselves would silently beat the cockpit's and no push would ever happen. Costs their config nothing: our file holds only verbs and binds only `enter` |
| 2026-08-29 *(T03 review)* | Enter on a **non-text** file opens broot's own preview panel (`internal: panel_right`) | **The user chose this**, having been shown that `apply_to: text_file` left images and compiled artifacts falling through to macOS, which opens a GUI app over the terminal. Alternatives offered: do nothing at all (quietest), or push it into micro anyway (shows gibberish). The catch-all is `apply_to: file`, not `binary_file` — an unreadable file is neither text nor binary and only the general kind caught it |

---

## 8. Explicitly out of scope

- **Commenting on a browsed file.** Declined 2026-08-29, above. If it is revisited, the shape
  is a second broot key running `revdiff --only={file}` — *not* an annotation feature bolted
  onto micro.
- **Editing.** The viewer is read-only by design (§2.2). A general editor in the cockpit is a
  separate question and `micro` is already installed if the answer is ever yes.
- **Find-and-replace across files.** Its own tool; `scooter` was surveyed in
  `ideas/terminal-find-in-files.md` and deliberately deferred there.
- **Repairing `ff` / `fp`.** They are dangling symlinks into a deleted job directory
  (see FINDINGS). Whether broot replaces them is a separate decision for the user.
- **Changing the notes column or anything in the fleet pane.** Untouched.
- **A `browse` command.** Removed at plan review: the browser now arrives with the mode, so there
  is nothing to type and nothing to publish on a PATH. If a second browser somewhere else is ever
  wanted, it is a new decision, not a leftover.
- **A second browser, or browsing a repo other than the attached agent's.** One pair per agent,
  rooted at that agent's worktree.
- **The agenda**, beyond `withLock` gaining a lock-file argument (§3.5, T02). Its behaviour,
  files and tests are unchanged and `spikes/agenda-test/run.sh` must stay green.
