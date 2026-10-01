// cockpit-usage-model: the pure normalize + render (DESIGN 2.2, 2.3, 2.4, 3.3).
//
// Every case here is a function of its arguments -- a rate_limits object or a
// cache, plus `now` as a number -- so the whole of the display behaviour is proven
// in milliseconds. Reset-time formatting is in the machine's local zone, so this
// suite pins TZ=UTC BEFORE the first Date operation and picks instants whose UTC
// wall clock is what it asserts; the model reads no clock and no env, only the Date
// runtime the fixed TZ governs. The purity grep itself lives in run.sh.
process.env.TZ = "UTC";

import { section, ok, eq, done } from "./harness.mjs";
import {
  normalizeRateLimits,
  renderUsage,
  WARN_PCT,
  CRIT_PCT,
  STALE_MS,
  PIR_FUTURE_TOLERANCE_MS,
  parsePirApiFile,
  decidePirReading,
} from "../../bin/cockpit-usage-model.mjs";

// Wed 2026-09-16 14:20:00 UTC. A reset later the same day, and one the next day
// (Thu), so the "today -> HH:MM / else Ddd HH:MM" split is exercised in one sample.
const NOW = Date.UTC(2026, 8, 16, 14, 20, 0);
const R5 = Math.floor(Date.UTC(2026, 8, 16, 18, 30, 0) / 1000); // later today
const R7 = Math.floor(Date.UTC(2026, 8, 17, 9, 0, 0) / 1000); // tomorrow, a Thursday

// --- normalizeRateLimits ---------------------------------------------------
section("normalizeRateLimits");
{
  // The T00-captured shape: five_hour / seven_day, each {used_percentage float,
  // resets_at epoch seconds}. The live UI read 62%/93% (T00 FINDINGS); the floats
  // round to whole numbers in the cache.
  const sample = {
    five_hour: { used_percentage: 62.4, resets_at: R5 },
    seven_day: { used_percentage: 93.1, resets_at: R7 },
  };
  eq("the T00 sample yields the normalized cache", normalizeRateLimits(sample, NOW), {
    writtenAt: NOW,
    fiveHour: { usedPct: 62, resetsAt: R5 },
    sevenDay: { usedPct: 93, resetsAt: R7 },
  });

  eq("an empty rate_limits object yields null", normalizeRateLimits({}, NOW), null);
  eq("a null rate_limits yields null", normalizeRateLimits(null, NOW), null);

  const onlyFive = { five_hour: { used_percentage: 40, resets_at: R5 } };
  eq("only five_hour present yields sevenDay: null", normalizeRateLimits(onlyFive, NOW), {
    writtenAt: NOW,
    fiveHour: { usedPct: 40, resetsAt: R5 },
    sevenDay: null,
  });

  // A present-but-incomplete window is treated as absent (DESIGN 2.n, partial data).
  const partial = {
    five_hour: { used_percentage: 55 }, // no resets_at
    seven_day: { used_percentage: 30, resets_at: R7 },
  };
  eq("a window missing resets_at is dropped, the other kept", normalizeRateLimits(partial, NOW), {
    writtenAt: NOW,
    fiveHour: null,
    sevenDay: { usedPct: 30, resetsAt: R7 },
  });
}

// --- role thresholds -------------------------------------------------------
section("role thresholds (69 ok / 70 warn / 89 warn / 90 crit)");
{
  const roleAt = (pct) => {
    const cache = { writtenAt: NOW, fiveHour: { usedPct: pct, resetsAt: R5 }, sevenDay: null };
    return renderUsage(cache, NOW).windows[0].role;
  };
  eq("69 -> ok", roleAt(69), "ok");
  eq("70 -> warn (WARN_PCT boundary)", roleAt(70), "warn");
  eq("89 -> warn", roleAt(89), "warn");
  eq("90 -> crit (CRIT_PCT boundary)", roleAt(90), "crit");
  // The constants are the one place these live; assert their values here so a
  // silent change to a literal elsewhere would surface as a failed boundary above.
  eq("WARN_PCT is 70", WARN_PCT, 70);
  eq("CRIT_PCT is 90", CRIT_PCT, 90);
}

