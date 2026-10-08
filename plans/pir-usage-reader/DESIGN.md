---
setup: none
test:
  - bash spikes/usage-test/run.sh
  - bash spikes/pir-pane-test/run.sh
  - bash spikes/cockpit-test/run.sh
---

# The usage bar fed by pir's API — Design

## 1. Purpose

The footer's usage bar (`plans/usage-limits`) is fed only by `bin/cockpit-usage-tap.mjs`, a
statusline command ordinary Claude Code sessions run after each turn. pir's workers are SDK
sessions with no statusline, so during a pir run nothing writes `usage-cache.json` and the bar
dims to `as of HH:MM` after 15 minutes. pir is getting a permanent local HTTP service whose first
endpoint serves the same numbers (`~/src/plan-implement-review`, `plans/api-service/`). This plan
is the reader: the cockpit daemon polls that service and writes what it hears into the cache the
footer already draws from.

Nothing is broken today. Measured 2026-09-30: the tap, its registration and the footer all work.

### Success criteria

- With pir's service up and a pir run alive, and no ordinary Claude session taking a turn,
  `usage-cache.json` follows `GET /v1/usage` within one poll and the bar does not dim.
- An ordinary session's reading and a pir reading coexist: the cache holds whichever was heard
  last.
- With pir absent, its service off, or any failure on the way, the cockpit behaves exactly as it
  does today, and `daemon.log` gains one line per change of state.
- No test reads the real `~/.pir/api.json` or sends a request to the real service.

### Stance

The cockpit reads pir over HTTP and nothing else. It does not read `~/.pir/usage.json`, tail
pir's conversation logs, or have pir write into `~/.claude/cockpit` (person, 2026-09-30). The
footer is unchanged: the feature is a second writer of a file the footer already reads.

---

## 2. Behaviour specification

### 2.1 The contract being read (version 1)

Copied from pir's `plans/api-service/DESIGN.md` §2.1 (`~/src/plan-implement-review`, branch
`pir/api-service`, commit 3e2f4bd, that plan's own review, re-read 2026-09-30). If that section
changes, this one changes with it. `plans/pir-usage-api/COCKPIT-PROMPT.md` is the older brief and
still describes a `Host` check that pir's review dropped.

**Discovery.** While the service is up it keeps `${PIR_HOME ?? HOME}/.pir/api.json`:

```json
{ "version": 1, "url": "http://127.0.0.1:47717", "pid": 4711 }
```

Written temp-then-rename, removed on a clean exit. The reader reads it before every poll and uses
its `url`; it never assumes the port. Reason: on a scratch home the OS picks the port and only
this file names it, which is how tests stay off the real service.

**Request.** `GET {url}/v1/usage`, no body, no headers of our own, no authentication. The service
does not check the `Host` header.

**Response.** 200, `application/json`:

```json
{
  "version": 1,
  "observed_at": 1790669288699,
  "rate_limits": {
    "five_hour": { "used_percentage": 97, "resets_at": 1790673000 },
    "seven_day": { "used_percentage": 77, "resets_at": 1790830800 }
  }
}
```

`observed_at` is ms since epoch when a pir worker received the numbers. `rate_limits` has the
shape `normalizeRateLimits` already takes. Either window may be null. Nothing known is 200 with
`"observed_at": null, "rate_limits": null`. Errors are 404, 405 and 500 with a small JSON body; the
reader treats every non-200 alike.

### 2.2 When the daemon polls

Once at daemon start and then every 30 seconds. Reason: the stale mark appears at 15 minutes, the
service answers from memory, and a pir reading arrives every few worker messages, so 30 s keeps
the bar within a poll of pir without measurable cost. One poll in flight at a time. The request
has a 2-second limit covering headers and body. Reason: a hung service must not hold the tick,
and a loopback answer from memory takes milliseconds.

The daemon polls, not the footer. Reason: `cockpitd.mjs` already fetches for the agenda and the
pull requests and the panes only draw; the strip stays pure display.

### 2.3 Newest wins

