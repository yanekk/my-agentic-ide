# T02 — jobs-calendar

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Let the owner mark a calendar as the agents' one, refuse the calendars where that would be unsafe, and make the instructions and creator of its entries available in the normalised event.

## Design sections this implements

DESIGN §2.1, §3.4.

## Files

`bin/cockpit-agenda.mjs`, `bin/cockpit-agenda-store.mjs`, `bin/cockpit-agenda-model.mjs`, `spikes/agenda-test/` (`cli.test.mjs`, `store.test.mjs`, `model.test.mjs`).

## Interface

```
agenda add <slug> --jobs
agenda jobs <slug> on|off
```

```js
setJobs(slug, on, now)                     // store
readState()                                // its row map must also keep jobs and jobsSince, or the flag reads as off
putCalendar({ ..., jobs, jobsSince }, now) // today it rebuilds the row and would drop both
normaliseEvent(raw, { slug, tz, selfEmail, jobs })
  // jobs true adds: description (raw string), creatorOwn (boolean)
```

`creatorOwn` is `raw.creator.self === true || raw.creator.email === selfEmail`. Without `jobs`, the event is unchanged and carries neither field. `agenda ls` marks a jobs calendar.

## Tests

- [ ] `add --jobs` refuses a primary calendar, and a calendar whose `accessRole` is not `owner`; nothing is written.
- [ ] `jobs <slug> on` refuses when `calendarId === account`; `off` always works; an unknown slug errors.
- [ ] An agent environment is refused (`refuseIfAgent`).
- [ ] `jobs` and `jobsSince` survive repair `agenda add`, `setColour`, and a re-read; turning on twice keeps the first `jobsSince`.
- [ ] A row with no flag reads as not jobs, so existing `agenda.json` files still work.
- [ ] `normaliseEvent` without `jobs` deep-equals today's output; with `jobs`, the two fields appear; `creator` absent gives `creatorOwn` false.
- [ ] The pane draws an event from 3 days ago in the cache as nothing (DESIGN §2.7 wider fetch).
- [ ] `AGENDA_DRY_RUN=1 agenda add x --jobs` opens nothing and writes nothing.

## Done when

- [ ] `bash spikes/agenda-test/run.sh` and `bash spikes/notes-test/run.sh` pass.
- [ ] `agenda help` documents both forms.
- [ ] No fetch window or daemon change is made here; T04 owns those.
