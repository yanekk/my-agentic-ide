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
bin/cockpit-open.mjs        new
spikes/browse-test/run.sh   extended — stubbed `wezterm`, as cockpit-test already does
```

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
| `~/.claude/cockpit/panes.json` → `repo` | `repoRoot` for the model |
| `~/.claude/cockpit/terminals.json` → `agent` | which agent's tab list to use |
| `~/.claude/cockpit/viewer-tabs.json` | `{ "<jobId>": ["bin/a.mjs", …] }` |

Writes `viewer-tabs.json` **under `viewer-tabs.lock`**, temp-file-plus-rename, exactly as
`notes.json` and `panes.json` already do. Stale locks broken at **5 s** — the same number and
the same reason as `notes.lock`: the agents share these files with the user, and a process
killed mid-write must not wedge it forever.

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
- [ ] **refuses** when `panes.json` is missing or unparseable
- [ ] **refuses** when the file does not exist on disk, naming it
- [ ] refuses when given no argument
- [ ] a `wezterm` that exits non-zero → the tab list is **not** updated, so a later push does
      not believe in a tab that was never opened
- [ ] two concurrent invocations both land: the second sees the first's entry, and the file
      ends with both, never one
- [ ] a stale lock older than 5 s is broken; a fresh one is waited for
- [ ] an unknown agent (no `terminals.json`, or no `agent` field) → refuses rather than writing
      under an empty key
- [ ] `viewer-tabs.json` corrupt → treated as empty and rewritten, never thrown

## Done when

- [ ] `spikes/browse-test/run.sh` green, covering every row above
- [ ] nothing is ever sent on any refusal path — asserted, not assumed
- [ ] `spikes/cockpit-test/run.sh` still green