A pir reading is written to `usage-cache.json` only when it is newer than what the cache holds:
`observed_at` strictly greater than the cache's `writtenAt`. It is written through `writeCache`
with `observed_at` as its `writtenAt`. The tap stamps its own writes with the time of the turn
and writes unconditionally, so comparing the two times is the whole rule (person, 2026-09-30;
"the higher number wins" was considered the same day and declined, because after a reset it
would keep showing the old high number).

- An equal time writes nothing. Reason: the same reading polled again must not touch the file,
  or the footer would repaint every 30 s for nothing.
- A newer reading replaces the whole cache, both windows, even when one of its windows is null.
  Reason: the tap does the same, and merging windows from two readings would show a pair of
  numbers that were never true together.
- With no cache, or an unreadable one, any valid reading is written. An old one then draws dim
  with its true `as of` time, which is what the staleness rule is for.

### 2.4 A reading dated in the future

`observed_at` more than 60 s ahead of the daemon's clock: the reading is ignored (state
`future`). Up to 60 s ahead: it is treated as heard now, so its `writtenAt` is the daemon's
current time. Reason: a `writtenAt` in the future would beat every real reading until the clock
caught up and would hold off the stale mark; 60 s is the tolerance pir's service itself applies.

A cache whose own `writtenAt` is ahead of the clock is treated as older than any valid reading.
Reason: otherwise one bad write would block the pir feed until the clock passed it.

### 2.5 Every failure is quiet

Each poll ends in one state. Only `ok` can write the cache; every other state leaves it alone and
the bar ages as it does today.

| State | Meaning |
|---|---|
| `absent` | No `api.json` |
| `bad-file` | `api.json` unreadable, not JSON, `version` not 1, `pid` not a positive integer, or `url` not plain `http://127.0.0.1:{port}` or `http://localhost:{port}` |
| `dead` | The `pid` is not running |
| `unreachable` | Refused, reset, a redirect, or the 2 s limit |
| `http {status}` | Any status but 200 |
| `bad-body` | Body not JSON, `version` not 1, or `observed_at` and `rate_limits` not both a value or both null |
| `empty` | 200 with nulls, or no drawable window: service up, nothing to report |
| `future` | §2.4 |
| `ok` | A valid reading, written or not |

`daemon.log` gets `usage: pir service {state}` when the state differs from the previous poll's,
never once per poll. The daemon starts in `absent`, so a machine without pir logs nothing at all.
Reason for logging `ok` too: the line that says the feed came back is as useful as the one that
says it went. No percentage, url or body is logged. Reason: `daemon.log` is pasted into
conversations.

The footer shows nothing about the pir feed (person, 2026-09-30: both sources feed the bar, and
when neither has anything recent it dims as today).

### 2.6 Only a loopback address is ever called

The `url` in `api.json` must be `http`, host `127.0.0.1` or `localhost`, with a port and no path,
query or credentials; anything else is `bad-file` and no request is made. Redirects are refused.
Reason: the daemon runs unattended, and a file on disk must not be able to point it at the
network.

### 2.7 The installer reports the service

When `bin/install.sh` finds `pir`, it prints one more line (person, 2026-09-30):

```
  ok    pir-api  http://127.0.0.1:47717
  warn  pir-api  optional -- not running; the usage bar will not refresh during pir runs (pir service on)
```

`ok` for states `ok` and `empty`, `warn` for every other. The state comes from `GET /v1/usage`
through the cockpit's own reader, not from pir's `GET /health` (person, 2026-09-30, plan review).
Reason: the line is about whether the bar will be fed, and one reader means the installer and the
daemon cannot disagree; the cost is that a service whose usage answer is broken reads `not running`
here while `pir service` says running. It is never counted in `MISSING`, never
fails the install and never starts the service. With `pir` absent the line is not printed.
Reason: the footer is silent about the feed, so this and `daemon.log` are the two places that say
why a bar went stale.

### 2.n The unhappy paths

