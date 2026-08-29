// cockpit-agenda-store — the agenda's three state files, the lock, atomic writes.
//
// Everything the agenda knows lives under ~/.claude/cockpit/, NEVER in the repo:
// a checked-in file here would show up in `revdiff --untracked HEAD`, the very
// diff an agent is reviewed on, so your calendar would become a change the agent
// thinks it has to explain -- and it would put refresh tokens in git.
//
//   agenda-client.json  0600  { version, clientId, clientSecret }
//   agenda.json         0600  { version,
//                               accounts:  { "<email>": { refreshToken, addedAt } },
//                               calendars: [ { slug, account, calendarId, title,
//                                              colour, addedAt } ] }
//   agenda-cache.json   0600  { version, calendars: { "<slug>": { fetchedAt, events, error } } }
//   agenda.lock               the write lock (5s stale break), as notes.lock
//
// Modelled on cockpit-notes.mjs, which already solves the same problems. Three
// deliberate differences:
//
//   * NOT keyed by repo. notes.json is `{ repos: { "<path>": [...] } }` because a
//     note is about a project; an agenda is about YOU, so there is one list.
//   * 0600 on all three, the cache included -- it holds your meeting titles.
//   * a corrupt agenda.json is MOVED ASIDE rather than silently replaced: it holds
//     the sign-ins, and discarding a refresh token costs two browser round trips.
//     The cache gets no such treatment; it is re-fetchable within a minute.
//
// This module is the dumb end of the boundary (DESIGN 3.1): it stores what it is
// given and guesses at nothing. Google's downloaded client JSON is nested
// (`{ "installed": { client_id, ... } }`) -- parsing that away is `agenda setup`'s
// job (T05); writeClient() only ever sees our own normalised flat shape.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
export const CLIENT_FILE = path.join(DIR, "agenda-client.json");
export const STATE_FILE = path.join(DIR, "agenda.json");
export const CACHE_FILE = path.join(DIR, "agenda-cache.json");
const LOCK_FILE = path.join(DIR, "agenda.lock");

const MODE = 0o600;

// --- the lock --------------------------------------------------------------
// You, an agent in another terminal and the daemon all write these files. Two
// read-modify-writes landing together would otherwise lose one. ONE lock covers
// all three files: they are written together often enough (add a calendar, prime
// its cache) that separate locks would only buy interleavings to reason about.

const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 25;
// Wait as long as it takes a stale lock to break, and no longer: any lock still
// held past that point is broken by the next attempt, so waiting further only
// delays a write that is now guaranteed to get in.
const LOCK_TRIES = Math.ceil(LOCK_STALE_MS / LOCK_WAIT_MS);

// It is not reentrant on its own, and ONE lock across all three files makes nesting
// the ordinary case rather than an exotic one: a compound write -- add a calendar,
// prime its cache -- is one withLock around calls that each take it again. Measured
// before this guard: that took 5035ms, because the inner call spun the whole retry
// budget against a lock THIS process was holding, then broke it as stale and
// unlinked it -- leaving the rest of the outer transaction running with no lock at
// all, which is the opposite of what wrapping it was for. So count depth: the
// outermost call owns the file and the inner ones simply run.
let lockDepth = 0;

export function withLock(fn) {
  if (lockDepth > 0) {
    lockDepth++;
    try { return fn(); } finally { lockDepth--; }
  }
  let fd = null;
  try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* exists, or unwritable */ }
  for (let i = 0; i < LOCK_TRIES; i++) {
    try { fd = fs.openSync(LOCK_FILE, "wx"); break; } catch {
      // A process killed mid-write leaves the lock behind forever; break one that
      // is clearly older than any write could take.
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(LOCK_FILE);
      } catch { /* someone else just cleared it */ }
      sleepSync(LOCK_WAIT_MS);
    }
  }
  lockDepth = 1;
  try {
    return fn();
  } finally {
    lockDepth = 0;
    if (fd !== null) try { fs.closeSync(fd); } catch { /* already gone */ }
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
  }
}

