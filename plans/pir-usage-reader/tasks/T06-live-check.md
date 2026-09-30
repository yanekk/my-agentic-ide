# T06 — live-check

**Phase:** 3 · **Depends on:** T03, T04, and pir's `plans/api-service` reviewed, built, merged
and installed (`./install.sh` in `~/src/plan-implement-review`) · **Weight:** light

## Goal

The one thing the stand-in cannot show: that the real pir service answers in the shape this
reader expects, and that the person's live cockpit keeps its bar lit through a pir run. The
worker settles everything a machine can decide; the person reopens the window and looks once.

## Design sections this implements

DESIGN §5.1, §5.3.

## Files

- `spikes/usage-test/live-check.sh` (new; not part of the test command, never run by `run.sh`)
- `plans/pir-usage-reader/FINDINGS.md` (the dated ✅ row)

## Interface

```
bash spikes/usage-test/live-check.sh            # step 1: the contract, read-only
bash spikes/usage-test/live-check.sh follow     # step 2: the live cockpit's cache and log
```

Step 1, in a scratch `COCKPIT_DIR`, against the real `${PIR_HOME ?? HOME}/.pir/api.json`:
`--status` prints `running`; `curl -s "$(jq -r .url ~/.pir/api.json)/v1/usage"` and
`--once` agree (scratch cache `writtenAt` equals `observed_at`, each window's `usedPct` equals
the rounded `used_percentage`, `resetsAt` equal); a second `--once` prints `ok kept` unless
`observed_at` moved. Step 2, read-only on the real `~/.claude/cockpit`: over three polls the real
cache's `writtenAt` is never older than the API's `observed_at` by more than 35 s, and
`daemon.log` holds a `usage: pir service ok` line from the running daemon.

The script prints `agree`/`differ` and times, never a percentage. Reason: its output is pasted
into conversations and into FINDINGS.

## Automated checks (the worker runs these)

```
bash spikes/usage-test/live-check.sh
bash spikes/usage-test/live-check.sh follow        # only after the person reopened the window
grep -c 'usage: pir service' ~/.claude/cockpit/daemon.log   # before and after off / on
```

If `--status` prints `off absent`, the pir plan has not landed: mark the task ⛔ and stop.

With the person's yes (`ask`, DESIGN §5.3): `pir service off`, wait 70 s, confirm exactly one new
`usage: pir service` line and an unchanged cache; `pir service on`, wait 35 s, confirm one new
`usage: pir service ok`. Run `pir service on` before marking the task done even if a check
failed, and confirm `--status` prints `running`.

## Outside actions

- `bash spikes/usage-test/live-check.sh` (both steps) — `worker`
- `pir service off`, then `pir service on` — `ask`
- Closing and reopening the live cockpit window — `person`

## Needs a person

Raised after step 1 is green. The window must run this plan's code, so the main checkout has to
hold T01 to T04 first; when that is, is the person's call.

```
Close and reopen the cockpit window (this closes every agent terminal and revdiff).
Leave a pir run working and take no turn in an ordinary Claude session for 20 minutes.
```

Expect: the bar at the bottom right keeps showing numbers in colour, with no `as of`, and the
numbers change as the run works. After `pir service off` it keeps its last numbers and goes dim
with `as of HH:MM` about 15 minutes later.
Tell me: whether the bar stayed lit for the 20 minutes, and whether it dimmed after the service
was switched off.

## Done when

- [ ] Step 1 and step 2 print `agree` throughout, and the off/on log counts are 1 and 1.
- [ ] `pir service` prints `running at` at the end.
- [ ] FINDINGS has a ✅ row dated with the person's answer, the machine result stated separately.
