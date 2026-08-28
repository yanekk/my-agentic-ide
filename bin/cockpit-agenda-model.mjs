// cockpit-agenda-model -- the pure half of the agenda: rules in, decisions out.
//
// This module is on the PURE side of the boundary (DESIGN 3.1). It reads no
// files, opens no sockets, asks nothing of the environment and never looks at a
// clock: the current time arrives as a parameter. That is what makes "what does
// 14:20 on a busy Wednesday look like" a millisecond test instead of a wait until
// Wednesday. `spikes/agenda-test/run.sh` greps this file to keep it honest, and
// if that grep ever fails the fix is to MOVE THE CODE OUT, never to relax it.
//
// T02 fills in the first half -- turning Google's event shape into a flat one and
// deciding which of them belong on screen. T03 adds the drawing half to the same
// file.
//
// Google says the same thing several ways and this is where that ends:
//
//   a timed event has  start.dateTime  (RFC3339, with an offset)
//   an all-day one has start.date      (a bare civil date, end EXCLUSIVE)
//   whether you declined is buried in an `attendees` array you may not be in
//   "free" is `transparency`, and it changes nothing (DESIGN 2.4)
//   a deleted event is still in the response, as status: "cancelled"

// --- civil time in a named zone --------------------------------------------
// Everything here is a function of (instant, zone) and nothing else. It exists
// because an all-day event is a CIVIL date -- "the 26th" -- and placing it needs
// the calendar's zone, not the machine's. Treating a bare date as UTC puts a
// Polish public holiday on the wrong day for two hours of every day.

// Memo only: Intl.DateTimeFormat construction is the expensive part and the
// result depends on nothing but the zone string, so caching it changes no answer.
const formatters = new Map();

function formatterFor(zone) {
  let dtf = formatters.get(zone);
  if (dtf) return dtf;
  try {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    // An unresolvable zone is a configuration mistake, not a reason to take the
    // pane down with an exception. UTC is wrong by an hour or two; a thrown
    // RangeError is a blank column.
    dtf = formatterFor("UTC");
  }
  formatters.set(zone, dtf);
  return dtf;
}

// The zone is normalised in exactly one place so that a caller who passes nothing
// gets a DETERMINISTIC answer. Leaving it undefined would hand Intl the machine's
// own zone, which is precisely the environment read this module may not make.
function zoneOf(tz) {
  return typeof tz === "string" && tz ? tz : "UTC";
}

