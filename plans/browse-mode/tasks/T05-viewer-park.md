# T05 — Park the viewer, do not kill it

**Phase:** 2 · **Depends on:** T00, T04 · **Weight:** heavy

## Goal

The heavy one. Cycling out of browse mode must **park** the viewer pane and bring revdiff back;
cycling in must park revdiff and bring the viewer back, with every tab still open. This is what
makes tabs worth having: browse is a stop in a four-way cycle, so it is passed through
constantly, and a viewer that is killed on the way past is an empty viewer every time.

The diff slot's parking area now holds **up to two panes per agent** where it has always held
one. The slot itself still holds exactly one pane at a time, so the "park exactly one, split
the incoming into it" invariant is untouched — but every place that assumes one pane per agent
has to be found.

**Do not start until T00 says the slot can do this.**

## Design sections this implements

DESIGN §2.6 (parking, not restarting), §2.n (the tab list is reset on launch, never merged).

## Files

```
bin/cockpitd.mjs             the diffs map, diffModeSet/diffModeCommand, showDiff,
                             rebuildDiffSlot, healMissingPanes
spikes/cockpit-test/run.sh   extended
```

## Interface

Where the daemon holds `diffs: Map<jobId, paneId>` it now needs, per agent, **both** a revdiff
pane and a viewer pane, either of which may be absent, parked, or in the slot. Whatever shape
is chosen, it must answer these three questions cheaply:

```
which pane of this agent is in the slot right now?
which pane should be in the slot for this agent's current mode?
which panes belong to this agent, so they can all be disposed when it dies?
```

The switch, in both directions, uses the **existing** park/insert helpers and the **existing**
opposite order for the diff slot: split the incoming pane *into* the outgoing one, then dispose
of — or here, park — the outgoing one. The incoming pane inherits the full slot; park first and
revdiff comes back at half width. This is measured and already documented in `CLAUDE.md`.

Switching between the three **revdiff** modes keeps its current behaviour — quit and relaunch,
because `R` only reloads the same range. Only the transition to and from `browse` parks.

The viewer's tab list (`viewer-tabs.json`) is **reset whenever a viewer is launched fresh**, and
never merged. A wrong `tabswitch <n>` jumps to the wrong file silently; a duplicate tab is
merely untidy.

## Tests

- [ ] uncommitted → browse: revdiff is parked (not killed), a viewer appears in the slot
- [ ] browse → uncommitted: the viewer is parked (not killed), revdiff returns
- [ ] browse → uncommitted → browse: the **same** viewer pane id comes back, not a new one
- [ ] the slot geometry is identical before and after a round trip
- [ ] revdiff returning from a park is **not** relaunched — its pane id is unchanged and no
      revdiff command is re-sent
- [ ] a second entry into browse does **not** reset the tab list; a fresh launch does
- [ ] agent A in browse, agent B in uncommitted: switching between them puts the right pane in
      the slot each time, and neither agent's panes are disposed
- [ ] switching agents while A is in browse leaves A's viewer parked and alive
- [ ] cycling among the three revdiff modes still quits and relaunches, unchanged
- [ ] never while the annotation editor is open — the existing guard still holds on the
      revdiff side of the transition
- [ ] `rebuildDiffSlot` with a viewer in the slot rebuilds correctly (it parks the terminal
      *and* the strip first, as it already does)
- [ ] `healMissingPanes` does not resurrect or dispose a legitimately parked viewer

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, covering every row above
- [ ] a round trip through browse leaves the same pane id in the slot, asserted
- [ ] no path kills a viewer that merely went out of view
