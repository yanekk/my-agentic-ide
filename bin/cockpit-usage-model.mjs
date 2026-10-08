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

// --- pir's usage service (plans/pir-usage-reader) ----------------------------
// pir's workers are SDK sessions with no statusline, so the tap never hears them;
// pir serves the same rate_limits from a local HTTP service and the daemon polls
// it. These two functions are the whole of the rule on the pure side: what a
// discovery file may point at, and whether a heard reading replaces the cache.
// The shell half (cockpit-usage-pir.mjs) only carries bytes in and out.

// How far ahead of our clock a reading may be dated and still count as "heard now"
// (DESIGN 2.4). 60 s is the tolerance pir's own service applies.
export const PIR_FUTURE_TOLERANCE_MS = 60_000;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// text: the contents of ${PIR_HOME ?? HOME}/.pir/api.json. Returns
// { origin, pid } or null. Only a plain loopback http origin is accepted (DESIGN
// 2.6): the daemon runs unattended, so a file on disk must not be able to point it
// at the network -- no other host, no https (nothing to verify on loopback), no
// credentials, no path/query/hash that would change what is requested. `new URL`
// reads no clock, so it is fine on this side of the boundary.
export function parsePirApiFile(text) {
  if (typeof text !== "string") return null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isPlainObject(data) || data.version !== 1) return null;
  if (!Number.isInteger(data.pid) || data.pid <= 0) return null;
  if (typeof data.url !== "string") return null;
  let u;
  try { u = new URL(data.url); } catch { return null; }
  if (u.protocol !== "http:") return null;
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
  // URL drops a port equal to the scheme default, so `:80` reads as no port and is
  // refused like a missing one; pir's service never binds 80.
  if (!u.port) return null;
  // URL normalises an empty path to "/", so both "" and "/" arrive here as "/".
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
  return { origin: u.origin, pid: data.pid };
}

// The newest-wins decision (DESIGN 2.3, 2.4, 3.3). cache: readCache()'s value or
// null. body: the parsed JSON of a 200, of any type. nowMs: the daemon's clock,
// read AFTER the response arrived. Returns the poll's state and, only when the
// reading is valid and newer than the cache, the cache object to write.
export function decidePirReading(cache, body, nowMs) {
  const none = (state) => ({ state, write: null });
  if (!isPlainObject(body) || body.version !== 1) return none("bad-body");
  const observed = body.observed_at;
  const limits = body.rate_limits;
  // Both null is the service's documented "nothing known yet".
  if (observed === null && limits === null) return none("empty");
  // Anything else must be a real instant plus a real object; one null and one value
  // is a malformed answer, not an empty one.
  if (typeof observed !== "number" || !Number.isFinite(observed) || observed <= 0) return none("bad-body");
  if (!isPlainObject(limits)) return none("bad-body");
  // A reading dated in the future would beat every real reading until the clock
  // caught up and hold off the stale mark (DESIGN 2.4). Within tolerance it is
  // treated as heard now; beyond it, ignored.
  if (observed > nowMs + PIR_FUTURE_TOLERANCE_MS) return none("future");
  const at = Math.min(observed, nowMs);
  const reading = normalizeRateLimits(limits, at);
  if (!reading) return none("empty");
  // Strictly newer wins: an equal time is the same reading polled again and must
  // not touch the file (the footer would repaint every poll). A cache dated ahead
  // of the clock is treated as older than anything, or one bad write would block
  // the feed until the clock passed it. A cache without a usable writtenAt counts
  // as no cache.
  const cachedAt = cache && typeof cache === "object" ? cache.writtenAt : undefined;
  const noCache = typeof cachedAt !== "number" || !Number.isFinite(cachedAt);
  const write = noCache || cachedAt > nowMs || at > cachedAt ? reading : null;
  return { state: "ok", write };
}

// --- the Aperture daily budget (the company gateway) ---
// On a machine whose sessions run on Bedrock through the company's Tailscale
// Aperture gateway the footer shows that gateway's budget instead of Claude's
// rate limits. Aperture answers GetMyQuotas with buckets in NANODOLLARS that refill
// CONTINUOUSLY at `rate` ("$100/day" per bucket; measured 2026-10-02 as +$0.0700
// in 60.5s) -- a leaky bucket, not a counter that resets, so there is no reset
// instant. What the footer adds instead is a FORECAST: `empty ~HH:MM` while the
// balance falls, `full ~HH:MM` while it climbs back.
//
// The EFFECTIVE balance/capacity is used when present: it adds the overdraft
// buckets Aperture draws from once the default one is empty (their names and
// sizes come from the response, never from here), so it is what can actually
// still be spent. A bucket without them falls back to its own current/capacity.
// With several top-level buckets the most-used one is shown, because it is the
// one that runs out first.

