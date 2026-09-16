// cockpit-usage-store -- the one place that reads and writes usage-cache.json, so
// the tap (writer, T03) and the footer strip (reader, T05) share the atomic-write
// and tolerant-read logic instead of each reimplementing it. The cache half of
// cockpit-bitbucket-store, with ONE difference that matters (DESIGN 3.5).
//
//   ~/.claude/cockpit/usage-cache.json  0600  (it holds account usage figures)
//   { writtenAt: <ms>, fiveHour: {usedPct,resetsAt}|null, sevenDay: {usedPct,resetsAt}|null }
//
// writtenAt is ms since epoch; resetsAt is SECONDS since epoch, as Claude Code's
// `resets_at` gives it -- stored as received, converted only where it is drawn.
//
// THE DIFFERENCE FROM bitbucket-cache.json: that cache has a single writer (the
// daemon), so a fixed `<file>.tmp` is safe. This cache is written by the statusline
// tap, which is registered GLOBALLY and runs in every Claude session (DESIGN 2.6),
// so MANY sessions write it concurrently. Two writers sharing one `.tmp` path would
// interleave into a torn temp that rename then publishes. So each writer uses a
// UNIQUE temp name (`<file>.<pid>.<rand>.tmp`) and renames its own temp over the
// target: the rename is atomic and last-writer-wins, and no two writers ever touch
// the same temp. No lock -- a per-writer temp plus atomic replace is enough for a
// last-writer-wins cache, and the reader tolerates a corrupt file anyway (DESIGN 3.5).
//
// readCache NEVER THROWS on an absent, empty or corrupt file: the footer draws off
// it every repaint, and a footer that will not paint because a JSON file lost a brace
// is worse than one showing no usage segment (DESIGN 2.n). It returns null there and
// leaves the file alone -- it never rescues or rewrites a bad file, which would race
// the tap; the tap's next write repairs it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// COCKPIT_DIR override matches config.mjs and the other stores, so a test points
// every reader and writer at one throwaway dir; otherwise the shared cockpit state.
const DEFAULT_DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");

const CACHE_FILE = "usage-cache.json";
const MODE = 0o600;

function cockpitDir() {
  return DEFAULT_DIR;
}

// A window is {usedPct, resetsAt} with both numeric, else null. A stored null (one
// limit not reported by Claude Code) and a malformed window both collapse to null,
// so a caller only ever sees a well-formed window or nothing (DESIGN 2.n).
function normalizeWindow(w) {
  if (!w || typeof w !== "object") return null;
  const usedPct = Number(w.usedPct);
  const resetsAt = Number(w.resetsAt);
  if (!Number.isFinite(usedPct) || !Number.isFinite(resetsAt)) return null;
  return { usedPct, resetsAt };
}

/**
 * The cache, or null. Absent, empty, unreadable, unparseable and "parsed to
 * something that is not a plain object" all collapse to null, so the footer only
 * ever branches on cache-or-not. Never throws. One window null is tolerated -- it
 * comes back null and the other still shows.
 */
export function readCache(dir = cockpitDir()) {
  let text;
  try { text = fs.readFileSync(path.join(dir, CACHE_FILE), "utf8"); }
  catch { return null; }                    // absent, or we may not read it
  if (!text.trim()) return null;            // empty file
  let data;
  try { data = JSON.parse(text); }
  catch { return null; }                    // present but broken -- left untouched
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    writtenAt: Number(data.writtenAt) || 0,
    fiveHour: normalizeWindow(data.fiveHour),
    sevenDay: normalizeWindow(data.sevenDay),
  };
}

/**
 * Temp-then-rename at 0600 with a PER-WRITER temp name. `<file>.<pid>.<rand>.tmp`
 * is unique to this write, so two concurrent sessions never share a temp to
 * scramble (DESIGN 3.5); the rename is atomic, so a reader racing the write sees
 * the whole old file or the whole new one, never a torn one. chmod is explicit
 * because writeFileSync's mode is masked by umask and only applies on create.
 */
export function writeCache(cache, dir = cockpitDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, CACHE_FILE);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const data = {
    writtenAt: Number(cache?.writtenAt) || 0,
    fiveHour: normalizeWindow(cache?.fiveHour),
    sevenDay: normalizeWindow(cache?.sevenDay),
  };
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: MODE });
  fs.chmodSync(tmp, MODE);
  fs.renameSync(tmp, file);
}