// --- staleness boundary ----------------------------------------------------
section("staleness boundary (STALE_MS)");
{
  eq("STALE_MS is 15 minutes", STALE_MS, 15 * 60 * 1000);

  // Just under STALE_MS: not stale, no asOf.
  const fresh = { writtenAt: NOW - (STALE_MS - 1), fiveHour: { usedPct: 10, resetsAt: R5 }, sevenDay: null };
  const rFresh = renderUsage(fresh, NOW);
  eq("just under STALE_MS is not stale", rFresh.stale, false);
  eq("a fresh reading has no asOf", rFresh.asOf, null);

  // Just over STALE_MS: stale, asOf is the local write time. writtenAt is
  // NOW - (STALE_MS+1) = 14:20:00 - 15:00.001 = 14:04:59.999 UTC -> "14:04".
  const stale = { writtenAt: NOW - (STALE_MS + 1), fiveHour: { usedPct: 10, resetsAt: R5 }, sevenDay: null };
  const rStale = renderUsage(stale, NOW);
  eq("just over STALE_MS is stale", rStale.stale, true);
  eq("a stale reading stamps the local write time", rStale.asOf, "14:04");
}

// --- reset formatting ------------------------------------------------------
section("reset formatting (today HH:MM / another day Ddd HH:MM)");
{
  const cache = {
    writtenAt: NOW,
    fiveHour: { usedPct: 5, resetsAt: R5 }, // later today
    sevenDay: { usedPct: 5, resetsAt: R7 }, // tomorrow (Thu)
  };
  const r = renderUsage(cache, NOW);
  const w = (k) => r.windows.find((x) => x.key === k);
  eq("a reset later today is bare HH:MM", w("5h").reset, "18:30");
  eq("a reset on another day is Ddd HH:MM", w("7d").reset, "Thu 09:00");
  // With both reported windows present the order is 5h / 1d / 7d, the 1d derived.
  eq("the windows are ordered 5h / 1d / 7d", r.windows.map((x) => x.key), ["5h", "1d", "7d"]);
}

// --- the derived 1d daily-budget window ------------------------------------
section("1d daily-budget window (derived from 7d, reset-aligned)");
{
  // A clean weekly window: reset Thu 09:00 UTC, so it started the previous Thu 09:00.
  // Days are slices of that window, not calendar days. `at(day, hours)` is an instant
  // `hours` into slice `day` (1..7); `oneD` reads back the derived 1d window there.
  const W7 = Math.floor(Date.UTC(2026, 8, 17, 9, 0, 0) / 1000); // Thu 09:00, weekly reset
  const weekStart = W7 - 7 * 86400;                             // previous Thu 09:00
  const at = (day, hours) => (weekStart + (day - 1) * 86400 + hours * 3600) * 1000;
  const oneD = (usedPct, nowMs) => {
    const cache = { writtenAt: nowMs, fiveHour: null, sevenDay: { usedPct, resetsAt: W7 } };
    return renderUsage(cache, nowMs).windows.find((x) => x.key === "1d");
  };

  // 1d% = 7*weekly - 100*(day-1). Day 1 subtracts no slice; day 2 subtracts one.
  eq("day 1, 5% weekly -> 35%", oneD(5, at(1, 3)).pct, 35);
  eq("day 2, 20% weekly -> 40%", oneD(20, at(2, 3)).pct, 40);
  // Carry-forward: a high weekly total early in the week reads over 100 -> red.
  eq("day 2, 40% weekly -> 180% (over budget)", oneD(40, at(2, 3)).pct, 180);
  eq("over 100 is crit (red)", oneD(40, at(2, 3)).role, "crit");
  eq("100 or under is ok (green)", oneD(20, at(2, 3)).role, "ok");
  // Banked credit reads negative and stays green (no amber on 1d).
  eq("day 6, 30% weekly -> -290% (banked credit)", oneD(30, at(6, 3)).pct, -290);
  eq("negative (credit) is ok (green)", oneD(30, at(6, 3)).role, "ok");
  // The slice resets at the next reset-aligned boundary (day 1 -> Fri 09:00).
  eq("1d reset is the next daily boundary", oneD(5, at(1, 3)).reset, "Fri 09:00");
  // A reading drifted past the weekly reset clamps to day 7 rather than overshooting.
  const past = (W7 + 2 * 86400) * 1000;
  eq("past the weekly reset clamps to day 7", oneD(50, past).pct, 7 * 50 - 100 * 6);
  // 1d appears only WITH the 7d window it derives from, never on its own.
  const onlyFiveCache = { writtenAt: at(1, 3), fiveHour: { usedPct: 10, resetsAt: W7 }, sevenDay: null };
  eq("only five_hour present -> no 1d window", renderUsage(onlyFiveCache, at(1, 3)).windows.map((x) => x.key), ["5h"]);
}

