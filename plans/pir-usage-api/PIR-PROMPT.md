# Prompt for the pir-side plan

Run this in `~/src/plan-implement-review` (for example `pir plan "$(sed -n '/^---8<---$/,/^--->8---$/p' plans/pir-usage-api/PIR-PROMPT.md | sed '1d;$d')"` from the agentic-ide checkout, or paste the block into `/pir-plan`). The "contract" part of the block is what the agentic-ide cockpit builds its reader against; if it changes in the pir planning session, change it here too and tell the agentic-ide plan (`plans/pir-usage-api/`).

Settled since by pir's plan (`plans/api-service/DESIGN.md` on `pir/api-service`, 2026-09-30): fixed port 47717, fail if taken; a foreign `Host` is answered 403; error bodies are `{"version":1,"error":"..."}`; runs hand readings to the service through `~/.pir/usage.json`. The contract below is otherwise unchanged. The cockpit-side brief is `COCKPIT-PROMPT.md` beside this file.

---8<---
Give pir a permanent local service that answers a REST API over HTTP, with Claude subscription usage as its first endpoint. This is for the agentic-ide cockpit (~/src/agentic-ide), whose footer shows how much of the 5-hour and weekly subscription limit is used. The cockpit gets those numbers from a statusline hook that only ordinary Claude Code sessions run; pir's workers are SDK sessions with no statusline, so during a pir run the footer goes stale. pir already receives the numbers: they only need a way out.

Decided by the person on 2026-09-30, not open for re-decision here:
- pir exposes a REST API over HTTP and the cockpit polls it. Not a file pir writes into the cockpit's state, not a raw socket.
- The API is served by a permanent pir service started at login, which answers whether or not any run is alive. Not by the run processes themselves, and not by the dashboard. The person chose this over "only while a run is alive" knowing it is the larger build, because the API is meant to grow.
- Usage is the first endpoint and the only one in this plan. The API is read-only for now.

Where the numbers are today (measured 2026-09-30, SDK @anthropic-ai/claude-agent-sdk 0.3.282, Claude Code 2.1.285):
- The SDK yields `{ type: "rate_limit_event", rate_limit_info: {...} }` messages to every worker on a claude.ai subscription. worker-proc.mjs already logs each one (`log({ dir: 'in', event: m })`) and core/stream.mjs passes it through as a `system` event.
- Across 668 such events in `plans/*/.parallel/*/conversations/*.ndjson`, every one carried `rate_limit_info.unifiedWindows = { five_hour: { utilization, resetsAt }, seven_day: { utilization, resetsAt } }`. `utilization` is a fraction 0..1 (observed min 0, max 1), `resetsAt` is epoch seconds.
- `unifiedWindows` is NOT in sdk.d.ts. The documented fields are `rateLimitType`, `resetsAt` and an optional `utilization` for the one window the event is about (present on 527 of the 668). Treat `unifiedWindows` as the source and decide what happens when it is absent; the endpoint must then report nothing new rather than fail.
- The processes that hold workers, and so see these events, are the per-run ones: `coordinate.mjs` (build runs, helpers) and `plan-run.mjs` (planning runs), each detached, several alive at once across repos. Getting a reading from those processes to the service is this plan's central design question.
- No events arrive on Bedrock, Vertex or an API key, so there the service simply never hears anything.

The contract the cockpit reads (version 1):

1. Discovery. While the service is up it keeps `${PIR_HOME ?? HOME}/.pir/api.json` current:
   { "version": 1, "url": "http://127.0.0.1:<port>", "pid": <service pid> }
   Written temp-then-rename, removed on a clean exit. The cockpit reads this file before each poll and never assumes a port, so the port (fixed or chosen at start) is pir's decision. `pid` lets a reader tell a file left by a crash from a live service.

2. GET {url}/v1/usage answers 200, `Content-Type: application/json`:
   {
     "version": 1,
     "observed_at": <ms since epoch when a worker last received numbers> | null,
     "rate_limits": null | {
       "five_hour": { "used_percentage": <0-100 number>, "resets_at": <epoch seconds> } | null,
       "seven_day": { "used_percentage": <0-100 number>, "resets_at": <epoch seconds> } | null
     }
   }
   - `rate_limits` deliberately has the shape of Claude Code's statusline `rate_limits` (`used_percentage` = utilization x 100, `resets_at` in seconds), so the cockpit feeds it to the code it already has.
   - Nothing heard yet: 200 with `observed_at: null` and `rate_limits: null`. Never a 404 or an error for "no data": the cockpit must be able to tell "service up, nothing to report" from "no service".
   - `observed_at` is when the event was received, not when the request was answered. The cockpit takes the newer of this and its own statusline reading, so an honest timestamp is what keeps an old pir reading from overwriting a fresh one.
   - When several workers report, the newest event wins. A reading is returned as it was heard even if a `resets_at` has since passed; the reader handles that.
   - The cockpit polls about every 30 seconds for as long as it is open, so the answer comes from memory and costs nothing.

3. Everything else: an unknown path is 404 and a non-GET method 405, both with a small JSON body. Bind 127.0.0.1 only, never a routable address. No authentication, since the numbers are not secret and the port is local; but this is the first endpoint of an API that will grow, so settle here whether to refuse requests whose `Host` is not 127.0.0.1/localhost and to send no CORS headers, which together keep a web page in a browser from reading it.

Must hold:
- A run never suffers for the service. If the service is down, slow or absent, a run process that tries to pass a reading on carries on without delay and without an error the person sees.
- The service never suffers for a run: a malformed or unexpected reading is dropped.
- Tests and rigs never touch the real service. They already point `PIR_HOME` at a scratch folder; everything the service reads, writes, binds or registers must follow from that, and no test installs a login item or binds the real port.

For that session to settle with the person (not decided):
- How the service is started at login and kept alive on macOS (a launchd agent is the obvious candidate), who installs and removes it (`install.sh`?), and how the person sees that it is running or stops it.
- How an upgrade of the engine (`~/.claude/pir-engine`) reaches a service that is already running the old code.
- How the run processes hand a reading to the service, and what a run started before the service existed does.
- Whether the last reading survives a service restart or a reboot. The cockpit works either way.
- The port: fixed and documented, or chosen at start and found only through `api.json`.

Out of scope: any other endpoint; any endpoint that changes something; authentication; access from another machine; any change to the dashboard's screen; agentic-ide's side (its reader is planned in ~/src/agentic-ide, `plans/pir-usage-api/`).

Check on the machine: with the service up and a run alive, `curl -s "$(jq -r .url ~/.pir/api.json)/v1/usage"` answers with numbers that match the newest `rate_limit_event` in that run's conversation log, and `observed_at` moves as the run works. With no run alive it still answers, with the last reading or nulls. Kill the service process and it comes back. After logging out and in again it is up without anyone starting it (this last one needs the person).
--->8---
