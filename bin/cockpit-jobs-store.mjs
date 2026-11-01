// cockpit-jobs-store -- the ledger of calendar entries already decided.
//
//   ~/.claude/cockpit/calendar-jobs.json  0600
//   { version: 1, notBefore?: epochMs,
//     entries: { "{slug}/{eventId}": { state, at, project?, agentId?, reason? } },
//     authNoted: { "{slug}": true } }
//
// One writer, the daemon, so it is lockless like bitbucket-cache.json; temp-then-
// rename means a crash mid-write leaves the previous file (calendar-agents DESIGN
// 3.5). This file is what stands between a restart and a second unattended agent,
// so every failure here errs towards starting nothing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
export const LEDGER_FILE = path.join(DIR, "calendar-jobs.json");

const MODE = 0o600;
const PRUNE_MS = 30 * 24 * 60 * 60 * 1000;   // safe: fetches reach back only 7 days

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** The parsed ledger, or null when the text is not one. */
function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isObject(data) || !isObject(data.entries)) return null;
  return {
    version: 1,
    ...(Number.isFinite(data.notBefore) ? { notBefore: data.notBefore } : {}),
    entries: data.entries,
    authNoted: isObject(data.authNoted) ? data.authNoted : {},
  };
}

/**
 * Always a usable ledger, or a throw. Only an ABSENT file reads as empty: a file we
 * merely failed to read still holds the decisions, and reading it as empty would
 * re-run every entry inside its window. So that throws, and the tick starts nothing.
 *
 * A corrupt file is copied aside and the fresh ledger renamed over it, rather than
 * moved and then written: a crash between those two steps would leave no file, which
 * reads as empty and loses notBefore. Here a crash leaves the corrupt file, which is
 * simply found corrupt again. `now` is what notBefore becomes.
 *
 * `rescue: false` touches nothing, for a dry run: the ledger reads as a fresh one
 * with notBefore set, which is what a real tick would decide against.
 */
export function readLedger({ now = Date.now(), rescue = true } = {}) {
  let text;
  try { text = fs.readFileSync(LEDGER_FILE, "utf8"); }
  catch (e) {
    if (e.code === "ENOENT") return { version: 1, entries: {}, authNoted: {} };
    throw e;
  }
  const ledger = parse(text);
  if (ledger) return ledger;

  const fresh = { version: 1, notBefore: now, entries: {}, authNoted: {} };
  if (!rescue) return fresh;
  const corruptedTo = `${LEDGER_FILE}.corrupt-${now}`;
  fs.copyFileSync(LEDGER_FILE, corruptedTo);
  fs.chmodSync(corruptedTo, MODE);
  writeLedger(fresh);
  return { ...fresh, corruptedTo };
}

/** Temp plus rename, 0600. Throws: a tick that cannot record `starting` must not start. */
export function writeLedger(ledger) {
  fs.mkdirSync(DIR, { recursive: true });
  const { version = 1, notBefore, entries, authNoted } = ledger;
  const tmp = `${LEDGER_FILE}.${process.pid}.tmp`;
  const data = { version, ...(notBefore === undefined ? {} : { notBefore }), entries, authNoted };
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: MODE });
  // writeFileSync's mode applies only on creation and is masked by umask.
  fs.chmodSync(tmp, MODE);
  fs.renameSync(tmp, LEDGER_FILE);
}

/** A new ledger without entries older than 30 days. */
export function pruneLedger(ledger, now) {
  const entries = Object.fromEntries(
    Object.entries(ledger.entries).filter(([, e]) => !(now - Number(e?.at) > PRUNE_MS)),
  );
  return { ...ledger, entries };
}
