# T01 — Data layer: per-PR diffstat fetch and summary

**Phase B · depends on nothing · medium**

## Goal

Bring the changed-file count and the lines added/removed into the cache for the PRs that show. Add a
GET-only `listPRDiffstat` to the client, a pure `summarizeDiffstat` to the model, and wire the daemon
to fetch the diffstat for each shown PR (the ones it already fetches comments for), summarise it, and
cache the three numbers on the PR entry. This is the plumbing; T02 reads it, T03 draws it.

## Files

- `bin/cockpit-bitbucket-client.mjs` — add `listPRDiffstat` beside `listPRComments`.
- `bin/cockpit-bitbucket-model.mjs` — add the pure `summarizeDiffstat`.
- `bin/cockpitd.mjs` — in the shown-PR loop that fetches comments, also fetch + summarise the
  diffstat and attach the triple.
- `bin/cockpit-bitbucket-store.mjs` — only if the cache write needs to carry the new field (it rides
  on the PR entry; likely no change beyond what already passes raw PRs through).
- `spikes/bitbucket-test/client.test.mjs`, `model.test.mjs` — tests + a diffstat fixture.

## Interface

```js
// client — one PR's diffstat, every page, raw. GET only, same shape as listPRComments.
//   GET /2.0/repositories/{ws}/{repo}/pullrequests/{prId}/diffstat  (pagelen 100, follow next)
// -> { diffstat: RawDiffstatEntry[] }  |  { error: { kind } }
export async function listPRDiffstat({ key, workspace, repo, prId, origin }) 

// model — reduce raw diffstat entries to the three numbers the row shows (DESIGN §2.4).
//   files   = entries.length
//   added   = sum of entry.lines_added   (missing/NaN treated as 0)
//   removed = sum of entry.lines_removed (missing/NaN treated as 0)
// Pure; no clock, no I/O. An empty/blank list -> { files: 0, added: 0, removed: 0 }.
export function summarizeDiffstat(entries) -> { files, added, removed }
```

The daemon attaches the summary to the cached PR entry, e.g. `raw.diffstatSummary = { files, added,
removed }`, computed with `summarizeDiffstat`. A PR whose diffstat fetch failed or was not attempted
carries **no** `diffstatSummary` (not a zeroed one), so T02/T03 can tell "0 files changed" from "not
fetched" (DESIGN §2.4).

## Done when

- `listPRDiffstat` fetches and paginates a PR's diffstat against the loopback stub, GET only,
  classifying errors like the sibling calls (401/403 → auth, else transient).
- `summarizeDiffstat` returns the right triple, tolerant of missing fields and an empty list.
- The daemon fetches the diffstat for exactly the shown PRs (those `concernsMe`), no more, and caches
  the summary; a PR that does not concern the user gets no diffstat call.
- The read-only grep in `run.sh` still passes (no mutating verb in the client); the origin seam still
  passes (no non-loopback origin named in a test).
- The full test command is green and quiet on pass.

## Tests

- `listPRDiffstat`: single page; multi-page `next` concatenated in order; 401/403 → auth; a dropped
  socket / garbage 200 → transient; the auth header is re-sent per page.
- `summarizeDiffstat`: several files summed; a file with only additions or only deletions; missing
  `lines_added`/`lines_removed` counted as 0; empty list → all zeros.
- Daemon: given a cache of open PRs where some concern the user and some do not, only the concerning
  ones get a diffstat call and a cached summary (assert against a stubbed client, as the comment
  fetch is tested).

## Hand-off to the user

```
Needs you — I cannot see this from here:

  A read-only diffstat call against a real PR with your token (I'll give the exact snippet
  when the client is built), under BITBUCKET_ORIGIN unset so it hits the real API read-only.

Expect: a file count and +added / −removed totals for that PR.
Tell me: do the numbers match what BitBucket's own PR page shows for that PR?
```

## Notes

Diffstat pagination can be many entries for a huge PR; `MAX_PAGES` (the client's existing cap) bounds
it exactly as it bounds comments. Storing only the summed triple — not the per-file list — is the
DESIGN §2.4 decision: it keeps the cache small and means the 2s repaint never re-sums. Compute the
summary once, in the daemon, via the pure function; do not sum in the render path.
