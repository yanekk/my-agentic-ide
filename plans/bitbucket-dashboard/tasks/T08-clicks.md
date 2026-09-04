# T08 — Clicks: tabs, paging, Open

**Phase:** 4 · **Depends on:** T07 · **Weight:** heavy

## Goal

Make the dashboard react. Enable mouse reporting in the welcome pane, turn a click into the verb
of whichever hit-zone it landed in, and have the daemon act on the tab, paging and Open verbs.
This is the same click→cmd→daemon path the strip already uses; the weight is adding input to a
pane that has only ever drawn, without breaking its pure-display role. Review/Address verbs are
recognised but left to T09.

## Design sections this implements

DESIGN §2.5 (paging), §2.7 (Open via the browser seam), §2.8 (tabs), §3.4 (clicks reach the
daemon through `cmd`; verbs carry slug/id), §3.5 (the daemon writes view-state).

## Files

- `bin/cockpit-welcome.mjs` — enable mouse (`ESC[?1000h ESC[?1006h`), parse SGR clicks, map to
  a hit-zone, append its verb to `~/.claude/cockpit/cmd`. Same shape as `cockpit-strip.mjs`.
- `bin/cockpitd.mjs` — dispatch the new verbs in the `tail(CMD_FILE)` block.

## Interface

```
// welcome.mjs: on a left-button press at (x,y), find the hit-zone containing it and append verb+"\n".
// The pane still moves no panes and makes no network call — it only writes a verb.

// cockpitd.mjs cmd dispatch adds:
bb-tab:toReview | bb-tab:mine   -> store.writeView({ ...view, tab })
bb-page:prev | bb-page:next     -> store.writeView with the active tab's page ±1 (clamped by the model)
bb-open:{slug}/{id}             -> look up the PR's htmlUrl in the cache;
                                   spawn(process.env.BITBUCKET_BROWSER || "/usr/bin/open", [url], { detached }).unref()
bb-review:{slug}/{id}           -> recognised, no-op until T09
bb-address:{slug}/{id}          -> recognised, no-op until T09
```

A verb carries the slug and id so the daemon finds the PR in the cache directly, without the
pane and the daemon needing to agree on row order (which would drift with paging).

## Tests

- [ ] a click inside a tab's zone appends the right `bb-tab:` verb; the daemon rewrites the view file
- [ ] switching tabs then reading the view shows the new active tab
- [ ] a `bb-page:next` past the last page is clamped (no page beyond `pages`)
- [ ] a `bb-open:` verb calls the fake opener (`BITBUCKET_BROWSER`) with the PR's htmlUrl from the cache
- [ ] a `bb-open:` for an id absent from the cache is a safe no-op, not a crash
- [ ] a click outside every hit-zone emits nothing
- [ ] the welcome pane still starts and draws when mouse reporting cannot be enabled (headless)

## Done when

- [ ] clicking a tab switches it; clicking the pager changes page; clicking Open launches the (fake, in test) browser
- [ ] verbs carry slug/id and the daemon resolves them against the cache
- [ ] Review/Address verbs are recognised and safely inert
- [ ] verified by hand that a click lands on the intended row in a live cockpit

## Needs a person

Mouse coordinates are only real in the running mux.

```
# In a live cockpit at the fleet list with PRs shown: click the tabs, the pager, and an Open button.
```

Expect: tabs switch, the page changes, Open opens the PR in your browser.
Tell me: does each click hit what you aimed at, including on a wrapped two-line row?