- **pir absent, or a pir without the service.** State `absent`, no log line, nothing changes.
- **Service crashed, stale `api.json`.** `dead`, no request sent.
- **Port held by another program.** pir writes no `api.json`: `absent`.
- **Bedrock, Vertex or an API key.** pir hears nothing, so `empty`, or `ok` with the last personal
  reading, which is not newer and is not written.
- **A window's `resets_at` has passed.** Written as heard; usage-limits DESIGN §2.n already
  covers drawing it.
- **The tap writes between the daemon's read and its write.** The daemon reads the clock and the
  cache after the response has arrived and writes in the same synchronous step, so the window is
  microseconds. If it is ever lost, the next turn's tap write repairs it. No lock, for the reason
  usage-limits DESIGN §3.5 gives.
- **Two cockpit windows.** Two daemons poll; both apply the same rule to the same file, and
  `writeCache` uses a per-writer temp name.

---

## 3. Architecture

### 3.1 The boundary

```
pure/   cockpit-usage-model.mjs   (extended) parsePirApiFile, decidePirReading.
                                   No clock, no fs, no env, no network.
shell/  cockpit-usage-pir.mjs     (new) reads api.json, checks the pid, GETs with a timeout,
                                   reads the clock and the cache, writes through the store.
        cockpit-usage-store.mjs   (unchanged) readCache, writeCache.
        cockpitd.mjs              (extended) the 30 s tick and the log-on-change.
        cockpit-strip.mjs         (unchanged) already watches usage-cache.json.
```

`spikes/usage-test/run.sh` already greps the model for `node:fs`, `node:http`, `fetch(`,
`Date.now(`, a bare `new Date()` and `process.env`. If that grep fails the fix is to move the
code out of the model, never to relax the grep. Reason: every rule on the pure side is tested in
milliseconds with plain values; one that leaks needs a live pir service to check.

### 3.2 Modules

- `cockpit-usage-model.mjs`: gains `PIR_FUTURE_TOLERANCE_MS`, `parsePirApiFile(text)`,
  `decidePirReading(cache, body, nowMs)`. `renderUsage` and `normalizeRateLimits` are untouched.
