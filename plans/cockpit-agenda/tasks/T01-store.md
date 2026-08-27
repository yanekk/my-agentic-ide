# T01 — State files, the lock, atomic writes

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

> **Amended 2026-08-27, after T00.** Google's downloaded client JSON is **nested**
> (`{ "installed": { "client_id", "client_secret" } }`), not the flat `{ clientId, clientSecret }`
> this doc assumed. That does **not** change this task: `agenda-client.json` still holds our
> normalised flat shape, and parsing Google's download is T05's job (`agenda setup <path>`,
> DESIGN §2.9). `writeClient` receives values already normalised. Do not add shape-guessing here.

## Goal

Everything the agenda knows lives in three files under `~/.claude/cockpit/`: the Google
registration you paste once, the sign-ins and configured calendars, and the last events
fetched. Two of the three hold secrets, all three are written by more than one process (you in
one terminal, an agent in another, the daemon in the background), and the renderers watch the
directory for changes rather than the files. This task builds that layer, and nothing else.

It is closely modelled on `bin/cockpit-notes.mjs`, which already solves the same problems for
notes — read that file first. The differences are deliberate and each has a reason below.

## Design sections this implements

`DESIGN.md` §3.5 (storage, shapes, why not in the repo, why not keyed by repo), §2.7 (corrupt
files, two writers, atomic writes), §5.2 (`COCKPIT_DIR`, file modes).

## Files

- `bin/cockpit-agenda-store.mjs` — new, the only file this task creates
- `spikes/agenda-test/run.sh` — new, the plan's test command; this task creates it and the
  harness every later task extends

## Interface

```js
// bin/cockpit-agenda-store.mjs

export const DIR;                    // COCKPIT_DIR ?? ~/.claude/cockpit
export const CLIENT_FILE, STATE_FILE, CACHE_FILE;

// --- the Google registration (agenda-client.json) --------------------------
readClient()   -> { clientId, clientSecret } | null
writeClient({ clientId, clientSecret }) -> void        // 0600; values ALREADY normalised
                                                       // by T05 — this never sees Google's
                                                       // nested `installed`/`web` wrapper

// --- accounts and calendars (agenda.json) ----------------------------------
// { version: 1,
//   accounts:  { "<email>": { refreshToken, addedAt } },
//   calendars: [ { slug, account, calendarId, title, colour, addedAt } ] }
readState()    -> { version, accounts, calendars }     // always well-formed; never throws
putAccount(email, refreshToken, now)   -> void         // upsert; keeps addedAt if present
removeAccount(email)                   -> void         // ALSO drops its calendars
putCalendar({ slug, account, calendarId, title, colour }, now) -> void   // upsert by slug
removeCalendar(slug)                   -> calendar | null
setColour(slug, colour)                -> calendar | null

// --- the event cache (agenda-cache.json) -----------------------------------
// { version: 1, calendars: { "<slug>": { fetchedAt, events: [...], error } } }
readCache()    -> { version, calendars }               // always well-formed; never throws
putCacheEntry(slug, { fetchedAt, events, error }) -> void
pruneCache(slugs)                      -> void         // drop entries with no calendar

// --- shared plumbing -------------------------------------------------------
withLock(fn)   -> any                                  // 5s stale break, as notes.lock
```

Non-obvious, and why:

- **Not keyed by repo.** `notes.json` is `{ repos: { "<path>": [...] } }` because a note is
  about a project. An agenda is about *you*, so there is one list. Do not copy the repo key.
- **`removeAccount` drops that account's calendars too.** A calendar whose sign-in is gone can
  never be fetched again; leaving it would produce a permanent loud error line (DESIGN §2.7)
  for a calendar the user believes they removed.
- **`readState()` and `readCache()` never throw.** They are called from the drawing pane, and a
  cockpit that will not paint because a JSON file lost a brace is worse than one that has
  forgotten a calendar (DESIGN §2.7).
- **But `readState()` moves a corrupt file aside** to `agenda.json.corrupt-<ts>` before
  returning empty, and returns a flag saying it did, so the CLI can say so. That file holds
  refresh tokens; silently discarding them costs two browser round trips. The cache gets no
  such treatment — it is re-fetchable in five minutes.
- **`0600` on all three**, including the cache: it holds your meeting titles.
- **Atomic write, under the lock, every time.** Temp file plus rename, so a watcher on the
  directory never goes deaf on a replaced inode and a crash mid-write leaves the old file whole.
- **The lock is synchronous** (`Atomics.wait`), because the CLI prints and exits — copy the
  `sleepSync` in `cockpit-notes.mjs` rather than inventing another one.

## Tests

- [ ] a fresh `COCKPIT_DIR` reads as empty state and empty cache, creating no files
- [ ] `putCalendar` then `readState` round-trips every field
- [ ] `putCalendar` on an existing slug updates it in place and does not duplicate it
- [ ] `putCalendar` preserves the original `addedAt` on update
- [ ] `removeCalendar` on an unknown slug returns null and changes nothing
- [ ] `removeAccount` removes that account's calendars and leaves other accounts' alone
- [ ] `pruneCache` drops cache entries whose calendar is gone and keeps the rest
- [ ] a corrupt `agenda.json` is moved to `agenda.json.corrupt-<ts>`, state reads empty, and the
      move is reported
- [ ] a corrupt `agenda-cache.json` reads empty and is **not** moved aside
- [ ] all three files are mode `0600` after writing
- [ ] a write leaves no `.tmp` file behind
- [ ] two concurrent `putCalendar` processes both survive and both calendars exist afterwards
- [ ] a lock file older than 5s is broken rather than waited on forever
- [ ] `COCKPIT_DIR` is honoured — **no test ever touches `~/.claude/cockpit`**
- [ ] nothing is ever written inside the repository

## Done when

- [ ] `spikes/agenda-test/run.sh` exists, is executable, prints `ALL PASS`, and covers every
      case above
- [ ] the full test command passes: `spikes/agenda-test/run.sh && spikes/notes-test/run.sh &&
      spikes/cockpit-test/run.sh`
- [ ] `bin/cockpit-agenda-store.mjs` imports nothing outside `node:*`
