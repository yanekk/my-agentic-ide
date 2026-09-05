# T03 — Pure renderer: two-line rows, separators and button emphasis

**Phase B · depends on T02 · heavy**

## Goal

Draw each PR as two lines — line one as now, line two the age, tags, branch and diff size with a
drop order — separate the rows with a hairline that costs no extra line, fix the pagination budget
and button hit-zone y for two-line rows, and add the two button emphasis states (hover, press). Still
one pure function in, lines + hit-zones out. The mouse that drives the emphasis is T04/T05.

## Files

- `bin/cockpit-bitbucket-model.mjs` — `buildRow`, `computeLayout`, `renderDashboard`, a line-two
  builder; the emphasis input; the row separator.
- `spikes/bitbucket-test/render.test.mjs` — update the single-line assumptions; add two-line,
  separator, drop-order, pagination, y-stamp and emphasis tests.

## Interface

`renderDashboard` gains one optional field:

```js
renderDashboard({ width, rows, cache, view, now, config,
                  emphasis /* { verb, state: "hover"|"press" } | null */ })
```

- **Line one** unchanged: repo, `#id`, title, author (To review), ✓/✎ counts, `[Review|Address]`
  `[Open]`. Buttons stay here; their hit-zones stamp **line one's** y.
- **Line two**, indented under the title: `ageLabel(...)`, then `activityTags(...)` each as a small
  tag, then `sourceBranch → destBranch`, then `N files`, then `+A −R`. Carries **no** hit-zones.
  When `pr.diff` is `null` (not fetched, DESIGN §2.4) the file/line items are omitted entirely — not
  drawn as zeros.
- **Drop order** (DESIGN §2.2) as the width narrows: branch first, then `+A −R`, then `N files`,
  always keeping the age and the tags. Each dropped item frees its space; nothing wraps; line two is
  clipped to width as a final guard.
- **Row separator** (DESIGN §2.6): a **dim underline on each PR's second line**, drawing a full-width
  hairline between PRs without a dedicated row. It shares line two's row, so it costs no vertical
  space. Pick whether the last row on a page draws it and test that choice.
- **Two lines per row** for the pagination budget: tabs (1) + header (1) reserved; pager (1 more)
  only when the list overflows; the remaining lines / 2, floored, min 1, is PRs-per-page. `paginate`
  is unchanged (pass it the PR count).
- **Emphasis**: a button whose zone verb equals `emphasis.verb` draws in `hover` (bright + faint
  fill) or `press` (reverse video); others at rest. No emphasis → byte-identical to no-emphasis.

## Done when

- Every shown PR renders two lines; line two shows age, tags, branch and (when fetched) diff size,
  degrading by the drop order as width shrinks.
- A dim hairline separates the PRs, on the second line, adding no rows.
- Output is still exactly `rows` lines, each ≤ `width` visible columns.
- Button hit-zones resolve on line one; `verbAt` maps a click to the right verb after the change.
- Pagination fits the right number of two-line rows; the pager appears only when it should; `pages`
  is correct.
- Emphasis renders as specified and is a no-op when absent.
- The full test command is green and quiet on pass; the click/render tests are updated, not deleted.

## Tests

- Two-line layout: each tag combination draws the expected line two; `pr.diff === null` omits the
  file/line items (no zeros); alignment holds across widths.
- Drop order: at descending widths, branch drops, then `+A −R`, then `N files`; age and tags survive
  to the narrowest; a very narrow width still returns `rows` lines and clips cleanly.
- Separator: the underline is present on the row-separating line and absent where the chosen rule
  says (e.g. not after the last row, if that is the choice); it adds no line to the output.
- Pagination: N PRs at a `rows` budget yield the right PRs-per-page (half of single-line); pager
  past one page steals exactly one line; a remembered page past the shrunk end still falls back.
- Hit-zones: `[Review]`/`[Open]` sit on line one; `verbAt(x, firstLineY)` returns the button verb,
  `verbAt(x, secondLineY)` returns null; a zone clipped off a narrow pane is dropped.
- Emphasis: `press` puts reverse-video on exactly that button; `hover` applies the hover style; an
  off-page emphasis verb is a no-op; no emphasis reproduces today's bytes for a fixed fixture.
- Empty / unconfigured / expired states unchanged (one line each).

## Notes

Keep line one's `computeLayout` intact — the two-line change is additive. Do not move the author down
(DESIGN §2.5, §8). The underline separator relies on terminals underlining trailing spaces (WezTerm
does); the test asserts the SGR underline wraps the line, not how a terminal paints it. Emphasis is a
rendering concern only: the model decides how a button looks when told, never when it is hovered.
