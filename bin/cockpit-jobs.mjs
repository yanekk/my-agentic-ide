#!/usr/bin/env node
// cockpit-jobs -- the world-touching half of agents started from a calendar: the
// ledger, `claude --bg`, the notes. What to do is cockpit-jobs-model's decision; this
// file only carries it out (calendar-agents DESIGN 3.1).
//
//   node bin/cockpit-jobs.mjs --once [--fetch] [--root DIR]
//     One tick outside the daemon. --fetch fetches the jobs calendars first.
//     --root is the projects root and notes key, default `repo` from panes.json.
//     COCKPIT_JOBS_DRY_RUN=1 prints the decisions, argv and each start's settings, and
//     writes nothing: not the ledger, not a note, not even the cache --fetch filled.
//
//   node bin/cockpit-jobs.mjs --trial --project NAME --root DIR [--limit-min 10] --commands-file FILE
//     Runs the commands in the project's wall, in a throwaway worktree (DESIGN 2.10).
//     Prints the agent's final message. Exit 0 it ran (blocks are in the text), 1 it
//     could not run, 2 usage. No ledger, no note, no calendar. The dry run prints the
//     argv and makes nothing.
//
// The description is untrusted text from a calendar and may hold anything. It
// reaches only Claude's argv. A log line carries slug, project and state; execFile's
// error.message is never used anywhere, because it quotes the whole command line.

import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dayBounds, errorKind, normaliseEvent, safeText } from "./cockpit-agenda-model.mjs";
import { DIR, putCacheEntry, readCache, readClient, readState } from "./cockpit-agenda-store.mjs";
import { accessToken, describeError, fetchEvents } from "./cockpit-agenda-google.mjs";
import { buildTrialArgs, decideJobs, noteText, validProjectName } from "./cockpit-jobs-model.mjs";
import { buildWallSettings } from "./cockpit-wall-model.mjs";
import { readWall } from "./cockpit-wall-store.mjs";
import { pruneLedger, readLedger, writeLedger } from "./cockpit-jobs-store.mjs";
import { addNote } from "./cockpit-notes.mjs";

const NOTE_AUTHOR = "calendar";
const START_LIMIT_MS = Number(process.env.COCKPIT_JOBS_START_LIMIT_MS) || 60_000;
const KILL_GRACE_MS = 2000;
const FETCH_BACK_MS = 7 * 24 * 60 * 60 * 1000;   // a bound, so a DST day does not matter
const WALL_CMD_LIMIT_MS = 5000;   // decideJobs is synchronous, so these hold up the daemon
const GUARD_PATH = fileURLToPath(new URL("./cockpit-jobs-guard.mjs", import.meta.url));

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

// --- the wall's facts (calendar-agent-sandbox DESIGN 3.4) ----------------------

// An inherited GIT_DIR would answer for some other repo. The ceiling stops a broken
// project's .git falling through to a repo around it, whose refs would then be the
// ones "protected" while this project's stay open.
function envWithoutGit() {
  const { GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR, GIT_INDEX_FILE, ...env } = process.env;
  return env;
}

function gitEnv(projectDir) {
  // Physical, as git's own cwd is: a project that is a symlink would walk up past a logical one.
  return { ...envWithoutGit(), GIT_CEILING_DIRECTORIES: path.dirname(fs.realpathSync(projectDir)) };
}

function git(projectDir, args) {
  return execFileSync("git", args, {
    cwd: projectDir, encoding: "utf8", timeout: WALL_CMD_LIMIT_MS, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    env: gitEnv(projectDir),
  });
}

/** scp form, URL form, or null for a remote on this disk. */
function remoteHost(url) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try { return new URL(url).hostname.replace(/^\[|\]$/g, "") || null; } catch { return null; }
  }
  if (url.startsWith("/") || url.startsWith(".")) return null;
  return /^(?:[^@/:]+@)?([^/:]+):/.exec(url)?.[1] ?? null;
}

/**
 * What buildWallSettings needs to know about one start. Throws when git does: a start
 * with an empty branch list would look confined and leave every branch movable. Its
 * message can quote a remote's URL and a token in it, so a catcher must not repeat it.
 */
