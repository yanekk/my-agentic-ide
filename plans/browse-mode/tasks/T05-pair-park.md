# T05 — Park the pair, do not kill it

**Phase:** 2 · **Depends on:** T00, T04 · **Weight:** heavy

## Goal

The heavy one. Cycling out of browse mode must **park the browser and the viewer together** and
bring revdiff back; cycling in must park revdiff and bring both back, with every tab still open
and the browser still where you left it in the tree. This is what makes tabs worth having: browse
is a stop in a four-way cycle, so it is passed through constantly, and a pair that is killed on
the way past is an empty viewer every time.

The diff slot now holds **two panes at once** in browse mode, and its parking area holds **up to
three panes per agent** (revdiff, browser, viewer) where it has always held one. The geometry
rule is unchanged — the incoming occupant is still split *into* the outgoing one — but every
place that assumes "one pane, one agent" has to be found.

**Do not start until T00 has run the four cases it names.** The core pair-park round trip was
already measured at plan review and works; what T00 adds is two agents, the empty-slot rebuild,
a resize while parked, and the swap timing.

## Design sections this implements

DESIGN §2.6 (parking, not restarting), §2.n (the tab list is reset on launch, never merged).

## Files

```
bin/cockpitd.mjs             the diffs map, diffModeSet/diffModeCommand, showDiff,
                             rebuildDiffSlot, healMissingPanes
spikes/cockpit-test/run.sh   extended
```

**Both entry points, not just the keyboard.** `⌥[`/`⌥]` go through `diffModeCommand`, but the
footer's `Browse` label is clickable (DESIGN §2.7) and goes through `diffModeSet` — a separate
function that today also ends in `relaunchDiff`. Whatever park/restore path this task builds has
to be reached from both, or clicking the label quits and relaunches while the keys park, and the
tabs vanish depending on how you got there.

## Interface

Where the daemon holds `diffs: Map<jobId, paneId>` it now needs, per agent, a revdiff pane **and
a browse pair** (browser + viewer), any of which may be absent, parked, or in the slot. Whatever
shape is chosen, it must answer these questions cheaply:

```
which occupant of this agent is in the slot right now — revdiff, or the pair?
which should be there for this agent's current mode?
within the pair, which pane is the browser and which the viewer?
which panes belong to this agent, so they can all be disposed when it dies?
```

The switch uses the **existing** park/insert helpers and the **existing** opposite order for the
diff slot: split the incoming occupant *into* the outgoing one, then dispose of — or here, park —
the outgoing one. The incoming inherits the full slot; park first and revdiff comes back at half
width. Measured, and documented in `CLAUDE.md`.

**The pair moves as a unit, in this exact order** (measured at plan review — DESIGN §2.6):

```
leaving browse    move-pane-to-new-tab <browser>
                  split-pane --move-pane-id <viewer> --pane-id <browser> --right --percent 60
                  ... then restore revdiff into the slot as usual

entering browse   split-pane --top --move-pane-id <browser> --pane-id <outgoing>
                  park <outgoing>
                  split-pane --right --percent 60 --move-pane-id <viewer> --pane-id <browser>
```

The browser is the half that carries the slot; the viewer is always split off it afterwards. Do
not restore the viewer first — it inherits the slot and the browser comes back at the wrong size,
the same trap as parking the diff pane before splitting.

Switching between the three **revdiff** modes keeps its current behaviour — quit and relaunch,
because `R` only reloads the same range. Only the transition to and from `browse` parks.

The viewer's tab list (`viewer-tabs.json`) is **reset whenever a viewer is launched fresh**, and
never merged. A wrong `tabswitch <n>` jumps to the wrong file silently; a duplicate tab is
merely untidy.

## Tests

- [ ] uncommitted → browse: revdiff is parked (not killed), **both** halves appear in the slot
- [ ] browse → uncommitted: **both** halves are parked (not killed), revdiff returns
- [ ] browse → uncommitted → browse: the **same two** pane ids come back, not new ones
- [ ] the slot's total geometry is identical before and after a round trip, **and so is the
      47/72 split** — the viewer must not creep wider each cycle
- [ ] the browser is restored into the slot **before** the viewer is split off it; restoring in
      the other order is asserted to be wrong, so a later session cannot "tidy" it
- [ ] revdiff returning from a park is **not** relaunched — its pane id is unchanged and no
      revdiff command is re-sent
- [ ] neither half is relaunched on return — no `broot` or `micro` command is re-sent
- [ ] a second entry into browse does **not** reset the tab list; a fresh launch does
- [ ] the browser comes back with its filter text intact, not at the top of the tree
- [ ] agent A in browse, agent B in uncommitted: switching between them puts the right occupant
      in the slot each time, and no agent's panes are disposed
- [ ] **agent A and agent B both in browse**: switching leaves four parked panes and puts the
      right pair in the slot — the case T00 probes
- [ ] switching agents while A is in browse leaves **both** of A's panes parked and alive
- [ ] cycling among the three revdiff modes still quits and relaunches, unchanged
- [ ] **clicking the footer's `Browse` label parks**, exactly as `⌥]` does — same pane ids back,
      same tabs — and clicking away from browse parks the pair rather than killing it
- [ ] never while the annotation editor is open — the existing guard still holds on the
      revdiff side of the transition
- [ ] `rebuildDiffSlot` with a **pair** in the slot rebuilds correctly (it parks the terminal
      *and* the strip first, as it already does, then puts back two)
- [ ] `healMissingPanes` does not resurrect or dispose a legitimately parked half

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, covering every row above
- [ ] a round trip through browse leaves the same **two** pane ids in the slot, at the same
      split, asserted
- [ ] no path kills a browser or a viewer that merely went out of view
- [ ] `spikes/browse-test/run.sh` still green
