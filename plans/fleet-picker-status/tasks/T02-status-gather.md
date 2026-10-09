# T02 — status-gather

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The world-touching half of the status: run `claude agents --json --all`, read the finish time of
each background done agent, and ask pir's service for its runs, each with a time limit and every
failure turned into a quiet result. It returns raw answers for T01's model to decide on, so this
module decides nothing a person sees.

## Design sections this implements

DESIGN §2.5 (limits), §2.7, §3.2, §3.5, §3.6.

## Files

- `bin/cockpit-fleet-status.mjs` (new)
- `bin/cockpit-usage-pir.mjs` (extended: `fetchPirRuns`, sharing the api.json read and liveness
  check with `fetchPirUsage`, whose results must not change)
- `spikes/usage-test/fleet-status.test.mjs` (new; `usage-test/run.sh` picks up every `*.test.mjs`, so
  no runner edit, which keeps this task off `fleet-picker-test/run.sh` that T01 edits in parallel)
- `spikes/usage-test/pir.test.mjs` only if the refactor needs a test moved; its checks keep passing

## Interface

```js
// cockpit-usage-pir.mjs
// GET /v2/runs with Authorization: Bearer <${home}/.pir/api-key, trimmed>. Never throws.
// states before "answered" are the same words fetchPirUsage uses, plus "no-key".
export async function fetchPirRuns({ home, alive, timeoutMs = PIR_TIMEOUT_MS } = {})
//   → { state: "answered", body } | { state: "absent"|"bad-file"|"dead"|"no-key"|"unreachable"|"bad-body" }
//   | { state: "http", status }

// cockpit-fleet-status.mjs
export const CLAUDE_TIMEOUT_MS = 3000;
// env gives PATH, HOME, CLAUDE_CONFIG_DIR. Never throws.
export async function gatherClaude({ env = process.env, timeoutMs = CLAUDE_TIMEOUT_MS } = {})
//   → { ok: true, agents, finishedAt: { [id]: number } } | { ok: false }
export async function gatherPir({ home = pirHome() } = {})
//   → { ok: true, body } | { ok: false, why: "down" | "other" }
//      "down": absent, dead, unreachable, any http other than 401; "other": no-key, 401, bad-file, bad-body
export async function gatherAll(opts)        // both at once → { claude, pir }
```

`finishedAt` holds only background agents whose `state` is `done` (or T00's equivalent); reading
every agent's file would cost reads for no shown line. A file that is missing, unreadable or not
JSON, or whose `lastTerminalAt` is not a number, leaves that id out.

## Tests

- [ ] fake `claude` on PATH printing an array → `ok: true`, the array, finish times from a scratch
      jobs folder under `HOME/.claude/jobs` and under `CLAUDE_CONFIG_DIR/jobs` when set
- [ ] fake `claude` exiting non-zero, printing junk, sleeping past the limit, missing from PATH →
      `{ ok: false }`, within the limit plus a margin
- [ ] a done agent's state.json missing, half-written (truncated JSON), with `lastTerminalAt`
      a string → id absent from `finishedAt`
- [ ] the fake is invoked with exactly `agents --json --all`
- [ ] pir stand-in (node:http, OS port, scratch `PIR_HOME`): 200 → answered with the body, and
      the request carried the Bearer key and asked `/v2/runs`
- [ ] no api.json, dead pid, refused port, a hang past 2s, 500 → `down`
- [ ] no api-key file, 401, bad body → `other`
- [ ] `fetchPirUsage` results unchanged (usage-test still passes)
- [ ] `gatherAll` runs both concurrently (a 1s fake claude and a 1s stand-in finish in under 1.8s)

## Done when

- [ ] Both test lines of DESIGN pass.
- [ ] No test reads the real `~/.claude`, `~/.pir` or the real `claude` (scratch `HOME`,
      `PIR_HOME`, `PATH`).
- [ ] Every result path of the interface has a test.
