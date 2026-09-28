// The pure half of following the pir dashboard (plans/pir-pane DESIGN §2.4–§2.6, §2.9, §3).
//
// pir, run with PIR_DASHBOARD_STATE set, keeps ~/.claude/cockpit/pir-dashboard.json current.
// The daemon reads that file and the facts only it can learn (is a pid alive, does a folder
// exist, is it a git work tree, what does git say the fork point is) and hands them here; this
// module turns them into the one decision the daemon acts on. It imports nothing and reaches
// for no clock, file system, process or environment: spikes/pir-pane-test greps it for that,
// and if the grep ever fails the fix is to move the code into the daemon, never to relax it.

// Every key the cockpit attaches for pir starts with this, so it can never collide with a
// `claude agents` job id and every pir-only rule (reaping, the claude-only guards) can test it.
export const PIR_KEY_PREFIX = "pir.";

const LIST = Object.freeze({ view: "list" });

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function nonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

// A field pir may leave null. Anything that is not a non-empty string reads as null, so the
// daemon never has to type-check what it was handed.
function strOrNull(v) {
  return nonEmptyString(v) ? v : null;
}

// §2.4 promises absolute paths. A relative one would be resolved against the daemon's own
// working directory by every exists()/cd downstream and attach some unrelated folder, so it
// reads as absent (null): the table then falls back or shows the list, which is safe.
function absPathOrNull(v) {
  return nonEmptyString(v) && v.startsWith("/") ? v : null;
}

function normaliseRun(r) {
  // The key is what every per-key map in the daemon is indexed by; without one there is
  // nothing to attach, so the run is treated as missing.
  if (!isObject(r) || !nonEmptyString(r.key)) return null;
  return {
    key: r.key,
    kind: strOrNull(r.kind),
    slug: strOrNull(r.slug),
    repo: strOrNull(r.repo),
    repoPath: strOrNull(r.repoPath),
    branch: strOrNull(r.branch),
    cwd: absPathOrNull(r.cwd),
  };
}

function normaliseWorker(w) {
  if (!isObject(w) || !nonEmptyString(w.id)) return null;
  return {
    id: w.id,
    task: strOrNull(w.task),
    role: strOrNull(w.role),
    cwd: absPathOrNull(w.cwd),
  };
}

// raw: the file's text, or null when it does not exist. isAlive(pid) → bool.
// Defensive by design (§2.4): an old pir writes nothing, a crashed one leaves its last file
// behind, and a half-understood file must never make the cockpit move panes. Every doubt
// reads as the runs list, which is the state that attaches nothing.
export function readPirState(raw, { isAlive }) {
  if (typeof raw !== "string" || raw.trim() === "") return LIST;
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return LIST;
  }
  if (!isObject(doc) || doc.version !== 1) return LIST;
  if (!Number.isInteger(doc.pid) || doc.pid <= 0) return LIST;
  let alive = false;
  try {
    alive = !!isAlive(doc.pid);
  } catch {
    alive = false;
  }
  if (!alive) return LIST;

  if (doc.view === "run") {
    const run = normaliseRun(doc.run);
    return run ? { view: "run", run } : LIST;
  }
  if (doc.view === "worker") {
    const run = normaliseRun(doc.run);
    const worker = normaliseWorker(doc.worker);
    return run && worker ? { view: "worker", run, worker } : LIST;
  }
  return LIST; // "list", or a view this version does not know
}

// The pid a report names, or null when the text is no report at all (absent, corrupt, no pid).
export function reportPid(raw) {
  if (typeof raw !== "string") return null;
  try {
    const doc = JSON.parse(raw);
    return isObject(doc) && Number.isInteger(doc.pid) && doc.pid > 0 ? doc.pid : null;
  } catch {
    return null;
  }
}

