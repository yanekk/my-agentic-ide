// cockpit-fleet-status -- the world-touching half of the fleet picker's status
// (plans/fleet-picker-status, DESIGN 2.5, 2.7, 3.2, 3.5, 3.6). It runs
// `claude agents --json --all`, reads the finish time of each background done
// agent, and asks pir's service for its runs, each under a time limit, and turns
// every failure into a quiet result. It returns raw answers: what a person sees is
// decided by cockpit-fleet-status-model.mjs, never here.
//
// Nothing here throws or rejects. A status failure must never take the picker
// down: a picker that dies hands back picker-cancel and the person's ← is lost
// (fleet-picker DESIGN 2.7).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fetchPirRuns, pirHome } from "./cockpit-usage-pir.mjs";

// Measured 0.16-0.19 s with 14 entries (T00 Q5); the limit only bounds a hung claude.
export const CLAUDE_TIMEOUT_MS = 3000;

// Resolves the child's whole stdout, or null on any failure. The limit is our own
// timer rather than execFile's `timeout`: execFile reports only once stdout closes,
// and a child that forked something holding the pipe would keep it open past the
// kill. Here the answer is given at the deadline whatever the child does.
function runClaude(env, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      try { child?.kill("SIGKILL"); } catch { /* already gone */ }
      try { child?.stdout?.destroy(); } catch { /* already gone */ }
      finish(null);
    }, timeoutMs);
    try {
      // `env` carries PATH, so the lookup of `claude` uses the caller's PATH, not
      // this process's (node resolves the command against options.env.PATH).
      child = spawn("claude", ["agents", "--json", "--all"], { env, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return finish(null);
    }
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stdout.on("error", () => {});
    child.on("error", () => finish(null));            // not on PATH, not executable
    child.on("close", (code) => finish(code === 0 ? Buffer.concat(chunks).toString("utf8") : null));
  });
}

// Claude's jobs folder (DESIGN 3.6).
function jobsDir(env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude"), "jobs");
}

// An id becomes a path segment, so only a plain one is read: an id of ".." or one
// with a slash must not send the read outside the jobs folder.
const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

// lastTerminalAt of one job, raw, or undefined when the file is missing,
// unreadable, not JSON (Claude may be rewriting it, DESIGN 3.5) or lacks the field.
async function readFinish(dir, id) {
  try {
    const state = JSON.parse(await fs.promises.readFile(path.join(dir, id, "state.json"), "utf8"));
    const v = state?.lastTerminalAt;
    return v === undefined || v === null ? undefined : v;
  } catch {
    return undefined;
  }
}

// env gives PATH, HOME and CLAUDE_CONFIG_DIR. Never throws.
//   → { ok: true, agents, finishedAt: { [id]: raw lastTerminalAt } } | { ok: false }
export async function gatherClaude({ env = process.env, timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
  try {
    const out = await runClaude(env, timeoutMs);
    if (out === null) return { ok: false };
    let agents;
    try { agents = JSON.parse(out); } catch { return { ok: false }; }
    if (!Array.isArray(agents)) return { ok: false };

    // Only background agents whose list state is "done" (T00 Q3) are shown by
    // finish time, so only their files are read; every other file would cost a
    // read for no shown line.
    const dir = jobsDir(env);
    const ids = agents
      .filter((a) => a && a.kind === "background" && a.state === "done" && typeof a.id === "string" && SAFE_ID.test(a.id))
      .map((a) => a.id);
    const times = await Promise.all(ids.map((id) => readFinish(dir, id)));
    const finishedAt = {};
    ids.forEach((id, i) => { if (times[i] !== undefined) finishedAt[id] = times[i]; });
    return { ok: true, agents, finishedAt };
  } catch {
    return { ok: false };
  }
}

// The two pir failures the picker words differently (DESIGN 2.7): "down" names
// the service as not running; "other" is a key or format problem.
const PIR_DOWN = new Set(["absent", "dead", "unreachable"]);

// → { ok: true, body } | { ok: false, why: "down" | "other" }. Never throws.
// `alive` and `timeoutMs` pass through to fetchPirRuns, for tests.
export async function gatherPir({ home = pirHome(), alive, timeoutMs } = {}) {
  try {
    const got = await fetchPirRuns({ home, alive, timeoutMs });
    if (got.state === "answered") return { ok: true, body: got.body };
    if (PIR_DOWN.has(got.state)) return { ok: false, why: "down" };
    if (got.state === "http") return { ok: false, why: got.status === 401 ? "other" : "down" };
    return { ok: false, why: "other" };       // no-key, bad-file, bad-body
  } catch {
    return { ok: false, why: "other" };
  }
}

// Both at once (DESIGN 3.4): the picker redraws when both have settled, so the
// slower source alone sets the wait. `home` defaults to pirHome of the same env.
//   opts: { env, home, claudeTimeoutMs, pirTimeoutMs, alive }
export async function gatherAll({ env = process.env, home, claudeTimeoutMs, pirTimeoutMs, alive } = {}) {
  const [claude, pir] = await Promise.all([
    gatherClaude({ env, timeoutMs: claudeTimeoutMs }),
    gatherPir({ home: home ?? pirHome(env), alive, timeoutMs: pirTimeoutMs }),
  ]);
  return { claude, pir };
}
