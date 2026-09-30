# T06 — live-check-script

**Phase:** 3 · **Depends on:** T02, T03 · **Weight:** light

## Goal

The script the after-merge checklist runs (PLAN § After the merge), proven here against the
stand-in. It compares what pir's service says with what the reader writes and with what the live
cockpit's cache and log hold, so the real-machine check is one command and a verdict. This task
never touches the real service or the real cockpit dir.

## Design sections this implements

DESIGN §4 (live-check script), §5.1, §5.2, §5.3.

## Files

- `spikes/usage-test/live-check.sh` (new; not run by `run.sh` itself)
- `spikes/usage-test/live-check.test.mjs` (new; picked up by `run.sh`'s `*.test.mjs` loop)

## Interface

```
bash spikes/usage-test/live-check.sh            # step 1: the contract
bash spikes/usage-test/live-check.sh follow     # step 2: the live cockpit's cache and log

LIVE_COCKPIT_DIR   the cockpit dir step 2 reads; default $HOME/.claude/cockpit
LIVE_FOLLOW_SECS   how long step 2 samples; default 1200
LIVE_POLL_SECS     seconds between samples; default 30
```

Exit 0 `agree`, 1 `differ`, 2 not checkable. The service is found through
`${PIR_HOME ?? HOME}/.pir/api.json`, as the reader finds it.

Step 1, in a `mktemp -d` `COCKPIT_DIR` of its own, removed on exit:

- `node bin/cockpit-usage-pir.mjs --status` does not print `running`: print its line, exit 2.
- `curl -s --max-time 2 "$(jq -r .url api.json)/v1/usage"` has null `observed_at`: print
  `no reading`, exit 2.
- `--once` then prints `ok wrote` and the scratch cache equals the curl body: `writtenAt` equal to
  `observed_at`, each window's `usedPct` equal to the rounded `used_percentage`, `resetsAt`
  equal, a null window null. A second `--once` prints `ok kept` unless `observed_at` moved.
  All true: `agree`. Otherwise `differ` and the name of the field.

Step 2, read-only on `LIVE_COCKPIT_DIR`. Every `LIVE_POLL_SECS` for `LIVE_FOLLOW_SECS`: GET
`observed_at`, read the cache's `writtenAt`. A sample fails when `writtenAt` is more than 35 s
older than `observed_at`. Reason: a tap write is newer than any pir reading and passes; only a
daemon that is not following fails. At the end: `agree` when no sample failed and the last
`usage: pir service` line in `daemon.log` ends in `ok`; else `differ` with the count of failed
samples. It also prints `moved N`, how many times `observed_at` changed.

The script prints verdicts, field names, counts and times, never a percentage. Reason: its
output is pasted into conversations and into FINDINGS.

## Tests

In `live-check.test.mjs`: a stand-in `node:http` server on an OS-chosen port, `PIR_HOME` at a
scratch home whose `api.json` names it, `LIVE_COCKPIT_DIR` at a scratch dir, `LIVE_FOLLOW_SECS=2`,
`LIVE_POLL_SECS=1`. The script is run as a child process.

- [ ] Step 1, documented body: `agree`, exit 0; the scratch `COCKPIT_DIR` it made is gone.
- [ ] Step 1, nulls body: `no reading`, exit 2.
- [ ] Step 1, no `api.json`: `off absent`, exit 2. Stand-in stopped: `off unreachable`, exit 2.
- [ ] Step 1, one window null: `agree`.
- [ ] `follow`, cache seeded with `writtenAt` equal to `observed_at`, log holding
      `usage: pir service ok`: `agree`, `moved 0`.
- [ ] `follow`, cache seeded newer than `observed_at` (a tap write): `agree`.
- [ ] `follow`, cache 5 minutes older than `observed_at`: `differ`, exit 1.
- [ ] `follow`, no cache file: `differ`.
- [ ] `follow`, last log line `usage: pir service unreachable`, and no such line at all: `differ`.
- [ ] `follow`, the stand-in serving a new `observed_at` mid-run and the cache rewritten to
      match: `moved 1`, `agree`.
- [ ] No output line contains a percentage from the stand-in's bodies.
- [ ] `LIVE_COCKPIT_DIR` is never written: its file list and mtimes are unchanged after `follow`.

## Done when

- [ ] `bash spikes/usage-test/run.sh` is green, and its "real cockpit dir is untouched" check
      still passes.
- [ ] `bash -n spikes/usage-test/live-check.sh` passes.
- [ ] The script was not run against the real service or the real cockpit dir (that is PLAN
      § After the merge).
