# T00 — Two-pane slot spike, and promote the planning probes

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Browse mode makes the diff slot's parking area hold **two panes per agent** — that agent's
revdiff and that agent's viewer — where it has always held one. Nothing else in this plan is
safe until that is shown to work on a real mux, with real geometry. This task proves it, and
it is throwaway code whose only job is to answer the question.

It also promotes the four probes already run during planning into `spikes/browse-mode/`, so
the numbers quoted in DESIGN §2.4 and §2.6 can be **re-run rather than believed**. Those
scripts are preserved in `plans/browse-mode/probes/` — they were written in a job scratch
directory that is deleted with the job.

## Design sections this implements

DESIGN §2.6 (parking, not restarting), §3.1 (why the browser is not in the diff slot),
§5.2 (seatbelts — headless mux only).

## Files

```
spikes/browse-mode/probe-push.sh      from probes/micro-push2.sh   — the push mechanism
spikes/browse-mode/probe-e2e.sh       from probes/e2e.sh           — broot Enter -> micro
spikes/browse-mode/probe-park.sh      from probes/park.sh          — micro survives parking
spikes/browse-mode/probe-title.sh     from probes/title.sh         — pane title reported
spikes/browse-mode/probe-two-pane.sh  NEW                          — the actual question
spikes/browse-mode/RESULTS.md         NEW                          — what each one showed
```

Nothing outside `spikes/browse-mode/` is touched.

## Interface

`probe-two-pane.sh` models one agent owning two diff-slot panes and alternating between them,
against a headless `wezterm-mux-server` with its own socket and pid file:

```
1. build a cockpit-shaped layout: fleet, diff slot (full width), terminal, strip, footer
2. put revdiff in the diff slot on a scratch repo;   record geometry
3. park it (move-pane-to-new-tab) and split micro INTO the slot in the same
   opposite order the daemon uses for the diff slot;  record geometry
4. push two files into micro so it has tabs
5. park micro, restore revdiff;                       record geometry
6. park revdiff, restore micro;                       record geometry + tab bar
7. assert: the slot's cols/rows are IDENTICAL at steps 2, 3, 5 and 6
   assert: micro still has both tabs at step 6
   assert: revdiff is still revdiff at step 5 (not a bare shell)
   assert: exactly one of the two is in the cockpit tab at any moment
```

The **opposite order** matters and is not optional: the diff pane spans the window, so its
geometry *is* the slot. Park it first and the only thing left to split is the fleet pane's
half-width region. Split the incoming pane *into* the outgoing one, then dispose of the
outgoing one. This is already documented in `CLAUDE.md`; the probe must not invent its own
order.

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

- [ ] `spikes/browse-mode/probe-two-pane.sh` runs green and prints the four geometries
- [ ] the four promoted probes run green and each has a section in `RESULTS.md` saying what it
      measured and what the number was
- [ ] `RESULTS.md` states plainly whether the slot **can** hold two alternating panes per agent

## If the answer is no

**Stop and ask the user.** Do not pick a fallback. The two candidates are: kill and relaunch
the viewer on every cycle (tabs die, and tabs are the feature), or browse stops being a stop
in the cycle. Both contradict a decision the user already made (DESIGN §7), so both are theirs.
