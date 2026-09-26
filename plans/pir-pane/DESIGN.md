---
setup: none
test:
  - "[ ! -e spikes/pir-pane-test/run.sh ] || bash spikes/pir-pane-test/run.sh"
  - bash spikes/cockpit-test/run.sh
---

# The pir dashboard in the Claude pane — Design

## 1. Purpose

The cockpit's bottom-left pane runs `claude agents`, and entering an agent there points the
diff, browse mode and terminals at that agent's worktree. Work driven by `pir` (the
plan-implement-review engine, `~/src/plan-implement-review`) happens in headless worker
sessions the fleet view never lists, so today the cockpit cannot review it. This plan makes the
`pir` dashboard a second program that the same pane can show, switched from the footer, and
makes the cockpit follow whatever run or worker is open in it exactly as it follows an agent.

The person reviews pir's output the same way they review an agent's: open it, read the diff,
browse the tree, poke around in a terminal at its folder, go back.

### Success criteria

- Clicking `PIR` in the footer at the fleet list shows the pir dashboard in the Claude pane;
  clicking `Claude Agents` at pir's runs list brings `claude agents` back, instantly, in the
  state it was left in.
- Opening a run in pir shows that plan's shared worktree as a diff against `main`; opening one
  of its workers narrows to that task's worktree at `uncommitted`; backing out widens again, and
  the runs list returns the notes view and the repo terminals.
- Nothing about `claude agents` changes while it is the program shown.
- `pir` run anywhere outside the cockpit behaves exactly as it does today.

### Stance

pir tells the cockpit what is open through a file it is asked to write; the cockpit never
scrapes pir's screen for it. pir's headers name no path, and CLAUDE.md's pane-title row is the
record of what reading a screen for state costs.

---

## 2. Behaviour specification

### 2.1 The switch

The footer carries a segment `Claude Agents | PIR`, the shown program in reverse video, the
same style as the diff-mode labels. Clicking a label appends `fleet-claude` or `fleet-pir` to
`~/.claude/cockpit/cmd`; the daemon owns the swap. There is no key binding: the person chose
click-only (2026-09-26), which leaves `⌥[`/`⌥]` routing untouched.

The segment is drawn whether or not an agent or run is attached, because the switch is about
the pane, not about a diff. If `pir` is not on the daemon's `PATH` at start the segment is not
drawn at all, since a label that can never work is noise.

### 2.2 When switching is allowed

Only when the shown program is on its list screen: `claude agents` showing its fleet list
(`LIST_MARKER`), or pir's reported view is `list` (§2.4). Otherwise the segment is drawn dim and
clicks on it are ignored, and the daemon refuses a stray verb with a log line. The person
decided this (2026-09-26); it means a switch always happens with nothing attached, so the
cockpit is already on the welcome/notes pane and the repo terminals and a switch never has to
decide what to do with an attached diff.

The parked program is always on its list too, because it could only have been parked from
there and nothing can type into a parked pane.

### 2.3 Both programs keep running

The pir pane is spawned the first time `fleet-pir` is accepted, not at layout time, so a person
who never uses it pays nothing. From then on the two panes are swapped like diffs: the incoming
pane is split into the outgoing one and the outgoing one is parked (`move-pane-to-new-tab`),
never killed. Restarting either costs seconds and loses its scroll and selection, the same
reason diffs are parked (CLAUDE.md, "Panes are moved, never restarted").

Every rebuild of the cockpit starts on `claude agents`. Which program was shown is session-only
state, like the diff mode.

The pir pane runs `bin/cockpit-pir.sh`, a relaunch loop around `pir` with
`PIR_DASHBOARD_STATE` set (§2.4). pir quits on Esc and Ctrl+C, and a pane that exits would be
closed; the loop is the same fix `claude agents` has in `cockpit-layout.sh`. After five exits
inside two seconds each it stops looping and waits for Enter, printing why, rather than
spinning; it never `exec`s away, so the pane survives.

### 2.4 What pir reports (the contract)

pir gains one opt-in behaviour, built by a separate pir plan whose prompt is
[PIR-PROMPT.md](PIR-PROMPT.md). When `PIR_DASHBOARD_STATE` names a file, the dashboard keeps
that file current; when it is unset, pir writes nothing and behaves as today.

```json
{
  "version": 1,
  "pid": 12345,
  "view": "list",
  "run": null,
  "worker": null,
  "updatedAt": "2026-09-26T21:00:00.000Z"
}
```

- `view`: `list` (runs list), `run` (one run's watch view), `worker` (one worker's
  conversation).
