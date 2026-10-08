# T01 — pir-reading-decision

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The pure half of the reader: parse pir's discovery file, and decide from the cache, the service's
answer and the current time whether the cache is rewritten and with what. Everything here is
tested with plain values, so the reader and the daemon built on it only carry bytes.

## Design sections this implements

DESIGN §2.3, §2.4, §2.5 (states `bad-file`, `bad-body`, `empty`, `future`, `ok`), §2.6, §3.3.

## Files

- `bin/cockpit-usage-model.mjs` (extend; `renderUsage` and `normalizeRateLimits` untouched)
- `spikes/usage-test/model.test.mjs` (extend)

## Interface

```js
export const PIR_FUTURE_TOLERANCE_MS = 60_000;

// text: the contents of api.json. Returns null for anything but a version-1 file whose url is
// http, host 127.0.0.1 or localhost, an explicit port, path "" or "/", no query, hash or
// credentials, and whose pid is a positive integer. `origin` has no trailing slash.
export function parsePirApiFile(text) → { origin: "http://127.0.0.1:47717", pid: 4711 } | null

// cache: readCache()'s value or null. body: the parsed JSON of a 200, any type.
export function decidePirReading(cache, body, nowMs) →
  { state: "ok" | "empty" | "bad-body" | "future",
    write: { writtenAt, fiveHour, sevenDay } | null }
```

`decidePirReading`, in order:

1. `body` not a plain object, or `version !== 1`: `bad-body`.
2. `observed_at === null` and `rate_limits === null`: `empty`.
3. `observed_at` not a finite number above 0, or `rate_limits` not a plain object: `bad-body`.
4. `observed_at > nowMs + PIR_FUTURE_TOLERANCE_MS`: `future`.
5. `at = Math.min(observed_at, nowMs)`; `reading = normalizeRateLimits(rate_limits, at)`; null
   (no drawable window): `empty`.
6. State `ok`. `write = reading` when there is no cache, or `cache.writtenAt > nowMs`, or
   `at > cache.writtenAt`; otherwise `write = null`.

`new URL(x)` is allowed in the model (it reads no clock); the purity grep in
`spikes/usage-test/run.sh` must stay green and unchanged.

## Tests

- [ ] `parsePirApiFile`: the documented file; `localhost`; a trailing slash on the url; not JSON;
      empty string; an array; `version` 2 or missing; `https:`; host `example.com`; host
      `127.0.0.1.example.com`; no port; a path; a query; `user:pw@`; pid 0, negative, a float, a
      string, missing.
- [ ] `decidePirReading`: the documented body against no cache writes it, `writtenAt` equal to
      `observed_at`, percentages rounded (97.49 → 97).
- [ ] Newer than the cache by 1 ms writes; equal writes nothing; older writes nothing; all three
      are state `ok`.
- [ ] One window null: writes, that window null. Both windows null inside an object: `empty`.
- [ ] Nulls body: `empty`. `observed_at` null with `rate_limits` set, and the reverse: `bad-body`.
- [ ] `version` 2, body a string, body null, `observed_at` a string, 0, negative, NaN: `bad-body`.
- [ ] `observed_at` = now + 60 000: `ok`, `writtenAt` clamped to now. now + 60 001: `future`,
      no write.
- [ ] A cache with `writtenAt` ahead of now loses to any valid reading.
- [ ] `resets_at` in the past is written as heard.
- [ ] The inputs are not mutated.

## Done when

- [ ] `bash spikes/usage-test/run.sh` is green, the purity grep included and unedited.
- [ ] Every line of the Tests list has at least one assertion.
