#!/usr/bin/env node
// agenda -- attach Google calendars to the cockpit, and see the day.
//
// Reachable ONLY from inside the cockpit, exactly as `note` is: there is no
// install step and nothing lands on your normal PATH. bin/cockpit-layout.sh
// symlinks this to ~/.claude/cockpit/bin/agenda and puts that directory on PATH
// for the shells it and the daemon spawn. Outside a cockpit window `agenda` is
// simply not a command.
//
//   agenda                  the day, as the column shows it, then per-calendar state
//   agenda ls               the configured calendars, one per line
//   agenda add <slug>       sign in if needed, pick one of the account's calendars
//   agenda rm <slug>        detach it (EXACT slug, no prefixes)
//   agenda color <slug>     reroll its colour, preferring an unused one
//   agenda setup [path]     read the client JSON Google gave you
//   agenda help
//
// This is the impure side of the boundary (DESIGN 3.1): it reads the clock, the
// environment and the files, and hands all of it to the pure model as arguments.
// Nothing here decides what an event means or how a row is drawn.
//
// Four environment seams, all of them so the tests never reach Google and never
// open a browser (DESIGN 5.2 -- the same reason `origin` is injectable in the
// client). Only the first is meant for a person:
//
//   AGENDA_DRY_RUN=1   print the URL `add` would open, then stop. Binds no port,
//                      opens no browser, writes nothing. The safe way to look at
//                      the flow, by hand or in a test.
//   AGENDA_ORIGIN      re-point Google's endpoints at a loopback stub.
//   AGENDA_BROWSER     the opener, instead of /usr/bin/open.
//   AGENDA_TTY         where the prompts are read from, instead of /dev/tty.
//
// The prompts read from /dev/tty rather than stdin ON PURPOSE: `agenda` writes
// its answer to stdout, and taking the replies from the terminal instead of the
// pipe is what keeps the two independent.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomInt } from "node:crypto";
import { spawn } from "node:child_process";

import {
  PALETTE, agendaHeight, dayBounds, normaliseEvent, parseGoogleClient,
  pickColour, renderAgenda, safeText,
} from "./cockpit-agenda-model.mjs";
import {
  CLIENT_FILE, STATE_FILE, putAccount, putCacheEntry, putCalendar, pruneCache,
  readCache, readClient, readState, removeCalendar, setColour, withLock, writeClient,
} from "./cockpit-agenda-store.mjs";
import { accessToken, describeError, fetchEvents, listCalendars, signIn } from "./cockpit-agenda-google.mjs";

const ESC = "\x1b[";
const tty = process.stdout.isTTY;
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
// Everything drawn goes through here, so a piped `agenda` is plain text and a
// grep over it sees the words rather than the escapes. The COLUMN is never
// stripped -- this is the terminal's own courtesy, and it is also why the slug is
// drawn beside the colour bar at all (DESIGN 2.8).
const say = (s = "") => console.log(tty ? s : strip(s));
// EVERY string that came off the wire goes through this before it is drawn --
// calendar titles, account emails, Google's own error text. A title is whatever
// the person who sent you the invitation typed: an ESC in one retitles your
// window or clears the screen, and a NEWLINE forges a second line that reads
// exactly like another configured calendar. The pane learned this in T03's
// review (FINDINGS 2026-08-28); a terminal is no safer, and `strip` cannot help
// -- it only removes colour, and the damage is done by the sequences it leaves.
const wire = (s) => safeText(s);
const dim = (s) => `${ESC}2m${s}${ESC}0m`;
const bold = (s) => `${ESC}1m${s}${ESC}0m`;

const die = (msg) => { console.error(`agenda: ${msg}`); process.exit(1); };
// NOTE: callers pass wire()'d text for anything off the wire -- stderr is drawn on
// the same terminal as stdout and an escape there does the same damage.

const USAGE = `agenda -- today's calendars, in the cockpit's fleet view.

  agenda                 the day, then the state of every calendar
  agenda ls              the configured calendars, one per line
  agenda add <slug>      connect one Google calendar and call it <slug>
  agenda rm <slug>       detach it (the slug in full -- no prefixes)
  agenda color <slug>    give it a different colour
  agenda setup [path]    read the client JSON downloaded from Google
  agenda help

The slug is the handle you type and the label shown against that calendar's
events. Sign-in is per Google account, so a second calendar from an account you
have already connected does not open a browser again.

State lives in ~/.claude/cockpit/agenda*.json, mode 0600, never in a repo.
AGENDA_DRY_RUN=1 makes \`agenda add\` print the sign-in URL and stop.`;