- `run` (non-null in `run` and `worker`): `{ key, kind, slug, repo, repoPath, branch, cwd }`.
  `key` is pir's `{repo}__{slug}`; `kind` is `plan` or `work`; `cwd` is the absolute path of the
  run's shared worktree (for a build `{main}/.claude/worktrees/pir-{slug}`, for a planning run
  its planning worktree), or `null` when it does not exist.
- `worker` (non-null in `worker`): `{ id, task, role, cwd }`. `cwd` is the worker's worktree as
  pir recorded it when spawning, or `null`.
- Written temp-then-rename in the same directory on start, on every change of view, open run
  or open worker, and when a shown path changes; removed on a clean exit.

The cockpit reads it defensively. A missing file, one that fails to parse, an unknown
`version`, or a `pid` that is not alive (a crashed pir leaves its last file behind) all read
as `list`. An old pir without the change therefore degrades to a switchable pane that the
cockpit never follows, which is safe. The file is `~/.claude/cockpit/pir-dashboard.json`, and
`cockpit-layout.sh` deletes it on every rebuild, as it empties `cmd`.

### 2.5 Following pir

While pir is shown, the file is the only source of truth. The daemon watches its directory
(CLAUDE.md, "Watch the directory, never the file") and maps it through the pure decision
`decidePir` (§3.3):

| Reported | The cockpit shows |
|---|---|
| `list` | welcome/notes pane and the repo terminals, as at the fleet list |
| `run`, `run.cwd` exists | key `pir.{run.key}`, folder `run.cwd` |
| `worker`, `worker.cwd` exists | key `pir.{run.key}.{worker.id}`, folder `worker.cwd` |
| `worker`, `worker.cwd` gone, `run.cwd` exists | the run's key and folder |
| a folder that is not a git work tree, or nothing left | welcome/notes pane, logged |

Following the depth was the person's choice (2026-09-26): a run is the whole plan, a worker is
one task. The fallback exists because pir removes a task's worktree after merging it, and a
worker conversation stays readable after that; showing the run is the nearest folder that still
exists.

A key is attached through the same path an agent is: `showDiff`, `showTerminal`, the watches,
browse mode, parking on leave. So each run and each worker has its own diff mode and its own
terminals, all parked and resumed exactly like an agent's. Keys are prefixed `pir.` so they can
never collide with a `claude agents` job id and so every pir-only rule can test for them.

### 2.6 The starting diff mode

A run key starts in `custom` against `main`, without opening the ref prompt; a worker key
starts at `uncommitted`, like an agent. A run's shared worktree has finished tasks merged in as
commits and usually nothing uncommitted, so `uncommitted` would open onto an empty diff; the
whole plan's work against `main` is what reviewing a run means. The person chose this
(2026-09-26).

If `custom-refs.json` already holds a ref for the run key, that ref is used instead of `main`,
because the person set it deliberately. If the ref does not resolve in that repo the key falls
back to `uncommitted` with a log line, not the prompt, since nobody asked for a prompt.

### 2.7 Reviews are inert under pir

With a pir key attached, revdiff is still launched with `-o review-{key}.md`, because without
an output file revdiff's flush prints to stdout and quits. The daemon neither injects nor
resets that file: it logs `review not sent: pir has no input box` and the annotations stay in
revdiff. `focus-claude` is ignored while pir is shown, because it would activate a parked pane
and fill the window with it. The person chose to leave reviews out for now (2026-09-26); pir's
worker input sends on Enter, and proving a multi-line draft can sit there unsent is a later
plan.

### 2.8 The BitBucket buttons

`bb-review` and `bb-address` type into `claude agents`' new-session box (`spawnAgent`). They are
only clickable on the welcome pane, which only shows at a list, so the switch is always
allowed at that moment. With pir shown, the daemon switches to `claude agents` first and then
spawns, so one click still launches the agent and the person sees it start (chosen 2026-09-26).
If the switch fails the spawn is dropped and logged, because typing into pir would send
keystrokes to its dashboard.

### 2.9 What stays claude-only

