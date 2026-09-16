// cockpit-usage-tap: the statusline command that copies a personal session's
// rate_limits into the cache (DESIGN 2.5, 2.6, 2.7, 2.n).
//
// Two kinds of check here. The logic tests call runTap() in-process with a fixed
// `now` and a scratch cache dir, so the write behaviour is proven in milliseconds.
// The contract tests run the script as a subprocess: execFileSync throws on a
// non-zero exit, so a clean return is itself proof the tap exited 0, and we assert
// its stdout is empty. Between them they cover the seven cases in the task doc.
//
// Everything writes to a throwaway dir; run.sh checks the real ~/.claude/cockpit
// is untouched afterwards.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { section, ok, eq, done } from "./harness.mjs";
import { runTap } from "../../bin/cockpit-usage-tap.mjs";
import { readCache } from "../../bin/cockpit-usage-store.mjs";

const CACHE = "usage-cache.json";
const TAP = new URL("../../bin/cockpit-usage-tap.mjs", import.meta.url).pathname;

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "usage-tap-"));
}

// A fixed instant so the written writtenAt is assertable. The reset epochs are
// arbitrary here -- the model's own suite proves how they format.
const NOW = Date.UTC(2026, 8, 16, 14, 20, 0);
const R5 = Math.floor(Date.UTC(2026, 8, 16, 18, 30, 0) / 1000);
const R7 = Math.floor(Date.UTC(2026, 8, 17, 9, 0, 0) / 1000);

// The T00-captured stdin shape: rate_limits.{five_hour,seven_day}, each with a
// used_percentage float and a resets_at in epoch seconds (T00 FINDINGS).
const SAMPLE = {
  session_id: "s1",
  rate_limits: {
    five_hour: { used_percentage: 62.4, resets_at: R5 },
    seven_day: { used_percentage: 93.1, resets_at: R7 },
  },
};