// Which report the cockpit follows. Only the pir running in the cockpit's own pir pane may move
// panes: PIR_DASHBOARD_STATE is inherited by everything that pir starts, so a worker running pir's
// own test suite spawns throwaway dashboards that write -- and on exit delete -- the SAME file, and
// following them swapped the panes back and forth between the real run and the test rigs' runs
// (bug 2026-09-28, "the cockpit flickers while a pir run is in progress").
//
// isOurs(pid) → bool: the pid is alive and runs in the cockpit's pir pane (the daemon asks `ps`).
// last: what this returned as `last` the previous time, or null. Returns
//   { state, last, ignored } -- the state to act on, the memory to hand back next time, and why a
//   file was not followed (null | { pid } for another pir's report | "unreadable" for a missing or
//   corrupt file while the cockpit's pir is alive), for the log.
// Everything doubtful still reads as the list (§2.4) unless the cockpit's own pir is alive and has
// said something: then the doubt is someone else's write, and what it last said still stands.
export function followPirReport(raw, { isAlive, isOurs, last }) {
  const pid = reportPid(raw);
  if (pid !== null && isOurs(pid)) {
    const state = readPirState(raw, { isAlive });
    return { state, last: { pid, state }, ignored: null };
  }
  if (last !== null && isOurs(last.pid)) {
    return { state: last.state, last, ignored: pid !== null ? { pid } : "unreadable" };
  }
  // No pir of ours alive to believe: our own quit (it deletes the file), crashed (its dead pid is
  // left behind), or has not written yet. The list, as §2.4 always had it.
  let foreign = false;
  try {
    foreign = pid !== null && !!isAlive(pid);
  } catch {
    foreign = false;
  }
  return { state: LIST, last: null, ignored: foreign ? { pid } : null };
}

export function pirKey(run, worker) {
  const base = PIR_KEY_PREFIX + run.key;
  return worker ? `${base}.${worker.id}` : base;
}

export function isPirKey(key) {
  return typeof key === "string" && key.startsWith(PIR_KEY_PREFIX) && key.length > PIR_KEY_PREFIX.length;
}

function followRun(run, cwd) {
  const key = pirKey(run);
  return { mode: "follow", key, cwd, label: run.slug || run.key, isRun: true, runKey: key };
}

// The table of §2.5, and nothing else. exists(path) and isGitRepo(path) are the daemon's.
// A worker whose folder is gone falls back to its run, because pir removes a task's worktree
// after merging it while the worker's conversation stays readable. A folder that exists but is
// not a git work tree is the table's last row: the notes view, with a reason for the log.
export function decidePir(state, { exists, isGitRepo }) {
  if (!state || (state.view !== "run" && state.view !== "worker")) return { mode: "list" };
  const run = state.run;
  const runKey = pirKey(run);

  if (state.view === "worker") {
    const w = state.worker;
    if (w.cwd && exists(w.cwd)) {
      if (!isGitRepo(w.cwd)) return { mode: "list", reason: `worker folder is not a git work tree: ${w.cwd}` };
      const slug = run.slug || run.key;
      return {
        mode: "follow",
        key: pirKey(run, w),
        cwd: w.cwd,
        label: `${slug} / ${w.task || w.id}`,
        isRun: false,
        runKey,
      };
    }
    // fall through to the run's folder
  }

  if (!run.cwd || !exists(run.cwd)) {
    return {
      mode: "list",
      reason: state.view === "worker" ? "neither the worker's nor the run's folder exists" : "the run's folder does not exist",
    };
  }
  if (!isGitRepo(run.cwd)) return { mode: "list", reason: `run folder is not a git work tree: ${run.cwd}` };
  return followRun(run, run.cwd);
}

// §2.6. A run opens in custom mode against its fork point from main, because its shared
// worktree holds finished tasks as commits and uncommitted would be empty. A ref the person
// stored for the key wins, since they set it on purpose. Neither ever opens the ref prompt:
// nobody asked for one, so a failure falls back to uncommitted with a reason for the log.
export function startingMode({ isRun, storedRef, forkPoint, resolves }) {
  if (!isRun) return { mode: "uncommitted" };
  if (nonEmptyString(storedRef)) {
    if (resolves(storedRef)) return { mode: "custom", ref: storedRef };
    return { mode: "uncommitted", reason: `stored ref does not resolve: ${storedRef}` };
  }
  if (nonEmptyString(forkPoint)) return { mode: "custom", ref: forkPoint };
  return { mode: "uncommitted", reason: "no fork point from main (git merge-base failed)" };
}

// §2.9. A pir key is reaped once its folder is gone (pir removed the worktree after a merge)
// and it is not the key on screen. A key whose folder the daemon never recorded is kept:
// reaping closes terminals, and doing that on missing information is the worse mistake.
export function shouldReapPirKey(key, { shownKey, exists, cwdOfKey }) {
  if (!isPirKey(key) || key === shownKey) return false;
  const cwd = cwdOfKey(key);
  if (!nonEmptyString(cwd)) return false;
  return !exists(cwd);
}
