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

- **Line one**: repo, `#id`, title, author (To review), ✓/✎ counts, then the **one** primary button
  `[Review|Address]`. The `[Open]` button is **removed** (DESIGN §3). Line one now carries **two**
  hit-zones, both stamping **line one's** y: the primary button's spawn verb, and an **open zone**
  (`bb-open:{repo}/{id}`) spanning from the row start to just before the button — a click anywhere on
  the line but the button opens the PR.
- **Line two**, indented under the title: `activityTags(...)` first (each a small tag, space-separated
  as a group), then `ageLabel(...)`, then `sourceBranch → destBranch` — the three left groups joined
  by ` · ` — then, pushed right, `N files` and `+A −R`. Carries **no** hit-zones. When `pr.diff` is
  `null` (not fetched, DESIGN §2.4) the file/line items are omitted entirely — not drawn as zeros.
- **Drop order** (DESIGN §2) as the width narrows: branch first, then `+A −R`, then `N files`, always
  keeping the age and the tags. Each dropped item frees its space; nothing wraps; line two is clipped
  to width as a final guard.
- **Row separator** (DESIGN §2.6): a **dim underline on each PR's second line**, drawing a full-width
  hairline between PRs without a dedicated row. It shares line two's row, so it costs no vertical
  space. Pick whether the last row on a page draws it and test that choice.
- **Two lines per row** for the pagination budget: tabs (1) + header (1) reserved; pager (1 more)
  only when the list overflows; the remaining lines / 2, floored, min 1, is PRs-per-page. `paginate`
  is unchanged (pass it the PR count).
- **Emphasis**: the hit-zone whose verb equals `emphasis.verb` draws emphasised — the primary button
  in `hover` (bright + fill) or `press` (reverse video); the **open zone** in `hover` (the title
  underlined / line lit) or `press` (reverse video across the line-one span). Everything else at rest.
  No emphasis → byte-identical to no-emphasis.

## Done when

- Every shown PR renders two lines; line two shows age, tags, branch and (when fetched) diff size,
  degrading by the drop order as width shrinks.
- A dim hairline separates the PRs, on the second line, adding no rows.
- Output is still exactly `rows` lines, each ≤ `width` visible columns.
- The primary-button and open-zone hit-zones resolve on line one; `verbAt` maps a click on the button
  to its spawn verb and a click anywhere else on line one to `bb-open`.
- Pagination fits the right number of two-line rows; the pager appears only when it should; `pages`
  is correct.
- Emphasis renders as specified and is a no-op when absent.
- The full test command is green and quiet on pass; the click/render tests are updated, not deleted.

## Tests

- Two-line layout: each tag combination draws the expected line two in order tags · age · branch with
  ` · ` between groups (no leading `·` when there are no tags); `pr.diff === null` omits the file/line
  items (no zeros); alignment holds across widths.
- Drop order: at descending widths, branch drops, then `+A −R`, then `N files`; age and tags survive
  to the narrowest; a very narrow width still returns `rows` lines and clips cleanly.
- Separator: the underline is present on the row-separating line and absent where the chosen rule
  says (e.g. not after the last row, if that is the choice); it adds no line to the output.
- Pagination: N PRs at a `rows` budget yield the right PRs-per-page (half of single-line); pager
  past one page steals exactly one line; a remembered page past the shrunk end still falls back.
- Hit-zones: the primary button and the open zone sit on line one; `verbAt(x, firstLineY)` on the
  button returns its spawn verb, elsewhere on line one returns `bb-open`, and `verbAt(x, secondLineY)`
  returns null; the open zone stops before the button (a click on the button is the button, not open);
  a zone clipped off a narrow pane is dropped.
- Emphasis: `press` on the button reverse-videos the button and on the open zone reverse-videos the
  line-one span; `hover` applies each target's hover style; an off-page emphasis verb is a no-op; no
  emphasis reproduces the no-emphasis bytes for a fixed fixture.
- Empty / unconfigured / expired states unchanged (one line each).

## Notes

Keep line one's `computeLayout` intact — the two-line change is additive. Do not move the author down
(DESIGN §2.5, §8). The underline separator relies on terminals underlining trailing spaces (WezTerm
does); the test asserts the SGR underline wraps the line, not how a terminal paints it. Emphasis is a
rendering concern only: the model decides how a button looks when told, never when it is hovered.
