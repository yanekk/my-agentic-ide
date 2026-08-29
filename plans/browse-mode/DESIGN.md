# Browse mode — Design

> Read before changing any behaviour here. Every rule carries its reason; a rule without one
> gets overturned by the first session that finds it inconvenient.

## 1. Purpose

The cockpit can only show you files the agent **changed**. `revdiff --untracked HEAD` is a
diff, so an unchanged file is invisible — you cannot read the function the agent called, only
the line that calls it. Browse mode adds a fourth stop to the diff-slot cycle that turns the
top pane into a **tabbed, read-only file viewer**, fed by a **file browser running in one of
your terminals**. Files you open accumulate as tabs and survive cycling away.

For the one person who runs this cockpit. Not a general-purpose editor and not a second IDE.

### Success criteria

- `⌥]` from `custom` lands on `browse`; the top pane becomes a file viewer.
- Pressing Enter on a file in the browser makes it a tab in that viewer, without spawning a
  second editor and **without taking focus away from the browser**.
- A `c/` content search in the browser followed by Enter lands on the **matching line**.
- Cycling to another mode and back returns the viewer with **every tab still open**, its
  cursor where it was.
- Files cannot be modified from the viewer.

### Stance

- **Reading, not editing.** The viewer is read-only. The agent's working tree is the agent's;
  a stray keystroke must not become a change the agent then has to explain.
- **Nothing is restarted that can be parked.** The cockpit's whole promise is that returning
  is instant. Browse mode obeys it or it is not worth having.
- **The browser is not in the diff slot.** See §3.1 — this is load-bearing, not a detail.

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

### 2.2 The viewer

`micro -readonly true`, occupying the **diff slot** — the same full-width pane revdiff uses.

- **Read-only is not cosmetic.** Every buffer shows `[ro]`. Without it the viewer is an editor
  pointed at the agent's worktree, and an accidental save becomes a diff the agent must
  account for.
- **Started with no file.** micro with no argument opens an empty `No name` buffer. The first
  push therefore uses micro's `open` command (replacing that buffer) and every later push uses
  `tab` (adding one). Otherwise the tab bar carries a permanent empty first tab.
- **Tab labels are whatever path is passed**, so paths are made **repo-relative** before
  sending. Absolute paths fill the bar with `/Users/...` and nothing is readable.

### 2.3 The browser

`broot`, run in a **cockpit terminal** via a `browse` command, never in the diff slot.

- Measured usable at **47 columns**, the attached agent's terminal width: tree, folder
  structure and content-search snippets all readable.
- Because terminals are already per-agent and already keep running while parked, the browser
  is per-agent and survives switching **for free**. `⌥t` gives you a second one if you want
  two places in the tree at once.

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

Focus is never taken: measured, the browser pane stayed active through every push and kept
its filter text.

### 2.5 Already-open files

Pushing a file that is already open must **switch to its tab**, not open a second copy. micro
has `tabswitch <n>` (1-based, in tab-bar order). The glue therefore remembers the ordered list
of files it has pushed per agent (§3.5) and decides between `open` / `tab` / `tabswitch` from
that list alone (§3.3).

*Why remembered rather than asked:* micro has no way to report its open buffers, so the only
available source of truth is what we ourselves sent.

### 2.6 Parking, not restarting

Cycling **out** of browse parks the viewer pane; cycling **back in** restores it. This differs
from the other three modes, which quit revdiff and relaunch it, because `R` only reloads the
same range.

*Why the difference:* browse is a stop in a four-way cycle, so it is passed through
constantly. Killing micro on the way past would empty the tab bar every time and make tabs
pointless — which is the entire feature. Measured: a parked micro returns with all tabs, the
cursor on the same line, `[ro]` still set, and the pane at identical geometry.

**Consequence, stated plainly:** the diff slot's parking area now holds **up to two panes per
agent** — that agent's revdiff and that agent's viewer — where it held one. The slot itself
still holds exactly one pane at a time, so the "park exactly one, split the incoming into it"
invariant is untouched. T00 exists to prove that before any of it is built.

### 2.7 What the strip shows

`terminals.json` already carries the visible agent's `diffMode` and the strip renders it. It
must render `browse` too, and the footer legend must not imply only three modes exist.

### 2.n The unhappy paths

| Situation | Rule | Why |
|---|---|---|
| `browse` run while the diff pane is **not** in browse mode | Refuse with a one-line hint naming the gesture; change nothing | Pushing into a revdiff pane would type the command into revdiff, where every character is a keybinding |
| `browse` run with **no agent attached** | Refuse the same way | Diff modes are per agent; with nothing attached the top pane is the greeting/notes pane |
| The user quits micro (`Ctrl+Q`) | The diff pane drops to a shell; heal it by relaunching the viewer, exactly as `healQuitDiff` reinstates revdiff — **and reset that agent's tab list**, because the tabs are gone | A bare shell in the diff slot reads as the cockpit having broken |
| Healing races a still-painting micro | Same cooldown guard as `healQuitDiff` | micro looks like a shell for a moment while it starts |
| The agent is reaped while its viewer is parked | Dispose the viewer pane and drop its tab list | Otherwise parked panes and stale state accumulate for the life of the window |
| Two pushes land together (an agent and you, or two terminals) | Take a lock around the read-modify-write of the tab list; break a stale lock at 5s | Same reasoning and same 5s as `notes.lock` — the agents share these files with you |
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

**The browser is not in the diff slot.** The diff slot swaps by parking *exactly one* pane and
splitting the incoming one into it — the documented reason the notes column is *drawn* rather
than being a real pane. broot *and* micro in that slot would make every agent switch a
two-pane dance. Putting broot in a terminal costs nothing: that slot already exists, already
parks, and is already per agent.

