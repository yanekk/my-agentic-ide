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

done();
