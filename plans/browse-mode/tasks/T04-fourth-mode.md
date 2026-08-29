# T04 — `browse` as the fourth mode

**Phase:** 2 · **Depends on:** — · **Weight:** medium

## Goal

Teach the daemon that the diff slot has four modes rather than three, so `⌥[`/`⌥]` reach
`browse`, the right command is launched into the slot, and the strip and footer say where you
are. This task makes the mode **reachable and visible**; T05 makes it **park**.

## Design sections this implements

DESIGN §2.1 (the fourth stop), §2.2 (the viewer's command line), §2.7 (what the strip shows),
§3.4 (publishing `panes.json.viewer`).

## Files

```
bin/cockpitd.mjs          DIFF_MODES, diffCommand(), publishPanes({viewer})
bin/cockpit-strip.mjs     render "browse"
spikes/cockpit-test/run.sh   extended
```

## Interface

```js
const DIFF_MODES = ["uncommitted", "lastcommit", "custom", "browse"];
```

`diffCommand(reviewFile, mode, ref)` returns, for `browse`:

```sh
micro -readonly true
```

started in the agent's worktree, with **no file argument** — the first push replaces micro's
`No name` buffer via `open` (DESIGN §2.2). It takes no `reviewFile` and no `ref`: browse mode
produces no annotations, so nothing is watched and nothing can be flushed.

`panes.json` gains:

```json
{ "viewer": 7 }     // the viewer pane id while the ATTACHED agent is in browse mode
{ "viewer": null }  // any other time
```

Published through the existing `publishPanes()`, so it is written atomically with the rest.
**This is what `cockpit-open` reads and what makes it refuse (T02).** It must be cleared on
detach, on a mode change away from browse, and when the agent is reaped — a stale id points at
a pane that is now somebody else's.

Cycling **into** `browse` must not fire the custom-ref prompt: that is `custom`'s behaviour and
is keyed on the transition into `custom` specifically.

## Tests

- [ ] `⌥]` from `custom` lands on `browse`; `⌥]` from `browse` wraps to `uncommitted`
- [ ] `⌥[` from `browse` lands on `custom` **and fires the custom prompt**, because that is a
      transition *into* custom
- [ ] `⌥[` from `uncommitted` lands on `browse` and fires **no** prompt
- [ ] the mode is per agent: putting agent A in `browse` leaves agent B in `uncommitted`
- [ ] a new agent starts at `uncommitted`, never in `browse`
- [ ] the browse command launched is `micro -readonly true` with **no file argument** and in
      the agent's worktree
- [ ] `panes.json.viewer` is set on entering browse and **cleared** on leaving it
- [ ] `panes.json.viewer` is cleared on detach
- [ ] `⌥[`/`⌥]` while a **terminal** holds focus still cycle terminals, not modes
- [ ] the strip renders `browse`; the footer legend does not imply three modes
- [ ] no annotation watch, review file or reflog watch is created for a browse-mode pane

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, covering every row above
- [ ] `panes.json` carries a correct `viewer` in every state, asserted rather than assumed
- [ ] `spikes/browse-test/run.sh` still green
