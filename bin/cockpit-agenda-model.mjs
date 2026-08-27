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