// --- renderUsage empties ---------------------------------------------------
section("renderUsage returns null when there is nothing to draw");
{
  eq("renderUsage(null) is null", renderUsage(null, NOW), null);
  const bothNull = { writtenAt: NOW, fiveHour: null, sevenDay: null };
  eq("a cache with both windows null is null", renderUsage(bothNull, NOW), null);
}

// --- one window only -------------------------------------------------------
section("one window null draws only the other");
{
  // seven_day present, five_hour null: the reported 7d window is drawn, and the 1d
  // window derived from it -- no 5h. (1d always accompanies 7d; only five_hour is
  // ever drawn truly alone.)
  const onlySeven = { writtenAt: NOW, fiveHour: null, sevenDay: { usedPct: 72, resetsAt: R7 } };
  const r = renderUsage(onlySeven, NOW);
  eq("no 5h, but 1d and 7d are drawn", r.windows.map((x) => x.key), ["1d", "7d"]);
  eq("the reported 7d window is unchanged", r.windows.find((x) => x.key === "7d"), {
    key: "7d",
    pct: 72,
    role: "warn",
    reset: "Thu 09:00",
  });
}

// --- parsePirApiFile (plans/pir-usage-reader DESIGN 2.1, 2.5, 2.6) -----------
section("parsePirApiFile: only a plain loopback http origin is accepted");
{
  const file = (o) => JSON.stringify({ version: 1, url: "http://127.0.0.1:47717", pid: 4711, ...o });
  eq("the documented file", parsePirApiFile(file({})), { origin: "http://127.0.0.1:47717", pid: 4711 });
  eq("localhost is accepted", parsePirApiFile(file({ url: "http://localhost:47717" })),
     { origin: "http://localhost:47717", pid: 4711 });
  eq("a trailing slash is accepted, origin has none", parsePirApiFile(file({ url: "http://127.0.0.1:47717/" })),
     { origin: "http://127.0.0.1:47717", pid: 4711 });

  eq("not JSON", parsePirApiFile("{ version: 1"), null);
  eq("empty string", parsePirApiFile(""), null);
  eq("an array", parsePirApiFile("[1]"), null);
  eq("JSON null", parsePirApiFile("null"), null);
  eq("not a string", parsePirApiFile(undefined), null);
  eq("version 2", parsePirApiFile(file({ version: 2 })), null);
  eq("version missing", parsePirApiFile(JSON.stringify({ url: "http://127.0.0.1:47717", pid: 4711 })), null);
  eq("version \"1\" (a string)", parsePirApiFile(file({ version: "1" })), null);

  eq("https", parsePirApiFile(file({ url: "https://127.0.0.1:47717" })), null);
  eq("host example.com", parsePirApiFile(file({ url: "http://example.com:47717" })), null);
  eq("host 127.0.0.1.example.com", parsePirApiFile(file({ url: "http://127.0.0.1.example.com:47717" })), null);
  eq("host 0.0.0.0", parsePirApiFile(file({ url: "http://0.0.0.0:47717" })), null);
  eq("no port", parsePirApiFile(file({ url: "http://127.0.0.1" })), null);
  eq("a path", parsePirApiFile(file({ url: "http://127.0.0.1:47717/v1" })), null);
  eq("a query", parsePirApiFile(file({ url: "http://127.0.0.1:47717/?x=1" })), null);
  eq("a hash", parsePirApiFile(file({ url: "http://127.0.0.1:47717/#x" })), null);
  eq("credentials user:pw@", parsePirApiFile(file({ url: "http://user:pw@127.0.0.1:47717" })), null);
  eq("url not a URL", parsePirApiFile(file({ url: "not a url" })), null);
  eq("url missing", parsePirApiFile(JSON.stringify({ version: 1, pid: 4711 })), null);

  eq("pid 0", parsePirApiFile(file({ pid: 0 })), null);
  eq("pid negative", parsePirApiFile(file({ pid: -4711 })), null);
  eq("pid a float", parsePirApiFile(file({ pid: 47.11 })), null);
  eq("pid a string", parsePirApiFile(file({ pid: "4711" })), null);
  eq("pid missing", parsePirApiFile(JSON.stringify({ version: 1, url: "http://127.0.0.1:47717" })), null);
}