// The forecast compares the newest reading with the oldest one at most
// FORECAST_WINDOW_MS older. The NET change already has the refill in it, so the
// refill rate is never needed (the effective tank measured +$0.14/min, twice the
// "$100/day" label, because both buckets refill). Below FORECAST_MIN_SPAN_MS of
// history there is no forecast; a step between readings longer than
// READING_GAP_MS (a sleeping laptop, an offline spell) starts the history afresh,
// so a gap never reads as a sudden refill.
// 15 minutes. 30 was tried (2026-10-02) to stop one burst swinging a far-off
// forecast from Fri to Sat; it is 15 again because only a same-day empty is shown
// now (renderAperture), and the short window is what makes that react to a burst.
export const FORECAST_WINDOW_MS = 15 * 60 * 1000;
// The minimum is "about five minutes" of one-minute polls, with slack: measured
// 2026-10-02, six polls spanned 299927ms, so a strict 5:00 waited a whole extra
// poll on the timer's own drift.
export const FORECAST_MIN_SPAN_MS = 4.5 * 60 * 1000;
export const READING_GAP_MS = 3 * 60 * 1000;

// One bucket -> { balance, capacity, usedPct }, or null when its numbers are
// missing or useless.
function bucketFigures(b) {
  if (!b || typeof b !== "object") return null;
  const eff = b.effectiveCapacityNanodollars != null;
  const balance = Number(eff ? b.effectiveBalanceNanodollars : b.currentNanodollars);
  const capacity = Number(eff ? b.effectiveCapacityNanodollars : b.capacityNanodollars);
  if (!Number.isFinite(balance) || !Number.isFinite(capacity) || capacity <= 0) return null;
  return { balance, capacity, usedPct: Math.max(0, Math.round((1 - balance / capacity) * 100)) };
}

// GetMyQuotas' JSON -> { writtenAt, usedPct, balance, capacity } for the most-used
// bucket, or null when no bucket is drawable (the caller then leaves the last
// reading alone).
export function normalizeQuotas(json, nowMs) {
  const figs = (json && Array.isArray(json.buckets) ? json.buckets : [])
    .map(bucketFigures).filter(Boolean);
  if (figs.length === 0) return null;
  const worst = figs.reduce((a, b) => (b.usedPct > a.usedPct ? b : a));
  return { writtenAt: nowMs, ...worst };
}

// The previous cache plus a fresh normalised reading -> the cache to write, with
// the reading appended to `readings` ({ t, balance }) and the history trimmed to
// what a forecast can use. A capacity change (a new tier, an overdraft added or
// removed) drops the history: the balance jumps with it, and that jump is not
// spending.
export function appendReading(prev, reading) {
  const keepFrom = reading.writtenAt - FORECAST_WINDOW_MS - READING_GAP_MS;
  const old = prev && prev.capacity === reading.capacity && Array.isArray(prev.readings) ? prev.readings : [];
  const readings = old
    .filter((r) => r && r.t >= keepFrom && r.t < reading.writtenAt)
    .concat({ t: reading.writtenAt, balance: reading.balance });
  return { ...reading, readings };
}

// The forecast, or null when there is too little history: { kind: "empty"|"full",
// atMs } or { kind: "full", atMs: null } when the tank is already full. Built from
// the newest contiguous run of readings, newest vs the oldest within the window.
export function forecastAperture(cache) {
  const rs = Array.isArray(cache?.readings) ? cache.readings : [];
  if (rs.length === 0) return null;
  const last = rs[rs.length - 1];
  if (cache.capacity > 0 && last.balance >= cache.capacity) return { kind: "full", atMs: null };
  let first = rs.length - 1;
  while (first > 0 && rs[first].t - rs[first - 1].t <= READING_GAP_MS
         && last.t - rs[first - 1].t <= FORECAST_WINDOW_MS) first--;
  const base = rs[first];
  const span = last.t - base.t;
  if (span < FORECAST_MIN_SPAN_MS) return null;
  const perMs = (last.balance - base.balance) / span;   // net: refill minus spend
  if (perMs < 0) return { kind: "empty", atMs: last.t + last.balance / -perMs };
  if (perMs > 0) return { kind: "full", atMs: last.t + (cache.capacity - last.balance) / perMs };
  return null;                                            // dead level: no direction
}

// The cache and now -> the same shape renderUsage returns, one window whose
// `reset` slot carries the forecast text instead, so the strip formats and colours
// it exactly as it does Claude's. Only an `empty ~HH:MM` that falls TODAY (local
// date) is shown (decided 2026-10-02): a refill time, a far-off empty and the
// warm-up all draw nothing, so the mark appears only when it is a warning. Stale,
// the forecast is dropped: it would project a pace nobody has measured for 15 minutes.
export function renderAperture(cache, nowMs) {
  if (!cache || typeof cache !== "object" || typeof cache.usedPct !== "number") return null;
  const stale = nowMs - cache.writtenAt > STALE_MS;
  let eta = null;
  if (!stale) {
    const f = forecastAperture(cache);
    if (f && f.kind === "empty" && new Date(f.atMs).toDateString() === new Date(nowMs).toDateString()) {
      eta = `empty ~${hhmm(f.atMs)}`;
    }
  }
  return {
    stale,
    asOf: stale ? hhmm(cache.writtenAt) : null,
    windows: [{ key: "aperture", pct: cache.usedPct, role: roleFor(cache.usedPct), reset: null, eta }],
  };
}