- `cockpit-usage-pir.mjs` (new): `fetchPirUsage`, `pollPirUsage`, and a CLI with `--status` (the
  installer's line) and `--once` (one poll, for the live check). One poll function serves the daemon and the
  CLI. Reason: the live check then runs the code the daemon runs.
- `cockpitd.mjs`: `refreshUsage()`, `USAGE_TICK_MS` with the test seam `COCKPIT_USAGE_TICK_MS`,
  in the shape of `refreshPRs`.

The brief said the clock, the file read and the HTTP call stay in the daemon. They sit in a
shell-side module the daemon imports, as `cockpit-bitbucket-client.mjs` does, so they can be
tested against a stand-in without starting a daemon.

### 3.3 The decision function

```
decidePirReading(cache, body, nowMs) → { state: "ok" | "empty" | "bad-body" | "future",
                                         write: { writtenAt, fiveHour, sevenDay } | null }
```

`cache` is what `readCache` returned (or null), `body` the parsed response. `write` is non-null
only when the state is `ok` and the reading is newer (§2.3, §2.4). The windows go through
`normalizeRateLimits`, so rounding and partial-window handling stay in one place.

### 3.4 Data flow

```
pir worker → pir's usage.json → pir service ─ GET /v1/usage ─┐
                                                             ▼
cockpitd tick (30 s) → pollPirUsage: api.json → pid → fetch → clock, readCache
                       → decidePirReading → writeCache (only when newer)
Claude Code turn → cockpit-usage-tap.mjs → writeCache (always)
                                     both → usage-cache.json → cockpit-strip.mjs footer
```

### 3.5 Storage

No new file. `usage-cache.json` keeps its shape and its per-writer-temp atomic write. The poll
state lives in the daemon's memory and resets to `absent` on a rebuild.

---

## 4. Testing

- **Pure** (`spikes/usage-test/model.test.mjs`): every branch of `parsePirApiFile` and
  `decidePirReading`, including the equal-time, future and future-cache boundaries.
- **Reader** (`spikes/usage-test/pir.test.mjs`): a stand-in `node:http` server on an OS-chosen
  port and a scratch home holding its `api.json`; every state of §2.5, the timeout, the refused
  redirect, the dead pid sending no request, the CLI's two modes.
- **Daemon** (`spikes/cockpit-test/run.sh`, a new chain): a real `cockpitd.mjs` against the
  stand-in; the write, the no-rewrite, newest-wins against a seeded tap reading, one log line per
  change of state, and the real strip drawing the pir-fed reading.
- **Installer** (`spikes/usage-test/run.sh`): assertions on the real lines of `bin/install.sh`,
  as `spikes/pir-pane-test` does for the `pir` line.
- **Live-check script** (`spikes/usage-test/live-check.test.mjs`): `live-check.sh` run against the
  stand-in, a scratch `PIR_HOME` and a scratch cockpit dir; every verdict it can print.

No surface is built or changed, so there is no rig task and no drill. The footer drawing from the
cache is already proven by cockpit-test §12b.

---

## 5. Environment

| | |
|---|---|
| OS | macOS (Darwin 25.5.0) |
| Runtime | Node v24.2.0 (built-in `fetch`, `AbortSignal.timeout`), zsh, bash |
| Tools | `jq`, `curl` present (T06 uses them) |
| pir | `~/.local/bin/pir`, installed, with no `service` command yet; `~/.pir/` holds no `api.json` (2026-09-30) |
| Absent | pir's API service: plan reviewed on branch `pir/api-service` (3e2f4bd), build started, nothing merged or installed (2026-09-30) |

**The test command.** Three suites, each a self-contained `run.sh`, run from the repo root.
Measured 2026-09-30 in a fresh worktree with no setup: usage-test green, pir-pane-test 95,
cockpit-test 780, `git status --porcelain` empty afterwards; re-measured at plan review, 1 s, 1 s
and 160 s. They are quiet on green: no per-check lines, `ALL PASS` last. usage-test prints 11
lines, pir-pane-test 1, cockpit-test one heading per section (206 lines). They print failures in
full, and `VERBOSE=1` restores the per-check lines.
Nothing forces colour here (`FORCE_COLOR`, `CLICOLOR_FORCE` and `CI` unset) and the suites emit
none. `pir-pane-test` is in the list because T04 edits `install.sh` beside the block it asserts on.

**Dependencies.** None added. Node's standard library only.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| That the real pir service speaks the contract of §2.1 | It lives in another repo and is not installed; PLAN § After the merge, step 1 |
| That the live cockpit's bar stays lit through a pir run | Needs the person's real window rebuilt on the merged code, which closes every agent terminal; PLAN § After the merge, steps 2 and 3 |

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| `PIR_HOME` exported to a scratch folder at the top of `usage-test`, `cockpit-test` and `daemon-leak-test` | No test daemon or test reader can resolve the real `~/.pir/api.json`, even when the caller's environment sets `PIR_HOME` or the suite forgets `HOME` |
| Loopback-only `url`, redirects refused (§2.6) | A file cannot send the daemon to the network |
| 2 s request limit, one poll in flight | A hung service cannot hold the tick or pile up requests |
| `COCKPIT_DIR` scratch in every suite, and in `live-check.sh`'s `--once` | No test and no live check writes the real `usage-cache.json` |

`spikes/pir-pane-drill/` already sets all three of `HOME`, `COCKPIT_DIR` and `PIR_HOME` to
scratch. `spikes/pane-swap/live*.sh` and `spikes/browse-mode/probe-pair-slot.sh` are hand spikes
outside the test command and are left alone.

### 5.3 Outside the code: who acts

Shown to the person and granted as it stands, 2026-09-30, plan review. Nothing here costs money or
is seen by anyone else, and none needs a login. The rules are in `.claude/settings.json`.

| Action | Command | Bin | Why this bin | Way back |
|---|---|---|---|---|
| The test command and the daemon-leak suite (T03 edits it) | `bash spikes/usage-test/run.sh`, `bash spikes/pir-pane-test/run.sh`, `bash spikes/cockpit-test/run.sh`, `bash spikes/daemon-leak-test/run.sh` | worker | Stand-in server, scratch `HOME`, `PIR_HOME`, `COCKPIT_DIR` | nothing changed |
| Read the pir service's state, after the merge | `pir service` | worker | Prints only. Added at plan review: the plan used it without a row | nothing changed |
| The live check, after the merge | `bash spikes/usage-test/live-check.sh`, `bash spikes/usage-test/live-check.sh follow`, `grep -c 'usage: pir service' ~/.claude/cockpit/daemon.log` | worker | GETs on loopback, one poll into a scratch `COCKPIT_DIR`, reads of the real `usage-cache.json` and `daemon.log`; prints no percentage | nothing changed |
| Stop and start pir's service, after the merge | `pir service off`, `pir service on` | ask | Stops a login service on the person's machine; the person kept it at `ask` | `pir service on` |
| Close and reopen the live cockpit window, after the merge | none | person | Closes every agent terminal and revdiff; needs the GUI | reopening is the way back |
| `bin/install.sh` on the real machine | not run | none | It rewrites `~/.wezterm.lua` and `settings.json`; T04 is proven on the script's lines and the CLI it calls | none needed |

---

## 6. Recovery

The plan adds no persistent state. Reverting the commits removes the poll; `usage-cache.json` is
then fed by the tap alone, as today. A cache entry written from a pir reading is an ordinary
entry and needs no clean-up.

---

## 7. Decisions and rationale

- 2026-09-30, person (brief): HTTP polling of pir's API, not pir's files; the footer unchanged;
  ordinary sessions keep feeding the bar; newest reading wins.
- 2026-09-30, person: with the pir feed off the footer stays silent and dims as today. No mark.
- 2026-09-30, person: newer wins, not higher. After a reset "higher" would show the old number.
- 2026-09-30, person: `bin/install.sh` reports the service with one line.
- 2026-09-30, person: `pirBase` was unset on the planning branch; planning went ahead with
  `main` as the base.
- 2026-09-30, person, plan review: the real-machine check is a checklist after the merge (PLAN
  § After the merge), not a task. Reason: it needs the merged code in the main checkout, and a
  pir build merges only when every task is done. T06 builds the script and proves it on the
  stand-in.
- 2026-09-30, person, plan review: the person reopens the window and glances once; the session
  follows the real cache for 20 minutes. Reason: a pir reading is told from a tap write by its
  `writtenAt`, so nobody has to keep ordinary sessions idle or watch the bar.
- 2026-09-30, person, plan review: the installer's line asks `/v1/usage`, not `/health` (§2.7).
- 2026-09-30, person, plan review: the §5.3 bins stand; `pir service off`/`on` stay at `ask`.
- No prototype: nothing new appears on screen.
- Extend `cockpit-usage-model.mjs` and reuse `normalizeRateLimits`, `readCache`, `writeCache`
  rather than a second model or store. Reason: the response's `rate_limits` is the shape the
  model already takes, and the cache is the file the footer already watches.
- The reader is its own module, not inline in `cockpitd.mjs`. Reason: it is testable without a
  daemon, and the installer and the live check reuse it.
- The installer asks the cockpit's own reader, not `pir service`. Reason: the installed pir has
  no `service` command yet (measured), and one reader means the installer and the daemon cannot
  disagree about "up".
- usage-limits DESIGN §8 deferred a "live poll" of Anthropic's private endpoint and noted the
  footer could take a second writer. This is a second writer from a different source; that
  deferral stands.

## 8. Explicitly out of scope

- Any change to pir, any other pir endpoint, writing to pir.
- Any change to how the bar looks, its thresholds or the 15-minute stale mark.
- The tap and its registration. It keeps writing unconditionally.
- A footer mark for "pir feed off" (declined, §2.5).
- Polling on a return to the fleet list, as the agenda does. Reason: 30 s is already well inside
  the 15-minute mark.
- `plans/usage-limits` T06, that plan's own live check, which stays open there.
