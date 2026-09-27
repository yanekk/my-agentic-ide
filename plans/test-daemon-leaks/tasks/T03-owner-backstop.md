# T03 — owner-backstop

**Phase:** 3 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

A test daemon ends itself once the suite run that started it is gone, so a suite that is force-killed,
and so never runs its exit cleanup, still cannot leave a daemon running for ever. The real cockpit's
daemon must be unable to get this behaviour at all. T02 is a dependency only because this task edits
the same launch lines of `cockpit-test/run.sh`.

## Design sections this implements

DESIGN §2.4, §2.8 (SIGKILL), §5.2.

## Files

- `bin/cockpitd.mjs`
- `spikes/cockpit-test/run.sh` (the six launches: `DPID` and the `d2env`–`d6env` functions)
- `spikes/daemon-leak-test/run.sh` (new checks)

## Interface

```js
// bin/cockpitd.mjs
// COCKPIT_OWNER_PID: test-only. Unset in the real cockpit (cockpit-layout.sh never sets it).
// Positive integer → checked every POLL_MS on the existing reconcile interval:
//   process.kill(pid, 0) throws ESRCH → miss; 2 consecutive misses → log
//   `owner <pid> gone, exiting` and shutdown(). EPERM → alive. Success → alive, misses = 0.
// Anything else non-empty → one log line at start, then ignored.
```

The check must not sit behind reconcile's `reconciling` guard, or a reconcile stuck on a slow
`claude agents` call would also stall the backstop: call it from the interval callback before
`reconcile()`.

In `cockpit-test/run.sh`, every launch adds `COCKPIT_OWNER_PID="$$"` (the main launch's prefix list
and each `dNenv` function).

## Tests

In `daemon-leak-test`, against the real `bin/cockpitd.mjs` with a scratch `HOME` and `COCKPIT_DIR`,
`COCKPIT_TIME_SCALE` small, `AGENDA_ORIGIN`/`BITBUCKET_ORIGIN` at `http://127.0.0.1:9`, a seeded
`$COCKPIT_DIR/panes.json` and empty `fleet.log` (cockpitd exits at start without `panes.json`,
`bin/cockpitd.mjs:109`; copy the shape cockpit-test writes), and a PATH
whose `wezterm` and `claude` are stubs that print nothing and exit 0:

- [ ] owner is a live `sleep` → the daemon is still running after several ticks.
- [ ] owner `sleep` is killed → the daemon exits within a bound (~3 ticks) and its log has
      `owner <pid> gone, exiting`.
- [ ] no `COCKPIT_OWNER_PID` → the daemon keeps running after an unrelated `sleep` dies.
- [ ] `COCKPIT_OWNER_PID=abc` and `=0` → running after several ticks, one log line about it.
- [ ] `COCKPIT_OWNER_PID=1` (EPERM) → still running.
- [ ] the force-kill path: a child mini-suite launching the real daemon through an env function with
      `COCKPIT_OWNER_PID="$$"`, killed with SIGKILL to its shell only → the daemon is gone within the
      bound, although no trap ran.
- [ ] fence: every launch of `bin/cockpitd.mjs` in a `spikes/*-test/run.sh` other than
      `daemon-leak-test` sets `COCKPIT_OWNER_PID` (count launches against owner assignments).
      `daemon-leak-test` is excluded because its no-owner and malformed-owner launches are the checks
      themselves; the hands-on probes in `spikes/pane-swap/` and `spikes/browse-mode/` are not suites.
- [ ] fence: `COCKPIT_OWNER_PID` does not appear in `bin/cockpit-layout.sh` or `wezterm/cockpit.lua`.

## Done when

- [ ] `daemon-leak-test` and `cockpit-test` both print `ALL PASS`.
- [ ] The force-kill check passes, and the real daemon's pid is unchanged across this task's runs.