`reconcile()`, the fleet-log tail, `followWorktreeMigration` and the reaper's `claude agents
--json` check all concern `claude agents`. While pir is shown the reconcile poll does nothing;
the parked fleet pane is at its list and cannot change. `followWorktreeMigration` and the agent
reaper skip `pir.` keys. pir keys are reaped instead when their folder no longer exists and the
key is not the one shown, which is when pir has removed a worktree after a merge.

### 2.10 The pane's identity

The daemon uses `panes.fleet` in two roles: the pane running `claude agents`, and the landmark
for finding the cockpit tab and for anchoring splits and focus. Once `claude agents` can be
parked, the landmark role moves to `panes.foot`, which is never parked, and anchors and focus
use the pane currently in the fleet slot (`slotFleetPane()`). Leaving any landmark on a
parkable pane makes the daemon treat a parked tab as the cockpit.

### 2.11 The unhappy paths

- pir quits or crashes while a run is open: the relaunch loop brings it back at its list, the
  new file says `list`, and the cockpit detaches. Until then the stale file's dead pid reads as
  `list`.
- The file names a folder in another repo: followed anyway. pir lists every repo on the machine,
  and nothing about the diff machinery is tied to the cockpit's own repo.
- Two dashboards: only the cockpit's own pir has `PIR_DASHBOARD_STATE` set, so a pir the person
  runs in a terminal writes nothing.
- A burst of writes while the person scrolls through runs: pir only writes on open/close, not
  on selection, and the daemon debounces 150ms and applies only the latest state, because each
  attach moves panes.
- The attached pir folder moves (a planning run's worktree renamed to its slug): pir writes the
  new `cwd`; the daemon treats the same key with a new folder like a migrated agent, relaunching
  revdiff there.

---

## 3. Architecture

### 3.1 The boundary

```
bin/cockpit-pir-model.mjs   pure: parse the state file, decide what to show, key names,
                            starting mode, reap decision
