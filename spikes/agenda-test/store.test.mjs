// The agenda's state layer: three files, one lock, atomic writes.
//
// Every case here runs against a throwaway COCKPIT_DIR that run.sh points at a
// mktemp dir -- nothing in this suite may ever reach ~/.claude/cockpit, where the
// real sign-ins live (DESIGN 5.2).

import fs from "node:fs";
import path from "node:path";
import { section, ok, eq, done } from "./harness.mjs";
import * as store from "../../bin/cockpit-agenda-store.mjs";

const { DIR, CLIENT_FILE, STATE_FILE, CACHE_FILE } = store;
const ls = () => fs.existsSync(DIR) ? fs.readdirSync(DIR).sort() : [];
const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);
const T0 = 1756200000000;   // a fixed `now`: the store never reaches for a clock itself

section("1. a fresh cockpit has no agenda, and reading does not create one");
ok("COCKPIT_DIR is honoured", DIR === process.env.COCKPIT_DIR, `DIR=${DIR}`);
ok("...and it is a temp dir, not the real one", !DIR.includes(".claude/cockpit"), DIR);
eq("empty state", store.readState(), { version: 1, accounts: {}, calendars: [], corruptedTo: null });
eq("empty cache", store.readCache(), { version: 1, calendars: {} });
eq("no client registered yet", store.readClient(), null);
eq("reading wrote nothing", ls(), []);

section("2. calendars round-trip, and the slug is the handle");
store.putCalendar({ slug: "work", account: "me@corp.com", calendarId: "c-1", title: "Work", colour: 33 }, T0);
eq("every field survives a round trip", store.readState().calendars, [
  { slug: "work", account: "me@corp.com", calendarId: "c-1", title: "Work", colour: 33, addedAt: T0 },
]);

store.putCalendar({ slug: "work", account: "me@corp.com", calendarId: "c-2", title: "Work rebuilt", colour: 99 }, T0 + 60000);
const after = store.readState().calendars;
eq("re-adding a slug does not duplicate it", after.length, 1);
eq("...it is updated in place", [after[0].calendarId, after[0].title, after[0].colour], ["c-2", "Work rebuilt", 99]);
eq("...and keeps the day it was added", after[0].addedAt, T0);

store.putCalendar({ slug: "home", account: "me@gmail.com", calendarId: "c-3", title: "Home", colour: 45 }, T0);
eq("a second calendar is appended", store.readState().calendars.map((c) => c.slug), ["work", "home"]);

eq("setColour returns the calendar", store.setColour("home", 200).colour, 200);
eq("...and persists", store.readState().calendars[1].colour, 200);
eq("setColour on an unknown slug is null", store.setColour("nope", 1), null);

eq("removeCalendar returns what it removed", store.removeCalendar("home").slug, "home");
eq("...and it is gone", store.readState().calendars.map((c) => c.slug), ["work"]);
const before = JSON.stringify(store.readState());
eq("removing an unknown slug returns null", store.removeCalendar("nope"), null);
eq("...and changes nothing", JSON.stringify(store.readState()), before);

section("3. accounts, and what removing one takes with it");
store.putAccount("me@corp.com", "rt-corp", T0);
store.putAccount("me@gmail.com", "rt-home", T0);
eq("both accounts are stored", Object.keys(store.readState().accounts).sort(), ["me@corp.com", "me@gmail.com"]);
eq("with their refresh tokens", store.readState().accounts["me@corp.com"].refreshToken, "rt-corp");

store.putAccount("me@corp.com", "rt-corp-2", T0 + 99999);
eq("re-signing in replaces the token", store.readState().accounts["me@corp.com"].refreshToken, "rt-corp-2");
eq("...but keeps the day it was added", store.readState().accounts["me@corp.com"].addedAt, T0);

store.putCalendar({ slug: "home", account: "me@gmail.com", calendarId: "c-3", title: "Home", colour: 45 }, T0);
store.putCalendar({ slug: "team", account: "me@corp.com", calendarId: "c-4", title: "Team", colour: 71 }, T0);
// A calendar whose sign-in is gone can never be fetched again; leaving it behind
// would print a permanent loud error line for a calendar the user believes they
// removed (DESIGN 2.7).
store.removeAccount("me@corp.com");
eq("removing an account drops its calendars", store.readState().calendars.map((c) => c.slug), ["home"]);
eq("...and only that account", Object.keys(store.readState().accounts), ["me@gmail.com"]);

section("4. the event cache");
store.putCacheEntry("home", { fetchedAt: T0, events: [{ title: "standup" }], error: null });
store.putCacheEntry("work", { fetchedAt: T0, events: [], error: "auth" });
eq("an entry round-trips", store.readCache().calendars.home, { fetchedAt: T0, events: [{ title: "standup" }], error: null });
eq("an error entry round-trips", store.readCache().calendars.work.error, "auth");
store.pruneCache(["home"]);
eq("pruning drops a calendar that is gone", Object.keys(store.readCache().calendars), ["home"]);
eq("...and keeps the rest whole", store.readCache().calendars.home.events.length, 1);

section("5. the Google registration");
// Google's own download is nested (`{ installed: { client_id, ... } }`); parsing
// that away is `agenda setup`'s job (T05). The store only sees our flat shape.
store.writeClient({ clientId: "id.apps.googleusercontent.com", clientSecret: "s3cr3t" });
eq("client round-trips", store.readClient(), { clientId: "id.apps.googleusercontent.com", clientSecret: "s3cr3t" });
fs.writeFileSync(CLIENT_FILE, JSON.stringify({ version: 1, clientId: "id" }));
eq("half a registration reads as none", store.readClient(), null);
store.writeClient({ clientId: "id.apps.googleusercontent.com", clientSecret: "s3cr3t" });