// `agenda help` must answer even where the command should not work at all -- with
// no registration, outside a cockpit, or run by an agent. Refusing to explain
// itself is the one unhelpful failure mode, so this is decided before anything
// else is read (the same rule `note help` follows).
const argv = process.argv.slice(2);
if (["help", "-h", "--help"].includes(argv[0])) { console.log(USAGE); process.exit(0); }

const ORIGIN = process.env.AGENDA_ORIGIN || "";
const DRY_RUN = process.env.AGENDA_DRY_RUN === "1";
const NOW = Date.now();
// The machine's zone, read HERE and passed down. Reading it inside the model is
// exactly the environment access DESIGN 3.1 forbids, and the purity grep cannot
// see it happen inside Intl (FINDINGS 2026-08-28).
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const CODE_BY_NAME = new Map(PALETTE.map((c) => [c.name, c.code]));
const BAR = "▌";
const swatch = (colour) => {
  const code = CODE_BY_NAME.get(colour);
  return code ? `${ESC}${code}m${BAR}${ESC}0m` : BAR;
};

// --- who is running this ---------------------------------------------------

/**
 * An agent running `agenda add` would open a browser window and ask YOU to sign
 * in, unattended, to a flow it cannot complete; `agenda rm` from an agent is a
 * configuration change nobody asked for (DESIGN 2.2). Reading is fine and stays
 * fine -- `agenda`, `agenda ls` and `agenda help` work anywhere.
 *
 * CLAUDECODE is the same "an agent is running this" marker the notes store
 * already relies on: CLAUDE_CODE_AGENT holds the agent TYPE, not the fact.
 */
function refuseIfAgent(verb) {
  if (!process.env.CLAUDECODE) return;
  die(`\`agenda ${verb}\` is not available to an agent.\n` +
      `      It would open a browser and wait for a person to finish signing in.\n` +
      `      Ask the human at this cockpit to run it. (\`agenda\` and \`agenda ls\` do work here.)`);
}

// --- the prompts -----------------------------------------------------------
// From /dev/tty, not stdin, so the picker still works when stdout is piped --
// which is how the tests drive everything else.

function openTty() {
  try { return fs.openSync(process.env.AGENDA_TTY || "/dev/tty", "r"); }
  catch { return null; }        // a script, a CI run, a session with no terminal
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no SAB */ }
}

/**
 * One line, or null at end of input. Bytes are collected and decoded once rather
 * than one at a time, so a multi-byte character typed at the prompt is not cut in
 * half on the way in.
 */
function readLine(fd) {
  const byte = Buffer.alloc(1);
  const bytes = [];
  for (;;) {
    let n = 0;
    try { n = fs.readSync(fd, byte, 0, 1, null); }
    catch (e) {
      // A tty handed to us in non-blocking mode says "nothing yet", not "no more".
      if (e && (e.code === "EAGAIN" || e.code === "EWOULDBLOCK")) { sleepSync(20); continue; }
      n = 0;
    }
    if (!n) return bytes.length ? Buffer.from(bytes).toString("utf8") : null;
    if (byte[0] === 0x0a) return Buffer.from(bytes).toString("utf8");
    bytes.push(byte[0]);
  }
}

function ask(fd, prompt) {
  process.stdout.write(tty ? dim(prompt) : strip(prompt));
  const line = readLine(fd);
  if (line === null) {
    say();
    die("no answer -- the input ended. `agenda add` needs an interactive terminal.");
  }
  return line.replace(/\r$/, "").trim();
}

/**
 * Re-prompts on anything that is not a number in range rather than crashing or
 * guessing: 0, `n` and 99 are all just typos, and the list is still on screen.
 */
function askNumber(fd, max, prompt) {
  for (;;) {
    const n = Number(ask(fd, prompt));
    if (Number.isInteger(n) && n >= 1 && n <= max) return n;
    say(dim(`  please type a number from 1 to ${max}.`));
  }
}

