# T01 — `config` settings and the test suite

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Give the cockpit somewhere to keep the four BitBucket settings, through the same `config`
command that already holds the Anthropic key, and stand up the `bitbucket-test` suite the rest
of the plan writes into. `config` today assumes every setting is a secret to be masked; this
task generalizes it so a setting can be either a masked secret or a plain value shown in full.

## Design sections this implements

DESIGN §2.6 (the four settings, masked vs shown), §3.5 (own file per setting), §5 (the new
suite and the test command).

## Files

- `bin/cockpit-config.mjs` — extend the `SETTINGS` map and the read/write helpers.
- `spikes/bitbucket-test/run.sh` — new; the suite runner, following the agenda suite's shape.
- `spikes/bitbucket-test/config.test.mjs` — new; tests for the settings.
- `bin/cockpit-layout.sh` — the `config` symlink already exists; confirm nothing new is needed.

## Interface

```
// cockpit-config.mjs — SETTINGS becomes a table carrying the mask policy:
const SETTINGS = {
  "anthropic-api-key":  { file: "anthropic-api-key",  secret: true  },
  "bitbucket-key":      { file: "bitbucket-key",      secret: true  },
  "bitbucket-workspace":{ file: "bitbucket-workspace",secret: false },
  "bitbucket-repos":    { file: "bitbucket-repos",    secret: false },
  "bitbucket-team":     { file: "bitbucket-team",     secret: false },
};

// A plain (non-secret) setting shows its value in full on read; a secret shows maskedStatus.
// Existing exported readers stay working. Add a generic reader the store (T04) can call:
export function readSetting(name, dir = DIR): string | null   // trimmed, or null if absent/empty
```

`bitbucket-repos` and `bitbucket-team` are stored as the raw comma string; parsing into a list
is the store's job (T04), not config's — config just holds text.

## Tests

- [ ] set/read/‑‑unset round-trip for each new setting
- [ ] a secret setting reads masked (`set · …`), never the raw value
- [ ] a plain setting reads back in full
- [ ] `config` with no args lists all five settings with the right shown/masked status
- [ ] an unknown setting name is refused with the known-settings list
- [ ] files are written `0600` and atomically (temp then rename)
- [ ] the module still imports nothing outside `node:*`
- [ ] the suite is quiet on pass (one summary line), no colour, loud on failure

## Done when

- [ ] the four settings can be set, read (with the right masking) and unset via `config`
- [ ] `spikes/bitbucket-test/run.sh` exists, is added to the test command in DESIGN §5, and passes
- [ ] the existing `anthropic-api-key` behaviour is unchanged (its tests still pass)
