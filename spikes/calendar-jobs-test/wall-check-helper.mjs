// wall-check-helper -- the parts of wall-check.sh that need Node: builds the real argv
// from the real code, reads job state and transcripts. Refuses the real cockpit folder.
//
//   start <item> <project> <root> <instructions-file> <limit-min>   prints: id <TAB> worktree
//   wait <id> <limit-s> <marker-file>                               prints the job's state
//   flags <id>                                                      exit 0 the wall survives in respawnFlags
//   control                                                         exit 0 example.com answers from outside the wall
//   probe <cwd> <project> <root>                                    the wall's init, against a dead API
//   suite <id> <script>                                             exit 0 that suite printed ALL PASS

import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DIR } from "../../bin/cockpit-agenda-store.mjs";
import { buildWallFor } from "../../bin/cockpit-jobs.mjs";
import { buildClaudeArgs, worktreeName } from "../../bin/cockpit-jobs-model.mjs";
import { judgeInit, parseCalls } from "./wall-check-judge.mjs";

const HOME = os.homedir();
const JOBS = path.join(HOME, ".claude", "jobs");
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The seatbelt of DESIGN 5.2: this file never runs against the live ledger or wall list.
if (DIR === path.join(HOME, ".claude", "cockpit")) {
  console.error("wall-check: COCKPIT_DIR must be a scratch folder");
  process.exit(2);
}

// This script runs from inside a Claude session; the daemon's starts do not. COCKPIT_DIR
// goes too, because a real start has none and nothing in a run should know the scratch.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID|CLAUDE_AGENT_SDK|CLAUDE_EFFORT|PIR_|COCKPIT_|GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_INDEX_FILE)/.test(k)) delete env[k];
  }
  return env;
}

/** Exactly what decideJobs does for an entry due now, from the same two functions. */
function realStart(item, project, root, instructions, limitMin) {
  const now = Date.now();
  const event = { id: `wallcheck-${item}-${now}`, start: now, end: now + limitMin * 60_000 };
  const name = worktreeName({ event, zone: ZONE });
  const wall = buildWallFor({ projectsRoot: root, home: HOME })(project, name);
  if (!wall.settings) return { unavailable: wall.unavailable };
  return { name, wall, args: buildClaudeArgs({ event, project, item, instructions, zone: ZONE, wall }) };
}

async function start([item, project, root, file, limitMin]) {
  const instructions = fs.readFileSync(file, "utf8");
  const made = realStart(item, project, root, instructions, Number(limitMin));
  if (made.unavailable) { console.error(`wall-check: the wall cannot be set up: ${made.unavailable}`); return 2; }
  const { name, wall, args } = made;
  if ((wall.dropped ?? []).length) { console.error(`wall-check: exceptions dropped: ${JSON.stringify(wall.dropped)}`); return 1; }
  if (wall.listUnreadable) { console.error("wall-check: the scratch exceptions list could not be read"); return 2; }
  const cwd = path.join(root, project);
  const result = await new Promise((resolve) => {
    const child = execFile("claude", args, { cwd, env: cleanEnv(), timeout: 60_000 }, (err, stdout, stderr) => resolve({ err, text: `${stdout}\n${stderr}` }));
    child.stdin?.end();
  });
  const id = /backgrounded\s*·\s*([A-Za-z0-9_-]+)\s*·/.exec(result.text)?.[1];
  if (result.err || !id) { console.error(`wall-check: the start did not report an agent: ${result.text.slice(0, 300)}`); return 2; }
  console.log(`${id}\t${path.join(cwd, ".claude", "worktrees", name)}`);
  return 0;
}

const stateOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, id, "state.json"), "utf8")); } catch { return {}; } };

// A state alone is not a finish signal: a job can read `working` minutes after its last
// turn (T00), and idle while its background command runs. The marker is the agent's last step.
async function wait([id, limitS, marker]) {
  const deadline = Date.now() + Number(limitS) * 1000;
  let state = "";
  while (Date.now() < deadline) {
    state = stateOf(id).state ?? "";
    if (fs.existsSync(marker)) {
      await sleep(5000);   // the transcript's last lines
      console.log(`finished (${stateOf(id).state ?? "?"})`);
      return 0;
    }
    if (/^(failed|error|killed|stopped)$/.test(state)) { console.log(`ended early (${state})`); return 1; }
    await sleep(5000);
  }
  console.log(`time limit (${state || "no state"})`);
  return 1;
}

