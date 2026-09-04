// cockpit-bitbucket-store -- the reads and writes the dashboard daemon and pane
// need: the four config settings as usable values, the fetched-PR cache, and the
// session view-state (DESIGN 3.5). The dumb end of the boundary (DESIGN 3.1): it
// stores what it is given and decides nothing about what a PR means -- that is the
// pure model's job (T03).
//
//   bitbucket-key / -workspace / -repos / -team  one file each, written by `config`
//   bitbucket-cache.json  0600  { meUuid, repos: { <slug>: { fetchedAt, prs, error } } }
//   bitbucket-view.json   0600  { tab, page: { toReview, mine } }
//
// DELIBERATELY SIMPLER THAN THE AGENDA STORE, and the reason is the writer count.
// Every one of these files has a SINGLE writer -- `config` owns each setting, the
// daemon owns the cache and the view -- so a temp-then-rename write is enough for
// the read/write race and there is NO LOCK. The agenda locks because agents write
// its files too; here nothing shares a writer, so the lock would be cost with no
// hazard (DESIGN 3.5). A crash mid-write leaves the previous file whole because the
// rename is atomic.
//
// readCache and readView NEVER THROW on a corrupt or absent file: the pane draws
// the cockpit's whole resting screen from them, and a pane that will not paint
// because a JSON file lost a brace is worse than one showing the empty state
// (DESIGN 2.n). They also never rescue or rewrite a bad file -- that would race the
// daemon, the single writer -- they just return the empty/default shape and leave
// the file alone. (Contrast the agenda's state file, which IS quarantined, because
// it holds refresh tokens; a re-fetchable PR cache is not worth a pile of
// .corrupt-* litter, the same call the agenda cache makes.)
//
// All files 0600 -- the cache holds PR titles -- and none is ever written inside
// the repo (a checked-in file would land in the very diff an agent is reviewed on).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSetting } from "./cockpit-config.mjs";

// COCKPIT_DIR override matches config.mjs and the agenda store, so a test points
// every reader and writer at one throwaway dir; otherwise the shared cockpit state.
const DEFAULT_DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");

const CACHE_FILE = "bitbucket-cache.json";
const VIEW_FILE = "bitbucket-view.json";
const MODE = 0o600;

// --- config reads (DESIGN 2.6) ---------------------------------------------

// Split a comma list into trimmed, non-empty entries. `a, b ,c` -> ["a","b","c"];
// an unset setting (null) or an all-whitespace one -> []. Repo and team slugs carry
// no internal spaces, so trimming only ever removes the noise around a paste.
function splitList(raw) {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The four settings, parsed into what the daemon and pane actually use. The two
 * secrets/slugs come back as `string | null` (null = unset), the two lists as
 * arrays. readSetting is the one read path (it trims and returns null when absent),
 * reused here rather than reopening the files, so config's masking policy and this
 * store can never disagree about what "set" means.
 */
export function readConfig(dir = DEFAULT_DIR) {
  return {
    key: readSetting("bitbucket-key", dir),
    workspace: readSetting("bitbucket-workspace", dir),
    repos: splitList(readSetting("bitbucket-repos", dir)),
    team: splitList(readSetting("bitbucket-team", dir)),
  };
}

/**
 * The dashboard is "on" only with a credential, a workspace and at least one repo
 * to watch; `bitbucket-team` may be empty (DESIGN 2.6), so it is not required here.
 * Anything less shows the unconfigured greeting (DESIGN 2.n).
 */
export function isConfigured(cfg) {
  return Boolean(cfg.key && cfg.workspace && cfg.repos.length);
}

// --- file helpers ----------------------------------------------------------

/**
 * A well-formed object from a JSON file, or null. Absent, unreadable, unparseable
 * and "parsed to something that is not a plain object" all collapse to null, so a
 * caller only ever branches on well-formed-or-not. Never throws: the readers below
 * depend on that.
 */
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch { return null; }                    // absent, or we may not read it
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch { /* fall through */ }
  return null;                              // present but broken -- left untouched
}

/**
 * Temp file then rename, at 0600. The pane watches the state DIRECTORY, not the
 * files, so a replaced inode must not deafen it; the rename is atomic, so a reader
 * racing a write sees the whole old file or the whole new one, never a torn one,
 * and a crash mid-write leaves the previous file intact. chmod is explicit because
 * writeFileSync's mode is masked by umask and only applies on create.
 */
function writeJson(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: MODE });
  fs.chmodSync(tmp, MODE);
  fs.renameSync(tmp, file);
}

// --- the PR cache (bitbucket-cache.json) -----------------------------------
// Written only by the daemon (DESIGN 3.5), read by the pane.
// Cache = { meUuid, repos: { <slug>: { fetchedAt, prs: RawPR[], error: {kind}|null } } }

/** Defensive: a corrupt or absent file reads back as an empty cache, never throwing. */
export function readCache(dir = DEFAULT_DIR) {
  const data = readJson(path.join(dir, CACHE_FILE));
  const meUuid = data && typeof data.meUuid === "string" ? data.meUuid : null;
  const repos = {};
  const raw = data && typeof data.repos === "object" && data.repos ? data.repos : {};
  for (const [slug, e] of Object.entries(raw)) {
    if (!e || typeof e !== "object") continue;
    repos[slug] = {
      fetchedAt: Number(e.fetchedAt) || 0,
      // Raw PRs pass through untouched -- the model normalises them (DESIGN 3.1).
      prs: Array.isArray(e.prs) ? e.prs : [],
      error: e.error ?? null,
    };
  }
  return { meUuid, repos };
}

export function writeCache(cache, dir = DEFAULT_DIR) {
  writeJson(dir, CACHE_FILE, {
    version: 1,
    meUuid: typeof cache?.meUuid === "string" ? cache.meUuid : null,
    repos: cache && typeof cache.repos === "object" && cache.repos ? cache.repos : {},
  });
}

// --- the view-state (bitbucket-view.json) ----------------------------------
// Written only by the daemon on a click verb (DESIGN 3.5), read by the pane. Keeping
// it a file the daemon owns is what lets the pane stay pure display: it never
// decides which tab is active, it draws the one the daemon recorded.

const DEFAULT_TAB = "toReview";

/** A page number the view is allowed to hold: an integer >= 1, else the default 1. */
function pageOr1(n) {
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Defensive: a corrupt or absent file reads back as the default view, never throwing. */
export function readView(dir = DEFAULT_DIR) {
  const data = readJson(path.join(dir, VIEW_FILE));
  const tab = data && (data.tab === "toReview" || data.tab === "mine") ? data.tab : DEFAULT_TAB;
  const p = data && typeof data.page === "object" && data.page ? data.page : {};
  return { tab, page: { toReview: pageOr1(p.toReview), mine: pageOr1(p.mine) } };
}

export function writeView(view, dir = DEFAULT_DIR) {
  const tab = view && (view.tab === "toReview" || view.tab === "mine") ? view.tab : DEFAULT_TAB;
  const p = view && typeof view.page === "object" && view.page ? view.page : {};
  writeJson(dir, VIEW_FILE, { version: 1, tab, page: { toReview: pageOr1(p.toReview), mine: pageOr1(p.mine) } });
}
