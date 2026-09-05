# T02 — Pure renderer: two-line rows and button emphasis

**Phase B · depends on T01 · heavy**

## Goal

Draw each PR as two lines — line one exactly as now, line two the age and tags — fix the pagination
budget and the button hit-zone y for two-line rows, and add the two button emphasis states (hover,
press) as pure rendering variants. Still one pure function of cache/view/width/rows/now in, lines +
hit-zones out. This is the visible change; the mouse that drives the emphasis is T03/T04.

## Files

- `bin/cockpit-bitbucket-model.mjs` — `buildRow`, `computeLayout`, `renderDashboard`, and a small
  line-two builder; add the emphasis input.
- `spikes/bitbucket-test/render.test.mjs` — update the single-line assumptions; add two-line,
  pagination, y-stamp and emphasis tests.

## Interface

`renderDashboard` gains one optional field on its argument object:

```js
renderDashboard({ width, rows, cache, view, now, config,
                  emphasis /* { verb: string, state: "hover"|"press" } | null */ })
```

- Line one is unchanged: repo, `#id`, title, author (To review), ✓/✎ counts, `[Review|Address]`
  `[Open]`. The buttons stay here, so their hit-zones stamp **line one's** y.
- Line two is new: indented under the title column, `ageLabel(...)` then the `activityTags(...)`
  each as a small tag (e.g. `NEW`), space-separated, dim/coloured. It carries **no** hit-zones.
- A row is two lines. Pagination now fits `floor(available / 2)` PRs (DESIGN §2). Recompute the
  budget: tabs (1) + header (1) reserved; when the list overflows a page, the pager costs one more
  line; the remaining lines divided by two, floored, min 1, is PRs-per-page. `paginate` is unchanged
  (it counts items) — pass it the PR count.
- Emphasis: when `emphasis` is set and a button's zone verb equals `emphasis.verb`, draw that button
  in `hover` (bright + faint fill) or `press` (reverse video). Every other button at rest. No
  emphasis, or a verb matching nothing → all rest, byte-identical to today.

## Done when

- Every shown PR renders two lines; line two shows the age and the applicable tags; a PR with no
  tags shows just the age.
- The output is still exactly `rows` lines, each ≤ `width` visible columns (the agenda contract the
  parent render already keeps).
- Button hit-zones resolve on line one; `verbAt` still maps a click to the right verb after the
  layout change.
- Pagination fits the right number of two-line rows and the pager appears only when it should;
  `pages` returned for the daemon's clamp is correct.
- The emphasis states render as specified and change nothing when absent.
- The full test command is green and quiet on pass; the click tests (`render.test.mjs` and any in
  the parent suite that assumed one line) are updated, not deleted.

## Tests

- Two-line layout: a PR with each tag combination draws the expected line two; alignment (line two
  indented under the title) holds across widths; a very narrow width still returns `rows` lines and
  clips cleanly.
- Pagination: N PRs at a given `rows` budget yield the right PRs-per-page (half of single-line);
  pager appears past one page and steals exactly one line; a remembered page past the shrunk end
  falls back (parent behaviour) still holds.
- Hit-zones: the `[Review]`/`[Open]` zones sit on the row's first line; `verbAt(x, firstLineY)`
  returns the button verb, `verbAt(x, secondLineY)` returns null; a zone clipped off a narrow pane
  is dropped (parent rule).
- Emphasis: `emphasis:{verb, state:"press"}` puts reverse-video on exactly that button's cells and
  leaves others at rest; `"hover"` applies the hover style; an emphasis verb not on the page is a
  no-op; no emphasis reproduces today's bytes for a fixed fixture.
- Empty state and the unconfigured/expired states are unchanged (one line each).

## Notes

Keep line one's column logic (`computeLayout`) intact — the two-line change is additive. The
temptation is to also move the author down; do not (DESIGN §2.3, §8). The emphasis is a rendering
concern only: the model does not decide *when* a button is hovered or pressed, only how it looks
when told.
