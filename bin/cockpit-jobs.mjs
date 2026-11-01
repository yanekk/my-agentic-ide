#!/usr/bin/env node
// cockpit-jobs -- the world-touching half of agents started from a calendar: the
// ledger, `claude --bg`, the notes. What to do is cockpit-jobs-model's decision; this
// file only carries it out (calendar-agents DESIGN 3.1).
//
//   node bin/cockpit-jobs.mjs --once [--fetch] [--root DIR]
//     One tick outside the daemon. --fetch fetches the jobs calendars first.
//     --root is the projects root and notes key, default `repo` from panes.json.
//     COCKPIT_JOBS_DRY_RUN=1 prints the decisions and argv, and writes nothing: not
//     the ledger, not a note, not even the cache --fetch filled.
//
// The description is untrusted text from a calendar and may hold anything. It
// reaches only Claude's argv. A log line carries slug, project and state; execFile's
// error.message is never used anywhere, because it quotes the whole command line.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dayBounds, errorKind, normaliseEvent, safeText } from "./cockpit-agenda-model.mjs";
import { DIR, putCacheEntry, readCache, readClient, readState } from "./cockpit-agenda-store.mjs";
import { accessToken, describeError, fetchEvents } from "./cockpit-agenda-google.mjs";
import { decideJobs, noteText } from "./cockpit-jobs-model.mjs";
import { pruneLedger, readLedger, writeLedger } from "./cockpit-jobs-store.mjs";
import { addNote } from "./cockpit-notes.mjs";

const NOTE_AUTHOR = "calendar";
const START_LIMIT_MS = Number(process.env.COCKPIT_JOBS_START_LIMIT_MS) || 60_000;
const KILL_GRACE_MS = 2000;
const FETCH_BACK_MS = 7 * 24 * 60 * 60 * 1000;   // a bound, so a DST day does not matter

const dryRun = () => process.env.COCKPIT_JOBS_DRY_RUN === "1";

// --- small pieces ----------------------------------------------------------

/** A note failing must not cost the entries after it their start. */
function tell(notesRepo, text, log) {
  try { addNote(notesRepo, text, NOTE_AUTHOR); }
  catch (e) { log(`jobs: note failed, ${e?.name ?? "Error"}`); }
}

const slugOf = (key) => safeText(String(key).split("/")[0]);

/** Reads the ledger, and says so once if it had to be set aside. */
function loadLedger({ now, notesRepo, log }) {
  if (dryRun()) return readLedger({ now, rescue: false });
  const { corruptedTo, ...ledger } = readLedger({ now });
  if (corruptedTo) {
    log("jobs: ledger was corrupt, set aside");
    tell(notesRepo, noteText("corrupt", { path: corruptedTo }), log);
  }
  return ledger;
}

// --- running Claude --------------------------------------------------------

