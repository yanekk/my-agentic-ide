# T02 — cockpit-test-adopt

**Phase:** 2 · **Depends on:** T01 · **Weight:** light

## Goal

Make `spikes/cockpit-test/run.sh`, the only suite that starts daemons, stop every one of them for
real: the two agenda sections, the three dashboard sections, the main daemon, and the exit path. Then
fail the suite if any is still running at the end. This removes the known leak.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3, §2.5.

## Files

- `spikes/cockpit-test/run.sh`

## Interface

- Source `spikes/lib/test-daemons.sh` near the top.
- One EXIT trap, set once near the top, that stops every pid variable in use (`DPID D2PID D3PID
  GPID D4PID D5PID D6PID BBPID`, all initialised empty up front), calls `daemon_sweep "$T"`, then
  `rm -rf "$T"`. The three later `trap … EXIT` lines (~337, ~2228, ~2524) are removed. The stubs
  (`GPID`, `BBPID`) are plain launches and may keep a plain `kill`; the trap still stops them.
- `kill $D2PID`, `kill $D3PID` and every `stopbb` call become `daemon_stop`. `stopbb` and its
  comment are removed; the reason moves to the helper file's comment if it is not already there.
- `daemon_stop $DPID` (and any other `D*PID` still set), then `daemon_tripwire "$T" || fail=1`, right
  before the final `ALL PASS` / `FAILURES` line. The main daemon is otherwise stopped only by the EXIT
  trap, so without the explicit stop the tripwire reports it as a leak on every run.

## Tests

- [ ] The suite still prints `ALL PASS (N checks)`, N one higher than before (the tripwire counted as
      a check, or unchanged if it only fails; say which in the commit).
- [ ] Temporarily deleting one `daemon_stop` line makes the suite print the `LEAK` line and
      `FAILURES`, exit non-zero, and still leave no daemon behind. Revert it; report the run in the
      commit message.
- [ ] After a run, `ps -E -ww -ax -o pid=,command=` shows no `cockpitd.mjs` whose env names the run's
      `$T` (capture `$T` from a debug echo or the daemon log path during the check, then remove the
      echo).

## Done when

- [ ] `bash spikes/cockpit-test/run.sh` prints `ALL PASS` and leaves no daemon of its own running.
- [ ] No `stopbb`, no bare `kill $D[0-9]PID`, and exactly one `trap … EXIT` remain in the file.