// The CLI is synchronous end to end (it prints and exits), so the lock retry has
// to block. Atomics.wait on a throwaway buffer is the only sleep node offers that
// does not need an event-loop turn.
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no SAB */ }
}

// --- reading and writing files ---------------------------------------------

/**
 * Distinguish "not there yet" from "there and broken": the second is the only one
 * worth quarantining, and only agenda.json is worth quarantining at all.
 */
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch { return { data: null, corrupt: false }; }   // absent, or we may not read it
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return { data, corrupt: false };
  } catch { /* fall through */ }
  return { data: null, corrupt: true };
}

/**
 * Temp file plus rename, always. The renderers watch the state DIRECTORY rather
 * than the files, so a replaced inode must not deafen them, and a crash mid-write
 * must leave the previous file whole.
 *
 * The temp name carries the pid: the lock makes a collision very unlikely, but a
 * writer that gave up waiting for a stale lock must still not scribble on another
 * writer's half-written temp file.
 */
function writeJson(file, data) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: MODE });
  // writeFileSync's mode only applies when it CREATES the file, and is masked by
  // umask even then. Tokens and meeting titles are not world-readable, so say so
  // outright; rename carries the mode across.
  fs.chmodSync(tmp, MODE);
  fs.renameSync(tmp, file);
}

/** Move a corrupt file out of the way, returning where it went (null if it could not). */
function quarantine(file) {
  for (let i = 0; i < 8; i++) {
    const dest = `${file}.corrupt-${Date.now()}${i ? `-${i}` : ""}`;
    if (fs.existsSync(dest)) continue;
    try { fs.renameSync(file, dest); return dest; }
    catch { return null; }   // another process quarantined it first
  }
  return null;
}

// --- the Google registration (agenda-client.json) --------------------------

