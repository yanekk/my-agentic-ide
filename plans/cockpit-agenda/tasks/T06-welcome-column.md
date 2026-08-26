# T06 — The right column: NOTES over AGENDA

**Phase:** 4 · **Depends on:** T03, T05 · **Weight:** medium

## Goal

Put the agenda on screen. The fleet view's resting pane is already split down the middle —
greeting on the left, NOTES on the right — and this stacks the agenda under NOTES in that right
column, with a rule between them.

It is **drawn**, not given a pane. The diff slot is swapped by parking exactly one pane and
splitting the incoming one into it; a real agenda pane would make every agent switch a
three-pane dance for a list nothing ever types into. That is the same reasoning that put the
notes column here, and this task must not disturb it: after this change, entering an agent must
still park exactly one pane and bring revdiff back at full width.

## Design sections this implements

`DESIGN.md` §2.6 (where it is drawn, the row budget, the empty state, the narrow pane), §2.7
(the stale and loud lines, as rendered by T03), §3.4 (the pane watches the directory and
redraws).

## Files

- `bin/cockpit-welcome.mjs` — modified; the `visibleLen`/`pad`/`clip` helpers move to
  `cockpit-agenda-model.mjs` (T03) and are imported back
- `spikes/notes-test/run.sh` — extended; it already owns the frame harness for this pane
- `spikes/agenda-test/run.sh` — extended if the split arithmetic is easier tested there

## Interface

No new public interface. The right column becomes:

```
NOTES                                   4
────────────────────────────────────────
5c4f  2h   rebase before the PR
0665  Mon  skipped the flaky test — some agent
… +7 more · note ls
────────────────────────────────────────
AGENDA                              14:20
Wed 26 Aug
▌ NOW      sprint review             work
▌   └ until 15:00
▌ 17:30    pick up kids              home
```

The row budget, exactly:

```
sep        = 1
wanted     = agendaHeight({ width, calendars, cache, now })
cap        = max(4, floor((rows - sep) / 2))
agendaRows = min(wanted, cap)
notesRows  = rows - sep - agendaRows
if (notesRows < 3) { agendaRows = max(0, rows - sep - 3); notesRows = 3 }
if (agendaRows === 0) → draw notes alone, no separator
```

Non-obvious, and why:

- **Content-driven, not a fixed half.** In the evening the agenda is two lines; a fixed half
  would show `nothing left today` above four blank rows while notes overflowed below.
- **Notes never fall below three rows** — a heading, a rule and one note. Below that the section
  is not a list, it is a label.
- **The pane still reads `Date.now()` exactly once per paint** and passes it in. That is one of
  only two places in the whole feature that reads a clock (DESIGN §3.4); do not add a third.
- **The pane must stay pure display** — no shell command, no pane move, no network. `cockpitd`
  owns it as the repo's diff slot on exactly that basis, and the daemon is what fetches (T07).
- **The existing `fs.watch(DIR)` gains `agenda-cache.json` and `agenda.json`** to its
  interesting-filenames list. It watches the **directory**, not the files, because every write
  is temp-plus-rename and a file watch would go deaf after the first one.
- **Below the existing narrow threshold the pane already collapses to one centred greeting.**
  Leave that alone; the agenda is not drawn there either.
- **`spikes/notes-test/run.sh` currently passes 39 assertions.** Every one must still pass:
  breaking a notes assertion means this task changed something it was not asked to.

## Tests

Through the existing frame harness, escapes stripped.

- [ ] with calendars configured, one frame contains both the `NOTES` heading and the `AGENDA`
      heading, with a rule between them
- [ ] the agenda's events appear below the notes, never above
- [ ] with no calendars configured, the agenda section shows `no calendars` / `agenda add home`
      and notes are unaffected
- [ ] a short agenda gives its slack to notes — more notes are visible than with a long agenda
      at the same pane size
- [ ] a long agenda is capped at half the column and notes still get at least three rows
- [ ] a very short pane drops the agenda entirely rather than starving notes below three rows
- [ ] the frame has exactly `rows` lines at several sizes, agenda present and absent
- [ ] no line exceeds the pane width, with colour codes present
- [ ] the left greeting is unchanged at every size
- [ ] the narrow pane still collapses to the single centred greeting, with no agenda
- [ ] a corrupt `agenda-cache.json` draws the pane anyway (notes and greeting intact)
- [ ] **all 39 existing notes-test assertions still pass**

## Done when

- [ ] the full three-suite test command passes
- [ ] `bin/cockpit-welcome.mjs` still runs no command, moves no pane and opens no socket
- [ ] the pane redraws when `agenda-cache.json` is replaced, without a restart

## Needs a person

Nothing here can see the screen. Raise this the moment the tests are green and **wait**:

```
# rebuild the cockpit the supported way — close the WezTerm window and reopen it
```

Expect: the fleet view's top pane shows the greeting on the left, and on the right NOTES above
a rule above AGENDA with today's events.
Tell me: (1) does the divider between the two halves still line up down the whole pane, and
(2) are the two calendars' colours actually distinguishable on your terminal theme? Nothing
automated can answer either.
