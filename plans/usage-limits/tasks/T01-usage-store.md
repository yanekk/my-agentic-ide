# T01 — `cockpit-usage-store.mjs`

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** light

## Goal

The one place that reads and writes `usage-cache.json`. It holds the atomic-write and
tolerant-read logic so the tap (writer) and the strip (reader) share it and neither reimplements
it. Mirrors `cockpit-bitbucket-store.mjs`'s cache half.

## Design sections this implements

DESIGN §3.5 (storage, the cache shape, 0600, atomic), §2.n (corrupt/absent read tolerance).

## Files

- `bin/cockpit-usage-store.mjs` (new).

## Interface

```
readCache(dir = cockpitDir()) → cache | null
  // parse ~/.claude/cockpit/usage-cache.json; return null on absent/empty/corrupt, never throw.

writeCache(cache, dir = cockpitDir()) → void
  // atomic: write a UNIQUE temp `${file}.${pid}.${rand}.tmp` at mode 0600, chmod 0600,
  // rename over the target. The temp name must be per-writer, not a fixed `${file}.tmp`:
  // the tap is registered globally and runs in every session (DESIGN §2.6), so many
  // Claude sessions write this cache concurrently and a shared temp path would let two
  // writers scramble it before the rename (DESIGN §3.5).

// cache shape (see DESIGN §3.5):
//   { writtenAt: <ms>, fiveHour: {usedPct,resetsAt}|null, sevenDay: {usedPct,resetsAt}|null }
```

`dir` is a parameter defaulting to `~/.claude/cockpit` (honour `COCKPIT_DIR` as the other stores
do) so tests write to a scratch dir. `resetsAt` is stored in epoch seconds, as Claude Code gives
it; `writtenAt` in ms.

## Tests

- [ ] `writeCache` then `readCache` round-trips a full cache.
- [ ] The written file is mode 0600.
- [ ] The write is atomic: no `.tmp` file remains after a successful write; a reader never sees a
      partial file (assert the temp-then-rename path, e.g. no target mutation until rename).
- [ ] The temp name is unique per writer, not a fixed `${file}.tmp`: two `writeCache` calls
      overlapping in time (or two distinct temp names asserted directly) never share a temp path,
      and the final cache is a whole, parseable file — never a torn interleave.
- [ ] `readCache` on an absent file returns null.
- [ ] `readCache` on a corrupt/truncated file returns null and does not throw.
- [ ] `readCache` tolerates a cache with one window null.

## Done when

- [ ] `bin/cockpit-usage-store.mjs` exports `readCache`/`writeCache` with the shape above.
- [ ] `spikes/usage-test/run.sh` covers the six cases and passes.
- [ ] No lock file is used or created (DESIGN §3.5: atomic replace is enough).
