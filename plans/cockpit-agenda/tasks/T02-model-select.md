# T02 — Normalising Google's events, and choosing what shows

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

Google returns events in a shape with several ways of saying the same thing: a timed event has
`start.dateTime`, an all-day one has `start.date`; whether you declined is buried in an
`attendees` array you may not appear in at all; "free" is a `transparency` field; a deleted
event is still in the response with `status: "cancelled"`. Every rule about *which* events
count (DESIGN §2.4) and *which are still ahead of you* (DESIGN §2.3) lives in turning that
shape into a flat one and then filtering it.

This is the heart of the feature and it is **pure** — parameters in, decisions out, `now` as an
argument. That is what makes "what does 14:20 on a busy Wednesday look like" a millisecond test
rather than a wait until Wednesday.

## Design sections this implements

`DESIGN.md` §2.3 (what shows, `NOW`, all-day pinning, the tomorrow roll-over), §2.4 (which
events count), §3.1 (the boundary and what enforces it).

## Files

- `bin/cockpit-agenda-model.mjs` — new; T03 extends the same file with the drawing half
- `spikes/agenda-test/run.sh` — extended
- `spikes/agenda-test/fixtures/` — new; recorded Google `events` responses as JSON

## Interface

```js
// bin/cockpit-agenda-model.mjs   — PURE. See the forbidden-import check below.

/** One normalised event. `start`/`end` are epoch ms. */
// { id, title, start, end, allDay, reply, slug }
//   reply: "yes" | "no" | "maybe" | "none" | "n/a"
//     "n/a"  = you are not an attendee (your own entries; a subscribed calendar)
//     "none" = invited, not yet answered   → rendered with `?`
//     "no"   = declined                    → filtered out

/**
 * One raw Google event -> one normalised event, or null if it must not be shown at all.
 * `tz` is the calendar's IANA zone, used ONLY to place an all-day event's boundaries.
 * `selfEmail` identifies which attendee is you.
 */
normaliseEvent(raw, { slug, tz, selfEmail }) -> event | null

/**
 * Everything on screen, decided. `events` is every normalised event for the fetch window
 * (start of today .. end of tomorrow) across all calendars.
 */
chooseEvents(events, now, { tz }) -> {
  scope:    "today" | "tomorrow" | "empty",
  allDay:   [event],       // pinned above; calendar-add order
  timed:    [event],       // start-ascending; nothing whose end <= now (today only)
  nowEvent: event | null,  // the timed event with start <= now < end; earliest start wins
}
```

Non-obvious, and why:

- **`end <= now` is finished, not `start <= now`.** A meeting you are in the middle of is the
  single most useful row on the screen (DESIGN §2.3).
- **`nowEvent` is also present in `timed`** — it is a label, not a separate list. Removing it
  from `timed` would make the row count wrong when several events overlap.
- **All-day events are placed with the calendar's timezone, not the machine's.** Google gives
  an all-day event as a bare `date`; treating that as UTC puts a Polish holiday on the wrong day
  for part of the day. A multi-day all-day event covers every day in `[date, endDate)` — note
  Google's end date is **exclusive**.
- **`reply` from `attendees.find(a => a.self)`**, not by matching `selfEmail` as a string:
  Google sets `self: true` and the address may be an alias. Fall back to `selfEmail` only if no
  attendee is marked `self`. No attendees at all means `"n/a"`, never `"none"` — your own diary
  entry is not an unanswered invitation.
- **`status: "cancelled"` returns null unconditionally.** It is a tombstone, not an event.
- **`transparency: "transparent"` ("free") changes nothing** — it is shown (DESIGN §2.4). Do not
  filter on it; the field is named here only so nobody adds a filter for it later.
- **Roll-over is decided here, not in the renderer.** If today's `allDay` and `timed` are both
  empty, `scope` becomes `"tomorrow"` and the lists are tomorrow's, unfiltered by `now` (nothing
  tomorrow can be finished). If tomorrow is also empty, `scope` is `"empty"`.

## Tests

Drive every case from a fixture plus a fixed `now`. No test may read the clock.

Normalising:
- [ ] a timed event yields correct epoch `start`/`end` and `allDay: false`
- [ ] an all-day event yields local-midnight boundaries in the given `tz` and `allDay: true`
- [ ] Google's exclusive all-day end date is handled — a one-day event does not bleed into the next
- [ ] a multi-day all-day event covers each of its days and no more
- [ ] `status: "cancelled"` returns null
- [ ] `attendees` with `self: true, responseStatus: "declined"` gives `reply: "no"`
- [ ] `"needsAction"` gives `"none"`; `"tentative"` gives `"maybe"`; `"accepted"` gives `"yes"`
- [ ] no `attendees` array at all gives `"n/a"`, not `"none"`
- [ ] an attendees array in which you do not appear gives `"n/a"`
- [ ] an alias address with `self: true` is still recognised as you
- [ ] `transparency: "transparent"` is normalised and **not** dropped
- [ ] an event missing `summary` gets a non-empty placeholder title rather than `undefined`

Choosing:
- [ ] at 14:20 with 09:30, 11:00, 14:00–15:00 and 17:30: the two finished ones are gone, the
      14:00 is `nowEvent`, and `timed` is `[14:00, 17:30]`
- [ ] an event ending exactly at `now` is finished; one starting exactly at `now` is not
- [ ] two overlapping current events: the earlier-starting one is `nowEvent`, both are in `timed`
- [ ] declined events are absent from both lists
- [ ] all-day events appear in `allDay` in calendar-add order and never in `timed`
- [ ] an all-day event does not become finished during its day
- [ ] an event that began yesterday and ends today is shown if it has not ended
- [ ] today empty and tomorrow non-empty gives `scope: "tomorrow"` with tomorrow's events, none
      filtered by `now`
- [ ] both empty gives `scope: "empty"` and two empty lists
- [ ] a day made entirely of declined events rolls over to tomorrow (it is empty *after* filtering)
- [ ] `now` moved backwards makes a finished event reappear — no crash, no special case
- [ ] a DST boundary inside the window does not shift a day's events onto the wrong day

Boundary:
- [ ] the test script greps `cockpit-agenda-model.mjs` for `node:fs`, `node:http`, `node:https`,
      `node:child_process`, `fetch(`, `Date.now(`, `new Date()` and `process.env`, and **fails
      on any hit**

## Done when

- [ ] every case above is covered and `spikes/agenda-test/run.sh` prints `ALL PASS`
- [ ] the full three-suite test command passes
- [ ] the forbidden-import check is part of the suite and demonstrably fails if a `node:fs`
      import is added — **if it ever fails, the fix is to move the code, never to relax the
      check** (DESIGN §3.1)
