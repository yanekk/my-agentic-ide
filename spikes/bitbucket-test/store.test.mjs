// The store: config reads, the PR cache and the session view-state. Single-writer
// files, so the interesting properties are the parsing (comma lists), the
// defensive reads (a corrupt file degrades to empty/default and is left untouched,
// never rescued), and the atomic write (temp-then-rename leaves no torn file).
//
// Every case runs against its own throwaway dir under COCKPIT_DIR, so none sees
// another's files and none touches the real ~/.claude/cockpit (run.sh checks that
// afterwards too). The config settings are written as the plain per-setting files
// `config` leaves on disk, since readSetting just reads those files.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  readConfig, isConfigured,
  readCache, writeCache,
  readView, writeView,
} from "../../bin/cockpit-bitbucket-store.mjs";
import { ok, eq, section, done } from "./harness.mjs";

const T = mkdtempSync(join(process.env.COCKPIT_DIR || "/tmp", "bb-store-"));
let seq = 0;
const freshDir = () => {
  const d = join(T, `d${++seq}`);
  mkdirSync(d, { recursive: true });
  return d;
};
// Write a setting the way `config` does: one plain file named for the setting.
const setSetting = (dir, name, value) => writeFileSync(join(dir, name), value);

// --- config reads ----------------------------------------------------------

section("readConfig parses the comma lists and reports unset as null / []");
{
  const d = freshDir();
  setSetting(d, "bitbucket-key", "me@example.com:tok");
  setSetting(d, "bitbucket-workspace", "acme");
  setSetting(d, "bitbucket-repos", "a, b ,c");   // spaces around and inside the list
  setSetting(d, "bitbucket-team", "");            // present but empty

  const cfg = readConfig(d);
  eq("key is the raw credential", cfg.key, "me@example.com:tok");
  eq("workspace is the slug", cfg.workspace, "acme");
  eq("repos split, trimmed, empties dropped", cfg.repos, ["a", "b", "c"]);
  eq("an empty team setting parses to []", cfg.team, []);

  // A dir with nothing set at all.
  const empty = readConfig(freshDir());
  eq("an absent key reads null", empty.key, null);
  eq("an absent workspace reads null", empty.workspace, null);
  eq("absent repos read as []", empty.repos, []);
  eq("absent team reads as []", empty.team, []);
}

section("a repos setting of only commas and spaces parses to []");
{
  const d = freshDir();
  setSetting(d, "bitbucket-repos", " , , ");
  eq("all-noise list drops to []", readConfig(d).repos, []);
}

// --- isConfigured ----------------------------------------------------------

section("isConfigured needs key + workspace + at least one repo; team is optional");
{
  const base = { key: "e:t", workspace: "acme", repos: ["a"], team: [] };
  ok("all three present -> configured", isConfigured(base));
  ok("...even with an empty team", isConfigured({ ...base, team: [] }));
  ok("no key -> not configured", !isConfigured({ ...base, key: null }));
  ok("no workspace -> not configured", !isConfigured({ ...base, workspace: null }));
  ok("no repos -> not configured", !isConfigured({ ...base, repos: [] }));
}

// --- the PR cache ----------------------------------------------------------

section("writeCache then readCache round-trips, and the file is 0600");
{
  const d = freshDir();
  const cache = {
    meUuid: "{me-uuid}",
    repos: {
      web: { fetchedAt: 1000, prs: [{ id: 1, title: "a" }, { id: 2, title: "b" }], error: null },
      api: { fetchedAt: 2000, prs: [], error: { kind: "auth" } },
    },
  };
  writeCache(cache, d);
  const back = readCache(d);
  eq("meUuid round-trips", back.meUuid, "{me-uuid}");
  eq("a repo's prs round-trip untouched", back.repos.web.prs, [{ id: 1, title: "a" }, { id: 2, title: "b" }]);
  eq("fetchedAt round-trips", back.repos.web.fetchedAt, 1000);
  eq("a per-repo error round-trips", back.repos.api.error, { kind: "auth" });
  eq("an empty prs list round-trips", back.repos.api.prs, []);

  const mode = statSync(join(d, "bitbucket-cache.json")).mode & 0o777;
  eq("the cache file is 0600", mode, 0o600);
  ok("no temp file is left behind", !existsSync(join(d, "bitbucket-cache.json.tmp")));
}