// --- setup: the Google registration ----------------------------------------

const expandHome = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

// The id is not a secret -- it travels in every auth URL -- but there is no reason
// to paste a whole one into a terminal someone may screenshot. The SECRET is never
// printed at all, to either stream, and never leaves this process except into
// agenda-client.json.
const redactId = (id) => (id.length > 22 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id);

/**
 * Read the JSON Google gave you and copy the two values out of it. The download
 * is READ and left exactly where it is: reading someone's ~/Downloads and moving
 * nothing is the least surprising thing this can do (DESIGN 2.9).
 */
function setupFrom(file) {
  const p = expandHome(String(file || "").trim());
  if (!p) die("`agenda setup <path>` needs the path to the JSON you downloaded from Google.");
  let text;
  try { text = fs.readFileSync(p, "utf8"); }
  catch (e) {
    die(`cannot read ${p} (${(e && e.code) || "unreadable"}).\n` +
        `      That is the JSON the Google Cloud console downloads when you create an OAuth client.`);
  }
  const parsed = parseGoogleClient(text);
  if (parsed.error) {
    // Naming the FILE matters more than naming the fault: the failure a person
    // actually hits is "right kind of file, shape I did not expect", or a wrong
    // download picked out of a folder full of them (T00 measured that the real
    // one is nested, which is why this is not a theoretical case).
    die(`${p}: ${parsed.error}\n` +
        `      Expected the OAuth client JSON from the Google Cloud console -- it looks like\n` +
        `      { "installed": { "client_id": "...", "client_secret": "..." } }.`);
  }
  writeClient(parsed);
  say(`registered client ${dim(redactId(parsed.clientId))}`);
  say(dim(`stored in ${CLIENT_FILE}, mode 0600. ${p} was not modified.`));
}

function askForPath() {
  const fd = openTty();
  if (fd === null) die("`agenda setup <path>` -- give it the path to the JSON you downloaded from Google.");
  say(dim("In the Google Cloud console, create an OAuth client of type Desktop app and download its JSON."));
  return ask(fd, "path to the downloaded JSON: ");
}

// --- the day ---------------------------------------------------------------

