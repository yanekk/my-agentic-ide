# Prompt for the cockpit-side plan

Run this in `~/src/agentic-ide` (for example `pir plan "$(sed -n '/^---8<---$/,/^--->8---$/p' plans/pir-usage-api/COCKPIT-PROMPT.md | sed '1d;$d')"`, or paste the block into `/pir-plan`). The contract in it is copied from the pir plan, `~/src/plan-implement-review` branch `pir/api-service`, `plans/api-service/DESIGN.md` §2.1, §2.2 and §6 (commit dab1019, written 2026-09-30, not yet reviewed or built). If that plan's review changes those sections, change this too.

---8<---
Make the cockpit footer's usage bar stay fresh during pir runs, by having the cockpit daemon poll pir's local HTTP API for the subscription usage numbers and feed them into the usage cache the footer already draws from.

Why: the bar (plans/usage-limits) is fed only by `bin/cockpit-usage-tap.mjs`, a statusline command that ordinary Claude Code sessions run after each turn. pir's workers are SDK sessions with no statusline, so during a pir run nothing writes `usage-cache.json` and the footer dims to "as of HH:MM" after 15 minutes. Nothing is broken: measured 2026-09-30, the tap, its registration and the footer all work. pir is getting a permanent local service whose first endpoint serves these numbers (planned in ~/src/plan-implement-review, `plans/api-service/`), and this plan is the reader.

Decided by the person on 2026-09-30, not open for re-decision here:
- The cockpit polls pir's REST API over HTTP. It does not read pir's `~/.pir/usage.json` directly, tail pir's conversation logs, or have pir write into `~/.claude/cockpit`.
- The footer looks exactly as it does today. No new segment, no new command, so there is no prototype.
- Ordinary sessions keep feeding the bar through the tap. Whichever reading is newer wins.

The API, as pir's plan fixes it (version 1):

1. Discovery. While the service is up it keeps `${PIR_HOME ?? HOME}/.pir/api.json`:
   { "version": 1, "url": "http://127.0.0.1:47717", "pid": 4711 }
   Written temp-then-rename, removed on a clean exit. Read it before each poll and use its `url`; never assume the port. The real port is fixed at 47717, but on a scratch home the OS picks one and only `api.json` names it, which is how tests stay off the real service. No file, or a `pid` that is dead, means the service is absent.

2. Request: `GET {url}/v1/usage`. No body, no headers of our own, no authentication. The `Host` header must be `127.0.0.1:{port}` or `localhost:{port}`, which a Node request to the `url` as given sends by itself; anything else is answered 403. A query string is ignored; `/v1/usage/` with a trailing slash is an unknown path.

3. Response: 200, `Content-Type: application/json`:
   {
     "version": 1,
     "observed_at": 1790669288699,
     "rate_limits": {
       "five_hour": { "used_percentage": 97, "resets_at": 1790673000 },
       "seven_day": { "used_percentage": 77, "resets_at": 1790830800 }
     }
   }
   - `observed_at`: ms since epoch when a pir worker received the numbers, not when the request was answered. The service accepts a value up to 60 s ahead of its own clock.
   - `rate_limits` has the shape of the statusline's `rate_limits`: `used_percentage` 0-100 (a number with up to two decimals), `resets_at` epoch seconds. `normalizeRateLimits` in `bin/cockpit-usage-model.mjs` already takes exactly this.
   - Either window may be null. Nothing known: 200 with `"observed_at": null, "rate_limits": null`. That is "service up, nothing to report", distinct from no service.
   - A reading is returned as heard even if a `resets_at` has passed; the reader handles it (usage-limits DESIGN already covers a past reset).
   - On Bedrock, Vertex or an API key pir hears nothing, so the answer stays null or keeps the last personal reading.

4. Errors, each with a small JSON body and never a CORS header: 403 `{"version":1,"error":"forbidden_host"}`, 404 `{"version":1,"error":"not_found"}`, 405 `{"version":1,"error":"method_not_allowed"}` (with `Allow: GET`), 500 `{"version":1,"error":"internal"}`. If the port is held by another program the service is not up and writes no `api.json`.

What I already settled, with reasons (say so if the code disagrees):
- The daemon polls, not the footer. `cockpitd.mjs` already fetches for the agenda and the pull requests on a tick (`refreshAgenda`, `refreshPRs`) and the panes only draw; the strip stays pure display.
- About every 30 seconds. The stale mark appears at 15 minutes, the service answers from memory, and a pir reading arrives every few worker messages.
- A pir reading is written to `usage-cache.json` through `writeCache` in `bin/cockpit-usage-store.mjs`, with `observed_at` as its `writtenAt`, and only when it is newer than what the cache holds. The tap stamps its own writes with the time of the turn, so comparing the two times is the whole "newest wins" rule. Decide what a reading dated in the future does; it must not beat real readings for long.
- The decision (given the cache, the response and the current time, write or not, and what) is pure and belongs beside `renderUsage` in the model, tested with plain values. The clock, the file read and the HTTP call stay in the daemon.
- No new dependency: Node 24's built-in `fetch` or `node:http`, with a short timeout so a hung service cannot hold the daemon's tick.
- Every failure is quiet: no file, dead pid, refused connection, timeout, non-200, a body that does not parse, `version` not 1, nulls. The cache is left alone, the bar ages as it does today, and the reason goes to `daemon.log` once per change of state, not once per poll.
- pir stays optional. With pir absent or the service off, the cockpit behaves exactly as today.
- Tests never touch the real service: a stand-in HTTP server on an OS-chosen port and a scratch `PIR_HOME` holding its `api.json`. The cockpit's existing test daemons must not poll the real `~/.pir/api.json` either.

For this session to settle with the person (not decided):
- When the pir service is down while pir is plainly in use, does the footer stay silent (my recommendation: it matches how the bar already behaves, and the stale mark says the reading is old), or show a small mark that the pir feed is off? I asked on 2026-09-30 and have no answer yet.
- Whether `bin/install.sh` should report the pir service's state next to its existing optional `pir` check.

Check what already exists before planning anything new: `bin/cockpit-usage-tap.mjs`, `cockpit-usage-store.mjs`, `cockpit-usage-model.mjs`, the footer's usage segment in `cockpit-strip.mjs`, `spikes/usage-test/`, `plans/usage-limits/` (its T06, the live hand check, is still open; this is a new plan, not an amendment to that one), and how the daemon reads `pir-dashboard.json` (plans/pir-pane).

Slug: `plans/pir-usage-api/` already exists on main and holds only the two briefs (this one and `PIR-PROMPT.md`, the one pir's plan was written from), so a plan run cannot use that name. Suggest `pir-usage-reader`.

Depends on the other repo: the reader can be built and proven against the stand-in now. The live check needs pir's plan reviewed, built, merged and `./install.sh` run there, after which `pir service` reads `running at http://127.0.0.1:47717`. Plan that check as the last task and say what it waits for.

Out of scope: any change to pir; any other pir endpoint; writing to pir; a change to how the bar looks or to its thresholds; the tap and its registration.

Check on the machine, once pir's service is installed: with a pir run alive and no ordinary Claude session taking a turn, `curl -s "$(jq -r .url ~/.pir/api.json)/v1/usage"` and `~/.claude/cockpit/usage-cache.json` agree within a poll, and the footer's numbers move without going dim. `pir service off`, and the bar keeps its last reading and dims after 15 minutes, with one line in `daemon.log`.
--->8---
