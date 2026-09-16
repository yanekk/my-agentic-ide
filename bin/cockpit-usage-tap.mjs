#!/usr/bin/env node
// cockpit-usage-tap -- the statusline command Claude Code runs after every turn.
// Its only job is to copy a personal subscription's `rate_limits` into the cache
// the footer reads. It is registered GLOBALLY (for every session, not only cockpit
// ones, DESIGN 2.6) because the limit is account-wide and any personal session
// reports the same true number, so more feeders means a fresher reading.
//
//   <this> < turn-input.json     tap the data (what settings.json invokes)
//
// (`--install`/`--uninstall`, which register/remove this in ~/.claude/settings.json,
// are T04. This task is the stdin->cache behaviour and the empty-by-default output.)
//
// Two hard rules shape the whole file (DESIGN 2.7): the tap must be INVISIBLE --
// Claude Code waits for our stdout before drawing its own status line, and the
// person asked for the cockpit footer, not a line inside every Claude session, so
// the default visible output is empty -- and it must NEVER DISRUPT a session --
// any error anywhere (Bedrock env, malformed stdin, an unwritable cache dir) ends
// in an empty stdout and exit 0, so a broken tap degrades to "no fresh reading",
// never to a broken Claude session. That is why every path here is wrapped and the
// process always exits 0.
//
// The clock is read HERE, in the shell layer (`Date.now()`), and passed into the
// pure model; the model never reads a clock (DESIGN 3.1). The tap stays quick and
// dependency-free otherwise: read stdin, normalize, one write, exit.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeRateLimits } from "./cockpit-usage-model.mjs";
import { writeCache } from "./cockpit-usage-store.mjs";

// The Bedrock gate (DESIGN 2.5). A boolean-ish env flag is "on" only when present,
// non-empty and not a spelled-out off value -- the exact reading Claude Code itself
// gives CLAUDE_CODE_USE_BEDROCK, so the tap short-circuits on the same signal that
// routed the session to Bedrock. Kept as a local copy rather than imported from the
// auto-namer: this file must stay small and pull in only the model and the store.
export function truthy(v) {
  const t = String(v ?? "").trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

// The visible statusline. T03 emits nothing: the person asked for the footer, not a
// line inside every Claude session (DESIGN 2.7). T04 adds chaining a pre-existing
// statusline command's output here; a Bedrock session still emits "" regardless
// (DESIGN 2.5 short-circuits before this is reached).
function visibleLine() {
  return "";
}

/**
 * The tap's whole behaviour as a function of its inputs, so the tests can drive it
 * without a subprocess. Returns the string to print; performs the cache write as a
 * side effect. NEVER THROWS -- any error (a bad env read, unparseable stdin, an
 * unwritable cache dir) is swallowed to an empty line, matching the exit-0 contract
 * the entrypoint relies on (DESIGN 2.7).
 *
 * @param stdinText  the raw JSON Claude Code piped on stdin
 * @param now        ms since epoch, read by the caller (the model stays clock-free)
 * @param dir        optional cache dir override (tests point it at a scratch dir);
 *                   omitted, the store uses COCKPIT_DIR or ~/.claude/cockpit
 */
export function runTap({ env = process.env, stdinText = "", now = Date.now(), dir } = {}) {
  try {
    // Bedrock first, before we even inspect the object (DESIGN 2.5): belt and
    // braces so a company session never surfaces a limit, even a future one the
    // gateway might attach. No read of stdin's rate_limits happens on this path.
    if (truthy(env.CLAUDE_CODE_USE_BEDROCK)) return visibleLine();

    let json;
    try { json = JSON.parse(stdinText); } catch { return visibleLine(); }

    // normalizeRateLimits returns null for an absent, empty or undrawable
    // rate_limits (no five_hour/seven_day, or both incomplete), so stdin without
    // usable numbers leaves the last reading alone -- no clobber (DESIGN 2.5, 2.n).
    const cache = normalizeRateLimits(json && json.rate_limits, now);
    if (cache) writeCache(cache, dir);

    return visibleLine();
  } catch {
    // Any unexpected failure (e.g. an unwritable cache dir surfacing from
    // writeCache) degrades to no fresh reading, never a disrupted session.
    return "";
  }
}

// -------------------------------------------------------------- entrypoint ---
// Read stdin whole and synchronously (Claude Code has already piped it), run the
// tap, print its line, and ALWAYS exit 0. runTap never throws, and the outer
// try/catch plus the fixed exit code are belt-and-braces on the same invariant.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  let stdinText = "";
  try { stdinText = readFileSync(0, "utf8"); } catch { stdinText = ""; }
  let out = "";
  try { out = runTap({ env: process.env, stdinText, now: Date.now() }); } catch { out = ""; }
  process.stdout.write(out);
  process.exit(0);
}
