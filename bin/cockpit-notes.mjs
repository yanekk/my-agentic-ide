// cockpit-notes — the notes store, shared by the `note` command and the pane
// that renders it.
//
// A note is ONE LINE of text with a stable short id, a timestamp and an author.
// That is the whole model: the notes column in the fleet view is half a pane
// wide, and anything with a body would only ever show its first line there while
// the real content hid in a terminal. Keeping it one line means what you read on
// screen IS the note.
//
// Notes live in ~/.claude/cockpit/notes.json, keyed by REPO ROOT -- not in the
// repo. A checked-in notes file would show up in the very diff the agent is
// being reviewed on (`revdiff --untracked HEAD`), so every note you wrote would
// become a change the agent thinks it has to explain.
//
//   { "version": 1, "repos": { "/Users/you/src/proj": [ note, ... ] } }
//   note = { id, text, ts, author }        author: null = you, else agent name
//
// Written atomically (temp + rename) like every other cockpit state file, so the
// renderers can watch the DIRECTORY and never go deaf on a replaced inode. Agents
// can write notes too (see cockpit-note.mjs), so writes also take a lock: two
// processes doing read-modify-write on the same JSON would otherwise lose one.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
export const NOTES_FILE = path.join(DIR, "notes.json");
const LOCK_FILE = path.join(DIR, "notes.lock");
const PANES_FILE = path.join(DIR, "panes.json");

/**
 * Which repo's notes are we looking at?
 *
 * COCKPIT_REPO is exported into every cockpit-spawned shell (and inherited by the
 * agents running under the fleet pane), so it is the authoritative answer and the
 * one that works from an agent's WORKTREE -- where `git rev-parse --show-toplevel`
 * would answer with the worktree path and split the notes into a second list.
 * panes.json is the fallback for the renderers, which are display panes and get
 * no env of their own.
 */
export function cockpitRepo() {
  if (process.env.COCKPIT_REPO) return normRepo(process.env.COCKPIT_REPO);
  try {
    const repo = JSON.parse(fs.readFileSync(PANES_FILE, "utf8")).repo;
    if (typeof repo === "string" && repo) return normRepo(repo);
  } catch { /* not inside a cockpit, or it has not written panes.json yet */ }
  return null;
}

const normRepo = (s) => s.replace(/\/+$/, "") || "/";

function readFile() {
  try {
    const data = JSON.parse(fs.readFileSync(NOTES_FILE, "utf8"));
    if (data && typeof data === "object" && data.repos) return data;
  } catch { /* absent or corrupt: start clean rather than crash the pane */ }
  return { version: 1, repos: {} };
}

/** `repo`'s notes, NEWEST FIRST. Always a fresh array -- callers mutate it. */
export function readNotes(repo) {
  const list = readFile().repos[normRepo(repo)];
  if (!Array.isArray(list)) return [];
  return list
    .filter((n) => n && typeof n.id === "string" && typeof n.text === "string")
    .map((n) => ({ id: n.id, text: n.text, ts: Number(n.ts) || 0, author: n.author ?? null }))
    .sort((a, b) => b.ts - a.ts);
}

// --- writing ---------------------------------------------------------------
// Every mutation is read-modify-write under a lock, because agents share this
// file with you: two `note add`s landing together would otherwise read the same
// list and the second would write the first one away.

const LOCK_STALE_MS = 5000;
const LOCK_TRIES = 40;
const LOCK_WAIT_MS = 25;

function withLock(fn) {
  let fd = null;
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
  try {
    return fn();
  } finally {
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

function mutate(repo, fn) {
  return withLock(() => {
    const data = readFile();
    const key = normRepo(repo);
    const list = Array.isArray(data.repos[key]) ? data.repos[key] : [];
    const result = fn(list);
    data.repos[key] = list;
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${NOTES_FILE}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tmp, NOTES_FILE);
    return result;
  });
}

/**
 * Mint an id that is short enough to retype from the screen and stable across
 * edits -- so a hash you read off the notes column keeps working after you change
 * the text. Random rather than a hash OF the text for exactly that reason.
 */
function mintId(list) {
  const taken = new Set(list.map((n) => n.id));
  for (let i = 0; i < 16; i++) {
    const width = i < 8 ? 4 : 6;
    const id = crypto.randomBytes(4).toString("hex").slice(0, width);
    if (!taken.has(id)) return id;
  }
  return crypto.randomBytes(8).toString("hex");
}

/** Notes are one line: a pasted paragraph becomes one line rather than an error. */
export const oneLine = (s) => s.replace(/\s+/g, " ").trim();

export function addNote(repo, text, author = null) {
  return mutate(repo, (list) => {
    const note = { id: mintId(list), text: oneLine(text), ts: Date.now(), author: author || null };
    list.push(note);
    return note;
  });
}

export function editNote(repo, id, text) {
  return mutate(repo, (list) => {
    const note = list.find((n) => n.id === id);
    if (!note) return null;
    note.text = oneLine(text);
    return note;
  });
}

export function removeNote(repo, id) {
  return mutate(repo, (list) => {
    const i = list.findIndex((n) => n.id === id);
    if (i === -1) return null;
    return list.splice(i, 1)[0];
  });
}

/**
 * Resolve what was typed to exactly one note, accepting any unique PREFIX of an
 * id. Returns { note } / { error }, never a guess: acting on the wrong note is
 * worse than asking again.
 */
export function resolve(notes, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return { error: "which note? pass an id from the left column" };
  const exact = notes.find((n) => n.id === q);
  if (exact) return { note: exact };
  const hits = notes.filter((n) => n.id.startsWith(q));
  if (hits.length === 1) return { note: hits[0] };
  if (hits.length > 1) return { error: `'${q}' matches ${hits.map((n) => n.id).join(", ")}` };
  return { error: `no note '${q}'` };
}

// --- dates -----------------------------------------------------------------
// The column is sorted newest first, so the date only has to say "how fresh" at a
// glance: minutes and hours while the note is from today, a weekday within the
// week, a calendar date beyond it.

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function relTime(ts, now = Date.now()) {
  const d = new Date(ts);
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 7 * 86400) return DAY[d.getDay()];
  return `${MONTH[d.getMonth()]} ${d.getDate()}`;
}

export function absTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
