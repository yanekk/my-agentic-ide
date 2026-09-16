# T03 — `cockpit-usage-tap.mjs` (the statusline command)

**Phase:** 1 · **Runs:** auto · **Depends on:** T00, T01, T02 · **Weight:** medium

## Goal

The statusline command Claude Code runs every turn. Its only job is to copy a personal session's
`rate_limits` into the cache. It gates on the subscription signal and on Bedrock, writes through
the store, and stays invisible and harmless — fast, silent, and exit-0 on any error so it can
never disrupt a Claude session.

## Design sections this implements

DESIGN §2.5 (the gate), §2.6 (runs in all sessions), §2.7 (invisible, never disruptive), §2.n
(no clobber when data absent).

## Files

- `bin/cockpit-usage-tap.mjs` (new). `--install`/`--uninstall` are T04; this task is the
  stdin→cache behaviour and the empty-by-default output.

## Interface

```
// invoked as: cockpit-usage-tap.mjs   (Claude Code pipes JSON on stdin)
// 1. If truthy(process.env.CLAUDE_CODE_USE_BEDROCK)  → print "", exit 0. (no read of stdin's rate_limits)
//    truthy = present, non-empty, not "0"/"false" (case-insensitive) — the auto-namer's reading.
// 2. Read stdin JSON. If it has no rate_limits with five_hour|seven_day → print "", exit 0, no write.
// 3. cache = normalizeRateLimits(json.rate_limits, Date.now())  [T02]
//    if cache is null → print "", exit 0, no write.
//    else writeCache(cache) [T01].
// 4. Print the visible statusline: "" by default, or the chained prior command's output (T04).
// 5. ANY thrown error anywhere → print "", exit 0. Never non-zero, never a stack to stderr.
```

`Date.now()` is read *here*, in the shell layer, and passed into the pure model — the clock does
not belong in the model (DESIGN §3.1). Keep the script dependency-free and quick: read stdin,
one write, exit.

## Tests

- [ ] The T00 sample on stdin writes a cache whose `fiveHour`/`sevenDay` match the sample.
- [ ] `CLAUDE_CODE_USE_BEDROCK=1` on stdin-with-rate_limits writes nothing and prints "".
- [ ] `CLAUDE_CODE_USE_BEDROCK=false` is treated as off (write happens).
- [ ] Stdin with no `rate_limits` leaves an existing cache untouched (no clobber) and prints "".
- [ ] Malformed/non-JSON stdin: exit 0, empty stdout, no write, no throw.
- [ ] An unwritable cache dir: exit 0, empty stdout (error swallowed).
- [ ] Default visible output is empty (no chained command configured).

## Done when

- [ ] `bin/cockpit-usage-tap.mjs` behaves as the interface states, driven by the store and model.
- [ ] `spikes/usage-test/run.sh` covers the seven cases and passes.
- [ ] The script exits 0 in every tested path, including every error path.
