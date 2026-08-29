# T00 — Pair-in-the-slot spike, and promote the planning probes

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

In browse mode the diff slot holds **two panes at once** — the browser on the left, the viewer
on the right — where it has always held one, and its parking area holds **up to three panes per
agent** (revdiff, browser, viewer). Nothing else in this plan is safe until the pair can be
built, parked as a unit and restored with its geometry intact, on a real mux.

**The core question was already answered at plan review, and the answer is yes.** Measured on a
headless mux:

```
pair in slot   broot 47x18   micro 72x18   fleet 120x11
parked         broot 47x30   micro 72x30   (their own tab)
restored       broot 47x18   micro 72x18   fleet 120x11    <- identical
```

micro came back holding its file with `[ro]` set and the cursor at (1,1); broot came back
drawing. So this task is **not** a go/no-go on the architecture any more — it is the task that
turns a one-off measurement into a spike a later session can re-run, and that pushes on the
cases the plan-review probe did not reach (below).

It also promotes the four probes already run during planning into `spikes/browse-mode/`, so
the numbers quoted in DESIGN §2.4 and §2.6 can be **re-run rather than believed**. Those
scripts are preserved in `plans/browse-mode/probes/` — they were written in a job scratch
directory that is deleted with the job.

## Design sections this implements

DESIGN §2.6 (parking the pair), §3.1 (why the browser IS in the diff slot, and the measurement
that reversed the earlier decision), §5.2 (seatbelts — headless mux only).

## Files

```
spikes/browse-mode/probe-push.sh      from probes/micro-push2.sh   — the push mechanism
spikes/browse-mode/probe-e2e.sh       from probes/e2e.sh           — broot Enter -> micro
spikes/browse-mode/probe-park.sh      from probes/park.sh          — micro survives parking
spikes/browse-mode/probe-title.sh     from probes/title.sh         — pane title reported
spikes/browse-mode/probe-pair-slot.sh  NEW                          — the pair in the slot
spikes/browse-mode/RESULTS.md         NEW                          — what each one showed
```

Nothing outside `spikes/browse-mode/` is touched.

**`probes/tui-render.py` is deliberately not in that list.** It is the pyte-based screen renderer
every planning probe was *looked at* through, and it needs a Python venv (`pip install pyte`)
that this project does not otherwise have — DESIGN §5 reserves new dependencies to the user.
Promote it **only if the user has said to**; otherwise leave it in `plans/browse-mode/probes/`
and say in `RESULTS.md` that the rendered screens came from it and how to get it back.
(`probes/README.md` says "T00 should decide"; it is not a session's to decide.)

**The promoted `probe-e2e.sh` uses `{file:path-from-directory}` in its broot verb, while the
shipped verb (T03) uses `{file}`** — the shipped one relativises on the pure side instead
(`planPush`, T01). Do not "fix" either to match the other; record the difference in `RESULTS.md`
so a later reader does not mistake the probe for proof of the shipped verb.

## Interface

`probe-pair-slot.sh` models one agent whose diff slot alternates between **revdiff alone** and
**the browser+viewer pair**, against a headless `wezterm-mux-server` with its own socket and pid
file:

```
 1. build a cockpit-shaped layout: fleet, diff slot (full width), terminal, strip, footer
 2. put revdiff in the diff slot on a scratch repo;        record geometry
 3. enter browse: split broot INTO the slot, park revdiff, then split micro
    to broot's right at --percent 60;                      record geometry
 4. push two files into micro so it has tabs
 5. leave browse: park the PAIR into one tab (move broot out, then
    split-pane --move-pane-id micro in beside it), restore revdiff;
                                                           record geometry
 6. re-enter browse: restore broot into the slot, then micro to its right;
                                                           record geometry + tab bar
 7. assert: the slot's total cols/rows are IDENTICAL at steps 2, 3, 5 and 6
    assert: broot is 47 and micro 72 of 120 columns at steps 3 and 6
    assert: micro still has both tabs at step 6
    assert: revdiff is still revdiff at step 5 (not a bare shell)
    assert: broot is still drawing at step 6 (not a bare shell)
    assert: exactly one of {revdiff, the pair} is in the cockpit tab at any moment
```

The **opposite order** matters and is not optional: the diff pane spans the window, so its
geometry *is* the slot. Park it first and the only thing left to split is the fleet pane's
half-width region. Split the incoming occupant *into* the outgoing one, then dispose of — or
park — the outgoing one. This is already documented in `CLAUDE.md`; the probe must not invent
its own order. With a pair, the **browser** is the one split into the outgoing occupant, and the
viewer is split off the browser afterwards.

**What the plan-review probe did not reach — this is where the value is now:**

- **Two agents, both in browse.** Three parked panes for one agent and three for another,
  alternating. The plan-review probe used one agent.
- **The empty-slot rebuild** (`rebuildDiffSlot`) with a *pair* to restore rather than one pane —
  it parks the terminal and the strip first, then has to put back two.
- **A window resize while the pair is parked**, then a restore. Parked panes are resized to the
  full tab and back; the pair must not return at the wrong ratio.
- **How long a pair swap takes** against a single-pane swap. "Returning is instant" is the
  cockpit's whole promise, and two parks instead of one is the cost the user accepted — it
  belongs in `RESULTS.md` as a number, not an assumption.

**No `timeout(1)` on this machine** (FINDINGS). Background the process and kill it.

## Tests

This task *is* a test. The assertions above are the deliverable, plus:

- [ ] the slot geometry is identical across all four recordings, not merely similar
- [ ] micro's tab bar still lists both files after a full park/restore round trip
- [ ] revdiff is still running after its round trip — pane title *or* framed screen, the same
      two-signal check the daemon uses, because the title lags
- [ ] the probe leaves no pane, tab, socket, pid file or temp directory behind on exit
- [ ] the probe refuses to run if `WEZTERM_UNIX_SOCKET` would point at a live cockpit
- [ ] every probe script runs green from a clean checkout with no arguments

## Done when

- [ ] `spikes/browse-mode/probe-pair-slot.sh` runs green and prints the four geometries
- [ ] the four promoted probes run green and each has a section in `RESULTS.md` saying what it
      measured and what the number was
- [ ] `RESULTS.md` records the pair-swap timing beside the single-pane swap, and states plainly
      that the slot can alternate revdiff and the pair — including with **two** agents in browse

## If any of the four new cases fails

**Stop and ask the user.** Do not pick a fallback. The shape — browser and viewer side by side in
the top pane, with nothing to type — is a decision the user made at plan review with the two-pane
cost put to them explicitly (DESIGN §7), so any retreat from it is theirs, not a session's.
