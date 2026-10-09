# T01 — status-model

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The pure half of the status: from the raw answers of `claude agents --json --all`, the jobs'
finish times and pir's `GET /v2/runs` body, plus the current time, produce each program's ordered
list of items exactly as DESIGN §2 says. Every rule a person would notice (which agents, which
class, the word, the hour, the order) lives here, so it is proven in milliseconds.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3, §2.4 (order only; the row share is T03), §2.7 (malformed items), §3.1,
§3.3. Use T00's FINDINGS rows for the Claude state values.

## Files

- `bin/cockpit-fleet-status-model.mjs` (new)
- `spikes/fleet-picker-test/status.test.mjs` (new)
- `spikes/fleet-picker-test/run.sh` (runs the new suite; the purity and import greps over the new
  module, same patterns as for the picker model)

## Interface

```js
// agents: the parsed --all array, or anything else (→ "unavailable")
// finishedAt: { [jobId]: number | undefined }  lastTerminalAt per background done agent
// now: epoch ms
export function claudeItems(agents, finishedAt, now)        // → Item[] | "unavailable"

// body: the parsed /v2/runs body ({ runs: RunSummary[] }), or anything else (→ "unavailable")
export function pirItems(body, now)                          // → Item[] | "unavailable"

// age in whole minutes, "0m".."59m"; null when hidden (≥ 60m) or unknown
export function ageLabel(endedAtMs, now)                     // → string | null

// endedAt as pir may send it: ISO string or epoch ms; anything else → undefined
export function parseEndedAt(v)                              // → number | undefined

// Item = { cls: "wait"|"run"|"bad"|"done", word: string, name: string }
```

`pirItems` never returns the `{ unavailable }` form; the shell picks that wording from why the
fetch failed (T02, T04).

## Tests

- [ ] interactive sessions are dropped; background ones kept
- [ ] each Claude state lands in its class and word (T00's values; `blocked` → wait `needs you`)
- [ ] an unknown Claude state is run, showing its own word
- [ ] done at 0m, 59m shown with `done 0m`/`done 59m`; at 60m and older hidden; unknown hidden
- [ ] a finish time in the future shows as `0m`
- [ ] bad items show however old they are
- [ ] pir: `waitingForYou` → wait whatever `state` is; running → run; stopped/crashed → bad;
      finished with `endedAt` inside the hour → done `finished 12m` (or `merged`/`closed`, its
      display word); finished without `endedAt` → hidden
- [ ] pir build word gets ` done/total` when total > 0; plan and single runs do not
- [ ] pir name: `repo / "label"` for a plan or single run with a label, else `repo / slug`
- [ ] order: wait, run, bad, done; Claude newest `startedAt` first; done most recent first; pir
      keeps its order within a class
- [ ] a row missing its name or state is skipped
- [ ] not an array / not an object / null → `"unavailable"`; `[]` → `[]`
- [ ] `parseEndedAt`: ISO, epoch ms, garbage, null

## Done when

- [ ] `bash spikes/fleet-picker-test/run.sh` passes with the new suite in it.
- [ ] The new module passes the purity and import greps.
- [ ] Every rule of §2.2–§2.3 has a test that would fail without it.
