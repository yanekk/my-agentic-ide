# T03 — picker-render

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Teach the picker model to draw each program's list under its entry, as in the approved prototype
(`plans/fleet-picker-status/prototype/index.html`, non-binding on detail): the row share between
the two entries, `+N more`, the loading, unavailable and empty lines, clipping, and the title
dropping at the small size. It takes items already ordered (DESIGN §3.3), so it needs no other
task's code.

## Design sections this implements

DESIGN §2.2 (glyphs, colours), §2.4 (row share, clipping, frame), §2.7 (the dim lines), §3.3.
`plans/fleet-picker/DESIGN.md` §2.3 for the parts of the frame that stay.

## Files

- `bin/cockpit-fleet-picker-model.mjs` (`render` gains a fourth argument)
- `spikes/fleet-picker-test/model.test.mjs`
- `spikes/fleet-picker-test/process.test.mjs` (only its expected frames, which now carry `…`)

## Interface

```js
// lists: { claude: List, pir: List }, List per DESIGN §3.3; omitted → both "loading"
export function render(state, cols, rows, lists)   // → exactly `rows` strings, none wider than `cols`
```

Lines, under each entry, indented past the entry's name (7 columns at 50+ columns, 3 below):

```
       ● needs you  sdet-tools / epic-readiness        (wait: glyph and word yellow)
       ◐ working    sdet-tools / branch-tilt-setup
       ✗ failed     sdet-tools / denormalization-gaps  (bad: glyph and word red)
       ✓ done 12m   cribl / pack-delete-plumbing       (done: whole line dim)
         +2 more                                       (dim)
       …                                               (loading, dim)
       nothing running                                 (dim)
       status unavailable                              (dim; or the { unavailable } text)
```

Colours are SGR 33 (yellow), 31 (red), 2 (dim), reset after each styled run, applied after
clipping so no escape is cut, as `render` already does.

## Tests

- [ ] `render(state, cols, rows)` with no lists draws both entries with `…` under them
- [ ] the four classes draw their glyph, word column (as wide as the entry's longest word) and name
- [ ] a long name is cut with `…` so the line is exactly within the width; the word is never cut
      before the name is
- [ ] row share at 59×22 and 39×12: half each, odd row to Claude, unused rows given to the other
- [ ] overflow shows `rows - 1` items and `+N more` with the right N; one spare row shows `+N more`
      alone rather than a cut item
- [ ] at 18+ rows the title and rule stay; below 18 they are gone; the hint is always the last line
- [ ] `[]` → `nothing running`; `"unavailable"` → `status unavailable`; `{ unavailable: t }` → t
- [ ] every line of every case within `cols` visible columns, exactly `rows` lines (sweep 30–80
      columns, 8–30 rows)
- [ ] the existing frame tests still describe the frame with empty lists (update the expected
      frames for the new list lines; the entry lines and hint are unchanged)

## Done when

- [ ] `bash spikes/fleet-picker-test/run.sh` passes model and purity checks (the process suite may
      need T04 for its frame snapshots; if those break here, update them in this task).
- [ ] Every line of DESIGN §2.4 has a test.
- [ ] The model still imports nothing.
