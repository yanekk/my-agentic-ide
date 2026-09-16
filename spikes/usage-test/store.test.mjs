// cockpit-usage-store: the atomic write and the tolerant read (DESIGN 3.5, 2.n).
// Everything runs against a throwaway COCKPIT_DIR passed as the `dir` argument, so
// nothing here touches the real ~/.claude/cockpit (the run.sh seatbelt checks it).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { section, ok, eq, done } from "./harness.mjs";
import { readCache, writeCache } from "../../bin/cockpit-usage-store.mjs";

const CACHE = "usage-cache.json";

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "usage-store-"));
}

section("round-trip");
{
  const dir = scratch();
  const cache = {
    writtenAt: 1758042000000,
    fiveHour: { usedPct: 40, resetsAt: 1758045600 },
    sevenDay: { usedPct: 72, resetsAt: 1758510000 },
  };
  writeCache(cache, dir);
  eq("writeCache then readCache round-trips a full cache", readCache(dir), cache);
}

section("0600");
{
  const dir = scratch();
  writeCache({ writtenAt: 1, fiveHour: null, sevenDay: null }, dir);
  const mode = fs.statSync(path.join(dir, CACHE)).mode & 0o777;
  eq("the written cache is mode 0600", mode, 0o600);
}

section("atomic: no temp remains, no partial read");
{
  const dir = scratch();
  writeCache({ writtenAt: 2, fiveHour: { usedPct: 1, resetsAt: 2 }, sevenDay: null }, dir);
  const left = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  eq("no .tmp file remains after a successful write", left, []);
  // A reader only ever sees the file the rename published, never a torn temp: the
  // target either does not exist or parses whole. Assert the published file parses.
  const raw = fs.readFileSync(path.join(dir, CACHE), "utf8");
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* parsed stays null */ }
  ok("the published cache is a whole, parseable file", parsed !== null);
}

section("unique per-writer temp name");
{
  // The temp name must be per-writer (`<file>.<pid>.<rand>.tmp`), not a fixed
  // `<file>.tmp`: two concurrent writers on a shared temp would scramble it before
  // the rename (DESIGN 3.5). We cannot easily force a real overlap in-process, so we
  // assert the two properties that guarantee safety directly: (1) the temp name is
  // NOT the fixed `<file>.tmp`, observed by trapping rename mid-write; (2) two
  // sequential writes leave a whole, parseable file and no litter.
  const dir = scratch();
  const file = path.join(dir, CACHE);

  // (1) Trap the rename to capture the temp path the writer actually used.
  const realRename = fs.renameSync;
  const seen = [];
  fs.renameSync = (from, to) => { seen.push(from); return realRename(from, to); };
  try {
    writeCache({ writtenAt: 10, fiveHour: null, sevenDay: null }, dir);
    writeCache({ writtenAt: 11, fiveHour: null, sevenDay: null }, dir);
  } finally {
    fs.renameSync = realRename;
  }
  const fixed = `${file}.tmp`;
  ok("the temp name is not the fixed <file>.tmp", seen.every((t) => t !== fixed), `saw ${JSON.stringify(seen)}`);
  ok("the two writes used two distinct temp names", new Set(seen).size === seen.length, `saw ${JSON.stringify(seen)}`);

  // (2) The final cache is a whole, parseable file -- never a torn interleave.
  const parsed = readCache(dir);
  eq("the final cache is the last write, whole", parsed && parsed.writtenAt, 11);
  eq("no temp litter after concurrent-style writes", fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
}

section("tolerant read");
{
  // Absent file.
  const dirA = scratch();
  eq("readCache on an absent file returns null", readCache(dirA), null);

  // Empty file.
  const dirE = scratch();
  fs.writeFileSync(path.join(dirE, CACHE), "");
  eq("readCache on an empty file returns null", readCache(dirE), null);

  // Corrupt / truncated file: must not throw.
  const dirC = scratch();
  fs.writeFileSync(path.join(dirC, CACHE), '{"writtenAt": 5, "fiveHour": {"usedPct": 4');
  let threw = false;
  let got;
  try { got = readCache(dirC); } catch { threw = true; }
  ok("readCache on a corrupt file does not throw", !threw);
  eq("readCache on a corrupt file returns null", got, null);

  // One window null: tolerated, the other still shows.
  const dirN = scratch();
  writeCache({ writtenAt: 6, fiveHour: null, sevenDay: { usedPct: 30, resetsAt: 99 } }, dirN);
  const partial = readCache(dirN);
  eq("readCache tolerates a cache with one window null", partial, {
    writtenAt: 6,
    fiveHour: null,
    sevenDay: { usedPct: 30, resetsAt: 99 },
  });
}

done();