bin/cockpitd.mjs            everything that touches wezterm, the file system and processes
bin/cockpit-strip.mjs       renders the footer from terminals.json
bin/cockpit-pir.sh          the relaunch loop the pir pane runs
```

`cockpit-pir-model.mjs` takes every fact as a parameter (the parsed JSON, whether a pid is
alive, which paths exist) and returns plain objects. The pir-pane suite greps it for
`node:fs`, `node:child_process`, `node:http(s)`, `fetch(`, `Date.now(`, `new Date()` and
`process.env`, the same check `spikes/usage-test` applies to its model. If that check fails the
fix is to move the code into the daemon, never to relax the grep. Everything on the pure side
is tested in milliseconds; everything in the daemon needs the 6-minute wezterm-stubbed suite.

### 3.2 Modules

- `cockpit-pir-model.mjs` (new): `readPirState`, `decidePir`, `pirKey`, `startingMode`,
  `shouldReapPirKey`. Depends on nothing.
- `cockpitd.mjs` (extended): the `fleet-claude`/`fleet-pir` verbs, the pane swap, the watch on
  `pir-dashboard.json`, attaching `pir.` keys through the existing `showDiff`/`showTerminal`,
  the claude-only guards of §2.7–§2.9, and the `fleet` block in `terminals.json`.
- `cockpit-strip.mjs` (extended): the `Claude Agents | PIR` segment and its hit zones.
- `cockpit-pir.sh` (new): the loop of §2.3.
- `cockpit-layout.sh` (extended): deletes `pir-dashboard.json` on rebuild.

### 3.3 The decision function

```js
decidePir(state, { exists, isGitRepo }) →
  { mode: "list" }
| { mode: "follow", key, cwd, label, isRun, runKey }
```

`state` is `readPirState`'s output (already `list` for missing, corrupt, wrong-version or
dead-pid input). `exists(path)` and `isGitRepo(path)` are supplied by the daemon. The function
applies the table of §2.5 and nothing else.

### 3.4 Data flow

```
pir (PIR_DASHBOARD_STATE) ──temp+rename──▶ ~/.claude/cockpit/pir-dashboard.json
                                                     │ dir watch, 150ms debounce
footer click ─▶ cmd: fleet-pir / fleet-claude        ▼
                       │                   daemon: readPirState → decidePir
                       ▼                             │
               daemon: swap panes              attach key / onExit
                       │                             │
                       └──────▶ terminals.json { fleet: { program, switchable, available } }
                                        │
                                        ▼
                                cockpit-strip.mjs footer
```

### 3.5 Storage

`pir-dashboard.json`: written by pir, read by the daemon, deleted on rebuild; atomic by pir's
temp-then-rename, so the daemon never reads half a file. `terminals.json` gains
`fleet: { program: "claude"|"pir", switchable: bool, available: bool }`, written by the daemon
as today. `panes.json` gains `pir` once the pir pane exists. No new persisted state: the shown
program and the per-key modes are in memory, as diff modes are.

---

## 4. Testing

- `spikes/pir-pane-test/run.sh` (new, T01): the model, exhaustively, and its purity grep.
- `spikes/cockpit-test/run.sh` (extended by T02–T04): the footer segment and click verbs, the
  swap with the wezterm stub (a `pir` stub on `PATH`; tests write `pir-dashboard.json`
  themselves), following, fallbacks, the claude-only guards.
- T00 and T06 run against a real headless `wezterm-mux-server`, as `spikes/pane-swap/` did;
  T07 against the real pir with the person.

None of it proves the real pir writes the file; that is the pir plan's own tests plus T07.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5.0) |
| Language / runtime | Node.js v24.2.0 (ESM `.mjs`), bash/zsh |
| Toolchain | wezterm 20240203-110809-5046fc22; Claude Code 2.1.283; revdiff v1.12.0; pir from `~/src/plan-implement-review` at `40ac418` (installed at `~/.claude/pir-engine`, wrapper `~/.local/bin/pir`) |
| Deliberately absent | No `package.json`, no npm dependencies: every cockpit module is Node standard library. pir has no status command or JSON output; its dashboard exposes nothing outside its screen until the pir plan of §2.4 lands. |

**The test command.** The `test` lines at the top. The pir-pane line is guarded because T01
creates that suite and tasks before it would otherwise fail on a missing file. cockpit-test takes
about 6 minutes and prints only its section headings plus `ALL PASS (N checks)` on success
(545 checks measured 2026-09-26); `VERBOSE=1` prints every check. Failures print in full and
exit non-zero. `FORCE_COLOR=3` is set in this machine's session environment, but both suites
print plain text regardless (measured: zero escape bytes); keep new suites printing no colour.

**Setup.** None: a fresh clone passed a suite and was left clean (measured 2026-09-26).

**Dependencies.** None may be added.

**End to end.** The footer and the pane swap are driven through `spikes/cockpit-test` (stubbed
wezterm, real daemon, real strip renderer) and, for geometry and redraw, a real headless
`wezterm-mux-server` with its own socket (T00, T06), sized 120×40 and 80×24.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A real mouse click on the footer labels in the real cockpit window switching the pane | Needs the GUI window and a rebuild of the live cockpit, which kills every agent terminal (T07) |
| The real pir, with the pir plan built, driving the cockpit | Depends on the separate pir plan landing (T07) |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| Headless `wezterm-mux-server` with its own socket and pid file | used by T00, T06 | Never touches the live cockpit window |
| `COCKPIT_DIR` / `HOME` pointed at a scratch dir | used by cockpit-test | The daemon under test never reads or writes the real state |
| `PIR_HOME` pointed at a scratch dir | T06, T07 if a stand-in run is needed | pir's run index is not touched |

Rebuilding the live cockpit window (T07) closes every agent terminal and revdiff. It is the
person's decision when to do it, not the worker's.

---

## 6. Recovery

Everything new is inert without a click: if the pir pane misbehaves, click `Claude Agents` at
pir's list, or rebuild the window, which always starts on `claude agents` and deletes the state
file. Reverting this plan's commits restores today's cockpit exactly.

---

## 7. Decisions and rationale

- 2026-09-26, person: follow the depth (run → shared worktree, worker → task worktree). The two
  levels answer different review questions.
- 2026-09-26, person: switch by footer click only, no key. `⌥[`/`⌥]` stay as they are.
- 2026-09-26, person: switching only at a list screen; disabled (dim) elsewhere.
- 2026-09-26, person: reviews (`O`) inert under pir for now.
- 2026-09-26, person: a run starts at `custom` against `main`.
- 2026-09-26, person: BitBucket buttons switch to Claude, then launch.
- Defaults the planner chose and the person accepted in the requirements playback: start on
  claude every rebuild, follow other repos, relaunch pir on exit, hide the segment when pir is
  absent, fall back worker → run → list.
- A state file written by pir, not screen scraping. Scraping pir's headers plus its run index
  could locate a folder without a pir change, but the headers carry no path, `repo` is a
  basename that can collide, and a header format change would silently break following.
- Extend `onEnter`/`onExit`, `showDiff`, `showTerminal` for `pir.` keys rather than a parallel
  follow path: they are already keyed by an opaque string, and a second attach path would mean
  every fix to parking made twice.
- `panes.foot` as the cockpit-tab landmark, because it is the one pane never parked, split into
  or restarted.
- No prototype: the only new surface is two labels in the existing footer, drawn in its style.

---

## 8. Explicitly out of scope

- Typing reviews into a pir worker (§2.7). Needs proof that pir's input keeps a multi-line draft
  unsent; a later plan.
- A keyboard shortcut for the switch; declined in favour of the footer.
- Remembering the shown program across rebuilds; nothing is lost by starting on claude.
- Changing pir itself. That is the pir plan of [PIR-PROMPT.md](PIR-PROMPT.md), built in its own
  repo under its own review.
- Showing pir's run list or worker status anywhere else in the cockpit (welcome pane, strip).
