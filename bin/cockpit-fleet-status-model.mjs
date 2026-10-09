// The pure half of the ← picker's status lists (plans/fleet-picker-status DESIGN §2, §3.1, §3.3).
//
// From the raw answers of `claude agents --json --all` (plus each finished job's lastTerminalAt)
// and pir's `GET /v2/runs` body, and the current time as an argument, decide which items each
// program lists, in which class, with which word, in which order. Imports nothing and reaches
// for no clock, file, process or network; run.sh greps for that, and the fix for a failing grep
// is to move the code into bin/cockpit-fleet-status.mjs, never to relax the grep.
//
// Item = { cls: "wait"|"run"|"bad"|"done", word: string, name: string }

const CLASS_ORDER = { wait: 0, run: 1, bad: 2, done: 3 };
const HOUR_MIN = 60;

// T00 (FINDINGS 2026-10-09): a background agent waiting on the person lists `state: "blocked"`;
// stopped and exited ones list `stopped` and `done`. `failed`/`crashed` were not observed and are
// the planner's reading of the binary. Everything else (`working`, or a state a later Claude adds)
// is run and shows its own word, so a new state reads as something rather than vanishing.
const CLAUDE_BAD = new Set(["failed", "stopped", "crashed"]);

const PIR_BAD = new Set(["stopped", "crashed"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.length > 0;

// An ISO 8601 instant must carry its zone: an offset-less wall-clock time would be read in the
// machine's zone, which is both wrong and a purity leak no grep sees (CLAUDE.md, the all-day row).
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// parseTime(v) → epoch ms, or undefined for anything that is not an ISO instant or epoch ms.
// Claude's lastTerminalAt is an ISO string (measured, plan review); pir's endedAt may be either.
export function parseTime(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || !ISO_INSTANT.test(v)) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

// ageLabel(endedAtMs, now) → "0m".."59m", or null when unknown or an hour or more old (§2.3).
// A finish in the future (a clock that moved) is age 0, so it shows rather than hiding for an hour.
export function ageLabel(endedAtMs, now) {
  if (typeof endedAtMs !== "number" || !Number.isFinite(endedAtMs)) return null;
  if (typeof now !== "number" || !Number.isFinite(now)) return null;
  const min = Math.max(0, Math.floor((now - endedAtMs) / 60000));
  return min < HOUR_MIN ? `${min}m` : null;
}

// Sort by class, then within wait/run/bad by `key` descending (Claude: startedAt, newest first;
// pir: input order, via a descending negative index), and within done by finish time descending.
// The sort is stable, so equal keys keep the input order.
function ordered(rows) {
  return rows
    .slice()
    .sort((a, b) => CLASS_ORDER[a.cls] - CLASS_ORDER[b.cls] || b.key - a.key)
    .map(({ cls, word, name }) => ({ cls, word, name }));
}

// claudeItems(agents, finishedAt, now) → Item[] | "unavailable" (§2.1, §2.2, §2.3).
//   agents      the parsed `claude agents --json --all` array; anything else is "unavailable"
//   finishedAt  { [jobId]: raw lastTerminalAt } for done agents; read with parseTime
export function claudeItems(agents, finishedAt, now) {
  if (!Array.isArray(agents)) return "unavailable";
  const ends = isObj(finishedAt) ? finishedAt : {};
  const rows = [];
  for (const a of agents) {
    // Interactive sessions are left out: pir's own workers are interactive and would be listed twice.
    if (!isObj(a) || a.kind !== "background") continue;
    if (!nonEmpty(a.name) || !nonEmpty(a.state)) continue;
    const started = typeof a.startedAt === "number" && Number.isFinite(a.startedAt) ? a.startedAt : -Infinity;
    if (a.state === "blocked") rows.push({ cls: "wait", word: "needs you", name: a.name, key: started });
    else if (CLAUDE_BAD.has(a.state)) rows.push({ cls: "bad", word: a.state, name: a.name, key: started });
    else if (a.state === "done") {
      const end = nonEmpty(a.id) && Object.hasOwn(ends, a.id) ? parseTime(ends[a.id]) : undefined;
      const age = ageLabel(end, now);
      if (age !== null) rows.push({ cls: "done", word: `done ${age}`, name: a.name, key: end });
    } else rows.push({ cls: "run", word: a.state, name: a.name, key: started });
  }
  return ordered(rows);
}

// pir's own naming rule (pir src/core/dashboard.mjs displayName): a planning or single run's
// label in quotes while it has one, else its slug. Mirrored so the picker and pir's dashboard
// name a run identically.
function pirName(run) {
  const label = (run.kind === "plan" || run.kind === "single") && nonEmpty(run.label) ? `"${run.label}"` : null;
  const shown = label ?? (nonEmpty(run.slug) ? run.slug : null);
  return nonEmpty(run.repo) && shown ? `${run.repo} / ${shown}` : null;
}

// pirItems(body, now) → Item[] | "unavailable" (§2.1, §2.2, §2.3). Never the { unavailable }
// form: the shell picks that wording from why the fetch failed.
export function pirItems(body, now) {
  if (!isObj(body) || !Array.isArray(body.runs)) return "unavailable";
  const rows = [];
  body.runs.forEach((run, i) => {
    if (!isObj(run) || !nonEmpty(run.state)) return;
    const name = pirName(run);
    if (!name) return;
    const display = isObj(run.display) ? run.display : {};
    let word = nonEmpty(display.state) ? display.state : run.state;
    // A build's progress is the one thing its word does not carry.
    if (run.kind === "work" && Number.isInteger(display.total) && display.total > 0 && Number.isInteger(display.done)) {
      word = `${word} ${display.done}/${display.total}`;
    }
    // pir returns repo then slug and a RunSummary carries no start time, so its order is kept.
    const key = -i;
    if (run.waitingForYou === true) rows.push({ cls: "wait", word, name, key });
    else if (PIR_BAD.has(run.state)) rows.push({ cls: "bad", word, name, key });
    else if (run.state === "finished") {
      // endedAt does not exist in pir yet (pir-ended-at.md); until it lands every finish is hidden.
      const end = parseTime(run.endedAt);
      const age = ageLabel(end, now);
      if (age !== null) rows.push({ cls: "done", word: `${word} ${age}`, name, key: end });
    }
    // `running` and `unreachable` are run; so is a state pir adds later, like Claude's unknowns.
    else rows.push({ cls: "run", word, name, key });
  });
  return ordered(rows);
}
