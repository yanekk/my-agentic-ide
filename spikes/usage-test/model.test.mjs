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
  eq("a reset later today is bare HH:MM", r.windows[0].reset, "18:30");
  eq("a reset on another day is Ddd HH:MM", r.windows[1].reset, "Thu 09:00");
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
  const onlySeven = { writtenAt: NOW, fiveHour: null, sevenDay: { usedPct: 72, resetsAt: R7 } };
  const r = renderUsage(onlySeven, NOW);
  eq("only one window is drawn", r.windows.length, 1);
  eq("the drawn window is the 7d one", r.windows[0], {
    key: "7d",
    pct: 72,
    role: "warn",
    reset: "Thu 09:00",
  });
}

done();
