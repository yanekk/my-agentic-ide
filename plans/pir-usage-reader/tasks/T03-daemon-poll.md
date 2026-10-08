# T03 — daemon-poll

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Wire the reader into the cockpit daemon: poll at start and every 30 seconds, one poll in flight,
and write one `daemon.log` line when the state changes. This is the task that makes the feature
run; before it the reader exists and nothing calls it. It also fences every suite that starts a
daemon off the real pir service.

## Design sections this implements

DESIGN §2.2, §2.5 (the log), §5.2.

## Files

- `bin/cockpitd.mjs` (extend, beside `refreshPRs` and its `setInterval`)
- `spikes/cockpit-test/run.sh` (export scratch `PIR_HOME` at the top; a new chain `usage` with
  section `15`)
- `spikes/daemon-leak-test/run.sh` (export scratch `PIR_HOME` at the top)

## Interface

```js
// Test seam only, as COCKPIT_BITBUCKET_TICK_MS is. Not scaled by ms().
const USAGE_TICK_MS = Number(process.env.COCKPIT_USAGE_TICK_MS) || 30_000;

let usagePolling = false;          // one poll in flight
let usageState = "absent";         // the last logged key; "absent" so a pir-less machine logs nothing

// Never throws, never rejects. Calls pollPirUsage({ home: pirHome(), dir: DIR }).
// key = state, or `http ${status}`. When key !== usageState: log(`usage: pir service ${key}`).
async function refreshUsage()

setInterval(refreshUsage, USAGE_TICK_MS);
refreshUsage();                    // at start, beside refreshAgenda("start") / refreshPRs("start")
```

Nothing but the state key is logged: no url, no percentage, no body. `DIR` is the daemon's own
`COCKPIT_DIR` resolution, passed explicitly so the daemon and the store cannot disagree.

## Tests

In `spikes/cockpit-test/run.sh`, a chain of its own (the agenda chain, sections 13 to 13c, is the
model: own daemon, own state dir, a stand-in server printing `PORT n`, a mode file, a hits file).
`COCKPIT_USAGE_TICK_MS` short; the scratch home's `.pir/api.json` names the stand-in and the
suite's own pid.

- [ ] No `api.json`, 2.5 ticks: no `usage:` line in the log, no `usage-cache.json`.
- [ ] `api.json` plus a reading: the cache appears with `writtenAt` equal to `observed_at`; the
      log holds exactly one `usage: pir service ok`.
- [ ] Three more ticks of the same reading: the cache file's inode and mtime unchanged, still one
      `ok` line, hits rising (it did poll).
- [ ] A cache seeded newer than the stand-in's reading (what the tap leaves) survives three ticks.
- [ ] The stand-in serves a newer reading: the cache follows within a tick.
- [ ] Mode 500 for three ticks: exactly one `usage: pir service http 500`, cache untouched.
- [ ] Stand-in stopped: exactly one `usage: pir service unreachable`.
- [ ] `api.json` naming a dead pid: one `usage: pir service dead`, hits do not rise.
- [ ] Nulls body: one `usage: pir service empty`, cache untouched.
- [ ] Back to a reading: one more `usage: pir service ok`.
- [ ] A stand-in that never answers: the daemon still reconciles (its `calls.log` keeps growing)
      and the next tick polls again.
- [ ] The log never contains a percentage from the stand-in's bodies nor its port.
- [ ] Fence: `run.sh` and `spikes/daemon-leak-test/run.sh` export `PIR_HOME` under their scratch
      dir before any daemon starts; the main chain's daemon log holds no `usage:` line.

## End to end (the worker drives this)

- suite: `spikes/cockpit-test/run.sh`, the existing footer capture used by §12b · size: 200 cols
- [ ] After the daemon wrote the stand-in's reading, `cockpit-strip.mjs footer` run on that
      state dir → the row shows `5h 97%` and `7d 77%`, not dim.
- [ ] A reading whose `observed_at` is 20 minutes old, empty cache → the row shows it dim with
      `as of`.

## Done when

- [ ] All three suites of the test command are green; `cockpit-test` prints `ALL PASS`.
- [ ] `grep -n refreshUsage bin/cockpitd.mjs` shows the function, the interval and the start call.
- [ ] `bash spikes/daemon-leak-test/run.sh` is green and no test daemon outlives the run.
