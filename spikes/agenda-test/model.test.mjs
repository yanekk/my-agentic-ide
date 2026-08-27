// The agenda's pure model: turning Google's event shape into a flat one, and
// deciding which of them are still ahead of you.
//
// Every case is driven from a recorded Google response in ./fixtures plus a fixed
// `now`. NOTHING HERE READS THE CLOCK -- that is the whole point of the boundary
// (DESIGN 3.1): "what does 14:20 on a busy Wednesday look like" has to be a
// millisecond test rather than a wait until Wednesday.
//
// Expected instants are written as explicit UTC strings wherever a timezone rule
// is under test, rather than being recomputed with the model's own arithmetic --
// a test that derives its expectation from the code it is testing proves nothing.

import fs from "node:fs";
import { section, ok, eq, done } from "./harness.mjs";
import { normaliseEvent, chooseEvents, dayBounds, NO_TITLE } from "../../bin/cockpit-agenda-model.mjs";

const TZ = "Europe/Warsaw";
const WORK = { slug: "work", tz: TZ, selfEmail: "me@corp.com" };
const HOME = { slug: "home", tz: TZ, selfEmail: "me@gmail.com" };

const fixture = (name) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const norm = (name, opts) => fixture(name).items.map((r) => normaliseEvent(r, opts));
const shown = (name, opts) => norm(name, opts).filter(Boolean);
const raw = (name, id) => fixture(name).items.find((e) => e.id === id);
const one = (name, id, opts) => normaliseEvent(raw(name, id), opts);
const at = (iso) => Date.parse(iso);
const ids = (list) => list.map((e) => e.id);
const titles = (list) => list.map((e) => e.title);

// ---------------------------------------------------------------------------
section("1. a timed event becomes two numbers");

const standup = one("events-work-wednesday", "w-0930-standup", WORK);
eq("start is the instant Google gave", standup.start, at("2026-08-26T07:30:00Z"));
eq("end likewise", standup.end, at("2026-08-26T07:45:00Z"));
eq("it is not all-day", standup.allDay, false);
eq("the title survives", standup.title, "standup");
eq("it is stamped with the calendar it came from", standup.slug, "work");
eq("and keeps Google's id", standup.id, "w-0930-standup");

// ---------------------------------------------------------------------------
section("2. an all-day event is placed in the calendar's zone, not the machine's");

const ana = one("events-work-wednesday", "w-allday-ana", WORK);
eq("it is all-day", ana.allDay, true);
// Midnight in Warsaw on 26 Aug is 22:00 UTC on the 25th. Reading the bare date as
// UTC would put a Polish public holiday on the wrong day for two hours a day.
eq("it starts at local midnight", ana.start, at("2026-08-25T22:00:00Z"));
eq("...and ends at the next local midnight", ana.end, at("2026-08-26T22:00:00Z"));
eq("one day is 24 hours long", ana.end - ana.start, 24 * 3600 * 1000);

const anaUTC = one("events-work-wednesday", "w-allday-ana", { ...WORK, tz: "UTC" });
ok("a different zone moves it", anaUTC.start !== ana.start, `${anaUTC.start} vs ${ana.start}`);
eq("...to that zone's midnight", anaUTC.start, at("2026-08-26T00:00:00Z"));

// Google's all-day end date is EXCLUSIVE. Taking it literally would leave a
// one-day event still on screen all through the following day.
const oneDay = one("events-shapes", "s-allday-one", WORK);
const dayAfter = chooseEvents([oneDay], at("2026-08-27T12:00:00+02:00"), { tz: TZ });
eq("a one-day event does not bleed into the next day", dayAfter.scope, "empty");

const week = one("events-shapes", "s-allday-many", WORK);
eq("a multi-day event spans its whole range", [week.start, week.end],
  [at("2026-08-23T22:00:00Z"), at("2026-08-27T22:00:00Z")]);
// "Covers" means it is TODAY's row: on the day before it starts the column has
// nothing left and rolls on to tomorrow, where the event legitimately appears --
// so scope has to be part of the question or that reads as a false positive.
const covers = (dayIso) => {
  const c = chooseEvents([week], at(dayIso), { tz: TZ });
  return c.scope === "today" && ids(c.allDay).includes("s-allday-many");
};
eq("it covers every day in the range", [24, 25, 26, 27].map((d) => covers(`2026-08-${d}T12:00:00+02:00`)),
  [true, true, true, true]);
eq("...and not the exclusive end date", covers("2026-08-28T12:00:00+02:00"), false);
eq("...nor the day before it starts", covers("2026-08-23T12:00:00+02:00"), false);
eq("...where it shows up as tomorrow's instead",
  chooseEvents([week], at("2026-08-23T12:00:00+02:00"), { tz: TZ }).scope, "tomorrow");

