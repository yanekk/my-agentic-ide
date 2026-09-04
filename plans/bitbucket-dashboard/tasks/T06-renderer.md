# T06 — Pure renderer and hit-zones

**Phase:** 3 · **Depends on:** T03 · **Weight:** light

## Goal

Draw the dashboard as terminal lines, and say where every clickable thing is. Pure: given the
cache, the view-state, a width, a row budget and `now`, return the lines to paint and the list
of hit-zones a click can land in. This is the whole visual behaviour, testable without a pane —
T07 only wires it to `cockpit-welcome.mjs`, and T08 only maps a click to a hit-zone's verb.

## Design sections this implements

DESIGN §2.2 (tabs, columns), §2.4 (counts, dim `·` for zero), §2.5 (paging control), §2.n
(empty, unconfigured, offline, expired states), §3.3 (renderDashboard, Zone).

## Files

- `bin/cockpit-bitbucket-model.mjs` — add the render functions (same pure module as T03).
- `spikes/bitbucket-test/render.test.mjs` — new.

## Interface

```
export function renderDashboard({ width, rows, cache, view, now }) -> {
  lines: string[],        // exactly `rows` lines, ANSI included, no trailing newline
  hitZones: Zone[],       // Zone = { verb, x0, x1, y }  (1-indexed pane-local, y is the line)
}
// verbs the zones emit (consumed by T08):
//   bb-tab:toReview | bb-tab:mine
//   bb-page:prev | bb-page:next
//   bb-open:{slug}/{id} | bb-review:{slug}/{id} | bb-address:{slug}/{id}
```

The renderer decides the states in this order: unconfigured (no key/workspace/repos) → the
setup greeting; whole-dashboard auth error → the expired line; otherwise the active tab's table,
with a per-tab empty state, a stale/offline footnote when any repo's `fetchedAt` is old or
errored, and the pager when the list overflows the row budget. Titles word-wrap within the title
column; a wrapped row is two lines tall and the buttons sit on the row's first line.

## Tests

- [ ] unconfigured (missing any of key/workspace/repos) renders the setup greeting, no table
- [ ] a whole-dashboard auth error renders `sign-in expired · config bitbucket-key`
- [ ] a populated To-review tab renders repo, PR#, wrapped title, author, approvals, comments, buttons
- [ ] the Mine tab has no author column and an Address button
- [ ] a zero count renders a dim `·`, a non-zero renders the number
- [ ] an empty tab renders the "nothing waiting" line, not a bare header
- [ ] an offline/stale cache adds exactly one dim `last updated …` line and still draws rows
- [ ] a per-repo error adds a per-repo dim line without blanking other repos' rows
- [ ] overflow renders the pager and only one page of rows; the hit-zones cover prev/next
- [ ] every button and tab in the output has a matching hit-zone at its drawn coordinates
- [ ] output is exactly `rows` lines at several widths, including the narrow 75%-of-small-window case
- [ ] the purity grep still passes

## Done when

- [ ] every state in DESIGN §2.n renders, tested
- [ ] hit-zones line up with the drawn buttons/tabs/pager (a coordinate test, not a screenshot)
- [ ] the module is still pure