function partsIn(ts, zone) {
  const out = {};
  for (const p of formatterFor(zone).formatToParts(new Date(ts))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

// How far the zone's wall clock is ahead of UTC at that instant, in ms.
function offsetAt(ts, zone) {
  const p = partsIn(ts, zone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(ts / 1000) * 1000;   // offsets are whole minutes; drop ms
}

// Midnight at the start of a civil date, in the given zone.
// Two passes because the offset we need is the one in force AT the answer, not at
// the guess: on a DST day the first guess can land on the wrong side of the jump.
// (A zone whose clocks skip midnight itself would leave this an hour out; none of
// the zones this cockpit runs in do that.)
function civilToEpoch(y, m, d, zone, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const first = offsetAt(guess, zone);
  const ts = guess - first;
  const second = offsetAt(ts, zone);
  return second === first ? ts : guess - second;
}

function civilIn(ts, zone) {
  const p = partsIn(ts, zone);
  return { y: p.year, m: p.month, d: p.day };
}

// Civil-date arithmetic, done in UTC where every day is exactly 86400000ms long.
// Doing it on the zoned instants instead would land 23 or 25 hours out twice a year.
function shiftCivil({ y, m, d }, days) {
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function parseCivilDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ""));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

// An RFC3339 stamp with no offset on the end: a bare wall-clock reading. Google's
// Events resource documents dateTime as carrying an offset "unless a time zone is
// explicitly specified in timeZone", so this is a shape the API is allowed to hand
// back. It matters because Date.parse reads an offset-less stamp in the MACHINE's
// zone -- the exact environment read this module may not make (DESIGN 3.1), and
// one the purity grep cannot catch, because it happens inside Date.parse.
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

// An offset in the string always wins: it names the instant outright, and the
// event's timeZone can disagree with it. `zone` only places a bare wall clock.
function parseDateTime(text, zone) {
  const m = WALL_CLOCK.exec(String(text ?? "").trim());
  if (!m) return Date.parse(text);
  return civilToEpoch(Number(m[1]), Number(m[2]), Number(m[3]), zone,
    Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
}

/**
 * The three midnights the whole feature is measured against, in `tz`.
 * `todayStart`..`dayAfterStart` is also exactly the fetch window of DESIGN 2.5 --
 * start of today to end of tomorrow -- which is why this is exported rather than
 * private: computing it is time arithmetic, and time arithmetic belongs on this
 * side of the boundary.
 */
export function dayBounds(now, { tz } = {}) {
  const zone = zoneOf(tz);
  const today = civilIn(now, zone);
  const tomorrow = shiftCivil(today, 1);
  const dayAfter = shiftCivil(today, 2);
  return {
    todayStart: civilToEpoch(today.y, today.m, today.d, zone),
    tomorrowStart: civilToEpoch(tomorrow.y, tomorrow.m, tomorrow.d, zone),
    dayAfterStart: civilToEpoch(dayAfter.y, dayAfter.m, dayAfter.d, zone),
  };
}

// --- normalising -----------------------------------------------------------

export const NO_TITLE = "(no title)";

const REPLIES = {
  accepted: "yes",
  declined: "no",
  tentative: "maybe",
  needsAction: "none",
};

// Which of the attendees is you. Google marks it with `self: true`, and that is
// the signal to trust: the address on the row may be an alias, a delegated
// mailbox or the group that was actually invited, none of which equal the address
// you signed in with. The email comparison is a fallback for the odd response
// that omits the flag, never the primary test.
function findSelf(attendees, selfEmail) {
  const flagged = attendees.find((a) => a && a.self === true);
  if (flagged) return flagged;
  if (!selfEmail) return null;
  const wanted = String(selfEmail).toLowerCase();
  return attendees.find((a) => a && String(a.email ?? "").toLowerCase() === wanted) ?? null;
}

/**
 * One raw Google event -> one normalised event, or null if it must not be shown
 * at all.
 *
 *   { id, title, start, end, allDay, reply, slug }   start/end are epoch ms
 *
 * `reply` is "yes" | "no" | "maybe" | "none" | "n/a", where "n/a" means you are
 * not an attendee -- your own diary entries, and anything on a calendar you
 * merely subscribe to. That is NOT the same as "none" (invited, unanswered,
 * drawn with a `?`), and conflating them would put a question mark on every note
 * you ever wrote to yourself.
 *
 * A DECLINED event is normalised like any other and returned with reply "no";
 * dropping it is chooseEvents' job, because "today is empty" has to mean empty
 * AFTER that filter or a day of declined meetings would never roll over.
 *
 * `tz` places an all-day event's boundaries, and stands in for a timed event
 * whose stamp carries neither an offset nor a `timeZone` of its own. A timed
 * stamp with an offset needs neither and ignores both.
 */
export function normaliseEvent(raw, { slug, tz, selfEmail } = {}) {
  if (!raw || typeof raw !== "object") return null;

  // A tombstone, not an event: cancelled entries stay in the response and are not
  // on your calendar any more (DESIGN 2.4).
  if (raw.status === "cancelled") return null;

  const zone = zoneOf(tz);
  const rawStart = raw.start ?? {};
  const rawEnd = raw.end ?? {};

  let start, end, allDay;
  if (rawStart.dateTime) {
    allDay = false;
    // Each end of the event carries its own timeZone in Google's shape, and it
    // is only consulted when the stamp itself has no offset.
    start = parseDateTime(rawStart.dateTime, rawStart.timeZone ? zoneOf(rawStart.timeZone) : zone);
    end = rawEnd.dateTime
      ? parseDateTime(rawEnd.dateTime, rawEnd.timeZone ? zoneOf(rawEnd.timeZone) : zone)
      : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  } else if (rawStart.date) {
    allDay = true;
    const from = parseCivilDate(rawStart.date);
    if (!from) return null;
    // Google's all-day end date is EXCLUSIVE: a one-day event on the 26th ends on
    // the 27th. Taking it literally is what stops it bleeding into the next day.
    const to = parseCivilDate(rawEnd.date) ?? shiftCivil(from, 1);
    start = civilToEpoch(from.y, from.m, from.d, zone);
    end = civilToEpoch(to.y, to.m, to.d, zone);
    if (end <= start) {
      const next = shiftCivil(from, 1);
      end = civilToEpoch(next.y, next.m, next.d, zone);
    }
  } else {
    return null;   // neither shape: nothing to place it by
  }

  const attendees = Array.isArray(raw.attendees) ? raw.attendees : null;
  const self = attendees && attendees.length ? findSelf(attendees, selfEmail) : null;
  // An attendee with an unrecognised responseStatus is still someone who was
  // invited, so it reads as unanswered rather than silently as yours.
  // hasOwn, not a plain lookup: `responseStatus: "constructor"` would otherwise
  // walk Object.prototype and hand back a FUNCTION as the reply, which is not one
  // of the five strings every caller switches on.
  const reply = self
    ? (Object.hasOwn(REPLIES, self.responseStatus) ? REPLIES[self.responseStatus] : "none")
    : "n/a";

  const title = String(raw.summary ?? "").trim() || NO_TITLE;

  return {
    id: raw.id ?? `${slug ?? ""}-${start}`,
    title,
    start,
    end,
    allDay,
    reply,
    slug,
  };
}

// --- choosing what shows ---------------------------------------------------

// Sorted by start alone, deliberately. Array.prototype.sort is stable, so events
// at the same minute keep the order they arrived in -- which is calendar-add
// order -- and 17:30 work sits above 17:30 home rather than flipping between
// refreshes.
function byStart(a, b) {
  return a.start - b.start;
}

const overlaps = (e, from, to) => e.start < to && e.end > from;

/**
 * Everything on screen, decided. `events` is every normalised event for the
 * fetch window (start of today .. end of tomorrow) across all calendars, IN
 * CALENDAR-ADD ORDER: that order is the only thing that ranks the all-day rows,
 * which have no start time to sort by.
 *
 *   { scope: "today" | "tomorrow" | "empty", allDay: [], timed: [], nowEvent }
 *
 * Two rules that look like details and are not:
 *
 *   * an event is finished when its END is at or before now, never its start. The
 *     meeting you are in the middle of is the single most useful row on the
 *     screen (DESIGN 2.3), so it stays and it gets the NOW label.
 *   * `nowEvent` is ALSO in `timed`. It is a label, not a separate list; taking it
 *     out would make the row count wrong wherever two events overlap.
 *
 * Roll-over is decided here rather than in the renderer: if today is empty AFTER
 * filtering, the lists become tomorrow's, unfiltered by now (nothing tomorrow can
 * be finished yet).
 */
export function chooseEvents(events, now, { tz } = {}) {
  const zone = zoneOf(tz);
  const { todayStart, tomorrowStart, dayAfterStart } = dayBounds(now, { tz: zone });

  // You are not going, so it is not a claim on your time and a row is scarce
  // (DESIGN 2.4). Dropped before anything else so "empty" means empty.
  const live = (Array.isArray(events) ? events : []).filter((e) => e && e.reply !== "no");

  const allDayOn = (from, to) => live.filter((e) => e.allDay && overlaps(e, from, to));

  const todayAllDay = allDayOn(todayStart, tomorrowStart);
  // `end > now` rather than `end > todayStart`: today's list is what is LEFT.
  const todayTimed = live
    .filter((e) => !e.allDay && e.start < tomorrowStart && e.end > now)
    .sort(byStart);

  if (todayAllDay.length || todayTimed.length) {
    return {
      scope: "today",
      allDay: todayAllDay,
      timed: todayTimed,
      nowEvent: todayTimed.find((e) => e.start <= now && e.end > now) ?? null,
    };
  }

  const tomorrowAllDay = allDayOn(tomorrowStart, dayAfterStart);
  const tomorrowTimed = live
    .filter((e) => !e.allDay && overlaps(e, tomorrowStart, dayAfterStart))
    .sort(byStart);

  if (tomorrowAllDay.length || tomorrowTimed.length) {
    // Nothing tomorrow can be happening now, so there is no NOW row to label.
    return { scope: "tomorrow", allDay: tomorrowAllDay, timed: tomorrowTimed, nowEvent: null };
  }

  return { scope: "empty", allDay: [], timed: [], nowEvent: null };
}

// --- drawing ---------------------------------------------------------------
// From here down is T03: the chosen events become the actual lines of the AGENDA
// section. Still pure -- given the calendars, the cache and a timestamp it returns
// strings, which is what makes every display rule in DESIGN 2.3, 2.4, 2.7 and 2.8
// a millisecond test rather than something only a person looking at a pane can
// confirm.
//
// The whole section is ONE call (DESIGN 3.3) and it honours `rows` exactly:
// returning more corrupts the column below it, returning fewer leaves the pane's
// previous paint on screen.

const ESC = "\x1b[";

// Visible width ignores the escape sequences, so centring and clipping line up
// with what is actually on screen. These three live here rather than in
// cockpit-welcome.mjs (where they started) because both halves of the right column
// must measure a string identically or the divider between them will not line up.
export const visibleLen = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "").length;
export const pad = (s, w) => s + " ".repeat(Math.max(0, w - visibleLen(s)));

/** Clip to `w` VISIBLE columns, marking the cut so a truncated line reads as one. */
export function clip(s, w) {
  if (w <= 0) return "";
  if (visibleLen(s) <= w) return s;
  // Slicing raw would count escape bytes as columns and could cut one in half,
  // spilling `[38;5;37m` into the pane. So walk the string, copying escapes for
  // free and counting only what is drawn.
  let out = "", seen = 0, styled = false;
  for (let i = 0; i < s.length; ) {
    const esc = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
    if (esc) { out += esc[0]; i += esc[0].length; styled = true; continue; }
    if (seen >= w - 1) break;
    out += s[i++]; seen++;
  }
  // Reset only if something was actually turned on: a plain string must come back
  // plain, so a caller can compare it without stripping anything.
  return `${out}…${styled ? `${ESC}0m` : ""}`;
}

const dim = (s) => `${ESC}2m${s}${ESC}0m`;
const bold = (s) => `${ESC}1m${s}${ESC}0m`;

// --- the palette -----------------------------------------------------------
// Eight mid-brightness 256-colour codes (DESIGN 2.8), deliberately away from both
// ends of the ramp: the dark end disappears on a dark theme and the light end on a
// light one, and this cockpit is used on both. Eight distinct hues, so two adjacent
// calendars never read as the same colour.

export const PALETTE = [
  { name: "teal", code: "38;5;37" },
  { name: "blue", code: "38;5;68" },
  { name: "violet", code: "38;5;99" },
  { name: "magenta", code: "38;5;133" },
  { name: "rose", code: "38;5;168" },
  { name: "amber", code: "38;5;172" },
  { name: "olive", code: "38;5;100" },
  { name: "green", code: "38;5;71" },
];

const CODE_BY_NAME = new Map(PALETTE.map((c) => [c.name, c.code]));

/**
 * A colour for a new calendar. `rand` is an integer the CALLER produced -- the
 * model may not reach for randomness any more than it may reach for a clock, and
 * a colour that changes on every render is not a colour.
 *
 * No two configured calendars share one while a free colour remains; past eight,
 * repeats are allowed rather than refusing to add a ninth calendar (DESIGN 2.8).
 */
export function pickColour(takenNames, rand) {
  const taken = new Set(Array.isArray(takenNames) ? takenNames : []);
  const free = PALETTE.filter((c) => !taken.has(c.name));
  const pool = free.length ? free : PALETTE;
  const n = Number.isFinite(rand) ? Math.trunc(rand) : 0;
  return pool[((n % pool.length) + pool.length) % pool.length].name;
}

// --- clock and calendar words ----------------------------------------------
// Written out rather than asked of Intl: the machine's LOCALE is an environment
// read exactly as much as its timezone is, and "Wed 26 Aug" must not become
// "śr. 26 sie" on one machine and not another. The zone still decides WHICH day
// it is; only the words are ours.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const two = (n) => String(n).padStart(2, "0");

function hhmm(ts, zone) {
  const p = partsIn(ts, zone);
  return `${two(p.hour)}:${two(p.minute)}`;
}

// Weekday from the civil date in UTC, where 1970-01-01 was a Thursday. Asking a
// zoned Date for getDay() would answer in the MACHINE's zone.
function dayLabel({ y, m, d }) {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
}

/** "22m ago" -- how old the newest thing on screen is, when a fetch has failed. */
function ageText(ms) {
  // Not finite means it has never been fetched at all. A NEGATIVE age is a clock
  // that jumped backwards, which is not worth a special case: the cache is current
  // as far as anyone can tell.
  if (!Number.isFinite(ms)) return "never";
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// --- what a cached error means ---------------------------------------------
// The cache carries whatever `classifyError` decided (T04): "network" | "auth" |
// "gone" | "unknown", as a bare string or as an object with a `kind`. Two of those
// four are permanent -- nothing improves until you act -- and the split is what
// DESIGN 2.7 hangs the whole unhappy-path behaviour on.
//
// "unknown" is drawn as TRANSIENT on purpose. A malformed 200 is not something the
// user can act on, and 2.7's rule is that a failure is loud only when it names a
// command that fixes it; shouting "sign-in expired" at a JSON parse error would be
// both wrong and unactionable.

const LOUD = {
  // The sign-in itself is dead or was never granted the calendar permission. Both
  // are fixed by signing in again, and NEITHER may say `agenda rm`: T00 measured
  // Google's per-scope consent checkbox, and telling someone to remove a calendar
  // that is perfectly fine would destroy a working configuration and fix nothing.
  auth: { message: "sign-in expired", fix: (slug) => `agenda add ${slug}` },
  scope: { message: "calendar permission not granted", fix: (slug) => `agenda add ${slug}` },
  gone: { message: "calendar gone", fix: (slug) => `agenda rm ${slug}` },
};

function errorKind(error) {
  if (!error) return null;
  const kind = String((typeof error === "string" ? error : error.kind) ?? "").toLowerCase();
  if (kind === "gone") return "gone";
  if (kind === "scope") return "scope";
  if (kind === "auth") {
    // A 403 carrying ACCESS_TOKEN_SCOPE_INSUFFICIENT classifies as auth (T04) but
    // has its own wording, so the reason travels beside the kind.
    const detail = typeof error === "object"
      ? `${error.reason ?? ""} ${error.code ?? ""} ${error.detail ?? ""}` : "";
    return /scope/i.test(detail) ? "scope" : "auth";
  }
  return "transient";   // network, unknown, and anything a later task invents
}

// --- the section -----------------------------------------------------------

const BAR = "▌";
const LABEL_W = 7;          // fits "ALL DAY"; "17:30" and "NOW" pad into it
const GAP = 2;
// bar, space, label, the `?` column, gap. Every event row's title starts here, so
// the titles form one column whether or not a row carries a question mark.
const PREFIX_W = 1 + 1 + LABEL_W + 1 + GAP;
const MIN_TITLE_W = 6;

/** Only what a renderer can safely draw: a title and two finite instants. */
const usable = (e) => e && typeof e === "object" &&
  Number.isFinite(e.start) && Number.isFinite(e.end);

/**
 * The section as blocks, before anything is dropped to fit. A block is one event
 * and the lines it draws -- the NOW row draws two, and they must be kept or
 * dropped together or the `until` line would end up orphaned under something else.
 */
function compose({ width, calendars, cache, now, tz }) {
  const zone = zoneOf(tz);
  const w = Math.max(1, Math.floor(width) || 0);
  const cals = (Array.isArray(calendars) ? calendars : []).filter((c) => c && c.slug);
  const entries = (cache && typeof cache === "object" && cache.calendars) || {};

  const head = [];
  const blocks = [];
  const trail = [];

  const clock = hhmm(now, zone);
  head.push(pad(bold("AGENDA"), w - clock.length) + dim(clock));

  if (!cals.length) {
    // A blank region with no explanation reads as a bug, so say what is missing
    // and the one command that fixes it (DESIGN 2.6).
    blocks.push({ events: 0, lines: [dim("no calendars")] });
    blocks.push({ events: 0, lines: [bold("agenda add home")] });
    return { head, blocks, trail };
  }

  // Colours, and how wide the slug column has to be. Capped at a third of the row
  // so a long slug cannot squeeze the title down to nothing; clipped, not wrapped.
  const colourOf = new Map(cals.map((c) => [c.slug, CODE_BY_NAME.get(c.colour) ?? ""]));
  const longest = cals.reduce((n, c) => Math.max(n, c.slug.length), 0);
  let slugW = Math.min(longest, Math.max(0, Math.floor((w - PREFIX_W) / 3)));
  let titleW = w - PREFIX_W - (slugW ? slugW + GAP : 0);
  if (titleW < MIN_TITLE_W) { slugW = 0; titleW = w - PREFIX_W; }

  // Events, in calendar-add order: that order is the only ranking the all-day rows
  // have (they have no start time to sort by), and chooseEvents takes it from the
  // order of the array it is handed.
  const events = [];
  let stalest = null;
  let loud = 0;               // calendars replaced by a loud line, not trail LINES
  for (const cal of cals) {
    const entry = entries[cal.slug];
    const kind = errorKind(entry && entry.error);
    if (kind && kind !== "transient") {
      // The whole calendar is replaced by one line naming the command that fixes
      // it. A silent gap in a two-calendar view is indistinguishable from a quiet
      // day (DESIGN 2.7), which is why this is loud and why the OTHER calendars
      // keep their rows.
      const { message, fix } = LOUD[kind];
      const tag = colourOf.get(cal.slug)
        ? `${ESC}${colourOf.get(cal.slug)}m${cal.slug}${ESC}0m` : cal.slug;
      const command = fix(cal.slug);
      const one = `${tag}  ${message} ${dim("·")} ${bold(command)}`;
      // The COMMAND is the point of a loud line -- "nothing improves until you act"
      // is only useful if you can read what to do. `calendar permission not granted`
      // plus `agenda add work` is 50-odd columns and the right column is nearer 40,
      // so when it will not fit the command drops to its own line rather than being
      // clipped away, which would leave a complaint and no remedy.
      loud++;
      if (visibleLen(one) <= w) trail.push(one);
      else {
        trail.push(clip(`${tag}  ${message}`, w));
        trail.push(clip(`  ${bold(command)}`, w));
      }
      continue;
    }
    if (kind === "transient") {
      // Staleness is reported only when a fetch has actually FAILED. A cache five
      // minutes old in normal operation is current, and saying "5m ago" every time
      // would make the line meaningless (DESIGN 2.7).
      const age = Number.isFinite(entry.fetchedAt) && entry.fetchedAt > 0
        ? now - entry.fetchedAt : Infinity;
      if (stalest === null || age > stalest) stalest = age;
    }
    for (const e of (entry && Array.isArray(entry.events) ? entry.events : [])) {
      // The cache key is the authority on which calendar an event came from: the
      // stored slug could be from before a rename.
      if (usable(e)) events.push({ ...e, slug: cal.slug });
    }
  }

  const showing = cals.length - loud;           // calendars still contributing rows
  const chosen = chooseEvents(events, now, { tz: zone });

  if (chosen.scope === "empty") {
    // With every calendar in a permanent error there is nothing to be empty ABOUT:
    // the loud lines already say why the section has no rows, and "nothing today or
    // tomorrow" over the top of them would be a claim about a day nobody could see.
    if (showing > 0) blocks.push({ events: 0, lines: [dim("nothing today or tomorrow")] });
  } else {
    const today = civilIn(now, zone);
    const day = chosen.scope === "tomorrow" ? shiftCivil(today, 1) : today;
    // Both scopes are labelled, symmetrically (DESIGN 2.3; the user chose this over
    // a bare date for today on 2026-08-28). The word is what changes meaning, so it
    // is the part drawn brightly and the date beside it stays dim.
    head.push(clip(`${bold(chosen.scope === "tomorrow" ? "TOMORROW" : "TODAY")} ` +
                   `${dim(`· ${dayLabel(day)}`)}`, w));

    const row = (e, label, labelStyle) => {
      const code = colourOf.get(e.slug) ?? "";
      const bar = code ? `${ESC}${code}m${BAR}${ESC}0m` : BAR;
      // The `?` is its own column, so a row that has one and a row that does not
      // still start their titles in the same place (DESIGN 2.4). No `✗` is ever
      // drawn -- declined events never reach here, chooseEvents dropped them.
      const flag = e.reply === "none" ? "?" : " ";
      const title = clip(String(e.title ?? ""), titleW);
      const tail = slugW ? "  " + dim(clip(e.slug, slugW)) : "";
      return clip(`${bar} ${pad(labelStyle(label), LABEL_W)}${flag}  ` +
                  `${tail ? pad(title, titleW) : title}${tail}`, w);
    };

    // All-day rows are pinned above the timed ones: a day off is the single most
    // schedule-changing fact of the day, and they do not finish until the day does.
    for (const e of chosen.allDay) blocks.push({ events: 1, lines: [row(e, "ALL DAY", dim)] });

    for (const e of chosen.timed) {
      const isNow = chosen.nowEvent && e.id === chosen.nowEvent.id;
      const lines = [row(e, isNow ? "NOW" : hhmm(e.start, zone), isNow ? bold : dim)];
      if (isNow) {
        // What you actually want at 14:20 is not the next meeting but when this one
        // lets you go (DESIGN 2.3).
        const code = colourOf.get(e.slug) ?? "";
        const bar = code ? `${ESC}${code}m${BAR}${ESC}0m` : BAR;
        lines.push(clip(`${bar}   ${dim(`└ until ${hhmm(e.end, zone)}`)}`, w));
      }
      blocks.push({ events: 1, lines });
    }
  }

  if (stalest !== null) {
    trail.unshift(clip(dim(`last updated ${ageText(stalest)} · offline`), w));
  }

  return { head, blocks, trail };
}

/**
 * How many lines the section wants if given unlimited room. T06 budgets the right
 * column with this rather than rendering twice and measuring.
 */
export function agendaHeight({ width, calendars, cache, now, tz } = {}) {
  const { head, blocks, trail } = compose({ width, calendars, cache, now, tz });
  return head.length + blocks.reduce((n, b) => n + b.lines.length, 0) + trail.length;
}

/**
 * THE decision function (DESIGN 3.3). A function of its arguments and nothing
 * else: the configured calendars, the cached events, a width, a row budget and a
 * millisecond timestamp in, the exact lines of the AGENDA section out.
 *
 * Returns EXACTLY `rows` entries, each at most `width` visible columns. The caller
 * has already budgeted the column; more would corrupt what is drawn below and
 * fewer would leave the pane's previous paint showing through.
 *
 * `tz` places the day boundaries and the clock. It is a parameter for the same
 * reason `now` is -- Intl's default zone is an environment read (DESIGN 3.1) -- and
 * defaults to UTC so a caller who names none gets the same answer on every machine.
 */
export function renderAgenda({ width, rows, calendars, cache, now, tz } = {}) {
  const w = Math.max(1, Math.floor(width) || 0);
  const n = Math.max(0, Math.floor(rows) || 0);
  if (n === 0) return [];

  const { head, blocks, trail } = compose({ width: w, calendars, cache, now, tz });
  const total = blocks.reduce((sum, b) => sum + b.events, 0);

  // Whole blocks only: the NOW row and its `until` line are one event and must be
  // kept or dropped together. Anything the room cannot take is counted, not
  // silently forgotten -- stopping at the fold reads as "that is all of them", and
  // here that would be a false statement about your afternoon (DESIGN 2.3).
  const fit = (room) => {
    const lines = [];
    let shown = 0;
    for (const b of blocks) {
      if (lines.length + b.lines.length > room) break;
      lines.push(...b.lines);
      shown += b.events;
    }
    return { lines, missed: total - shown };
  };

  // The trailer is reserved before the events are: the one line you can act on
  // must not be the first thing pushed off the bottom.
  let room = n - head.length - trail.length;
  let body = fit(Math.max(0, room));
  let overflow = null;
  if (body.missed > 0) {
    body = fit(Math.max(0, room - 1));
    if (body.missed > 0) {
      overflow = clip(`${ESC}2m… +${body.missed} more · ${ESC}0m${bold("agenda")}`, w);
    }
  }

  const out = [...head, ...body.lines, ...(overflow ? [overflow] : []), ...trail];
  // Honoured exactly, in both directions -- including a pane too short for even the
  // header, which degrades to whatever fits rather than throwing.
  while (out.length < n) out.push("");
  return out.slice(0, n);
}