// ---------------------------------------------------------------------------
section("3. which of the attendees is you");

const reply = (id, opts = WORK) => one("events-shapes", id, opts).reply;
eq("declined", reply("s-declined"), "no");
eq("needsAction is unanswered, not yours", reply("s-needs-action"), "none");
eq("tentative", reply("s-tentative"), "maybe");
eq("accepted", reply("s-accepted"), "yes");
// "n/a" and "none" are NOT the same thing: one is your own diary entry, the other
// is an invitation you owe someone an answer to, and it is drawn with a `?`.
eq("no attendees at all is not an unanswered invitation", reply("s-no-attendees"), "n/a");
eq("an empty attendee list likewise", reply("s-empty-attendees"), "n/a");
eq("a meeting you are not on is not yours to answer", reply("s-not-an-attendee"), "n/a");
// Google sets self:true and the address on the row may be an alias, a delegated
// mailbox or the group that was actually invited.
eq("an alias marked self is still you", reply("s-alias-self"), "maybe");
eq("...and the address alone would have missed it",
  raw("events-shapes", "s-alias-self").attendees[0].email !== WORK.selfEmail, true);
eq("your address is the fallback when no row is flagged", reply("s-email-self"), "no");
eq("...case-insensitively",
  raw("events-shapes", "s-email-self").attendees[0].email, "ME@Corp.com");
eq("a different sign-in is not you", reply("s-email-self", { ...WORK, selfEmail: "someone@else.com" }), "n/a");
// `reply` is one of five strings and every caller switches on it. A plain lookup
// in the response-status table walks Object.prototype, so a status that happens to
// name one of its properties handed back a FUNCTION instead.
eq("a responseStatus naming an Object property is not a reply", reply("s-odd-status"), "none");
eq("...and reply is always a string", typeof one("events-shapes", "s-odd-status", WORK).reply, "string");

// ---------------------------------------------------------------------------
section("4. what normalising drops, and what it deliberately does not");

eq("a cancelled event is a tombstone", one("events-shapes", "s-cancelled", WORK), null);
eq("...and it is the only thing dropped here",
  norm("events-shapes", WORK).filter((e) => e === null).length, 1);
// "Free" is about availability, not about whether you meant to do the thing:
// focus blocks are exactly the personal-planning half of what this is for.
const focus = one("events-shapes", "s-transparent", WORK);
ok("a 'free' event is normalised, not filtered", focus !== null);
eq("...and carries no trace of the flag", focus.reply, "n/a");
// A declined event is normalised and labelled; dropping it is chooseEvents' job,
// so that "today is empty" can mean empty AFTER the filter.
ok("a declined event still normalises", one("events-shapes", "s-declined", WORK) !== null);
eq("an event with no summary gets a placeholder", one("events-shapes", "s-no-summary", WORK).title, NO_TITLE);
ok("...which is not empty and not undefined", typeof NO_TITLE === "string" && NO_TITLE.length > 0, NO_TITLE);
eq("junk in is null out, never a throw", [normaliseEvent(null, WORK), normaliseEvent({}, WORK),
  normaliseEvent({ start: { date: "not-a-date" } }, WORK)], [null, null, null]);

// ---------------------------------------------------------------------------
section("5. 14:20 on a busy Wednesday");
// DESIGN 1: the column shows the 14:00 as NOW and the 17:30 below it, nothing else.

const NOW = at("2026-08-26T14:20:00+02:00");
const work = shown("events-work-wednesday", WORK);
const wed = chooseEvents(work, NOW, { tz: TZ });

eq("the scope is today", wed.scope, "today");
eq("what is left is the 14:00 and the 17:30", ids(wed.timed), ["w-1400-sprint", "w-1730-arch"]);
eq("the 09:30 and the 11:00 are finished and gone",
  ids(wed.timed).some((i) => i === "w-0930-standup" || i === "w-1100-oneonone"), false);
eq("the meeting you are in is the NOW row", wed.nowEvent.id, "w-1400-sprint");
// It is a label, not a separate list: removing it from `timed` would make the row
// count wrong wherever two events overlap.
eq("...and it is still in the list", ids(wed.timed).includes(wed.nowEvent.id), true);
eq("the declined all-hands is in neither list",
  [...ids(wed.timed), ...ids(wed.allDay)].includes("w-1200-allhands"), false);
eq("the cancelled slot never got this far", ids(wed.timed).includes("w-1000-cancelled"), false);
eq("the all-day row is pinned separately", ids(wed.allDay), ["w-allday-ana"]);
eq("...and never appears among the timed ones", wed.timed.every((e) => !e.allDay), true);
// An all-day event has no end time to be past, so it lasts as long as the day.
eq("an all-day event does not finish during its day",
  ids(chooseEvents(work, at("2026-08-26T23:50:00+02:00"), { tz: TZ }).allDay), ["w-allday-ana"]);
