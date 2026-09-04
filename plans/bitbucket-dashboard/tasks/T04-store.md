# T04 — The store: config reads, cache and view-state

**Phase:** 1 · **Depends on:** T01 · **Weight:** light

## Goal

Own the reads and writes the daemon and the pane need: the four config settings as usable
values, the fetched-PR cache, and the session view-state (active tab and page). Every file here
has a single writer, so this is deliberately simpler than the agenda store — atomic writes, no
lock.

## Design sections this implements

DESIGN §3.5 (storage, single-writer, no lock, `0600`, never in the repo), §2.6 (parsing the
repo and team lists).

## Files

- `bin/cockpit-bitbucket-store.mjs` — new.
- `spikes/bitbucket-test/store.test.mjs` — new.

## Interface

```
// Config, parsed. repos/team split on commas, trimmed, empties dropped.
export function readConfig(dir?) -> {
  key: string | null, workspace: string | null,
  repos: string[], team: string[],
}
export function isConfigured(cfg) -> boolean   // key && workspace && repos.length

// Cache: written only by the daemon, read by the pane.
export function readCache(dir?) -> Cache        // defensive: a corrupt/absent file -> empty cache
export function writeCache(cache, dir?)         // atomic temp-then-rename, 0600
// Cache = { meUuid, repos: { [slug]: { fetchedAt, prs: RawPR[], error: {kind}|null } } }

// View-state: written only by the daemon (on a click verb), read by the pane.
export function readView(dir?) -> { tab: "toReview"|"mine", page: { toReview: number, mine: number } }
export function writeView(view, dir?)           // atomic, 0600; defaults tab=toReview, page=1
```

`readCache`/`readView` never throw on a corrupt file — the pane depends on that (DESIGN §2.n);
they return the empty/default shape instead. They also never rescue or rewrite a bad file; that
would race the daemon, the single writer.

## Tests

- [ ] `readConfig` parses `a, b ,c` into `["a","b","c"]`; an empty setting into `[]`
- [ ] `isConfigured` is false when any of key/workspace/repos is missing, true when all present
- [ ] `writeCache` then `readCache` round-trips; the file is `0600`
- [ ] a corrupt `bitbucket-cache.json` reads back as an empty cache, no throw, file left untouched
- [ ] a corrupt/absent `bitbucket-view.json` reads back as the default view
- [ ] `writeView` then `readView` round-trips tab and per-tab page
- [ ] a write is atomic: a reader during a write sees the whole old file or the whole new one
- [ ] no file is ever written inside the repo (run.sh no-repo-leak check)

## Done when

- [ ] config, cache and view read and write per the interface, tests green
- [ ] corrupt files degrade to empty/default without throwing and without being rewritten