// --- decidePirReading (DESIGN 2.3, 2.4, 2.5, 3.3) --------------------------
section("decidePirReading: newest wins, every failure quiet");
{
  const OBS = NOW - 5000; // heard five seconds ago
  const body = (o) => ({
    version: 1,
    observed_at: OBS,
    rate_limits: {
      five_hour: { used_percentage: 97.49, resets_at: R5 },
      seven_day: { used_percentage: 77, resets_at: R7 },
    },
    ...o,
  });
  const reading = (at) => ({
    writtenAt: at,
    fiveHour: { usedPct: 97, resetsAt: R5 },
    sevenDay: { usedPct: 77, resetsAt: R7 },
  });
  const cacheAt = (t) => ({ writtenAt: t, fiveHour: { usedPct: 10, resetsAt: R5 }, sevenDay: null });

  eq("PIR_FUTURE_TOLERANCE_MS is 60 s", PIR_FUTURE_TOLERANCE_MS, 60000);

  // The documented body against no cache: written, stamped with observed_at, rounded.
  eq("no cache: written at observed_at, 97.49 rounds to 97", decidePirReading(null, body({}), NOW),
     { state: "ok", write: reading(OBS) });
  eq("readCache's 0 writtenAt (unreadable stamp) loses", decidePirReading(cacheAt(0), body({}), NOW),
     { state: "ok", write: reading(OBS) });
  eq("a cache with no usable writtenAt counts as no cache",
     decidePirReading({ fiveHour: null, sevenDay: null }, body({}), NOW), { state: "ok", write: reading(OBS) });

  // Strictly newer.
  eq("newer than the cache by 1 ms writes", decidePirReading(cacheAt(OBS - 1), body({}), NOW),
     { state: "ok", write: reading(OBS) });
  eq("equal to the cache writes nothing, still ok", decidePirReading(cacheAt(OBS), body({}), NOW),
     { state: "ok", write: null });
  eq("older than the cache writes nothing, still ok", decidePirReading(cacheAt(OBS + 1), body({}), NOW),
     { state: "ok", write: null });

  // One window null replaces the whole cache; both null inside an object is empty.
  eq("one window null writes, that window null",
     decidePirReading(cacheAt(OBS - 1000), body({ rate_limits: { five_hour: null, seven_day: { used_percentage: 77, resets_at: R7 } } }), NOW),
     { state: "ok", write: { writtenAt: OBS, fiveHour: null, sevenDay: { usedPct: 77, resetsAt: R7 } } });
  eq("both windows null inside an object: empty",
     decidePirReading(null, body({ rate_limits: { five_hour: null, seven_day: null } }), NOW), { state: "empty", write: null });
  eq("an empty rate_limits object: empty", decidePirReading(null, body({ rate_limits: {} }), NOW),
     { state: "empty", write: null });

  // The service's "nothing known" and the half-null malformations.
  eq("nulls body: empty", decidePirReading(null, { version: 1, observed_at: null, rate_limits: null }, NOW),
     { state: "empty", write: null });
  eq("observed_at null, rate_limits set: bad-body", decidePirReading(null, body({ observed_at: null }), NOW),
     { state: "bad-body", write: null });
  eq("observed_at set, rate_limits null: bad-body", decidePirReading(null, body({ rate_limits: null }), NOW),
     { state: "bad-body", write: null });
  eq("observed_at missing, rate_limits missing: bad-body", decidePirReading(null, { version: 1 }, NOW),
     { state: "bad-body", write: null });

  const bad = { state: "bad-body", write: null };
  eq("version 2: bad-body", decidePirReading(null, body({ version: 2 }), NOW), bad);
  eq("version missing: bad-body", decidePirReading(null, { observed_at: OBS, rate_limits: {} }, NOW), bad);
  eq("body a string: bad-body", decidePirReading(null, "ok", NOW), bad);
  eq("body null: bad-body", decidePirReading(null, null, NOW), bad);
  eq("body an array: bad-body", decidePirReading(null, [body({})], NOW), bad);
  eq("observed_at a string: bad-body", decidePirReading(null, body({ observed_at: String(OBS) }), NOW), bad);
  eq("observed_at 0: bad-body", decidePirReading(null, body({ observed_at: 0 }), NOW), bad);
  eq("observed_at negative: bad-body", decidePirReading(null, body({ observed_at: -OBS }), NOW), bad);
  eq("observed_at NaN: bad-body", decidePirReading(null, body({ observed_at: NaN }), NOW), bad);
  eq("observed_at Infinity: bad-body", decidePirReading(null, body({ observed_at: Infinity }), NOW), bad);
  eq("rate_limits an array: bad-body", decidePirReading(null, body({ rate_limits: [] }), NOW), bad);
  eq("rate_limits a string: bad-body", decidePirReading(null, body({ rate_limits: "x" }), NOW), bad);

  // The future: up to 60 s ahead is heard now; beyond, ignored.
  eq("observed_at now + 60 000: ok, writtenAt clamped to now",
     decidePirReading(null, body({ observed_at: NOW + 60000 }), NOW), { state: "ok", write: reading(NOW) });
  eq("observed_at now + 60 001: future, no write",
     decidePirReading(null, body({ observed_at: NOW + 60001 }), NOW), { state: "future", write: null });
  eq("a future reading does not write even over an old cache",
     decidePirReading(cacheAt(1), body({ observed_at: NOW + 60001 }), NOW), { state: "future", write: null });
  // A clamped near-future reading vs a cache stamped exactly now: equal, not written.
  eq("near-future clamped to now ties a cache at now: no write",
     decidePirReading(cacheAt(NOW), body({ observed_at: NOW + 10 }), NOW), { state: "ok", write: null });

  // A cache dated ahead of the clock loses to any valid reading, even an old one.
  eq("a cache ahead of now loses to a valid reading",
     decidePirReading(cacheAt(NOW + 3600000), body({}), NOW), { state: "ok", write: reading(OBS) });
  eq("a cache ahead of now loses even to an hour-old reading",
     decidePirReading(cacheAt(NOW + 1), body({ observed_at: NOW - 3600000 }), NOW),
     { state: "ok", write: reading(NOW - 3600000) });

  // A reset already past is written exactly as heard.
  const PAST = Math.floor((NOW - 7200000) / 1000);
  eq("resets_at in the past is written as heard",
     decidePirReading(null, body({ rate_limits: { five_hour: { used_percentage: 12, resets_at: PAST }, seven_day: null } }), NOW),
     { state: "ok", write: { writtenAt: OBS, fiveHour: { usedPct: 12, resetsAt: PAST }, sevenDay: null } });

  // Inputs are not mutated.
  const c = cacheAt(OBS - 1), b = body({});
  const cBefore = JSON.stringify(c), bBefore = JSON.stringify(b);
  const out = decidePirReading(c, b, NOW);
  eq("the cache is not mutated", JSON.stringify(c), cBefore);
  eq("the body is not mutated", JSON.stringify(b), bBefore);
  ok("the write is a new object, not the cache", out.write !== c && out.write !== b.rate_limits);
  const fb = Object.freeze({ ...b, rate_limits: Object.freeze({ ...b.rate_limits }) });
  eq("a frozen body decides the same", decidePirReading(Object.freeze(cacheAt(OBS - 1)), fb, NOW),
     { state: "ok", write: reading(OBS) });
}

done();
