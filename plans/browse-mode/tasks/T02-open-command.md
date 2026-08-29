# T02 — `cockpit-open.mjs`, the command broot calls

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

The thin, world-touching half of the push. It finds the viewer pane, reads what is already
open, asks the model what to do (T01), sends the bytes, and writes the state back — refusing
safely whenever it is not certain the target is a viewer. It is the only thing in this plan
that types into a pane it does not own, so its refusals matter more than its successes.

## Design sections this implements

DESIGN §2.4 (the push), §2.5 (already-open), §2.n (every refusal), §3.4 (data flow),
§3.5 (storage).

## Files

```
bin/cockpit-open.mjs             new
bin/cockpit-agenda-store.mjs     withLock gains a lockFile argument; depth becomes per-file
spikes/browse-test/run.sh        extended — stubbed `wezterm`, as cockpit-test already does
```

`spikes/agenda-test/run.sh` must stay green — it is another feature's suite and this task edits
a file it owns.

`bin/cockpitd.mjs` is **not** touched here. Publishing `panes.json.viewer` is T04's job; this
task reads the key and refuses when it is absent, which is also what happens today.

## Interface

```
cockpit-open <file> [line]

exit 0   pushed (or switched to an existing tab)
exit 1   refused, with a one-line reason on stderr
```

Reads:

| Source | Used for |
|---|---|
| `~/.claude/cockpit/panes.json` → `viewer` | the target pane id; **absent or null means refuse** |
| `~/.claude/cockpit/panes.json` → `viewerAgent` | the **jobId** whose tab list to use; absent or null means refuse |
| `~/.claude/cockpit/panes.json` → `viewerRoot` | `repoRoot` for the model; absent or null means refuse |
| `~/.claude/cockpit/viewer-tabs.json` | `{ "<jobId>": ["bin/a.mjs", …] }` |

All three `panes.json` keys are published together by the daemon (T04, DESIGN §3.4), so any one
of them missing means the daemon does not currently believe a viewer is showing — refuse.

**Do not read `terminals.json`, and do not use `panes.json.repo`.** `terminals.json.agent` holds
the agent's *display name*, not its jobId, and `.repo` holds the *projects root* the cockpit was
opened in, not a repo root — both measured. DESIGN §3.4 has the full reasoning.

Writes `viewer-tabs.json` **under `viewer-tabs.lock`**, temp-file-plus-rename, exactly as
`notes.json` and `panes.json` already do. Stale locks broken at **5 s**: the agents share these
files with the user, and a process killed mid-write must not wedge it forever.

### Reuse the agenda's lock — do not write a third one

Decided with the user at plan review. `bin/cockpit-agenda-store.mjs` already **exports**
`withLock`, and it is the better of the two copies in this repo: it carries a fix the
`cockpit-notes.mjs` copy does not. (Notes tries 40 × 25 ms = 1 s against a 5 s stale window, then
falls out of the loop with `fd === null` and **runs the write anyway, unguarded**. The agenda
version sets `LOCK_TRIES = ceil(LOCK_STALE_MS / LOCK_WAIT_MS)`, so the budget always outlasts the
stale break.) A third copy would mean finding and fixing that class of bug in three places.

The change is small and it is this task's:

```js
// cockpit-agenda-store.mjs
export function withLock(fn, lockFile = LOCK_FILE)
```

**The reentrancy counter must become per-lock-file.** `lockDepth` is one module-level number
today, which is correct while there is one lock. With two, a `withLock(…, viewerTabsLock)` nested
anywhere inside an agenda `withLock(…)` would see `lockDepth > 0`, take the reentrant branch, and
run **holding no lock at all** — precisely the failure the depth counter was added to prevent,
in a new disguise. So depth becomes a `Map<lockFile, number>` keyed by the file, and the existing
agenda behaviour falls out of it unchanged.

`bin/cockpit-notes.mjs` is **deliberately not touched** — it is another feature's file and this
task has no business in it (scope rule). Its bug is logged in FINDINGS instead.

Sends, once per payload from `planPush`:

```
wezterm cli send-text --pane-id <viewer> --no-paste <payload>
```

`--no-paste` because bracketed-paste would wrap the text in markers that micro's command bar
reads as literal characters.

## Tests

Against a stubbed `wezterm` that records argv and stdin, in the style of `spikes/cockpit-test`:

- [ ] happy path, first file → one `open` triple sent, `viewer-tabs.json` gains the entry
- [ ] happy path, second file → `tab` triple, list grows in order
- [ ] already-open file → `tabswitch` triple, list unchanged
- [ ] a line argument → the `goto` triple follows
- [ ] **every** `send-text` call carries `--no-paste` and the right `--pane-id`
- [ ] **refuses** when `panes.json` has no `viewer` key — and sends nothing at all
- [ ] **refuses** when `viewer` is `null` — and sends nothing at all
- [ ] **refuses** when `viewerAgent` or `viewerRoot` is missing or null — and sends nothing
- [ ] **refuses** when `panes.json` is missing or unparseable
- [ ] **refuses** when the file does not exist on disk, naming it
- [ ] refuses when given no argument
- [ ] a `wezterm` that exits non-zero → the tab list is **not** updated, so a later push does
      not believe in a tab that was never opened
- [ ] two concurrent invocations both land: the second sees the first's entry, and the file
      ends with both, never one
- [ ] a stale lock older than 5 s is broken; a fresh one is waited for
- [ ] `withLock` guards `viewer-tabs.lock`, not `agenda.lock` — an agenda write and a push do
      **not** block each other
- [ ] a `viewer-tabs` lock taken **inside** an agenda `withLock` still takes its own file lock,
      rather than falling through the reentrant branch unguarded
- [ ] the agenda's own nesting still counts as reentrant, and `spikes/agenda-test/run.sh` passes
- [ ] an unknown agent (no `viewerAgent`, or an empty one) → refuses rather than writing under
      an empty key
- [ ] `viewer-tabs.json` corrupt → treated as empty and rewritten, never thrown

## Done when

- [ ] `spikes/browse-test/run.sh` green, covering every row above
- [ ] nothing is ever sent on any refusal path — asserted, not assumed
- [ ] `spikes/cockpit-test/run.sh` still green
