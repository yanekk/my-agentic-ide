# T05 — leak-free-check

**Phase:** 4 · **Depends on:** T03, T04 · **Weight:** light

## Goal

Show that the whole change delivers the success criteria on this machine: every suite passes and
leaves no daemon, every interrupt path leaves none, and the real cockpit's daemon never changed pid.
Then record it in the project docs.

## Design sections this implements

DESIGN §1 success criteria, §5.2, §6 (the CLAUDE.md row decision).

## Files

- `docs/cockpit.md` (a short section on how the suites stop daemons and why, pointing at the helper)
- `CLAUDE.md` (the file listing: `spikes/lib/test-daemons.sh` and `spikes/daemon-leak-test/` with
  its check count; a measured-facts row only per DESIGN §6)
- `plans/test-daemon-leaks/FINDINGS.md`

## Automated checks (the worker runs these)

```
REAL=$(ps -E -ww -ax -o pid=,command= | grep cockpitd.mjs | grep "HOME=$HOME " | awk '{print $1}')
# record $REAL (may be empty if no cockpit window is open; say so)
# run every line of the DESIGN test block
# afterwards: every cockpitd alive is either $REAL or one whose env names a folder of a run still
#   in progress (a pir worktree); list them with their COCKPIT_DIR
# cockpit-test interrupted, each in its own process group, ~20s in:
#   SIGINT to the group; SIGTERM to its shell; SIGKILL to its shell (then wait ~5s)
#   after each: no cockpitd whose env names that run's $T (find $T from its daemon.log path in ps)
# finally: $REAL still alive with the same pid
```

Record each result (pass/fail and the pids seen) in FINDINGS with the date.

## Done when

- [ ] Every check above passed and is recorded in FINDINGS, including the real daemon's pid before
      and after.
- [ ] `docs/cockpit.md` and CLAUDE.md's listing name the helper and the new suite.
