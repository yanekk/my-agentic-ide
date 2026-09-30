# T02 — pir-usage-reader

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

The world-touching half: find pir's service through `api.json`, ask it with a time limit, and
apply T01's decision to the cache. One poll function serves the daemon (T03), the installer
(T04) and the live check (T06), so all three run the same code. It never throws and never
rejects.

## Design sections this implements

DESIGN §2.1, §2.2 (the 2 s limit), §2.5, §2.6, §3.2, §5.2.

## Files

- `bin/cockpit-usage-pir.mjs` (new)
- `spikes/usage-test/pir.test.mjs` (new; picked up by `run.sh`'s `*.test.mjs` loop)
- `spikes/usage-test/run.sh` (export a scratch `PIR_HOME` at the top; one bash check that it is
  exported)

## Interface

```js
export const PIR_TIMEOUT_MS = 2000;

// env.PIR_HOME ?? env.HOME, the rule pir itself uses. Returns the folder holding `.pir/`.
export function pirHome(env = process.env) → string

// process.kill(pid, 0); EPERM counts as alive (the same rule as cockpitd's isAlive).
export function isAlive(pid) → boolean

// One GET. Never throws, never rejects.
export async function fetchPirUsage({ home, alive = isAlive, timeoutMs = PIR_TIMEOUT_MS }) →
    { state: "absent" | "bad-file" | "dead" | "unreachable" | "bad-body" }
  | { state: "http", status: 500 }
  | { state: "answered", origin, body }      // body: the parsed JSON of a 200

// One whole poll: fetch, then the clock, readCache(dir), decidePirReading, writeCache(dir).
// The clock and the cache are read AFTER the response arrived, and the write follows in the
// same synchronous step (DESIGN §2.n). Never throws, never rejects.
export async function pollPirUsage({ home, dir, now = Date.now, alive, timeoutMs }) →
    { state, status?, origin?, wrote: boolean }
    // state: any of DESIGN §2.5's, with "http" carrying status
```

`fetch` is called with `redirect: "error"` and `signal: AbortSignal.timeout(timeoutMs)`, and the
body is read inside the same limit. Reason: headers can arrive and the body never. No header of
our own is set. `dir` undefined means the store's own
default (`COCKPIT_DIR` or `~/.claude/cockpit`). A failed `writeCache` is state `ok`,
`wrote: false`.

CLI, guarded by the same main-module check the tap uses:

```
node bin/cockpit-usage-pir.mjs --status   → "running http://127.0.0.1:47717"   exit 0  (ok, empty)
                                            "off {state}"                        exit 1  (every other)
node bin/cockpit-usage-pir.mjs --once     → "{state} wrote" | "{state} kept"    exit 0
```

`--status` writes nothing: it calls `fetchPirUsage` and `decidePirReading(null, body, now)` for
the state only. Both modes use `pirHome()` and the store's default dir. No percentage is printed.

## Tests

A stand-in `node:http` server on `listen(0, "127.0.0.1")` with a switchable mode, and a scratch
home whose `.pir/api.json` the test writes. `home` and `dir` are passed explicitly.

- [ ] No `.pir/`, and `.pir/` without `api.json`: `absent`, no request.
- [ ] `api.json` not JSON, `version` 2, url `http://example.com:80`: `bad-file`, no request
      (the server's hit count stays 0).
- [ ] A pid that is not running: `dead`, no request.
- [ ] A closed port: `unreachable`. A server that never answers, `timeoutMs: 200`: `unreachable`
      in under a second. Headers sent and the body never finished: `unreachable`.
- [ ] A 302 to another address: `unreachable`, and the target is never requested.
- [ ] 403, 404, 500: `http` with the status.
- [ ] 200 with a non-JSON body: `bad-body`.
- [ ] The request as the server saw it: method `GET`, path `/v1/usage`, no `Authorization`.
- [ ] `pollPirUsage`, documented body, empty dir: cache written, mode 0600, `writtenAt` equal to
      `observed_at`, `wrote: true`.
- [ ] Polled again: `wrote: false`, the cache file's inode and mtime unchanged.
- [ ] A seeded newer cache is kept; a seeded older one is replaced.
- [ ] Nulls body: `empty`, a seeded cache untouched. `version` 2 body: `bad-body`, untouched.
- [ ] `now` injected 2 minutes behind `observed_at`: `future`, untouched.
- [ ] `dir` not writable: resolves, `wrote: false`.
- [ ] `pirHome`: `PIR_HOME` wins over `HOME`; with `PIR_HOME` unset it is `HOME`.
- [ ] CLI `--status` with `PIR_HOME` at the scratch home: `running {origin}` exit 0; with the
      server stopped: `off unreachable` exit 1; no cache file created either way.
- [ ] CLI `--once` with `PIR_HOME` and `COCKPIT_DIR` scratch: `ok wrote`, then `ok kept`.

## Done when

- [ ] `bash spikes/usage-test/run.sh` is green, and its "real cockpit dir is untouched" check
      still passes.
- [ ] `grep -n PIR_HOME spikes/usage-test/run.sh` shows the export above the suite loop.
- [ ] No test passes a home other than a scratch folder; none names port 47717.
