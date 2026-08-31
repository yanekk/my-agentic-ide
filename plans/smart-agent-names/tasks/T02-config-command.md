# T02 — `config` command and key store

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Build the `config` command that sets, reads, and clears the Anthropic API key without
hand-editing a file, and the small store the hook will read the key from. It is a
cockpit-only command in the mould of `note` and `agenda`: a node script symlinked onto the
cockpit PATH. The read path only ever shows a masked status, because agents inherit that PATH
and must never be able to print the secret.

## Design sections this implements

DESIGN 2.7 (the command), 3.5 (the key file: 0600, atomic, `COCKPIT_DIR`-overridable), 2.n
(a torn read is impossible because writes are atomic).

## Files

- `bin/cockpit-config.mjs` — new: the command and the key read/write/unset and masking.
- `bin/cockpit-layout.sh` — add a symlink line next to the note and agenda ones (lines
  69–70), `ln -sf "$HERE/cockpit-config.mjs" "$COCKPIT_BIN/config"`, so it is relinked on
  every rebuild and lands on `$COCKPIT_BIN`, which line 82 already puts on PATH.
- `spikes/auto-name-test/config.test.mjs` — new: the cases below (the run.sh already loops
  over `*.test.mjs` with a fresh `COCKPIT_DIR` each).
- `spikes/auto-name-test/run.sh` — add a check that `cockpit-layout.sh` symlinks `config`,
  and that `cockpit-config.mjs` imports nothing outside `node:*`.

## Interface

```
config anthropic-api-key <key>        // write DIR/anthropic-api-key, 0600, atomic (temp+rename)
config anthropic-api-key              // print "set · …1234" or "not set" — never the key
config anthropic-api-key --unset      // remove the file; naming returns to today's behaviour
config                                // list known settings and their masked status

// exported for the hook (T03) and the tests:
export function readApiKey(dir) → string|null   // the raw key, or null if absent/empty
export function maskedStatus(dir) → string      // "set · …1234" | "not set"
```

`DIR` is `process.env.COCKPIT_DIR || ~/.claude/cockpit`, matching the hook. `readApiKey` is
the only function that returns the raw key and it is called only by the hook; the command's
own read path uses `maskedStatus`. An unknown setting name exits non-zero with a one-line
message. The write creates `DIR` if missing and sets mode 0600 on the file.

## Tests

- [ ] `anthropic-api-key <key>` writes the file with mode 0600 and the exact bytes
- [ ] the write is atomic — a temp file is renamed, never a partial target left behind
- [ ] a bare `anthropic-api-key` prints a masked status showing only the last four, never the key
- [ ] `readApiKey` returns the key when set and null when the file is absent or empty
- [ ] `--unset` removes the file and a following read is null / "not set"
- [ ] an unknown setting name exits non-zero and names the setting
- [ ] `maskedStatus` never contains the full key for any key length (including very short keys)

## Done when

- [ ] `config anthropic-api-key <key>` then `config anthropic-api-key` round-trips to a masked status
- [ ] `cockpit-layout.sh` symlinks `config` alongside `note` and `agenda`
- [ ] `spikes/auto-name-test/run.sh` passes and its new checks assert the symlink and the import boundary

## Needs a person

That the command exists only inside a cockpit terminal (on PATH there, absent in a plain
shell) is a live-cockpit fact — it is verified in T04, not here.
