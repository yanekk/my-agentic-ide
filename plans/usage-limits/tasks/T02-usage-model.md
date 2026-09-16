# T02 — `cockpit-usage-model.mjs` (pure)

**Phase:** 1 · **Runs:** auto · **Depends on:** T00 · **Weight:** medium

## Goal

The pure heart of the feature: turn Claude Code's `rate_limits` object into the normalized cache
shape, and turn a cache plus the current time into exactly what the footer should draw — colours,
reset-time strings, staleness. A function of its arguments and nothing else, so the whole of the
display behaviour is a millisecond test. This is where the thresholds, the staleness rule and the
format live.

## Design sections this implements

DESIGN §2.2 (format), §2.3 (thresholds/colour), §2.4 (staleness), §3.1 (the boundary and its
grep), §3.3 (the decision function).

## Files

- `bin/cockpit-usage-model.mjs` (new, pure). Header comment like the agenda/bitbucket models:
  no clock, no fs, no env, no network; `now` arrives as a parameter; if the grep fails, move the
  code out, never relax the grep.

## Interface

```
// constants at the top — the one place they are defined
WARN_PCT = 70, CRIT_PCT = 90, STALE_MS = 15*60*1000

normalizeRateLimits(rawRateLimits, nowMs) → cache | null
  // rawRateLimits is Claude Code's stdin `rate_limits` (shape confirmed in T00).
  // → { writtenAt: nowMs, fiveHour: {usedPct,resetsAt}|null, sevenDay: {usedPct,resetsAt}|null }
  // returns null if neither five_hour nor seven_day is present.
  // nowMs is passed in (not read) so the module stays clock-free.

renderUsage(cache, nowMs) → null | {
  stale:   boolean,                  // nowMs - cache.writtenAt > STALE_MS
  asOf:    "HH:MM" | null,           // local write time, only when stale
  windows: [ { key:"5h"|"7d", pct:<int>, role:"ok"|"warn"|"crit", reset:<string> } ]
}
  // role: pct >= CRIT_PCT → "crit"; >= WARN_PCT → "warn"; else "ok".
  // reset: same local day as nowMs → "HH:MM"; else "Ddd HH:MM" (weekday + time).
  // returns null when cache is null or holds no drawable window.
```

The model emits no ANSI — `role` is a semantic string the strip colours (DESIGN §3.3). Reset
formatting uses the machine's local zone; that is a deterministic function of `resetsAt` and the
zone, so tests fix `TZ`.

## Tests

- [ ] `normalizeRateLimits` on the T00 sample yields the expected cache; on `{}` yields null; on
      an object with only `five_hour` yields a cache with `sevenDay: null`.
- [ ] Role thresholds at the boundaries: 69→ok, 70→warn, 89→warn, 90→crit.
- [ ] Staleness boundary: `now - writtenAt` just under `STALE_MS` → not stale, no `asOf`; just
      over → stale, `asOf` is the local write time.
- [ ] Reset formatting: a reset later today → `HH:MM`; a reset tomorrow → `Ddd HH:MM`; both under
      a fixed `TZ`.
- [ ] `renderUsage(null, now)` → null; a cache with both windows null → null.
- [ ] A cache with one window null draws only the other.
- [ ] The purity grep passes: the model file contains no `fs`/`http`/`https`/`child_process`,
      no `fetch`, no `Date.now`/bare `new Date()`, no `process.env`.

## Done when

- [ ] `bin/cockpit-usage-model.mjs` exports `normalizeRateLimits` and `renderUsage` as above.
- [ ] `spikes/usage-test/run.sh` greps the model for forbidden imports/clock/env and fails on a
      hit, and all the cases above pass.
- [ ] Thresholds and `STALE_MS` are module constants, referenced nowhere else by literal.