### 3.2 Modules

| Module | Owns | Depends on |
|---|---|---|
| `bin/cockpit-open-model.mjs` | the open/tab/tabswitch decision, path relativisation | nothing |
| `bin/cockpit-open.mjs` | viewer pane lookup, tab-list persistence + lock, sending | the model, `wezterm cli` |
| `bin/cockpit-browse.sh` | launching broot with the cockpit's verb layer | broot |
| `bin/cockpit-browse-verbs.hjson` | the Enter verb only | — |
| `bin/cockpitd.mjs` | the fourth mode, viewer park/restore, healing, reaping | wezterm |

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
                                   | reads panes.json .viewer
                                   | reads viewer-tabs.json (under lock)
                                   | planPush(...)
                                   v
                                wezterm cli send-text --pane-id <viewer> --no-paste
                                   |
                                   v
                                micro in the diff slot
```

`cockpitd` publishes `viewer` into `panes.json`: the viewer's pane id while the **attached**
agent is in browse mode, and `null` otherwise. The glue reads it and refuses when it is null
(§2.n).

*Why an explicit `viewer` key rather than reusing `.diff`:* `.diff` is whatever occupies the
slot, which is usually revdiff. A separate process cannot safely infer which. Publishing it
makes the daemon the single authority, as it already is for every pane swap.

*Why a file and not an environment variable:* a `wezterm cli split-pane` inherits **no**
environment — the mux server's env dates from whenever WezTerm started. Already documented in
`CLAUDE.md`; it applies here exactly.

### 3.5 Storage

| Path | Contents | On crash mid-write |
|---|---|---|
| `~/.claude/cockpit/viewer-tabs.json` | `{ "<jobId>": ["bin/a.mjs", "docs/b.md"] }` | written to a temp file and renamed, as `panes.json` and `terminals.json` already are |
| `~/.claude/cockpit/viewer-tabs.lock` | held across read-modify-write; stale-broken at 5s | same rule and same 5s as `notes.lock` |
| `~/.claude/cockpit/panes.json` | gains `viewer` | existing atomic write |

Never in the repo. A file written into the worktree appears in `revdiff --untracked HEAD` —
the very diff the agent is being reviewed on.

---

## 4. Testing

| Layer | Proves | Cannot prove |
|---|---|---|
| `spikes/browse-test/run.sh` (new) | the model's decisions, exhaustively; the boundary import check; the glue's refusals and locking against a stubbed `wezterm` | that any of it draws correctly |
| `spikes/cockpit-test/run.sh` (existing, must stay green) | the daemon's mode cycling, park/restore and healing, with `wezterm` stubbed | the same |
| `spikes/browse-mode/` (T00, headless mux) | that two panes really can alternate in the slot, with real geometry | what it looks like |

None of them prove the thing is usable. That is §5.1.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS 26.5.1 (25F80), Apple Silicon |
| Runtime | node v24.2.0 |
| Toolchain | wezterm 20240203-110809-5046fc22 (+ `wezterm-mux-server`), git 2.50.1 |
| New dependencies | **micro 2.0.15**, **broot 1.59.0** — both installed during planning, both single binaries from Homebrew |
| Also present | revdiff v1.12.0, ripgrep, fzf, bat, fd |
| **Deliberately absent** | No IDE, no GUI editor, no tmux. `timeout(1)` **does not exist** on this machine — scripts must not use it. `micro` is the editor; `helix`/`vim` are rejected as modal |

**The test command.**

```
spikes/browse-test/run.sh && spikes/cockpit-test/run.sh
```

**It is the only evidence a session may produce on its own.** `spikes/notes-test/run.sh` and
`spikes/agenda-test/run.sh` belong to other features and must also stay green if a shared file
is touched.

**Dependencies.** No new runtime dependencies beyond micro and broot, both already installed.
No npm packages: this project has no `package.json` and is not acquiring one. Anything else
is a decision for the user, not a session.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| That the viewer *looks* right in the diff slot | Nothing here can see a screen |
| That `⌥[`/`⌥]` actually reach the daemon | The stub tests the daemon's reaction to a verb, not WezTerm's delivery of the keystroke |
| That `⌥p`/`⌥o` work in broot inside WezTerm | macOS and WezTerm both sit between the key and the app |
| That the redraw on return from parking is acceptable rather than merely correct | A judgement, not an assertion |
| That 47 columns is *comfortable* as well as legible | Same |

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

- **The viewer is stuck or wrong.** `⌥[` back to `uncommitted`; the slot returns to revdiff.
- **The diff pane is a bare shell.** The daemon heals it within a second. If it does not,
  re-open the WezTerm window — the supported way to rebuild everything.
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
| 2026-08-29 | broot in a **terminal**, micro in the diff slot | Both in the diff slot was the user's first instinct; it breaks the "park exactly one pane" invariant that keeps agent switching cheap |
| 2026-08-29 | **broot + micro** rather than `revdiff --all-files` | revdiff's own browse mode has an identical look and keeps annotations, but: no directory folding (2,251 rows on a real repo), **6–12 s** to open that repo against broot's instant, and its search covers only the currently-open file. broot folds, opens instantly and searches across files |
| 2026-08-29 | You **cannot comment** on a browsed file | A second broot key opening the file in revdiff would close the loop, and is the better end state. The user chose to leave it: it introduces a fifth diff-slot state that is not a stop in the cycle, and muddies the model just decided. See §8 |
| 2026-08-29 | The cockpit ships its **own** broot verb file, layered with `--conf` | Editing the user's `~/.config/broot/verbs.hjson` would fight their own settings. Measured: `--conf a;b;c` **layers**, it does not replace |

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
- **Changing the notes column, the agenda, or anything in the fleet pane.** Untouched.