eq("the unanswered 17:30 is shown, to be marked with a ?",
  wed.timed.find((e) => e.id === "w-1730-arch").reply, "none");

// ---------------------------------------------------------------------------
section("6. now, exactly");

const edge = shown("events-overlap", WORK);
const strike = chooseEvents(edge, NOW, { tz: TZ });
// Finished means the END is at or before now. A meeting you are in the middle of
// is the single most useful row on the screen.
eq("an event ending exactly at now is finished", ids(strike.timed).includes("o-ends-at-1420"), false);
eq("one starting exactly at now is not", ids(strike.timed).includes("o-starts-at-1420"), true);
eq("both overlapping current events are listed",
  ids(strike.timed), ["o-earlier-current", "o-later-current", "o-starts-at-1420"]);
eq("...and the earlier-starting one wears the NOW label", strike.nowEvent.id, "o-earlier-current");
eq("an event starting exactly at now is not yet the NOW row",
  chooseEvents([one("events-overlap", "o-starts-at-1420", WORK)], NOW, { tz: TZ }).nowEvent.id,
  "o-starts-at-1420");

// Time is only ever an argument, so moving it backwards is an ordinary call.
const earlier = chooseEvents(work, at("2026-08-26T09:00:00+02:00"), { tz: TZ });
eq("winding now back makes a finished event reappear",
  ids(earlier.timed), ["w-0930-standup", "w-1100-oneonone", "w-1400-sprint", "w-1730-arch"]);
eq("...with nothing happening yet", earlier.nowEvent, null);

// An overnight shift has not finished just because the date rolled over.
const overnight = shown("events-shapes", WORK);
eq("an event that began yesterday and ends today is still shown",
  ids(chooseEvents(overnight, at("2026-08-26T03:00:00+02:00"), { tz: TZ }).timed)[0],
  "s-yesterday-into-today");
eq("...and is the NOW row while it runs",
  chooseEvents(overnight, at("2026-08-26T03:00:00+02:00"), { tz: TZ }).nowEvent.id,
  "s-yesterday-into-today");
eq("...but not after it ends",
  ids(chooseEvents(overnight, at("2026-08-26T07:00:00+02:00"), { tz: TZ }).timed)
    .includes("s-yesterday-into-today"), false);

// ---------------------------------------------------------------------------
section("7. two calendars, in the order they were added");
// All-day rows have no start time to sort by, so calendar-add order is the only
// ranking they have -- and it is the order the caller hands them over in.

const both = [...shown("events-work-wednesday", WORK), ...shown("events-home-wednesday", HOME)];
const day = chooseEvents(both, NOW, { tz: TZ });
eq("all-day rows follow calendar-add order", ids(day.allDay), ["w-allday-ana", "h-allday-school"]);
eq("timed rows are start-ascending across both calendars",
  titles(day.timed), ["sprint review", "architecture sync", "pick up kids"]);
// Two events at the same minute keep calendar order rather than flipping between
// refreshes: the sort is by start alone and JavaScript's sort is stable.
eq("...and a tie keeps calendar order", ids(day.timed).slice(1), ["w-1730-arch", "h-1730-kids"]);
eq("the home calendar's finished gym is gone", ids(day.timed).includes("h-0800-gym"), false);
eq("every row remembers which calendar it came from",
  day.timed.map((e) => e.slug), ["work", "work", "home"]);

// ---------------------------------------------------------------------------
section("8. when today has nothing left, it rolls on to tomorrow");
// The fetch window is two days wide precisely so this costs no network round trip
// at 18:05.

const roll = shown("events-rollover", WORK);
const evening = chooseEvents(roll, at("2026-08-26T20:00:00+02:00"), { tz: TZ });
eq("today's every survivor was one you declined, so it rolls over", evening.scope, "tomorrow");
eq("...to tomorrow's events", ids(evening.timed), ["r-tomorrow-0900"]);
eq("...including tomorrow's all-day row", ids(evening.allDay), ["r-tomorrow-allday"]);
eq("nothing tomorrow is filtered by now", evening.timed[0].start < at("2026-08-27T09:00:01+02:00"), true);
eq("tomorrow's declined event is still dropped", ids(evening.timed).includes("r-tomorrow-0800-declined"), false);
eq("nothing tomorrow can be happening now", evening.nowEvent, null);

// The declined filter runs BEFORE the emptiness test, which is what makes a day
// of meetings you are not going to roll over instead of showing them.
const declinedOnly = chooseEvents(
  [one("events-rollover", "r-today-declined-late", WORK)],
  at("2026-08-26T14:20:00+02:00"), { tz: TZ });
