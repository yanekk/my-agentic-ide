# T07 — The refresh: a 60-second tick and the return to the cockpit

**Phase:** 4 · **Depends on:** T04, T05 · **Weight:** medium

## Goal

Keep the cache current. Every five minutes, and also the moment you come back to the fleet list
if the last fetch is older than five minutes. The daemon does it, not the pane — the pane is
pure display by construction, and that is what lets `cockpitd` own it as a diff slot.

`cockpitd.mjs` is the file the cockpit boots from and a broken one is a window that will not
come up, so this change is small, late, and fenced by a suite that must stay green.

## Design sections this implements

`DESIGN.md` §2.5 (the five minutes, the two-day window, one tick not two timers, one fetch in
flight, nothing scheduled when nothing is configured), §2.7 (error classification into the
cache), §3.4 (the daemon writes, the pane watches).

## Files

- `bin/cockpitd.mjs` — modified: a `refreshAgenda` function, a `setInterval`, and one call from
  the existing `onExit`
- `spikes/cockpit-test/run.sh` — extended

## Interface

```js
// inside bin/cockpitd.mjs

const AGENDA_TICK_MS  = 60_000;
const AGENDA_STALE_MS = 5 * 60_000;
let agendaFetching = false;

/** Fetch every calendar whose cache is older than AGENDA_STALE_MS. */
async function refreshAgenda(reason)      // reason is for the log only

setInterval(() => refreshAgenda("tick"), AGENDA_TICK_MS);
// and, inside the existing onExit() — the list→agent→list return:
refreshAgenda("returned");
```

Per calendar, each pass:

```
accessToken(...)  →  fetchEvents(start-of-today .. end-of-tomorrow, local)
                  →  normaliseEvent(...) for each          ← the PURE model (T02)
                  →  putCacheEntry(slug, { fetchedAt, events, error: null })

on failure        →  putCacheEntry(slug, { …keep previous events…,
                                           error: { kind: classifyError(e), since } })
```

Non-obvious, and why:

- **A 60-second tick with a staleness predicate, not a 5-minute timer.** The on-return rule
  needs sub-five-minute granularity anyway, and one "is anything stale?" question is easier to
  reason about than a periodic timer racing an event.
- **`onExit()` already exists** and already fires on the return to the fleet list, at an 800ms
  poll (FINDINGS 2026-08-26). Do not write a new detector.
- **`agendaFetching` guards one pass at a time**, exactly as `reconciling` guards `reconcile`.
  Overlapping passes interleave cache writes and burn quota on a slow network.
- **A failed fetch keeps the previous events** and only sets `error`. Blanking them would turn
  a wifi blip into an empty agenda, which is precisely what DESIGN §2.7 refuses.
- **`since` is set on the first failure and preserved across repeats**, so the column can say
  how long it has been broken rather than resetting the age every tick.
- **A successful fetch clears `error` entirely.**
- **With no calendars configured the function returns immediately** — no token call, no file
  written. The feature costs nothing until it is used.
- **Never log a token, and never log an event title.** `daemon.log` gets pasted into
  conversations. Log the slug, the outcome and the error kind.
- **Failures must never take the daemon down.** It runs unattended behind a window; the existing
  `uncaughtException` handler is a backstop, not a licence to leave a rejection unhandled.
- **`spikes/cockpit-test/run.sh` currently passes 82 assertions.** All of them must still pass.

## Tests

Through the existing wezterm-stubbed harness, with the T04 stub standing in for Google.

- [ ] with no calendars configured a tick writes no file and makes no request
- [ ] a stale calendar is fetched and its cache entry updated with a new `fetchedAt`
- [ ] a fresh calendar (younger than 5 minutes) is **not** re-fetched
- [ ] two calendars are both refreshed in one pass
- [ ] the fetch window is start-of-today to end-of-tomorrow in local time
- [ ] events reaching the cache are **normalised**, not raw Google shapes
- [ ] a network failure keeps the previous events and sets `error.kind = "network"`
- [ ] an auth failure sets `error.kind = "auth"` and keeps the previous events
- [ ] `error.since` is set on the first failure and unchanged on the second
- [ ] a success after a failure clears `error` completely
- [ ] one calendar failing does not prevent the other from being refreshed
- [ ] a second pass entered while one is in flight returns immediately and starts nothing
- [ ] the on-return path refreshes a stale calendar and skips a fresh one
- [ ] a thrown error inside a pass does not kill the daemon — the next tick still runs
- [ ] no token and no event title appears in the log
- [ ] **all 82 existing cockpit-test assertions still pass**

## Done when

- [ ] the full three-suite test command passes with no network access
- [ ] `refreshAgenda` is called from both the tick and the existing `onExit`, and from nowhere
      else
- [ ] a cockpit with no calendars configured behaves exactly as it did before this task

## Needs a person

The timing can only be seen in a live cockpit. Raise it when the tests are green and **wait**:

```
# with at least one calendar added, close the WezTerm window and reopen it, then:
tail -f ~/.claude/cockpit/daemon.log
```

Expect: a refresh line shortly after start-up, another about five minutes later, and one
whenever you leave an agent and land back on the fleet list.
Tell me: (1) did the column populate without you doing anything, and (2) does the log contain
any token or meeting title — it must not.
