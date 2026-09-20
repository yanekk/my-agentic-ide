// cockpit-usage-model -- the pure half of the footer usage segment: Claude Code's
// rate_limits object in, and (cache + now) -> what the footer should draw out.
//
// This module is on the PURE side of the boundary (DESIGN 3.1). It reads no
// files, opens no sockets, asks nothing of the environment and never looks at a
// clock: the current instant arrives as a parameter (`nowMs`). That is what makes
// "how does 89% at 14:20 draw" a millisecond test instead of a wait for a live
// subscription to climb. `spikes/usage-test/run.sh` greps this file to keep it
// honest, and if that grep ever fails the fix is to MOVE THE CODE OUT, never to
// relax it -- every rule that leaks across this line becomes a rule only a person
// on a real Pro/Max session could check.
//
// It emits no ANSI. `role` is a semantic string ("ok"/"warn"/"crit") the strip
// turns into a colour (DESIGN 3.3), so the model stays a pure data function.

// --- the tunable constants, defined here and nowhere else (DESIGN 2.3, 2.4, 3.3) ---
// Thresholds are on the USED percentage: crit means little headroom left. STALE_MS
// is how long a reading may sit before the footer dims it and stamps "as of".
export const WARN_PCT = 70;
export const CRIT_PCT = 90;
export const STALE_MS = 15 * 60 * 1000;

// Fixed weekday labels rather than Intl: the drawn string must be a deterministic
// function of (instant, machine zone) with no locale in it, so a reset on another
// day always reads "Wed 09:00", never a localised variant. getDay() is local-zone.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad2 = (n) => String(n).padStart(2, "0");

// Local wall-clock HH:MM of an ms-since-epoch instant. Constructing a Date FROM an
// argument is allowed past the purity grep; a bare zero-argument one reads the
// clock and is not.
function hhmm(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// role from used percentage (DESIGN 2.3): >=90 crit, >=70 warn, else ok.
function roleFor(pct) {
  if (pct >= CRIT_PCT) return "crit";
  if (pct >= WARN_PCT) return "warn";
  return "ok";
}

// --- the derived daily-budget window (1d) ---
// The weekly cap, paced as seven equal daily slices, so the person can see whether
// today's spend is on track without doing the sum. It is NOT a number Claude Code
// reports: it is DERIVED from the seven_day window and the current instant. "100%"
// of 1d is one slice -- 100/7 of the weekly cap. The slices are aligned to the
// WEEKLY RESET (a 07:00-style boundary), not to local midnight, because the reset
// is the only boundary that divides the 7*24h window into seven whole days.
//
// The value is a pure closed form:
//
//     1d% = 7 * weeklyUsedPct - 100 * (dayIndex - 1)
//
// It rides 0 -> 100 across a day when spending is perfectly on pace. Overspend and
// credit both carry to the next day with NO stored state: the weekly used% is
// already cumulative, and each elapsed day subtracts one whole slice (the -100),
// so a day ended at 114% opens the next at 14%, and one ended at 50% opens the next
// at -50%. Over 100 is red (crit); at-or-under 100, INCLUDING negative credit, is
// green (ok) -- there is no amber here, unlike the reported windows: 100 is the line
// and being under it, however far, is simply fine.
const DAY_SEC = 86400;
const WEEK_SEC = 7 * DAY_SEC;

// The 1d window {key,pct,role,reset} from the 7d window and now, or null when there
// is no 7d window to derive it from. dayIndex is clamped to 1..7 so a reading that
// has drifted before the week's start or past its reset still yields a drawable
// window (extreme, but the stale mark already flags it) rather than a NaN.
function oneDayWindow(sevenDay, nowMs) {
  if (!sevenDay) return null;
  const nowSec = nowMs / 1000;
  const weekStart = sevenDay.resetsAt - WEEK_SEC;
  let dayIndex = Math.floor((nowSec - weekStart) / DAY_SEC) + 1;
  if (dayIndex < 1) dayIndex = 1;
  if (dayIndex > 7) dayIndex = 7;
  const pct = Math.round(7 * sevenDay.usedPct - 100 * (dayIndex - 1));
  const reset = weekStart + dayIndex * DAY_SEC; // this slice's next boundary
  return { key: "1d", pct, role: pct > 100 ? "crit" : "ok", reset: formatReset(reset, nowMs) };
}

// The reset string (DESIGN 2.2): a reset later the same local day is just "HH:MM";
// once it falls on another day the weekday matters, so "Ddd HH:MM". `resetsAt` is
// epoch SECONDS (as Claude Code's `resets_at` gives it); `nowMs` is epoch ms.
function formatReset(resetsAt, nowMs) {
  const d = new Date(resetsAt * 1000);
  const now = new Date(nowMs);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return sameDay ? t : `${WEEKDAYS[d.getDay()]} ${t}`;
}

// One raw window ({used_percentage, resets_at}) -> {usedPct, resetsAt} or null.
// A present-but-incomplete window (missing either field) is treated as absent, so
// it is simply not drawn (DESIGN 2.n, "Partial data"). The percentage is rounded
// to a whole number here, the one conversion from Claude Code's float, so the
// cache holds ints and the thresholds compare against whole numbers everywhere.
function normalizeWindow(w) {
  if (!w || typeof w !== "object") return null;
  if (typeof w.used_percentage !== "number" || typeof w.resets_at !== "number") return null;
  return { usedPct: Math.round(w.used_percentage), resetsAt: w.resets_at };
}

// rawRateLimits is Claude Code's stdin `rate_limits` object (shape confirmed live
// in T00). Returns the normalized cache, or null when neither window is drawable.
// `nowMs` is passed in (not read from a clock) so this module stays clock-free.
export function normalizeRateLimits(rawRateLimits, nowMs) {
  if (!rawRateLimits || typeof rawRateLimits !== "object") return null;
  const fiveHour = normalizeWindow(rawRateLimits.five_hour);
  const sevenDay = normalizeWindow(rawRateLimits.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return { writtenAt: nowMs, fiveHour, sevenDay };
}

// The decision function (DESIGN 3.3): a cache and the current instant in, and what
// the footer should draw out. Returns null when there is nothing to show (no cache,
// or a cache with no drawable window). The reset times stay accurate even while
// stale -- a reset is an absolute instant, not a countdown (DESIGN 2.4).
export function renderUsage(cache, nowMs) {
  if (!cache || typeof cache !== "object") return null;
  const stale = nowMs - cache.writtenAt > STALE_MS;
  const windows = [];
  // Order is 5h / 1d / 7d: the session cap, the derived daily budget, the weekly
  // cap. The 1d window is derived from the 7d one (oneDayWindow), so it appears
  // exactly when 7d does and never on its own.
  if (cache.fiveHour) {
    windows.push({
      key: "5h",
      pct: cache.fiveHour.usedPct,
      role: roleFor(cache.fiveHour.usedPct),
      reset: formatReset(cache.fiveHour.resetsAt, nowMs),
    });
  }
  const oneDay = oneDayWindow(cache.sevenDay, nowMs);
  if (oneDay) windows.push(oneDay);
  if (cache.sevenDay) {
    windows.push({
      key: "7d",
      pct: cache.sevenDay.usedPct,
      role: roleFor(cache.sevenDay.usedPct),
      reset: formatReset(cache.sevenDay.resetsAt, nowMs),
    });
  }
  if (windows.length === 0) return null;
  return {
    stale,
    asOf: stale ? hhmm(cache.writtenAt) : null,
    windows,
  };
}