function firstLine(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/** Why it did not start, in words that quote nothing from the command line. */
function failureLine(err, stdout, stderr) {
  const said = firstLine(stderr) || firstLine(stdout);
  if (said) return said.slice(0, 200);
  if (err?.killed) return `no answer from claude after ${Math.round(START_LIMIT_MS / 1000)} s`;
  if (typeof err?.code === "number") return `claude exited with status ${err.code}`;
  return `could not run claude (${safeText(String(err?.code ?? err?.name ?? "error"))})`;
}

/**
 * Resolves { ok, agentId?, line? }; never rejects. execFile, no shell: the
 * description is untrusted. It can also throw synchronously (a NUL byte in an
 * argument, measured in T02), which by then has `starting` on disk, so that is a
 * plain failure too.
 */
function runClaude(job) {
  return new Promise((resolve) => {
    let hardStop;
    const finish = (err, stdout = "", stderr = "") => {
      clearTimeout(hardStop);
      if (err) return resolve({ ok: false, line: failureLine(err, stdout, stderr) });
      const m = /backgrounded\s*·\s*([A-Za-z0-9_-]+)\s*·/.exec(`${stdout}\n${stderr}`);
      resolve({ ok: true, agentId: m ? m[1] : undefined });
    };
    try {
      const child = execFile("claude", job.args, { cwd: job.cwd, timeout: START_LIMIT_MS }, finish);
      // An open stdin pipe is not what the plan's probes ran with, and nothing will
      // ever write to it.
      child.stdin?.on("error", () => {});
      child.stdin?.end();
      // execFile's limit only sends SIGTERM and its callback waits for the exit, so a
      // claude that ignores it would hold the tick's guard up and stop every later start.
      hardStop = setTimeout(() => child.kill("SIGKILL"), START_LIMIT_MS + KILL_GRACE_MS);
    } catch (e) {
      finish(e);
    }
  });
}

// --- the tick --------------------------------------------------------------

/**
 * One note per auth or gone episode; a success ends the episode. Returns the notes
 * for the caller to add once the ledger is written: told first, a ledger that cannot
 * be written would repeat the note on every tick.
 */
function fetchFailureNotes(calendars, cache, ledger, { log, dry, print }) {
  let changed = false;
  const texts = [];
  for (const cal of calendars) {
    const entry = cache.calendars?.[cal.slug];
    if (!entry) continue;
    if (entry.error == null) {
      if (entry.fetchedAt > 0 && ledger.authNoted[cal.slug]) {
        delete ledger.authNoted[cal.slug];
        changed = true;
      }
      continue;
    }
    const kind = errorKind(entry.error);
    // `scope` is an auth failure with its own wording in the column; its repair is
    // the same `agenda add`, so it is the same note.
    const note = kind === "gone" ? "gone" : kind === "auth" || kind === "scope" ? "auth" : null;
    if (!note || ledger.authNoted[cal.slug]) continue;
    const text = noteText(note, { slug: cal.slug });
    log(`jobs: ${safeText(cal.slug)} ${note}`);
    if (dry) { print(`would note: ${text}`); continue; }
    ledger.authNoted[cal.slug] = true;
    changed = true;
    texts.push(text);
  }
  return { changed, texts };
}

let ticking = false;

/**
 * One pass. Never rejects: this runs unattended behind a window. Starts run one after
 * another, so each ledger write is whole and a tick's own writes cannot interleave.
 *
 * `cache` and `print` are for --once: a dry run's fetch stays in memory, and only the
 * command has a person reading its output. The daemon's stdout is daemon.log, which
 * gets pasted into conversations, so with no `print` the dry run's argv goes nowhere.
 */
export async function jobsTick({ now, projectsRoot, zone, notesRepo, log = () => {}, cache, print = () => {} }) {
  if (ticking) return;
  ticking = true;
  try {
    const dry = dryRun();
    // rescue: false. A timer must not quarantine a corrupt agenda.json with nobody
    // to tell; that reads as no calendars, so nothing happens.
    const calendars = readState({ rescue: false }).calendars.filter((c) => c.jobs === true);
    // Nothing is even read until a calendar is marked: the feature costs nothing and
    // leaves no file until it is used.
    if (calendars.length === 0) { if (dry) print("no jobs calendars"); return; }

    const ctx = { now, notesRepo, log };
    const seen = cache ?? readCache();
    const ledger = pruneLedger(loadLedger(ctx), now);
    const failures = fetchFailureNotes(calendars, seen, ledger, { log, dry, print });
    let changed = failures.changed;

    const decision = decideJobs({
      calendars, cache: seen, ledger, now, projectsRoot, zone,
      projectExists: (name) => fs.existsSync(path.join(projectsRoot, name, ".git")),
    });

    if (dry) {
      for (const c of decision.ledgerChanges) print(`would record ${c.key}: ${c.state}${c.reason ? ` (${c.reason})` : ""}`);
      for (const n of decision.notes) print(`would note: ${n.text}`);
      for (const s of decision.start) {
        print(`would start ${s.key} in ${s.cwd}`);
        print(`  argv: ${JSON.stringify(["claude", ...s.args])}`);
        log(`jobs: dry run, ${slugOf(s.key)} ${s.project} would start`);
      }
      if (!decision.ledgerChanges.length && !decision.start.length) print("nothing to start");
      return;
    }

    // Recorded before it is told: a crash between the two loses a note, where the
    // other order would repeat one on every restart.
    for (const c of decision.ledgerChanges) {
      ledger.entries[c.key] = { state: c.state, at: now, ...(c.reason ? { reason: c.reason } : {}) };
      changed = true;
      log(`jobs: ${slugOf(c.key)} ${c.state}`);
    }
    if (changed) writeLedger(ledger);
    for (const text of failures.texts) tell(notesRepo, text, log);
    for (const n of decision.notes) tell(notesRepo, n.text, log);

    for (const job of decision.start) {
      // Throws if it cannot be written, which ends the pass with Claude not run: an
      // agent the ledger does not know about could start again on the next tick.
      ledger.entries[job.key] = { state: "starting", at: now, project: job.project };
      writeLedger(ledger);
      log(`jobs: ${slugOf(job.key)} ${job.project} starting`);

      const result = await runClaude(job);
      if (result.ok) {
        ledger.entries[job.key] = {
          state: "started", at: now, project: job.project,
          ...(result.agentId ? { agentId: result.agentId } : {}),
        };
        writeLedger(ledger);
        log(`jobs: ${slugOf(job.key)} ${job.project} started`);
      } else {
        ledger.entries[job.key] = { state: "failed", at: now, project: job.project, reason: result.line };
        writeLedger(ledger);
        log(`jobs: ${slugOf(job.key)} ${job.project} failed`);
        tell(notesRepo, noteText("failed", { title: job.project, line: result.line }), log);
      }
    }
  } catch (e) {
    // The constructor name only: the message can carry anything.
    log(`jobs: tick failed, ${e?.name ?? "Error"}`);
  } finally {
    ticking = false;
  }
}

/**
 * Once at daemon start, before the first tick. A leftover `starting` may or may not
 * have become an agent, so it is reported and never retried: a rare missed run is
 * preferred to any chance of a second one (DESIGN 2.7).
 */
export function recoverStarting({ now, notesRepo, log = () => {} }) {
  try {
    const ledger = loadLedger({ now, notesRepo, log });
    const left = Object.entries(ledger.entries).filter(([, e]) => e?.state === "starting");
    if (left.length === 0 || dryRun()) return;
    for (const [key, e] of left) {
      ledger.entries[key] = { ...e, state: "unknown", at: now };
      log(`jobs: ${slugOf(key)} ${safeText(String(e.project ?? ""))} unknown`);
    }
    writeLedger(ledger);
    for (const [, e] of left) tell(notesRepo, noteText("unknown", { title: e.project }), log);
  } catch (e) {
    log(`jobs: recovery failed, ${e?.name ?? "Error"}`);
  }
}

// --- fetching, for --once --------------------------------------------------

/**
 * The daemon's fetch for jobs calendars (T05 wires its own into refreshAgenda): seven
 * days back so an entry that ended while the window was closed is still reported, and
 * the job fields on. Returns the cache as it now reads; written only when not a dry run.
 */
export async function fetchJobCalendars({ now, zone, log = () => {} }) {
  const origin = process.env.AGENDA_ORIGIN || "";
  const dry = dryRun();
  const { accounts, calendars } = readState({ rescue: false });
  const cache = readCache();
  const client = readClient();
  if (!client) { log("jobs: no client registration, nothing fetched"); return cache; }
  const { todayStart, dayAfterStart } = dayBounds(now, { tz: zone });

  for (const cal of calendars.filter((c) => c.jobs === true)) {
    const prev = cache.calendars[cal.slug];
    let entry;
    try {
      const refreshToken = accounts[cal.account]?.refreshToken;
      if (!refreshToken) { log(`jobs: ${safeText(cal.slug)} has no sign-in`); continue; }
      const { token } = await accessToken({ ...client, refreshToken, origin, now });
      const { events: raw, timeZone } = await fetchEvents({
        token, calendarId: cal.calendarId, timeMin: todayStart - FETCH_BACK_MS, timeMax: dayAfterStart, origin,
      });
      const events = raw
        .map((r) => normaliseEvent(r, { slug: cal.slug, tz: timeZone || zone, selfEmail: cal.account, jobs: true }))
        .filter(Boolean);
      entry = { fetchedAt: now, events, error: null };
      log(`jobs: ${safeText(cal.slug)} fetched, ${events.length} events`);
    } catch (e) {
      entry = {
        fetchedAt: prev?.fetchedAt ?? 0,
        events: prev?.events ?? [],
        error: { ...describeError(e), since: Number(prev?.error?.since) || now },
      };
      log(`jobs: ${safeText(cal.slug)} fetch failed, ${entry.error.kind}`);
    }
    cache.calendars[cal.slug] = entry;
    if (!dry) putCacheEntry(cal.slug, entry);
  }
  return cache;
}

// --- the command -----------------------------------------------------------

function panesRoot() {
  try {
    const repo = JSON.parse(fs.readFileSync(path.join(DIR, "panes.json"), "utf8")).repo;
    return typeof repo === "string" && repo ? repo : null;
  } catch { return null; }
}

const USAGE = "usage: cockpit-jobs.mjs --once [--fetch] [--root DIR]";

async function main(argv) {
  let once = false, fetch = false, root = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--once") once = true;
    else if (argv[i] === "--fetch") fetch = true;
    else if (argv[i] === "--root" && argv[i + 1]) root = argv[++i];
    else { console.error(USAGE); return 2; }
  }
  if (!once) { console.error(USAGE); return 2; }
  root = root ?? panesRoot();
  // Notes are keyed by this string, and the column reads the absolute one.
  root = root && path.resolve(root);
  if (!root) { console.error("no projects root: pass --root, or run where panes.json exists"); return 2; }

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = Date.now();
  let failed = false;
  // jobsTick never rejects, so the command learns of a failed pass from its log line.
  const log = (line) => { if (/tick failed/.test(line)) failed = true; console.error(line); };
  const cache = fetch ? await fetchJobCalendars({ now, zone, log }) : undefined;
  await jobsTick({ now, projectsRoot: root, zone, notesRepo: root, log, cache, print: (l) => console.log(l) });
  return failed ? 1 : 0;
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