// Run the tap as Claude Code would: pipe JSON on stdin. Returns {out, code}.
// execFileSync throws on a non-zero exit; we turn that into a captured code so a
// wrongly-failing tap surfaces as a readable FAIL rather than an uncaught throw.
function runScript({ input, env = {} }) {
  try {
    const out = execFileSync("node", [TAP], {
      input,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: e.stdout ?? "", code: e.status ?? -1, err: e };
  }
}

// --- 1. the sample writes a matching cache -------------------------------------
section("the T00 sample writes a matching cache");
{
  const dir = scratch();
  const line = runTap({ env: {}, stdinText: JSON.stringify(SAMPLE), now: NOW, dir });
  eq("the tap prints nothing by default", line, "");
  eq("the sample writes a cache whose windows match the sample", readCache(dir), {
    writtenAt: NOW,
    fiveHour: { usedPct: 62, resetsAt: R5 },
    sevenDay: { usedPct: 93, resetsAt: R7 },
  });
}

// --- 2. Bedrock gate: never inspects, never writes -----------------------------
section("CLAUDE_CODE_USE_BEDROCK short-circuits");
{
  const dir = scratch();
  const line = runTap({
    env: { CLAUDE_CODE_USE_BEDROCK: "1" },
    stdinText: JSON.stringify(SAMPLE),
    now: NOW,
    dir,
  });
  eq("a Bedrock session prints nothing", line, "");
  eq("a Bedrock session writes no cache even with rate_limits present", readCache(dir), null);
  ok("no cache file exists after a Bedrock turn", !fs.existsSync(path.join(dir, CACHE)));
}

// --- 3. Bedrock=false is treated as off ----------------------------------------
section("CLAUDE_CODE_USE_BEDROCK=false is off");
{
  const dir = scratch();
  runTap({ env: { CLAUDE_CODE_USE_BEDROCK: "false" }, stdinText: JSON.stringify(SAMPLE), now: NOW, dir });
  eq("BEDROCK=false lets the write happen", readCache(dir)?.fiveHour, { usedPct: 62, resetsAt: R5 });

  // The same off-reading Claude Code uses: "0" and "" are also off.
  const dir0 = scratch();
  runTap({ env: { CLAUDE_CODE_USE_BEDROCK: "0" }, stdinText: JSON.stringify(SAMPLE), now: NOW, dir: dir0 });
  ok('BEDROCK="0" lets the write happen', readCache(dir0) !== null);
  const dirE = scratch();
  runTap({ env: { CLAUDE_CODE_USE_BEDROCK: "" }, stdinText: JSON.stringify(SAMPLE), now: NOW, dir: dirE });
  ok('BEDROCK="" lets the write happen', readCache(dirE) !== null);
}

// --- 4. no rate_limits does not clobber a prior cache --------------------------
section("stdin without rate_limits leaves the cache untouched");
{
  const dir = scratch();
  // Seed a prior reading, then feed a turn with no rate_limits (an API-key session,
  // or a session before its first response, DESIGN 2.5).
  runTap({ env: {}, stdinText: JSON.stringify(SAMPLE), now: NOW, dir });
  const before = readCache(dir);
  const line = runTap({ env: {}, stdinText: JSON.stringify({ session_id: "s1" }), now: NOW + 5000, dir });
  eq("no rate_limits prints nothing", line, "");
  eq("no rate_limits leaves the prior reading exactly as it was", readCache(dir), before);

  // An empty rate_limits object is the same: nothing drawable, no clobber.
  runTap({ env: {}, stdinText: JSON.stringify({ rate_limits: {} }), now: NOW + 9000, dir });
  eq("an empty rate_limits object does not clobber either", readCache(dir), before);
}

// --- 5. malformed stdin: no write, no throw, empty line ------------------------
section("malformed stdin is swallowed");
{
  const dir = scratch();
  let threw = false;
  let line;
  try { line = runTap({ env: {}, stdinText: "not json {{{", now: NOW, dir }); }
  catch { threw = true; }
  ok("malformed stdin does not throw", !threw);
  eq("malformed stdin prints nothing", line, "");
  eq("malformed stdin writes no cache", readCache(dir), null);

  // Empty stdin (no data piped at all) is the same non-JSON path.
  const dirEmpty = scratch();
  eq("empty stdin prints nothing", runTap({ env: {}, stdinText: "", now: NOW, dir: dirEmpty }), "");
  eq("empty stdin writes no cache", readCache(dirEmpty), null);
}

// --- 6. an unwritable cache dir is swallowed -----------------------------------
section("an unwritable cache dir is swallowed");
{
  // Point the cache dir at a path whose parent is a regular file: the store's
  // mkdirSync(recursive) then throws ENOTDIR, and runTap must swallow it.
  const base = scratch();
  const blocker = path.join(base, "not-a-dir");
  fs.writeFileSync(blocker, "x");
  const dir = path.join(blocker, "sub");
  let threw = false;
  let line;
  try { line = runTap({ env: {}, stdinText: JSON.stringify(SAMPLE), now: NOW, dir }); }
  catch { threw = true; }
  ok("an unwritable cache dir does not throw", !threw);
  eq("an unwritable cache dir prints nothing", line, "");
}

// --- 7. the subprocess contract: exit 0, empty stdout, on every path -----------
section("the script itself: exit 0 and empty stdout on every path");
{
  // Happy path: a real personal turn. execFileSync returning at all proves exit 0.
  const dir = scratch();
  const good = runScript({ input: JSON.stringify(SAMPLE), env: { COCKPIT_DIR: dir } });
  eq("a good turn exits 0", good.code, 0);
  eq("a good turn prints nothing", good.out, "");
  ok("a good turn actually wrote the cache via the subprocess", readCache(dir) !== null);

  // Bedrock: exit 0, empty, no file.
  const dirB = scratch();
  const bed = runScript({
    input: JSON.stringify(SAMPLE),
    env: { COCKPIT_DIR: dirB, CLAUDE_CODE_USE_BEDROCK: "1" },
  });
  eq("a Bedrock turn exits 0", bed.code, 0);
  eq("a Bedrock turn prints nothing", bed.out, "");
  ok("a Bedrock turn wrote no cache", !fs.existsSync(path.join(dirB, CACHE)));

  // Malformed stdin: exit 0, empty, no throw crossing the process boundary.
  const dirM = scratch();
  const bad = runScript({ input: "not json", env: { COCKPIT_DIR: dirM } });
  eq("malformed stdin exits 0", bad.code, 0);
  eq("malformed stdin prints nothing", bad.out, "");
  ok("malformed stdin wrote no cache", !fs.existsSync(path.join(dirM, CACHE)));

  // Default visible output is empty even on the happy path (no chained command).
  eq("the default visible statusline is empty", good.out, "");
}

// --- 8. runtime chaining of a recorded foreign statusline (DESIGN 2.7) ----------
section("a recorded foreign statusline is chained onto the visible line");
{
  // A stub standing in for a statusline the user already had. It reads the piped
  // stdin and echoes it back behind a marker, so the assertions prove both that its
  // stdout becomes the visible line AND that the tap piped Claude Code's JSON to it.
  function recordPrev(dir, command) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "statusline-prev"),
      JSON.stringify({ type: "command", command }, null, 2) + "\n");
  }
  function stub(dir, body) {
    const p = path.join(dir, "prev-statusline.sh");
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    fs.chmodSync(p, 0o755);
    return p;
  }

  { // The chained command's stdout is emitted, and the cache is still written on top.
    const dir = scratch();
    const s = stub(dir, `IN=$(cat); printf 'chained:%s' "$IN"`);
    recordPrev(dir, s);
    const line = runTap({ env: {}, stdinText: JSON.stringify(SAMPLE), now: NOW, dir });
    ok("the chained command's stdout is the visible line", line.startsWith("chained:"), line);
    ok("...and the tap piped Claude Code's stdin to it", line.includes('"s1"'), line);
    eq("the data is still tapped on top of the chained line", readCache(dir)?.fiveHour,
       { usedPct: 62, resetsAt: R5 });
  }

  { // A chained command that fails falls back to empty output; the cache still writes.
    const dir = scratch();
    recordPrev(dir, "false");   // /usr/bin/false: always exits non-zero
    let threw = false, line;
    try { line = runTap({ env: {}, stdinText: JSON.stringify(SAMPLE), now: NOW, dir }); }
    catch { threw = true; }
    ok("a failing chained command does not throw", !threw);
    eq("a failing chained command falls back to empty output", line, "");
    ok("...but the data is still tapped", readCache(dir) !== null);
  }

  { // The foreign statusline is chained even on a Bedrock session (it is unrelated to
    // usage), but no usage cache is written there.
    const dir = scratch();
    const s = stub(dir, `printf 'bedrock-prev'`);
    recordPrev(dir, s);
    const line = runTap({
      env: { CLAUDE_CODE_USE_BEDROCK: "1" },
      stdinText: JSON.stringify(SAMPLE), now: NOW, dir,
    });
    eq("a Bedrock session still shows the chained statusline", line, "bedrock-prev");
    eq("...but writes no usage cache", readCache(dir), null);
  }

  { // A malformed statusline-prev is ignored, not a crash: empty line, cache written.
    const dir = scratch();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "statusline-prev"), "not json {{{");
    const line = runTap({ env: {}, stdinText: JSON.stringify(SAMPLE), now: NOW, dir });
    eq("a corrupt statusline-prev chains nothing", line, "");
    ok("...and the data is still tapped", readCache(dir) !== null);
  }
}

done();
