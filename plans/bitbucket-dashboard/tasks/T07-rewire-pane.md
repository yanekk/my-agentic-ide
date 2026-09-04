# T07 — Rewire the welcome pane to 75/25

**Phase:** 3 · **Depends on:** T05, T06 · **Weight:** heavy

## Goal

Put the dashboard on screen. Change `cockpit-welcome.mjs` from greeting-left / notes-right to
**dashboard-left ~75% / notes over agenda ~25%**, drawing the dashboard from the cache via the
model. Read-only: this task shows real PRs but nothing reacts to a click yet. The weight is not
the drawing — it is doing this to the one pane the daemon parks and swaps as the diff slot
without disturbing that invariant.

## Design sections this implements

DESIGN §2.1 (one pane, the 75/25 split, greeting replaced by the unconfigured state), §3.1 (the
pane stays pure display), §3.4 (watches the cache/view files).

## Files

- `bin/cockpit-welcome.mjs` — the split ratio, the left region, the file watches.

## Interface

```
// The left ~75% draws model.renderDashboard(...); the right ~25% keeps NOTES over AGENDA.
// One clock read for the whole paint (as today), passed to the model as `now`.
// Watch DIR for the two new files as well as today's set:
const INTERESTING = new Set([
  "notes.json", "panes.json", "agenda.json", "agenda-cache.json",
  "bitbucket-cache.json", "bitbucket-view.json",
]);
// Below a minimum width the dashboard column keeps a single-column fallback rather than a
// table too narrow to read, mirroring the existing `split` floor for the notes column.
```

Still pure display: no shell command, no pane move, no network — the daemon owns all of that, so
the pane can stay the swappable diff slot. The dashboard's own hit-zones are computed here for
T08 but not yet acted on.

## Tests

- [ ] with a populated cache, the dashboard lines appear in the left ~75% and notes/agenda in the right ~25%
- [ ] an unconfigured cache shows the setup greeting on the left (the old greeting is gone)
- [ ] the notes/agenda column still renders in its narrower width (text-only fallback if needed)
- [ ] the pane repaints when `bitbucket-cache.json` or `bitbucket-view.json` changes
- [ ] the pane never throws on a corrupt cache — it falls back to the empty/unconfigured view
- [ ] the cockpit integration test still parks and restores this pane as the diff slot unchanged

## Done when

- [ ] the top pane shows the dashboard at ~75% with notes/agenda at ~25%, from the cache
- [ ] attaching and leaving an agent still swaps this pane exactly as before (integration test green)
- [ ] verified by hand that it looks right in a live cockpit

## Needs a person

Rendering is only real in WezTerm at a real width.

```
# Open the cockpit at the fleet list with some BitBucket config set (or unconfigured, to see the greeting).
```

Expect: the dashboard fills the left ~75%, notes and agenda sit legibly in the right ~25%,
long titles are truncated with an ellipsis to a single line, counts and buttons are aligned.
Tell me: does it look right and stay readable? Are truncated titles still recognisable, or cut
too short? Anything clipped, misaligned, or too cramped in the 25% column?