/** A session Claude respawns restarts from these (T00), so the wall must be in them. */
function flags([id]) {
  const f = stateOf(id).respawnFlags ?? [];
  const has = f.includes("--settings") && f.includes("--strict-mcp-config") && f.includes("--setting-sources");
  console.log(has ? "wall kept in respawnFlags" : `respawnFlags lack the wall (${f.length} flags)`);
  return has ? 0 : 1;
}

/** A blocked site proves nothing unless this machine reaches it from outside the wall. */
function control() {
  try {
    const code = execFileSync("curl", ["-sS", "-m", "20", "-o", "/dev/null", "-w", "%{http_code}", "http://example.com"], { stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, encoding: "utf8" });
    return code === "200" ? 0 : 1;
  } catch { return 1; }
}

/** The first system/init line of a -p run against a dead address, so it costs nothing. */
function initOf(args, cwd) {
  return new Promise((resolve) => {
    const env = { ...cleanEnv(), ANTHROPIC_BASE_URL: "http://127.0.0.1:9" };
    const child = spawn("claude", args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "ignore"] });
    let buf = "", found = null;
    const end = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } resolve(found); };
    const limit = setTimeout(end, 25_000);
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        try {
          const e = JSON.parse(line);
          if (e.type === "system" && e.subtype === "init") { found = { tools: e.tools, mcp_servers: e.mcp_servers, permissionMode: e.permissionMode }; clearTimeout(limit); end(); return; }
        } catch { /* partial */ }
      }
    });
    child.on("error", () => { clearTimeout(limit); end(); });
    child.on("exit", () => { clearTimeout(limit); end(); });
  });
}

async function probe([cwd, project, root]) {
  const made = realStart("wall-check probe", project, root, "say ok", 5);
  if (made.unavailable) { console.error(`wall-check: the wall cannot be set up: ${made.unavailable}`); return 2; }
  const { args } = made;
  const stream = ["--output-format", "stream-json", "--verbose"];
  // The real start's flags, less the three that only make sense for a background start.
  const walled = args.filter((a, i) => a !== "--bg" && a !== "-n" && a !== "-w" && args[i - 1] !== "-n" && args[i - 1] !== "-w");
  const wall = await initOf(["-p", ...stream, ...walled], cwd);
  const control = await initOf(["-p", ...stream, "say ok"], cwd);
  const result = judgeInit({ wall, control });
  console.log(`  settings taken: ${result.verdict} (${result.why})`);
  return result.verdict === "refused" ? 0 : result.verdict === "BREACH" ? 1 : 2;
}

function transcripts(id) {
  const sid = stateOf(id).sessionId;
  if (!sid) return null;
  const projects = path.join(HOME, ".claude", "projects");
  for (const d of fs.readdirSync(projects)) {
    const f = path.join(projects, d, `${sid}.jsonl`);
    if (!fs.existsSync(f)) continue;
    const texts = [fs.readFileSync(f, "utf8")];
    const subs = path.join(projects, d, sid, "subagents");
    if (fs.existsSync(subs)) for (const s of fs.readdirSync(subs)) if (s.endsWith(".jsonl")) texts.push(fs.readFileSync(path.join(subs, s), "utf8"));
    return texts;
  }
  return null;
}

/** A suite's own pass line, in the result of the call that ran it. */
function suite([id, script]) {
  const texts = transcripts(id);
  if (!texts) return 2;
  const runs = texts.flatMap(parseCalls).filter((c) => c.name === "Bash" && String(c.input.command).includes(script));
  return runs.some((c) => !c.isError && /ALL PASS/.test(c.result ?? "")) ? 0 : 1;
}

const [verb, ...rest] = process.argv.slice(2);
const verbs = { suite, start, wait, flags, control, probe };
if (!verbs[verb]) { console.error("wall-check-helper: no such verb"); process.exit(2); }
process.exitCode = await verbs[verb](rest);