export function wallFacts(project, worktreeName, { projectsRoot, home }) {
  const dir = path.join(projectsRoot, project);
  // Absolute: a main checkout answers a relative `.git`, and denyWrite would miss the refs.
  const commonDir = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  if (!commonDir) throw new Error("no git dir");
  // denyWrite protects ref files, and a reftable repo has none: every branch would look
  // protected and stay movable. Denying reftable/ would stop the agent's own commits.
  if (fs.existsSync(path.join(commonDir, "reftable"))) {
    throw Object.assign(new Error("reftable"), { line: "this project stores its branches in a format the wall cannot protect" });
  }
  // The full name: refname:short answers `heads/x` when a tag is also called x.
  const branches = git(dir, ["for-each-ref", "--format=%(refname)", "refs/heads"])
    .split("\n").filter(Boolean).map((r) => r.replace(/^refs\/heads\//, ""));
  const urls = git(dir, ["remote", "-v"]).split("\n").filter(Boolean)
    .map((l) => (l.split("\t")[1] ?? "").replace(/ \((?:fetch|push)\)(?: \[.*\])?$/, ""));
  const wall = readWall();
  const row = wall.projects[project];
  const rowOk = row == null || (typeof row === "object" && !Array.isArray(row));
  return {
    worktree: path.join(dir, ".claude", "worktrees", worktreeName),
    home, commonDir, branches,
    remoteHosts: [...new Set(urls.map(remoteHost).filter(Boolean))],
    exceptions: rowOk ? row ?? {} : {},
    listUnreadable: wall.unreadable || !rowOk,
  };
}

/**
 * Can a wall be set up at all? --bg returns before the session starts, so
 * failIfUnavailable alone might not reach the tick (DESIGN 2.9). sandbox-exec is found
 * on PATH, so a test can stub it. The words go into a note.
 */
export function preflight({ guardPath }) {
  try { fs.accessSync(guardPath, fs.constants.R_OK); }
  catch { return { ok: false, line: "the guard script cannot be read" }; }
  try {
    execFileSync("sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"], {
      timeout: WALL_CMD_LIMIT_MS, stdio: "ignore",
    });
  } catch { return { ok: false, line: "the sandbox did not run" }; }
  return { ok: true };
}

/**
 * The wallFor decideJobs asks. The preflight runs at the first question, so only a pass
 * with an entry due pays for it, and once however many are due. Build one per pass.
 */
export function buildWallFor({ projectsRoot, home, guardPath = GUARD_PATH }) {
  let check;
  return (project, worktreeName) => {
    check ??= preflight({ guardPath });
    if (!check.ok) return { unavailable: check.line };
    let facts;
    try { facts = wallFacts(project, worktreeName, { projectsRoot, home }); }
    catch (e) { return { unavailable: e.line ?? "git could not read this project" }; }
    const { listUnreadable, ...rest } = facts;
    return { ...buildWallSettings({ ...rest, guardPath }), listUnreadable };
  };
}

let ticking = false;

/**
 * One pass. Never rejects: this runs unattended behind a window. Starts run one after
 * another, so each ledger write is whole and a tick's own writes cannot interleave.
 *
 * `cache` and `print` are for --once: a dry run's fetch stays in memory, and only the
 * command has a person reading its output. The daemon's stdout is daemon.log, which
 * gets pasted into conversations, so with no `print` the dry run's argv goes nowhere.
 * `guardPath` is for the tests; the real one is beside this file.
 */
export async function jobsTick({ now, projectsRoot, zone, notesRepo, log = () => {}, cache, print = () => {}, guardPath = GUARD_PATH }) {
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
      wallFor: buildWallFor({ projectsRoot, home: os.homedir(), guardPath }),
    });

    if (dry) {
      for (const c of decision.ledgerChanges) print(`would record ${c.key}: ${c.state}${c.reason ? ` (${c.reason})` : ""}`);
      for (const n of decision.notes) print(`would note: ${n.text}`);
      for (const s of decision.start) {
        print(`would start ${s.key} in ${s.cwd}`);
        print(`  argv: ${JSON.stringify(["claude", ...s.args])}`);
        // Again on its own, because a person reads the wall here and the argv is one line.
        print(`  settings: ${JSON.stringify(JSON.parse(s.args[s.args.indexOf("--settings") + 1]), null, 2)}`);
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
      // The title is kept for recoverStarting, whose note must quote it after a restart.
      ledger.entries[job.key] = { state: "starting", at: now, project: job.project, title: job.title };
      writeLedger(ledger);
      log(`jobs: ${slugOf(job.key)} ${job.project} starting`);

      const result = await runClaude(job);
      if (result.ok) {
        ledger.entries[job.key] = {
          state: "started", at: now, project: job.project, title: job.title,
          ...(result.agentId ? { agentId: result.agentId } : {}),
        };
        writeLedger(ledger);
        log(`jobs: ${slugOf(job.key)} ${job.project} started`);
      } else {
        ledger.entries[job.key] = { state: "failed", at: now, project: job.project, title: job.title, reason: result.line };
        writeLedger(ledger);
        log(`jobs: ${slugOf(job.key)} ${job.project} failed`);
        tell(notesRepo, noteText("failed", { title: job.title, line: result.line }), log);
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
    for (const [, e] of left) tell(notesRepo, noteText("unknown", { title: e.title ?? e.project }), log);
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

// --- the trial (DESIGN 2.10) -------------------------------------------------

const TRIAL_ADD_LIMIT_MS = 5 * 60 * 1000;   // checking out a large project is slow
const TRIAL_OUTPUT_MAX = 64 * 1024 * 1024;
const TRIAL_DRAIN_MS = 500;
const TRIAL_LIMIT_MAX_MIN = Math.floor((2 ** 31 - 1) / 60_000);   // past this setTimeout fires at once

/**
 * One child in its own process group, so whatever it started goes with it: those would
 * hold the throwaway folder, and a killed claude's Bash children would run on. The group
 * also keeps a terminal's Ctrl+C from killing git before cleanup is ready.
 * spawn and not execFile, which drops `detached` (measured: the child stayed in our group
 * and the group kill found nothing). No shell, all the same.
 * Resolves { err, stdout, stderr, timedOut }; never rejects.
 */
function runInGroup(file, args, { cwd, env, limitMs, stops }) {
  return new Promise((resolve) => {
    let timedOut = false, limit, hardStop, drain, child, failure = null;
    const out = [], errs = [];
    const signal = (name) => { try { process.kill(-child.pid, name); } catch { /* already gone */ } };
    const stop = () => {
      clearTimeout(hardStop);
      signal("SIGTERM");
      hardStop = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
    };
    const finish = () => {
      clearTimeout(limit); clearTimeout(hardStop); clearTimeout(drain);
      stops.delete(stop);
      const stdout = Buffer.concat(out).toString("utf8");
      resolve({ err: failure, stdout, stderr: Buffer.concat(errs).toString("utf8"), timedOut });
    };
    try {
      child = spawn(file, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      failure = e;   // a NUL byte in a command throws here
      return finish();
    }
    let room = TRIAL_OUTPUT_MAX;
    const keep = (into) => (chunk) => { if (room > 0) { into.push(chunk); room -= chunk.length; } };
    child.stdout.on("data", keep(out));
    child.stderr.on("data", keep(errs));
    child.on("error", (e) => { failure = e; finish(); });
    stops.add(stop);
    limit = setTimeout(() => { timedOut = true; stop(); }, limitMs);
    // The pipes close only when everyone holding them has gone, and a leftover process
    // can hold them for ever. The child's exit decides, then the leftovers and pipes go.
    child.on("exit", (code, sig) => {
      clearTimeout(hardStop);
      if (code !== 0) failure = Object.assign(new Error("failed"), { code: code ?? sig });
      signal("SIGKILL");
      drain = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, TRIAL_DRAIN_MS);
    });
    child.on("close", finish);
  });
}

/**
 * Takes the worktree, its branch and any folder the trial had to make. Sync, so nothing
 * can come between a signal and it. Returns what is still there, for the caller to say.
 */
function removeTrial({ dir, worktree, branch, madeDirs }) {
  const quiet = (args) => {
    // Detached: a second Ctrl+C must not kill the git doing the cleaning up.
    try { execFileSync("git", args, { cwd: dir, env: gitEnv(dir), stdio: "ignore", detached: true, timeout: 60_000 }); return true; }
    catch { return false; }
  };
  if (fs.existsSync(worktree) && !quiet(["worktree", "remove", "--force", "--force", worktree])) {
    try { fs.rmSync(worktree, { recursive: true, force: true }); } catch { /* reported below */ }
  }
  quiet(["worktree", "prune"]);
  quiet(["branch", "-D", branch]);
  for (const d of madeDirs) { try { fs.rmdirSync(d); } catch { /* something else uses it */ } }
  const left = [];
  if (fs.existsSync(worktree)) left.push(worktree);
  if (quiet(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) left.push(`branch ${branch}`);
  return left;
}

/** Reads the commands; null when there is no usable list. The text goes nowhere but argv. */
function readCommands(file) {
  try {
    const commands = fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    return commands.length ? commands : null;
  } catch { return null; }
}

function parseTrialArgs(argv) {
  const out = { limitMin: 10 };
  for (let i = 0; i < argv.length; i++) {
    const has = argv[i + 1] != null;
    if (argv[i] === "--trial") continue;
    if (argv[i] === "--project" && has) out.project = argv[++i];
    else if (argv[i] === "--root" && has) out.root = argv[++i];
    else if (argv[i] === "--commands-file" && has) out.file = argv[++i];
    else if (argv[i] === "--limit-min" && has) out.limitMin = Number(argv[++i]);
    else return null;
  }
  return out.project != null && out.root && out.file && out.limitMin > 0 && out.limitMin <= TRIAL_LIMIT_MAX_MIN ? out : null;
}

async function trialCommand(argv) {
  const opts = parseTrialArgs(argv);
  if (!opts) { console.error(USAGE); return 2; }
  if (!validProjectName(opts.project)) { console.error("that is not a project name"); return 2; }
  const commands = readCommands(opts.file);
  if (!commands) { console.error("no commands: the file is missing, unreadable or empty"); return 2; }

  const root = path.resolve(opts.root);
  const dir = path.join(root, opts.project);
  if (!fs.existsSync(path.join(dir, ".git"))) { console.error(`no project folder is named "${opts.project}"`); return 1; }

  const id = randomBytes(4).toString("hex");
  const name = `wall-trial-${id}`;
  const wall = buildWallFor({ projectsRoot: root, home: os.homedir() })(opts.project, name);
  if (!wall.settings) { console.error(`the wall could not be set up: ${wall.unavailable}`); return 1; }
  // Said here and not as notes: a trial leaves none, and a person is reading this.
  if (wall.listUnreadable) console.error("the wall exceptions list could not be read, so this trial has none");
  for (const d of wall.dropped ?? []) console.error(`a wall exception was ignored because it is not allowed: ${safeText(String(d.value))}`);

  const args = buildTrialArgs({ settings: wall.settings, commands });
  if (dryRun()) {
    console.log(`would run a trial in ${path.join(dir, ".claude", "worktrees", name)}`);
    console.log(`  argv: ${JSON.stringify(["claude", ...args])}`);
    return 0;
  }

  const worktree = path.join(dir, ".claude", "worktrees", name);
  // `.claude` and its `worktrees` may be new here, and a copy must not leave them behind.
  const madeDirs = [path.join(dir, ".claude", "worktrees"), path.join(dir, ".claude")].filter((d) => !fs.existsSync(d));

  let stoppedBy = null;
  const stops = new Set();
  // Stays installed through the cleanup: a second signal must not cut that short.
  const onSignal = (sig) => { stoppedBy ??= sig; for (const stop of stops) stop(); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let code = 1, report = null, line = null;
  try {
    const add = await runInGroup("git", ["worktree", "add", "-q", "-b", name, worktree, "HEAD"], {
      cwd: dir, env: gitEnv(dir), limitMs: TRIAL_ADD_LIMIT_MS, stops,
    });
    if (add.err) line = "git could not make the throwaway worktree";
    else if (!stoppedBy) {
      const run = await runInGroup("claude", args, {
        // An inherited GIT_DIR would point the agent's git at some other repo, outside the throwaway copy.
        cwd: worktree, env: envWithoutGit(), limitMs: opts.limitMin * 60_000, stops,
      });
      // -p prints only at its end, so what a killed run wrote is not a report.
      if (run.timedOut) line = `the trial passed its ${opts.limitMin} minute limit and was stopped, so it has no report`;
      else if (run.err) line = failureLine(run.err, "", run.stderr);
      else if (!run.stdout.trim()) line = "claude finished without a final message";
      else { report = run.stdout; code = 0; }
    }
  } finally {
    const left = removeTrial({ dir, worktree, branch: name, madeDirs });
    if (left.length) console.error(`the trial could not remove: ${left.join(", ")}`);
  }
  if (stoppedBy) { console.error(`the trial was stopped by ${stoppedBy}`); return 1; }
  // safeText: this is claude's own stderr, and a person's terminal obeys escapes in it.
  if (line) console.error(safeText(line));
  if (report != null) process.stdout.write(report);
  return code;
}

// --- the command -----------------------------------------------------------

function panesRoot() {
  try {
    const repo = JSON.parse(fs.readFileSync(path.join(DIR, "panes.json"), "utf8")).repo;
    return typeof repo === "string" && repo ? repo : null;
  } catch { return null; }
}

const USAGE = "usage: cockpit-jobs.mjs --once [--fetch] [--root DIR]\n"
  + "       cockpit-jobs.mjs --trial --project NAME --root DIR [--limit-min 10] --commands-file FILE";

async function main(argv) {
  if (argv.includes("--trial")) return trialCommand(argv);
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