function ago(ms) {
  if (!Number.isFinite(ms) || ms < 60000) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * The width the column is drawn at here. Capped: the section is a glance, and on
 * a 200-column terminal the clock would end up a foot away from the word AGENDA.
 */
const termWidth = () => Math.max(20, Math.min(process.stdout.columns || 80, 80));

/**
 * Bare `agenda`. The day comes from `renderAgenda` -- the SAME function the pane
 * calls -- so what you read in a terminal and what you read in the column cannot
 * drift. That includes the "no calendars" invitation, which is why there is no
 * separate empty-state message here to disagree with it.
 */
function day() {
  const { calendars } = readState();
  const cache = readCache();
  const args = { width: termWidth(), calendars, cache, now: NOW, tz: TZ };
  // agendaHeight is what the section WANTS; asking for exactly that is how a
  // terminal shows all of it while the pane shows as much as its budget allows.
  for (const line of renderAgenda({ ...args, rows: agendaHeight(args) })) say(line);
  if (!calendars.length) return;

  // Then the part the column has no room for: where each calendar's rows came
  // from and when. This is what DESIGN 6 sends you to when the column looks wrong.
  say();
  const slugW = Math.max(4, ...calendars.map((c) => c.slug.length));
  const acctW = Math.max(7, ...calendars.map((c) => (c.account || "").length));
  for (const cal of calendars) {
    // hasOwn, not a plain lookup: a slug like `__proto__` in a hand-edited or
    // older state file would otherwise hand back Object.prototype, and the whole
    // command would die on it rather than saying that calendar was never fetched.
    const entry = Object.hasOwn(cache.calendars, cal.slug) ? cache.calendars[cal.slug] : undefined;
    let state;
    if (!entry) state = dim("never fetched");
    else if (entry.error) {
      const kind = typeof entry.error === "string" ? entry.error : entry.error.kind;
      const why = typeof entry.error === "object" && entry.error.detail ? ` (${wire(entry.error.detail)})` : "";
      state = `${wire(kind)}${why}` + (entry.fetchedAt ? dim(` · last good ${ago(NOW - entry.fetchedAt)}`) : "");
    } else {
      const n = entry.events.length;
      state = dim(`${n} event${n === 1 ? "" : "s"} · updated ${ago(NOW - entry.fetchedAt)}`);
    }
    say(`${swatch(cal.colour)} ${cal.slug.padEnd(slugW)}  ${wire(cal.account || "").padEnd(acctW)}  ${state}`);
  }
}

function ls() {
  const { calendars } = readState();
  if (!calendars.length) {
    say(dim("no calendars. `agenda add home` connects one."));
    return;
  }
  const slugW = Math.max(4, ...calendars.map((c) => c.slug.length));
  const colW = Math.max(6, ...calendars.map((c) => String(c.colour || "").length));
  const acctW = Math.max(7, ...calendars.map((c) => (c.account || "").length));
  for (const c of calendars) {
    say(`${swatch(c.colour)} ${c.slug.padEnd(slugW)}  ${wire(c.colour || "").padEnd(colW)}  ` +
        `${wire(c.account || "").padEnd(acctW)}  ${wire(c.title || "")}`);
  }
}

// --- fetching one calendar -------------------------------------------------

/**
 * Fetch a calendar's events once and put them in the cache, so the column has
 * rows the moment `agenda add` returns rather than up to a minute later.
 *
 * The daemon does the same thing on its own tick, and T07 gives it its own copy
 * deliberately: this one runs in a process that is about to exit and may fail
 * without consequence, while cockpitd's must never take the daemon down.
 *
 * A failure here does NOT fail the add. The calendar is attached and the column
 * says why it has no rows (DESIGN 2.7) -- which is more useful than an add that
 * half-succeeded and left nothing to look at.
 */
async function fetchOnce(cal, client, refreshToken) {
  // Never now +/- 24h: a day is not always 24 hours long, and the window is the
  // start of today to the end of tomorrow so the roll-over needs no round trip
  // (DESIGN 2.5, FINDINGS 2026-08-27).
  const { todayStart, dayAfterStart } = dayBounds(NOW, { tz: TZ });
  try {
    const { token } = await accessToken({ ...client, refreshToken, origin: ORIGIN, now: NOW });
    const { events: raw, timeZone } = await fetchEvents({
      token, calendarId: cal.calendarId, timeMin: todayStart, timeMax: dayAfterStart, origin: ORIGIN,
    });
    // The calendar's OWN zone places its all-day boundaries; the machine's is the
    // fallback for a calendar that does not say.
    const zone = timeZone || TZ;
    const events = raw
      .map((r) => normaliseEvent(r, { slug: cal.slug, tz: zone, selfEmail: cal.account }))
      .filter(Boolean);
    putCacheEntry(cal.slug, { fetchedAt: NOW, events, error: null });
    return events.length;
  } catch (e) {
    // describeError, never a bare classifyError string: the object is what lets
    // the column tell "sign-in expired" from "calendar permission not granted"
    // (FINDINGS 2026-08-28). No response body rides along with it.
    putCacheEntry(cal.slug, { fetchedAt: 0, events: [], error: { ...describeError(e), since: NOW } });
    say(dim(`  (not fetched yet: ${wire(e.message)})`));
    return null;
  }
}

// --- add -------------------------------------------------------------------

// A slug is the handle you type, and `agenda rm` matches it EXACTLY (DESIGN 2.2).
// A slug with a space could therefore never be removed without knowing to quote
// it, and one with a control character would be invisible on the screen it has to
// be read off. Both are refused at the one moment a person can still pick another
// word -- and the empty string is refused with them.
// `__proto__` is refused with them, and not for tidiness: the cache is an OBJECT
// keyed by slug, so `cache.calendars["__proto__"] = entry` sets that object's
// PROTOTYPE instead of storing anything. Measured: the calendar attaches, its
// events are silently dropped on every fetch, and bare `agenda` then reads
// Object.prototype back as the entry and dies on `entry.events.length` -- the one
// command DESIGN 6 sends you to when the column looks wrong.
const badSlug = (s) => !s || s === "__proto__" || /[\s\p{Cc}]/u.test(s);

async function add(slug) {
  refuseIfAgent("add");
  if (!slug) die("`agenda add <slug>` needs a name for the calendar, e.g. `agenda add work`.");
  if (badSlug(slug)) {
    die(`\`${wire(slug)}\` will not do as a slug: no spaces, no control characters, not \`__proto__\`.\n` +
        `      It is the handle you type at \`agenda rm\`, in full.`);
  }

  const state = readState();
  if (state.calendars.some((c) => c.slug === slug)) {
    die(`\`${slug}\` is already connected. \`agenda rm ${slug}\` first, or pick another name.`);
  }

  let client = readClient();

  if (DRY_RUN) {
    // Binds no port, opens nothing, writes nothing (DESIGN 5.2). The safe way to
    // look at the flow -- which is also why it asks for no terminal.
    if (!client) die("no Google client registered yet -- `agenda setup <path-to-downloaded-json>` first.");
    const { dryRunUrl } = await signIn({ ...client, origin: ORIGIN, dryRun: true });
    say(dim("AGENDA_DRY_RUN=1 -- nothing opened, nothing bound, nothing written. This is the URL:"));
    say(dryRunUrl);
    return;
  }

  // Checked BEFORE the browser dance rather than during it: with no terminal this
  // has to exit saying so, not block forever on a read nobody can answer.
  const fd = openTty();
  if (fd === null) {
    die("`agenda add` needs an interactive terminal -- it has calendars for you to pick from.\n" +
        "      Run it in a cockpit terminal, or use AGENDA_DRY_RUN=1 to see the sign-in URL.");
  }

  if (!client) {
    say(dim("no Google client registered yet -- that comes first."));
    setupFrom(askForPath());
    client = readClient();
    if (!client) die("still no registration -- nothing was added.");
    say();
  }

  const account = await connectAccount(fd, state.accounts, client);
  const refreshToken = readState().accounts[account]?.refreshToken;
  if (!refreshToken) die(`signed in as ${wire(account)} but the sign-in was not stored -- nothing was added.`);

  const { token } = await accessToken({ ...client, refreshToken, origin: ORIGIN, now: NOW });
  const items = await listCalendars({ token, origin: ORIGIN });
  if (!items.length) die(`${wire(account)} has no calendars to attach.`);

  say();
  say(`Which calendar from ${bold(wire(account))}?`);
  items.forEach((c, i) => {
    say(`  ${String(i + 1).padStart(2)}  ${wire(c.summary)}` +
        (c.primary ? dim("  (your own)") : "") +
        (c.accessRole === "freeBusyReader" ? dim("  (free/busy only)") : ""));
  });
  const chosen = items[askNumber(fd, items.length, "calendar number: ") - 1];

  // No two configured calendars share a colour while a free one remains. The model
  // owns the palette; the randomness is produced HERE, because a model that reaches
  // for a random number is exactly as impure as one that reads a clock (DESIGN 3.1).
  const colour = pickColour(readState().calendars.map((c) => c.colour), randomInt(0, 1 << 30));
  const cal = { slug, account, calendarId: chosen.id, title: chosen.summary, colour };
  putCalendar(cal, NOW);

  say();
  say(`${swatch(colour)} ${bold(slug)}  ${wire(chosen.summary)}  ${dim(`· ${wire(account)} · ${colour}`)}`);
  const n = await fetchOnce(cal, client, refreshToken);
  if (n !== null) say(dim(`  ${n} event${n === 1 ? "" : "s"} today and tomorrow.`));
}

/**
 * Which Google account this calendar comes from. Sign-in is per ACCOUNT and
 * calendars are per slug (DESIGN 2.1), so a second calendar from an account
 * already connected reuses the stored sign-in and opens no browser at all --
 * which is the whole reason accounts and calendars are separate tables.
 *
 * With nothing signed in yet there is no question to ask: a one-item menu whose
 * only answer is "a different account" is a keystroke spent on nothing.
 */
async function connectAccount(fd, accounts, client) {
  const known = Object.keys(accounts).sort();
  if (known.length) {
    say("Which Google account?");
    known.forEach((e, i) => say(`  ${String(i + 1).padStart(2)}  ${wire(e)}`));
    say(`  ${String(known.length + 1).padStart(2)}  ${dim("a different account (opens a browser)")}`);
    const n = askNumber(fd, known.length + 1, "account number: ");
    if (n <= known.length) return known[n - 1];
  }

  const opener = process.env.AGENDA_BROWSER || "/usr/bin/open";
  const openBrowser = async (url) => {
    // Detached and unreferenced: the browser outlives this process and this
    // process must not wait on it. A failure to open is not fatal -- signIn keeps
    // listening and the URL can be pasted by hand.
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  };
  say(dim("opening a browser to sign in…"));
  const { email, refreshToken } = await signIn({ ...client, origin: ORIGIN, openBrowser });
  // Stored only once the whole flow has succeeded, so an abandoned or refused
  // sign-in leaves no half-connected account behind.
  putAccount(email, refreshToken, NOW);
  say(`signed in as ${bold(wire(email))}`);
  return email;
}

// --- rm and color ----------------------------------------------------------

function rm(slug) {
  refuseIfAgent("rm");
  if (!slug) die("`agenda rm <slug>` needs the name of a calendar. `agenda ls` lists them.");
  // EXACT match, deliberately unlike `note rm a3f9`: a note removed by mistake is
  // one line retyped, a calendar removed by mistake is the whole browser sign-in
  // again (DESIGN 2.2).
  //
  // Removing the calendar and dropping its cached events is ONE transaction --
  // the lock is reentrant for exactly this (FINDINGS 2026-08-27) -- so no reader
  // can catch a slug that is gone from the state and still in the cache.
  const removed = withLock(() => {
    const gone = removeCalendar(slug);
    if (gone) pruneCache(readState().calendars.map((c) => c.slug));
    return gone;
  });
  if (!removed) {
    const have = readState().calendars.map((c) => c.slug);
    die(`no calendar called \`${slug}\`.` +
        (have.length
          ? ` Configured: ${have.join(", ")}. The slug in full -- \`rm\` takes no prefixes.`
          : " None are configured."));
  }
  say(`${swatch(removed.colour)} ${bold(slug)} ${dim("removed")}  ${wire(removed.title || "")}`);
}

function color(slug) {
  refuseIfAgent("color");
  if (!slug) die("`agenda color <slug>` needs the name of a calendar. `agenda ls` lists them.");
  const { calendars } = readState();
  if (!calendars.some((c) => c.slug === slug)) die(`no calendar called \`${slug}\`. \`agenda ls\` lists them.`);
  // Its OWN current colour counts as taken, so a reroll actually rerolls: while a
  // free colour remains it is guaranteed to move, and past eight it may not.
  const colour = pickColour(calendars.map((c) => c.colour), randomInt(0, 1 << 30));
  setColour(slug, colour);
  say(`${swatch(colour)} ${bold(slug)}  ${dim(colour)}`);
}

// --- dispatch --------------------------------------------------------------

// A corrupt agenda.json is moved aside rather than silently replaced -- it holds
// the sign-ins, and discarding a refresh token costs two browser round trips
// (DESIGN 2.7). readState does the moving; saying so out loud is this side's job,
// because the pane cannot say anything.
const { corruptedTo } = readState();
if (corruptedTo) {
  console.error(`agenda: ${STATE_FILE} was unreadable and has been set aside as`);
  console.error(`        ${corruptedTo}. The calendars will need adding again.`);
}

const [verb, ...rest] = argv;

try {
  switch (verb) {
    case undefined:                 day(); break;
    case "ls": case "list":         ls(); break;
    case "add":                     await add(rest[0]); break;
    case "rm": case "remove":       rm(rest[0]); break;
    case "color": case "colour":    color(rest[0]); break;
    case "setup":
      refuseIfAgent("setup");
      setupFrom(rest[0] ?? askForPath());
      break;
    default:
      die(`unknown command \`${verb}\`. Try \`agenda help\`.`);
  }
} catch (e) {
  // Anything reaching here is a failure only the user can act on -- a refused
  // sign-in, a dead registration, an unreachable Google. One line and exit 1: a
  // stack trace belongs in the daemon log, not in a person's terminal.
  die(wire(e && e.message ? e.message : String(e)));
}