/** null when the cockpit has never been registered -- `agenda setup` says so. */
export function readClient() {
  const { data } = readJson(CLIENT_FILE);
  const clientId = data && typeof data.clientId === "string" ? data.clientId : "";
  const clientSecret = data && typeof data.clientSecret === "string" ? data.clientSecret : "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Values arrive ALREADY normalised (see the header): no shape-guessing here. */
export function writeClient({ clientId, clientSecret }) {
  withLock(() => writeJson(CLIENT_FILE, { version: 1, clientId: String(clientId), clientSecret: String(clientSecret) }));
}

// --- accounts and calendars (agenda.json) ----------------------------------

/**
 * Always well-formed, and never throws: this is called from the drawing pane, and
 * a cockpit that will not paint because a JSON file lost a brace is worse than one
 * that has forgotten a calendar (DESIGN 2.7).
 *
 * `corruptedTo` is the one thing a caller learns about the damage: the path the
 * broken file was moved to, so the CLI can say the sign-ins were set aside rather
 * than let them vanish silently.
 *
 * `rescue: false` reads WITHOUT moving anything: the quarantine is a one-shot
 * event and only a caller that can speak to a person may consume it. The drawing
 * pane repaints every two seconds and would otherwise always win the race to a
 * freshly corrupted file, moving the sign-ins aside where nothing would ever
 * report it -- and DESIGN 2.7 puts the announcement at the heart of the rule
 * ("silently discarding refresh tokens costs two browser round trips"). So the
 * CLI rescues and says so; the pane and the daemon read and leave it alone.
 */
export function readState({ rescue = true } = {}) {
  const { data, corrupt } = readJson(STATE_FILE);
  const corruptedTo = corrupt && rescue ? quarantine(STATE_FILE) : null;

  const accounts = {};
  const rawAccounts = data && typeof data.accounts === "object" && data.accounts ? data.accounts : {};
  for (const [email, a] of Object.entries(rawAccounts)) {
    if (!a || typeof a !== "object" || typeof a.refreshToken !== "string" || !a.refreshToken) continue;
    accounts[email] = { refreshToken: a.refreshToken, addedAt: Number(a.addedAt) || 0 };
  }

  const calendars = (Array.isArray(data?.calendars) ? data.calendars : [])
    .filter((c) => c && typeof c === "object" && typeof c.slug === "string" && c.slug)
    .map((c) => ({
      slug: c.slug,
      account: typeof c.account === "string" ? c.account : "",
      calendarId: typeof c.calendarId === "string" ? c.calendarId : "",
      title: typeof c.title === "string" ? c.title : "",
      // Kept opaque: the palette belongs to the model (DESIGN 3.2), and a store
      // that second-guesses a colour is a store that loses one.
      colour: c.colour ?? null,
      addedAt: Number(c.addedAt) || 0,
    }));

  return { version: 1, accounts, calendars, corruptedTo };
}

function mutateState(fn) {
  return withLock(() => {
    const state = readState();
    const result = fn(state);
    writeJson(STATE_FILE, { version: 1, accounts: state.accounts, calendars: state.calendars });
    return result;
  });
}

/** Upsert. A re-sign-in gets a new token but keeps the day the account was added. */
export function putAccount(email, refreshToken, now) {
  mutateState((state) => {
    const prev = state.accounts[email];
    state.accounts[email] = { refreshToken, addedAt: prev?.addedAt || now };
  });
}

/**
 * Drops that account's calendars too. A calendar whose sign-in is gone can never
 * be fetched again, so leaving it behind would print a permanent loud error line
 * (DESIGN 2.7) for a calendar the user believes they removed.
 */
export function removeAccount(email) {
  mutateState((state) => {
    delete state.accounts[email];
    state.calendars = state.calendars.filter((c) => c.account !== email);
  });
}

/** Upsert by slug, in place -- the slug is the handle, so its position is stable. */
export function putCalendar({ slug, account, calendarId, title, colour }, now) {
  mutateState((state) => {
    const prev = state.calendars.find((c) => c.slug === slug);
    const cal = { slug, account, calendarId, title, colour, addedAt: prev?.addedAt || now };
    if (prev) state.calendars[state.calendars.indexOf(prev)] = cal;
    else state.calendars.push(cal);
  });
}

export function removeCalendar(slug) {
  return mutateState((state) => {
    const i = state.calendars.findIndex((c) => c.slug === slug);
    if (i === -1) return null;
    return state.calendars.splice(i, 1)[0];
  });
}

export function setColour(slug, colour) {
  return mutateState((state) => {
    const cal = state.calendars.find((c) => c.slug === slug);
    if (!cal) return null;
    cal.colour = colour;
    return cal;
  });
}

// --- the event cache (agenda-cache.json) -----------------------------------

/**
 * Never throws either, and -- unlike the state -- a corrupt cache is simply
 * ignored, not moved aside. It is re-fetchable within a minute, so a pile of
 * agenda-cache.json.corrupt-* files would be litter with nothing in it.
 */
export function readCache() {
  const { data } = readJson(CACHE_FILE);
  const calendars = {};
  const raw = data && typeof data.calendars === "object" && data.calendars ? data.calendars : {};
  for (const [slug, e] of Object.entries(raw)) {
    if (!e || typeof e !== "object") continue;
    calendars[slug] = {
      fetchedAt: Number(e.fetchedAt) || 0,
      events: Array.isArray(e.events) ? e.events : [],
      error: e.error ?? null,
    };
  }
  return { version: 1, calendars };
}

function mutateCache(fn) {
  return withLock(() => {
    const cache = readCache();
    const result = fn(cache);
    writeJson(CACHE_FILE, { version: 1, calendars: cache.calendars });
    return result;
  });
}

export function putCacheEntry(slug, { fetchedAt, events, error }) {
  mutateCache((cache) => {
    cache.calendars[slug] = {
      fetchedAt: Number(fetchedAt) || 0,
      events: Array.isArray(events) ? events : [],
      error: error ?? null,
    };
  });
}

/** Drop entries for calendars that are no longer configured. */
export function pruneCache(slugs) {
  const keep = new Set(slugs);
  mutateCache((cache) => {
    for (const slug of Object.keys(cache.calendars)) if (!keep.has(slug)) delete cache.calendars[slug];
  });
}
