#!/usr/bin/env node
// cockpit-usage-pir -- the world-touching half of the pir usage feed
// (plans/pir-usage-reader, DESIGN 2.1, 2.5, 3.2). pir's workers are SDK sessions
// with no statusline, so the tap never hears them; pir serves the same rate_limits
// from a local HTTP service, and this module finds it, asks it, and applies the
// pure model's newest-wins decision to the cache the footer already draws from.
//
// One poll function serves the daemon (its 30 s tick), the installer (--status)
// and the live check (--once), so all three run the same code and cannot disagree
// about whether the service is up.
//
//   <this> --status   "running <origin>" exit 0 | "off <state>" exit 1; writes nothing
//   <this> --once     one poll into the cache: "<state> wrote" | "<state> kept", exit 0
//
// Nothing here throws or rejects: every failure is a quiet state (DESIGN 2.5) and
// the bar simply ages as it does today. The rules themselves -- what api.json may
// point at, whether a reading is newer -- live in cockpit-usage-model.mjs; this
// file only carries bytes in and out and reads the clock.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePirApiFile, decidePirReading } from "./cockpit-usage-model.mjs";
import { readCache, writeCache } from "./cockpit-usage-store.mjs";

// The whole request, headers AND body (DESIGN 2.2). A loopback answer from memory
// takes milliseconds; a hung service must not hold the daemon's tick.
export const PIR_TIMEOUT_MS = 2000;

// The folder holding `.pir/` -- the rule pir itself uses. The last fallback only
// matters for a process started with no HOME at all.
export function pirHome(env = process.env) {
  return env.PIR_HOME ?? env.HOME ?? os.homedir();
}

// EPERM means the pid exists but belongs to someone else: alive (cockpitd's rule).
export function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e?.code === "EPERM"; }
}

// One GET to the service named by ${home}/.pir/api.json. Never throws, never
// rejects. Every state before "unreachable" is decided without sending anything.
export async function fetchPirUsage({ home, alive = isAlive, timeoutMs = PIR_TIMEOUT_MS } = {}) {
  try {
    let text;
    try { text = fs.readFileSync(path.join(home, ".pir", "api.json"), "utf8"); }
    catch (e) {
      // No .pir/, or .pir/ without the file: pir is absent or its service is off.
      // Anything else (a directory in its place, no permission) is a broken file.
      return { state: e?.code === "ENOENT" || e?.code === "ENOTDIR" ? "absent" : "bad-file" };
    }
    const api = parsePirApiFile(text);
    if (!api) return { state: "bad-file" };
    // A crashed service leaves its api.json behind; its pid is how we know not to
    // knock on a port some other program may since have taken.
    if (!alive(api.pid)) return { state: "dead" };

    // The signal covers the body read too: headers can arrive and the body never.
    // redirect "error": the url was checked to be loopback, and a redirect must not
    // be able to send the request anywhere else (DESIGN 2.6). No header of our own.
    const signal = AbortSignal.timeout(timeoutMs);
    let res, raw;
    try {
      res = await fetch(`${api.origin}/v1/usage`, { redirect: "error", signal });
      if (res.status !== 200) {
        // Release the socket; the error body is never read (every non-200 is alike).
        try { await res.body?.cancel(); } catch { /* already gone */ }
        return { state: "http", status: res.status };
      }
      raw = await res.text();
    } catch {
      return { state: "unreachable" };       // refused, reset, redirect, or the limit
    }
    let body;
    try { body = JSON.parse(raw); } catch { return { state: "bad-body" }; }
    return { state: "answered", origin: api.origin, body };
  } catch {
    return { state: "unreachable" };         // belt and braces: never reject
  }
}

// One whole poll. The clock and the cache are read only AFTER the response has
// arrived, and the write follows in the same synchronous step, so a tap write can
// slip in between only within microseconds (DESIGN 2.n). `dir` undefined means
// the store's own default (COCKPIT_DIR or ~/.claude/cockpit).
export async function pollPirUsage({ home, dir, now = Date.now, alive, timeoutMs } = {}) {
  try {
    const got = await fetchPirUsage({ home, alive, timeoutMs });
    if (got.state !== "answered") {
      const out = { state: got.state, wrote: false };
      if (got.status !== undefined) out.status = got.status;
      return out;
    }
    const decision = decidePirReading(readCache(dir), got.body, now());
    let wrote = false;
    if (decision.write) {
      // An unwritable dir is still a valid reading heard: state ok, nothing written.
      try { writeCache(decision.write, dir); wrote = true; } catch { wrote = false; }
    }
    return { state: decision.state, origin: got.origin, wrote };
  } catch {
    return { state: "unreachable", wrote: false };
  }
}

// "http 500" rather than a bare "http": the status is what tells one failure from
// another, and it is the same string the daemon's log line carries (DESIGN 2.5).
function stateLabel(r) {
  return r.state === "http" ? `http ${r.status}` : r.state;
}

async function main(argv) {
  if (argv.includes("--status")) {
    // State only: no clock-sensitive write, no cache read. ok and empty both mean
    // the service is up and answering the endpoint the bar is fed from (DESIGN 2.7).
    const got = await fetchPirUsage({ home: pirHome() });
    let state = stateLabel(got);
    if (got.state === "answered") state = decidePirReading(null, got.body, Date.now()).state;
    if (got.state === "answered" && (state === "ok" || state === "empty")) {
      console.log(`running ${got.origin}`);
      return 0;
    }
    console.log(`off ${state}`);
    return 1;
  }
  if (argv.includes("--once")) {
    const r = await pollPirUsage({ home: pirHome() });
    console.log(`${stateLabel(r)} ${r.wrote ? "wrote" : "kept"}`);
    return 0;
  }
  console.error("usage: cockpit-usage-pir.mjs --status | --once");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), () => process.exit(1));
}
