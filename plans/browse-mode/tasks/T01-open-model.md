# T01 — `cockpit-open-model.mjs`, the pure decision

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

One function decides everything about a push: whether the file is already open, whether this
is the first file the viewer has seen, what path to show on the tab, and which keystrokes to
send. It takes its inputs as parameters and returns a decision — no filesystem, no wezterm, no
clock. That is what makes the whole of DESIGN §2.4 and §2.5 testable exhaustively in
milliseconds instead of by a person with a terminal.

## Design sections this implements

DESIGN §2.2 (first file uses `open`), §2.4 (the keystroke sequence), §2.5 (already-open files),
§3.1 (the boundary), §3.3 (the decision function).

## Files

```
bin/cockpit-open-model.mjs    new — the only file this task creates
spikes/browse-test/run.sh     new — the suite; T02 extends it
```

## Interface

```js
export function planPush({ openTabs, file, line, repoRoot })
```

| Field | Type | Meaning |
|---|---|---|
| `openTabs` | `string[]` | repo-relative paths, in tab-bar order, **as we last sent them** |
| `file` | `string` | absolute or relative path of the file being opened |
| `line` | `number \| null` | 1-based line to jump to, or null |
| `repoRoot` | `string` | absolute path the tab label is made relative to |

Returns:

```js
{
  payloads: string[],   // sent in order, one `send-text` each, verbatim
  openTabs: string[],   // the new list, to be persisted by the caller
  rel: string           // the repo-relative path that was used as the tab label
}
```

Payload rules, and the reason for each:

| Case | `payloads` | Why |
|---|---|---|
| `openTabs` empty | `["\x05", "open <rel>", "\r"]` | micro's initial `No name` buffer is replaced rather than left as a dead first tab |
| `rel` not in `openTabs` | `["\x05", "tab <rel>", "\r"]` | adds a tab |
| `rel` already in `openTabs` at index `i` | `["\x05", "tabswitch <i+1>", "\r"]` | micro's tab numbering is **1-based**; `openTabs` is unchanged |
| `line` is a positive integer | append `["\x05", "goto <line>", "\r"]` | lands on a content-search hit |

**`\r` and never `\n`.** `\n` inserts a newline into micro's command bar and submits nothing;
the push then fails silently. This is the project's `\r`/`\n` rule in reverse — see FINDINGS.

The three payload elements are kept **separate** rather than concatenated because the caller
sends one `send-text` per element, matching what was measured to work.

## Tests

- [ ] empty `openTabs` → `open`, not `tab`
- [ ] second distinct file → `tab`, and `openTabs` grows by one, in order
- [ ] a file already open → `tabswitch` with the **1-based** index, `openTabs` unchanged
- [ ] the first file, re-pushed → `tabswitch 1`
- [ ] the last file, re-pushed → `tabswitch <length>`
- [ ] `line` present → the `goto` triple is appended, in that order, after the open/tab triple
- [ ] `line` null, 0, negative, or non-integer → no `goto` payload at all
- [ ] every payload list submits with `\r`; **no payload anywhere contains `\n`**
- [ ] an absolute path under `repoRoot` → relativised
- [ ] a path already relative → unchanged
- [ ] a path **outside** `repoRoot` → returned absolute rather than as a `../../..` chain, which
      is unreadable on a tab
- [ ] a path containing a space → still one payload; the caller quotes nothing
- [ ] `openTabs` is not mutated in place — the input array is untouched
- [ ] boundary check: `cockpit-open-model.mjs` imports nothing from `node:fs`,
      `node:child_process` or `node:os`. **If this fails the fix is to move the code, never to
      relax the test.**

## Done when

- [ ] `spikes/browse-test/run.sh` runs green and covers every row above
- [ ] `cockpit-open-model.mjs` has no import of `node:fs`, `node:child_process` or `node:os`
- [ ] `spikes/cockpit-test/run.sh` is still green