eq("a day made entirely of declined events is empty", declinedOnly.scope, "empty");
eq("...with two empty lists", [declinedOnly.allDay, declinedOnly.timed], [[], []]);

const nothing = chooseEvents(shown("events-empty", WORK), NOW, { tz: TZ });
eq("nothing today or tomorrow", nothing.scope, "empty");
eq("...and two empty lists", [nothing.allDay, nothing.timed, nothing.nowEvent], [[], [], null]);
eq("an absent list is treated the same", chooseEvents(undefined, NOW, { tz: TZ }).scope, "empty");

// Earlier in the same day, today is not empty and there is no roll-over.
const morning = chooseEvents(roll, at("2026-08-26T08:00:00+02:00"), { tz: TZ });
eq("it only rolls over once today really is empty", morning.scope, "today");
eq("...showing today's own event", ids(morning.timed), ["r-today-finished"]);

// ---------------------------------------------------------------------------
section("9. the two days a year that are not 24 hours long");
// Sun 25 Oct 2026, Europe/Warsaw: the clocks go back at 03:00, so the day is 25
// hours long. A boundary computed by adding 24 hours to midnight would land an
// hour early and throw that evening's events onto the wrong day.

const autumn = dayBounds(at("2026-10-25T10:00:00+01:00"), { tz: TZ });
eq("the day starts at midnight CEST", autumn.todayStart, at("2026-10-24T22:00:00Z"));
eq("...and ends at midnight CET", autumn.tomorrowStart, at("2026-10-25T23:00:00Z"));
eq("which makes it 25 hours long", autumn.tomorrowStart - autumn.todayStart, 25 * 3600 * 1000);
eq("and tomorrow an ordinary 24", autumn.dayAfterStart - autumn.tomorrowStart, 24 * 3600 * 1000);

const spring = dayBounds(at("2026-03-29T12:00:00+02:00"), { tz: TZ });
eq("the short day is 23 hours", spring.tomorrowStart - spring.todayStart, 23 * 3600 * 1000);
eq("...starting at midnight CET", spring.todayStart, at("2026-03-28T23:00:00Z"));

const dst = chooseEvents(shown("events-dst", WORK), at("2026-10-25T10:00:00+01:00"), { tz: TZ });
eq("the long day's events stay on the long day", ids(dst.timed), ["d-brunch", "d-late"]);
eq("...the 23:30 one included, an hour past a naive boundary",
  one("events-dst", "d-late", WORK).start, at("2026-10-25T22:30:00Z"));
eq("yesterday's supper has finished", ids(dst.timed).includes("d-yesterday"), false);
eq("tomorrow's standup is not today's", ids(dst.timed).includes("d-tomorrow"), false);
const dstAllDay = one("events-dst", "d-allday", WORK);
eq("the all-day row covers the whole 25 hours",
  [dstAllDay.start, dstAllDay.end], [at("2026-10-24T22:00:00Z"), at("2026-10-25T23:00:00Z")]);
eq("...and is pinned on that day", ids(dst.allDay), ["d-allday"]);

// ---------------------------------------------------------------------------
section("10. the model is deterministic without an environment");
// A caller who names no zone must get the same answer on every machine: leaving
// it undefined would hand Intl the machine's own zone, which is exactly the read
// this module may not make.
eq("no zone means UTC, not the machine's", dayBounds(at("2026-08-26T12:00:00Z"), {}).todayStart,
  at("2026-08-26T00:00:00Z"));
eq("an unresolvable zone falls back rather than throwing",
  dayBounds(at("2026-08-26T12:00:00Z"), { tz: "Mars/Olympus" }).todayStart, at("2026-08-26T00:00:00Z"));

// Google documents `dateTime` as carrying an offset "unless a time zone is
// explicitly specified in timeZone", so an offset-less stamp is a shape the API
// may return -- and `Date.parse` reads one of those in the MACHINE's zone. New
// York is deliberately neither this machine's zone nor the calendar's, so the
// expected instant is the same number on every machine and a machine-local parse
// cannot accidentally agree with it.
const bare = one("events-shapes", "s-no-offset", WORK);
eq("an offset-less stamp is placed by its own timeZone", bare.start, at("2026-08-26T18:00:00Z"));
eq("...both ends of it", bare.end, at("2026-08-26T19:00:00Z"));
eq("...and the calendar's zone stands in when the event names none",
  normaliseEvent({ id: "x", start: { dateTime: "2026-08-26T14:00:00" } },
    { ...WORK, tz: "America/New_York" }).start, at("2026-08-26T18:00:00Z"));
// The offset names the instant outright; a timeZone beside it can disagree.
eq("an offset in the stamp wins over the timeZone beside it",
  one("events-shapes", "s-offset-wins", WORK).start, at("2026-08-26T19:00:00Z"));

done();
