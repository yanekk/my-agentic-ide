# T01 — test-daemons-lib

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The three shell helpers every suite will use to stop its daemons, sweep up what it forgot, and fail
when something is still running at the end, in one sourced file, and a new suite that proves them
against fake daemons, including the three ways a run gets interrupted. Nothing adopts them yet; T02
and T04 do.

## Design sections this implements

DESIGN §2.2, §2.3, §2.5, §2.6, §2.7, §2.8, §5.2.

## Files

- `spikes/lib/test-daemons.sh` (new, sourced, never run)
- `spikes/daemon-leak-test/run.sh` (new suite; prints `ALL PASS (N checks)` or `FAILURES`, exits
  non-zero on failure, no colour)

## Interface

```bash
# All three take effect only on processes whose `ps -E -ww -ax -o pid=,command=` line contains
# `cockpitd.mjs` AND `=$T/`, excluding $$ and its ancestors (DESIGN §2.7).

daemon_stop <pid>...      # SIGTERM each pid and its `pgrep -P` children, wait up to ~2s for all
                          # to be gone, SIGKILL survivors. Empty or dead pids are a no-op.
daemon_pids <T>           # prints matching pids, one per line (used by the other two and by tests)
daemon_sweep <T>          # daemon_stop every pid daemon_pids prints. Always returns 0.
daemon_tripwire <T>       # waits up to ~2s for daemon_pids to empty; if not, prints one
                          # `LEAK cockpitd pid <pid> still running, env names <path>` line per
                          # process and one hint line naming daemon_stop, returns 1. Else 0.
                          # Never kills.
```

The suite calls the tripwire and turns a return of 1 into its own `fail=1`; the helper does not
touch the caller's counters, because each suite counts differently.

## Tests

- [ ] a fake daemon launched through an env function (`envfn node $T/bin/cockpitd.mjs &`) is gone,
      node included, after `daemon_stop $!`.
- [ ] the same for the plain launch shape (`VAR=x node … &`).
- [ ] a fake daemon that ignores SIGTERM is gone after `daemon_stop` (the SIGKILL path).
- [ ] `daemon_pids` finds a fake daemon under `$T` and prints nothing for one under a second
      scratch folder `$T2` (the stand-in for the real cockpit and for another run).
- [ ] `daemon_sweep "$T"` stops a forgotten fake daemon and leaves the `$T2` one running.
- [ ] `daemon_tripwire "$T"` returns 1 and prints the `LEAK` line with the pid for a forgotten one,
      and returns 0 when none is left.
- [ ] `ps -E` sees a known scratch daemon (guards against a silently disarmed match, §2.8).
- [ ] interrupt paths, each on a child mini-suite that sources the helpers, launches two wrapped
      fake daemons with an EXIT trap calling `daemon_sweep`, and is started in its own process group
      (`perl -e 'setpgrp(0,0); exec …'`): SIGINT to the group leaves none; SIGTERM to its shell only
      leaves none. (SIGKILL is T03's, since only the backstop can cover it.)
- [ ] fence: no `pkill -f` naming `cockpitd` anywhere under `spikes/` (excluding this check's own
      line).

## Done when

- [ ] `bash spikes/daemon-leak-test/run.sh` prints `ALL PASS` and every test above is a check in it.
- [ ] After it runs, no process matching its own scratch folders is alive.
