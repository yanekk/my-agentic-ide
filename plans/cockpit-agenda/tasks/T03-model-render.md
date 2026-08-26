# T03 — Drawing the column

**Phase:** 1 · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

Turn the chosen events into the actual lines of the AGENDA section: the header, the colour
bars, the `NOW` row and its `until` line, the `ALL DAY` rows, the `?` on unanswered
invitations, the calendar labels, the overflow line, the dim staleness line, the loud error
lines, and the empty states. This is the single function every display rule in the design is
provable through, and it is **pure** — given the calendars, the cache and a timestamp it
returns strings, so every state on that list is a millisecond test.

It is the heaviest task in the plan. If the row-budget arithmetic and the state rendering start
fighting each other, splitting it in two is the right call — say so and ask before doing it.

## Design sections this implements

`DESIGN.md` §2.3 (header, `NOW`, all-day, roll-over, overflow), §2.4 (the `?`), §2.6 (the row
budget, the empty state, the narrow pane), §2.7 (stale vs loud), §2.8 (colours), §3.3 (this is
the decision function).

## Files

- `bin/cockpit-agenda-model.mjs` — extended (T02 created it)
- `spikes/agenda-test/run.sh` — extended

## Interface

```js
// bin/cockpit-agenda-model.mjs   — still PURE; the T02 import check covers this too.

/** Eight mid-brightness 256-colour codes, legible on light and dark. */
export const PALETTE;      // [{ name: "teal", code: "38;5;37" }, … ] — 8 entries

/** Pure: `rand` is an integer supplied by the caller, never generated here. */
pickColour(takenNames, rand) -> name
  // never repeats a taken name while a free one remains; beyond 8, repeats are allowed
  // rather than refusing to add a ninth calendar

/** How many lines the section wants if given unlimited room. Lets the caller budget. */
agendaHeight({ width, calendars, cache, now }) -> number

/** THE decision function (DESIGN §3.3). A function of its arguments and nothing else. */
renderAgenda({ width, rows, calendars, cache, now }) -> string[]
  // exactly `rows` entries, each at most `width` VISIBLE columns
```

The shape it draws:

```
AGENDA                              14:20     ← left label, right clock
Wed 26 Aug                                    ← scope line: "Wed 26 Aug" / "TOMORROW · Thu 27 Aug"
▌ ALL DAY  Ana on leave              work
▌ NOW      sprint review             work
▌   └ until 15:00
▌ 17:30 ?  architecture sync         work
▌ 17:30    pick up kids              home
… +2 more · agenda                            ← only when it overflowed
last updated 22m ago · offline                ← only when a fetch actually failed
work  sign-in expired · agenda add work       ← loud; replaces that calendar's rows
```

Non-obvious, and why:

- **`visibleLen`/`pad`/`clip` already exist in `cockpit-welcome.mjs`.** Move them into the model
  and have the pane import them rather than keeping two copies — centring and clipping must
  ignore escape sequences identically in both halves of the column or the divider will not line
  up.
- **The colour bar and the slug are both drawn.** The bar is the glance; the slug survives a
  colourblind reader and a monochrome terminal (DESIGN §2.8).
- **`?` sits between the time and the title**, in the fixed-width gap, so the titles stay in one
  column whether or not a row has one. A `✗` is never drawn — declined events are filtered out
  before they reach here (T02).
- **A calendar in a permanent error state loses its rows entirely** and gets one loud line; the
  other calendars keep theirs. A silent gap in a two-calendar view is indistinguishable from a
  quiet day (DESIGN §2.7).
- **The staleness line appears only when a fetch has actually failed**, never on a merely
  five-minute-old cache. Saying "5m ago" every time makes the line meaningless.
- **The overflow line is not optional.** When rows are dropped it must say how many, or the
  column asserts something false about the user's afternoon.
- **`rows` is honoured exactly.** The caller has budgeted; returning more corrupts the column
  below, returning fewer leaves the pane's previous paint on screen.
- **`agendaHeight` exists so T06 can budget** without rendering twice.

## Tests

Fixed `now`, fixture cache, escapes stripped before asserting.

Content:
- [ ] the 14:20 scenario renders `NOW` on the 14:00 event with `until 15:00` beneath it
- [ ] the finished 09:30 and 11:00 rows are absent
- [ ] an all-day event renders `ALL DAY` and sits above every timed row
- [ ] an unanswered invitation renders `?` and an answered one does not
- [ ] every event row carries its calendar's slug
- [ ] two calendars get two different colour codes, and each event uses its own calendar's
- [ ] the roll-over renders `TOMORROW` in the scope line and tomorrow's events
- [ ] nothing today and nothing tomorrow renders `nothing today or tomorrow`
- [ ] no calendars configured renders `no calendars` and `agenda add home`

Failure states:
- [ ] a network error on a calendar keeps its cached events and adds `offline` with an age
- [ ] a fresh successful cache adds **no** staleness line
- [ ] an auth error replaces that calendar's rows with `sign-in expired · agenda add <slug>`
- [ ] a gone/forbidden calendar renders `calendar gone · agenda rm <slug>`
- [ ] one calendar in a permanent error does not remove the other's events
- [ ] both calendars in error still renders a header and both loud lines

Geometry:
- [ ] the output has exactly `rows` entries at several row counts
- [ ] no line exceeds `width` visible columns, with and without colour codes present
- [ ] more events than rows produces `… +N more · agenda` with the correct N
- [ ] enough rows for everything produces **no** overflow line
- [ ] `rows` too small for even the header degrades without throwing
- [ ] a long event title is clipped with `…` and never wraps
- [ ] a long slug cannot squeeze the title column to nothing
- [ ] `agendaHeight` equals the line count `renderAgenda` produces when given that many rows

Colours:
- [ ] `pickColour` never returns a taken name while a free one remains
- [ ] with all eight taken it returns a valid palette name rather than throwing
- [ ] it is a function of `rand` alone — the same `rand` and `taken` always give the same answer
- [ ] the palette has eight entries and no duplicate names or codes

Boundary:
- [ ] the T02 forbidden-import check still passes over the grown file

## Done when

- [ ] every case above is covered and `spikes/agenda-test/run.sh` prints `ALL PASS`
- [ ] the full three-suite test command passes
- [ ] `renderAgenda` reads no clock and touches no file — the boundary check proves it