section("an absent cache reads back empty");
{
  const back = readCache(freshDir());
  eq("meUuid is null when nothing is cached", back.meUuid, null);
  eq("repos is empty", back.repos, {});
}

section("a corrupt cache reads back empty, does not throw, and is left untouched");
{
  const d = freshDir();
  const p = join(d, "bitbucket-cache.json");
  writeFileSync(p, "{ this is not json");
  let threw = false;
  let back;
  try { back = readCache(d); } catch { threw = true; }
  ok("readCache did not throw on a broken file", !threw);
  eq("...and returned an empty cache", back, { meUuid: null, repos: {} });
  eq("...and left the broken file exactly as it was", readFileSync(p, "utf8"), "{ this is not json");
  ok("...creating no quarantine copy", !existsSync(`${p}.corrupt`) && existsSync(p));
}

section("a cache whose repos entry is malformed is skipped, not fatal");
{
  const d = freshDir();
  // repos present but one entry is not an object, and one field is the wrong type.
  writeFileSync(join(d, "bitbucket-cache.json"),
    JSON.stringify({ meUuid: "u", repos: { bad: 7, ok: { fetchedAt: "x", prs: "nope", error: null } } }));
  const back = readCache(d);
  ok("the non-object entry is dropped", !("bad" in back.repos));
  eq("a non-number fetchedAt falls to 0", back.repos.ok.fetchedAt, 0);
  eq("a non-array prs falls to []", back.repos.ok.prs, []);
}

// --- the view-state --------------------------------------------------------

section("an absent or corrupt view reads back as the default");
{
  const DEFAULT = { tab: "toReview", page: { toReview: 1, mine: 1 } };
  eq("absent view is the default", readView(freshDir()), DEFAULT);

  const d = freshDir();
  const p = join(d, "bitbucket-view.json");
  writeFileSync(p, "not json at all");
  let threw = false, back;
  try { back = readView(d); } catch { threw = true; }
  ok("readView did not throw on a broken file", !threw);
  eq("...and returned the default view", back, DEFAULT);
  eq("...and left the broken file untouched", readFileSync(p, "utf8"), "not json at all");
}

section("writeView then readView round-trips the tab and per-tab pages");
{
  const d = freshDir();
  writeView({ tab: "mine", page: { toReview: 3, mine: 2 } }, d);
  eq("tab and pages round-trip", readView(d), { tab: "mine", page: { toReview: 3, mine: 2 } });
  eq("the view file is 0600", statSync(join(d, "bitbucket-view.json")).mode & 0o777, 0o600);
}

section("a view with a bad tab or a bad page number falls back to the defaults");
{
  const d = freshDir();
  writeFileSync(join(d, "bitbucket-view.json"),
    JSON.stringify({ tab: "elsewhere", page: { toReview: 0, mine: "x" } }));
  const back = readView(d);
  eq("an unknown tab falls to toReview", back.tab, "toReview");
  eq("a zero page falls to 1", back.page.toReview, 1);
  eq("a non-number page falls to 1", back.page.mine, 1);
}

// --- atomic write ----------------------------------------------------------

section("a write is atomic: no torn file, no lingering temp");
{
  // The observable consequence of temp-then-rename: the destination is only ever a
  // whole file, and no half-written `.tmp` survives. Overwrite an existing cache
  // and confirm the reader sees the WHOLE new file (never a truncated one) and the
  // temp is gone. A partial in-place write would leave the file unparseable, which
  // readCache would swallow to empty -- so a round-trip that returns the new value
  // is itself the proof the old file was replaced whole.
  const d = freshDir();
  writeCache({ meUuid: "old", repos: { r: { fetchedAt: 1, prs: [{ id: 1 }], error: null } } }, d);
  writeCache({ meUuid: "new", repos: { r: { fetchedAt: 2, prs: [{ id: 9 }], error: null } } }, d);
  const p = join(d, "bitbucket-cache.json");
  ok("no .tmp lingers after the rename", !existsSync(`${p}.tmp`));
  // The destination is complete JSON (would throw here if torn) and is the NEW file.
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  eq("the destination is the whole new file", parsed.meUuid, "new");
  eq("...with the new repo contents", parsed.repos.r.prs, [{ id: 9 }]);
}

done();
