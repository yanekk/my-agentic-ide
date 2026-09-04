# T05 — The daemon fetch loop

**Phase:** 2 · **Depends on:** T02, T04 · **Weight:** medium

## Goal

Make the cache fill and stay fresh. Add `refreshPRs` to the daemon, modelled on `refreshAgenda`:
identify the user once, fetch each watched repo's open PRs, and write the cache — on the same
three triggers the agenda uses. Nothing is drawn yet; this task ends with a `bitbucket-cache.json`
that a later pane will read.

The cache holds **raw** PRs untouched (per T04's store); classifying and sorting is T03's model,
consumed later by the renderer (T06), not by this fetch loop. That is why T05 does not depend on
T03 — dropped from its deps by the user 2026-09-04, so the cache-fill work need not wait on the
classify brainstorm that only blocks T03.

## Design sections this implements

DESIGN §2.9 (three triggers, one call per repo, bounded budget), §2.n (per-repo independence,
offline keeps last, auth vs transient), §3.4 (data flow).

## Files

- `bin/cockpitd.mjs` — add `refreshPRs`, its guard flag, its timers, and the identity cache.
- `spikes/bitbucket-test/` or `spikes/cockpit-test/` — integration coverage with the client stub.

## Interface

```
// Mirrors refreshAgenda: guarded by a fetching flag, never throws/rejects.
async function refreshPRs(reason)   // reason: "tick" | "returned" | "start"
//  - read config via store; if !isConfigured, do nothing
//  - if meUuid not cached, client.getUser; on auth error mark and stop
//  - for each repo (sequential): client.listOpenPRs
//      success  -> cache.repos[slug] = { fetchedAt: now, prs, error: null }
//      auth     -> record { kind: "auth" } (whole-dashboard signal)
//      transient-> keep previous prs, record { kind: "transient" }
//  - store.writeCache(cache)

// Triggers, matching the agenda's:
setInterval(() => refreshPRs("tick"), PR_TICK_MS)   // PR_TICK_MS = 60_000, env-scaled
onExit(): refreshPRs("returned")                    // on return to the fleet list, not awaited
startup: refreshPRs("start")
```

Time scaling and the origin/browser seams go through env vars, matching the agenda
(`COCKPIT_BITBUCKET_TICK_MS`, `BITBUCKET_ORIGIN`).

## Tests

- [ ] unconfigured: `refreshPRs` does nothing, writes no cache
- [ ] configured: a fetch writes each repo's PRs and a `fetchedAt` into the cache
- [ ] `meUuid` is fetched once and reused, not re-fetched every tick
- [ ] one repo failing transiently keeps its previous PRs and records the error; others still update
- [ ] an auth error is recorded as the whole-dashboard auth signal
- [ ] the fetch is guarded: a second call while one is in flight does not double-fetch
- [ ] the integration harness points the client at a dead origin and an accidental real fetch fails loudly

## Done when

- [ ] the cache fills on start, on tick and on return to the list
- [ ] per-repo errors are isolated; auth is distinguished from transient
- [ ] no unhandled rejection escapes `refreshPRs`