section("6. modes, temp files, and what is left lying around");
// The state holds refresh tokens and the cache holds your meeting titles: none of
// the three is world-readable.
eq("agenda-client.json is 0600", mode(CLIENT_FILE), "600");
eq("agenda.json is 0600", mode(STATE_FILE), "600");
eq("agenda-cache.json is 0600", mode(CACHE_FILE), "600");
ok("no temp file left behind", !ls().some((f) => f.includes(".tmp")), ls().join(" "));
ok("no lock file left behind", !ls().includes("agenda.lock"), ls().join(" "));

section("7. a corrupt file starts clean rather than crashing the pane");
// agenda.json holds the sign-ins, so it is MOVED ASIDE, not silently replaced:
// discarding a refresh token costs two browser round trips (DESIGN 2.7).
fs.writeFileSync(STATE_FILE, "{ this is not json");
const rescued = store.readState();
ok("a corrupt agenda.json does not throw", true);
eq("...it reads as empty", [Object.keys(rescued.accounts).length, rescued.calendars.length], [0, 0]);
ok("...the move is reported", typeof rescued.corruptedTo === "string" && rescued.corruptedTo !== null, String(rescued.corruptedTo));
ok("...to agenda.json.corrupt-<ts>", /agenda\.json\.corrupt-\d+$/.test(rescued.corruptedTo || ""), String(rescued.corruptedTo));
eq("...with the tokens still in it", fs.readFileSync(rescued.corruptedTo, "utf8"), "{ this is not json");
ok("...and the original is out of the way", !fs.existsSync(STATE_FILE));
eq("a second read reports nothing to rescue", store.readState().corruptedTo, null);
store.putCalendar({ slug: "work", account: "a@b.c", calendarId: "c", title: "W", colour: 1 }, T0);
eq("...and writing works again afterwards", store.readState().calendars.length, 1);

// The cache is re-fetchable in five minutes, so quarantining it would only litter
// the directory with files nobody will ever open.
fs.writeFileSync(CACHE_FILE, "]]] also not json");
eq("a corrupt cache reads as empty", store.readCache(), { version: 1, calendars: {} });
ok("...and is NOT moved aside", !ls().some((f) => f.startsWith("agenda-cache.json.corrupt-")), ls().join(" "));
ok("...the file is left where it was", fs.existsSync(CACHE_FILE));
store.putCacheEntry("work", { fetchedAt: T0, events: [], error: null });
eq("...and the next write repairs it", Object.keys(store.readCache().calendars), ["work"]);

// Junk that parses but has the wrong shape must not reach the renderer either.
fs.writeFileSync(STATE_FILE, JSON.stringify({ version: 1, accounts: "nope", calendars: [null, 7, { slug: "ok" }] }));
const junk = store.readState();
eq("garbage accounts read as none", junk.accounts, {});
eq("only well-formed calendars survive", junk.calendars.map((c) => c.slug), ["ok"]);
eq("...with the missing fields filled in", junk.calendars[0], { slug: "ok", account: "", calendarId: "", title: "", colour: null, addedAt: 0 });
ok("a well-shaped file is not quarantined", junk.corruptedTo === null);

section("8. the lock: a stale one is broken, a nested one does not stall");
// A process killed mid-write leaves the lock behind. Breaking it at 5s is what
// stops one crash wedging every later write.
fs.writeFileSync(path.join(DIR, "agenda.lock"), "");
const old = (Date.now() - 60000) / 1000;
fs.utimesSync(path.join(DIR, "agenda.lock"), old, old);
const t = Date.now();
store.putCalendar({ slug: "after-stale", account: "a@b.c", calendarId: "c", title: "T", colour: 2 }, T0);
const waited = Date.now() - t;
ok("the write got in", store.readState().calendars.some((c) => c.slug === "after-stale"));
ok("...without waiting out the retries", waited < 2000, `waited ${waited}ms`);
ok("...and the lock is cleared", !fs.existsSync(path.join(DIR, "agenda.lock")));

// ONE agenda.lock covers all three files precisely so that a compound write -- add
// a calendar, prime its cache -- is a single transaction. That makes nesting the
// ordinary case, so withLock has to be reentrant. Before it was, this took 5035ms:
// the inner call spun the whole retry budget against a lock this same process was
// holding, then broke it as stale and UNLINKED it, so the rest of the outer block
// ran with no lock at all. Both halves are asserted -- the stall and the drop --
// because fixing only the timing would leave the transaction just as unprotected.
const lockFile = path.join(DIR, "agenda.lock");
let heldThroughout = null;
const t2 = Date.now();
const returned = store.withLock(() => {
  store.putCalendar({ slug: "compound", account: "a@b.c", calendarId: "c", title: "C", colour: 3 }, T0);
  store.putCacheEntry("compound", { fetchedAt: T0, events: [], error: null });
  heldThroughout = fs.existsSync(lockFile);
  return "returned";
});
const nested = Date.now() - t2;
ok("a nested withLock does not spin on this process's own lock", nested < 1000, `took ${nested}ms`);
ok("...and the lock is still held after the inner calls", heldThroughout === true);
eq("...the outer return value is passed through", returned, "returned");
eq("...and both files were written", [
  store.readState().calendars.some((c) => c.slug === "compound"),
  Boolean(store.readCache().calendars.compound),
], [true, true]);
ok("...and the lock is released when the outermost call ends", !fs.existsSync(lockFile));

done();
