// `--trial` against a fake `claude` and real scratch repositories. run.sh sets both up;
// this refuses to run otherwise, because the real binary would start a real agent.

import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { section, ok, eq, done } from "../agenda-test/harness.mjs";

const SCRATCH = process.env.COCKPIT_DIR;
const IDENTITY = (() => {
  try { return execFileSync("claude", ["--i-am-the-fake"], { encoding: "utf8" }).trim(); } catch { return ""; }
})();
if (!SCRATCH || !process.env.FAKE_CLAUDE_LOG || IDENTITY !== "fake-claude") {
  console.log("  FAIL refusing to run: use spikes/calendar-jobs-test/run.sh");
  process.exit(1);
}

const { buildWallFor } = await import("../../bin/cockpit-jobs.mjs");
const { buildClaudeArgs, buildTrialArgs } = await import("../../bin/cockpit-jobs-model.mjs");
const { WALL_FILE } = await import("../../bin/cockpit-wall-store.mjs");
const { STATE_FILE, CACHE_FILE } = await import("../../bin/cockpit-agenda-store.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOBS_BIN = path.join(HERE, "../../bin/cockpit-jobs.mjs");
const LOG = process.env.FAKE_CLAUDE_LOG;
const ROOT = path.join(SCRATCH, "root");
const PROJ = path.join(ROOT, "proj");
const COMMANDS = path.join(SCRATCH, "commands.txt");

const gitIn = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first");
}
makeRepo(PROJ);
fs.writeFileSync(COMMANDS, "npm install\n\n  npm test -- --grep 'a b'  \n");

const calls = () => fs.existsSync(LOG)
  ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const reset = (mode) => {
  fs.rmSync(LOG, { force: true });
  if (mode) process.env.FAKE_CLAUDE_MODE = mode; else delete process.env.FAKE_CLAUDE_MODE;
};
const flag = (args, name) => args[args.indexOf(name) + 1];
const settingsOf = (args) => JSON.parse(flag(args, "--settings"));

const trialArgs = (extra = []) => ["--trial", "--project", "proj", "--root", ROOT, "--commands-file", COMMANDS, ...extra];
function trial(args = trialArgs(), env = {}) {
  return new Promise((resolve) => {
    execFile("node", [JOBS_BIN, ...args], { encoding: "utf8", env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}
function nothingLeft(what, repo = PROJ) {
  eq(`${what}: no worktree left`, gitIn(repo, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
  eq(`${what}: no branch left`, gitIn(repo, "branch", "--format=%(refname:short)").trim(), "main");
  ok(`${what}: no folder left`, !fs.existsSync(path.join(repo, ".claude")));
  eq(`${what}: the main checkout is clean`, gitIn(repo, "status", "--short"), "");
}
const until = async (test, ms = 8000) => {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return test();
};

section("a trial that runs");
{
  fs.writeFileSync(WALL_FILE, JSON.stringify({ version: 1, projects: {
    proj: { sites: ["example.org"], localPorts: true, write: [] },
    other: { sites: ["other-only.example"], localPorts: false, write: [] },
  } }));
  reset();
  const r = await trial();
  eq("exit 0", r.code, 0);
  eq("prints the final message, nothing else", r.stdout, "FAKE FINAL MESSAGE\n");
  const [c] = calls();
  eq("one agent", calls().length, 1);
  eq("it is -p", c.args[0], "-p");
  eq("on the small model", flag(c.args, "--model"), "haiku");
  eq("dontAsk", flag(c.args, "--permission-mode"), "dontAsk");
  ok("not bypass", !c.args.includes("bypassPermissions") && !c.args.includes("--bg"));
  eq("only the owner's settings", flag(c.args, "--setting-sources"), "user");
  ok("connectors off", c.args.includes("--strict-mcp-config"));
  ok("cwd is a throwaway worktree",
    /\/proj\/\.claude\/worktrees\/wall-trial-[0-9a-f]{8}$/.test(c.cwd), c.cwd);
  const s = settingsOf(c.args);
  eq("the sandbox is on", s.sandbox.enabled, true);
  ok("this project's site exception", s.sandbox.network.allowedDomains.includes("example.org"));
  eq("this project's ports exception", s.sandbox.network.allowLocalBinding, true);
  ok("another project's exception is absent", !s.sandbox.network.allowedDomains.includes("other-only.example"));
  const guard = s.hooks.PreToolUse[0].hooks[0].command;
  ok("the guard is rooted at the throwaway worktree",
    guard.endsWith(`|| exit 2`) && fs.realpathSync(PROJ) && guard.includes(`/proj/.claude/worktrees/${path.basename(c.cwd)}`), guard);
  const prompt = c.args.at(-1);
  ok("the commands are in order, one to a line", prompt.includes("1. npm install\n2. npm test -- --grep 'a b'\n"), prompt);
  ok("told not to fix or commit", /Do not fix anything and do not commit anything/.test(prompt));
  ok("told to list blocks", /each thing the wall blocked/.test(prompt));
  nothingLeft("after success");
  fs.rmSync(WALL_FILE);
}

section("removal, when the agent left work behind");
{
  reset("commits");
  const r = await trial();
  eq("exit 0", r.code, 0);
  nothingLeft("untracked file in the worktree");

  // `.claude` that was already there stays, and other worktrees are not disturbed.
  fs.mkdirSync(path.join(PROJ, ".claude", "worktrees", "keep"), { recursive: true });
  reset();
  await trial();
  ok("a folder that was already there stays", fs.existsSync(path.join(PROJ, ".claude", "worktrees", "keep")));
  fs.rmSync(path.join(PROJ, ".claude"), { recursive: true });
}

section("a failing agent");
{
  reset("stderr-fail");
  const r = await trial();
  eq("exit 1", r.code, 1);
  eq("its line", r.stderr.trim(), "claude said no");
  eq("no report", r.stdout, "");
  nothingLeft("after a failure");

  reset("silent-fail");
  const s = await trial();
  eq("a silent failure is exit 1", s.code, 1);
  ok("names the status", /status 3/.test(s.stderr), s.stderr);
  nothingLeft("after a silent failure");

  reset("empty");
  const e = await trial();
  eq("no final message is exit 1", e.code, 1);
  ok("says so", /without a final message/.test(e.stderr), e.stderr);
  nothingLeft("after an empty answer");
}

section("the limit");
{
  reset("hang");
  const r = await trial(trialArgs(["--limit-min", "0.01"]));
  eq("exit 1", r.code, 1);
  ok("the line names the limit", /0\.01 minute limit/.test(r.stderr), r.stderr);
  eq("no report", r.stdout, "");
  nothingLeft("after the limit");

  reset("stubborn");
  const t0 = Date.now();
  const s = await trial(trialArgs(["--limit-min", "0.01"]));
  eq("one that ignores SIGTERM: exit 1", s.code, 1);
  ok("it is ended all the same", Date.now() - t0 < 15000);
  nothingLeft("after a stubborn agent");
}

section("a leftover process");
{
  const pidFile = path.join(SCRATCH, "child.pid");
  fs.rmSync(pidFile, { force: true });
  reset("leaves-child");
  const t0 = Date.now();
  const r = await trial(trialArgs(), { FAKE_CLAUDE_CHILD: pidFile });
  eq("exit 0", r.code, 0);
  eq("the report survives", r.stdout, "FAKE FINAL MESSAGE\n");
  ok("a child holding stdout does not hold the trial up", Date.now() - t0 < 15000);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  ok("the child is gone", await until(() => !alive(pid)));
  nothingLeft("after a leftover process");
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  section(`${sig} while it runs`);
  for (const mode of ["hang", "stubborn"]) {
    reset(mode);
    const child = spawn("node", [JOBS_BIN, ...trialArgs()], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    const closed = new Promise((res) => child.on("exit", (code) => res(code)));
    ok(`${mode}: the agent started`, await until(() => calls().length === 1));
    const fakeStarted = calls()[0];
    ok(`${mode}: its worktree exists while it runs`, fs.existsSync(fakeStarted.cwd));
    // The fake installs its handlers just after it logs.
    await new Promise((r) => setTimeout(r, 100));
    child.kill(sig);
    eq(`${mode}: exit 1`, await closed, 1);
    ok(`${mode}: says what stopped it`, stderr.includes(sig), stderr);
    nothingLeft(`${mode} after ${sig}`);
  }
}

section("preflight");
{
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), "stub-sandbox-"));
  fs.writeFileSync(path.join(stub, "sandbox-exec"), "#!/bin/sh\nexit 71\n", { mode: 0o755 });
  reset();
  const r = await trial(trialArgs(), { PATH: `${stub}:${process.env.PATH}` });
  eq("exit 1", r.code, 1);
  ok("its line", /the sandbox did not run/.test(r.stderr), r.stderr);
  eq("no agent", calls().length, 0);
  nothingLeft("after a failed preflight");
  fs.rmSync(stub, { recursive: true });

  const unreadable = path.join(ROOT, "not-git");
  fs.mkdirSync(path.join(unreadable, ".git"), { recursive: true });
  const n = await trial(["--trial", "--project", "not-git", "--root", ROOT, "--commands-file", COMMANDS]);
  eq("git cannot read the project: exit 1", n.code, 1);
  ok("its line", /git could not read this project/.test(n.stderr), n.stderr);
  eq("no agent there either", calls().length, 0);
  fs.rmSync(unreadable, { recursive: true });
}

section("nothing else is touched");
{
  // A jobs calendar is configured with an entry due right now. A trial must not see it.
  const now = Date.now();
  const state = JSON.stringify({
    version: 1,
    accounts: { "me@x.y": { refreshToken: "r", addedAt: 1 } },
    calendars: [{ slug: "night", account: "me@x.y", calendarId: "cal", title: "n", colour: null, addedAt: 1, jobs: true, jobsSince: 1 }],
  });
  const cache = JSON.stringify({ version: 1, calendars: { night: { fetchedAt: now, error: null, events: [{
    id: "due", title: "proj / due", start: now - 1000, end: now + 3600_000, allDay: false, reply: "n/a", slug: "night",
    description: "should never run", creatorOwn: true,
  }] } } });
  fs.writeFileSync(STATE_FILE, state);
  fs.writeFileSync(CACHE_FILE, cache);
  const before = fs.readdirSync(SCRATCH).sort();
  reset();
  const r = await trial();
  eq("exit 0", r.code, 0);
  eq("one agent, the trial's", calls().length, 1);
  ok("the due entry did not run", !calls()[0].args.at(-1).includes("should never run"));
  eq("no new file in the cockpit folder", fs.readdirSync(SCRATCH).sort(), before);
  eq("the calendar state is unchanged", fs.readFileSync(STATE_FILE, "utf8"), state);
  eq("the cache is unchanged", fs.readFileSync(CACHE_FILE, "utf8"), cache);
  fs.rmSync(STATE_FILE); fs.rmSync(CACHE_FILE);
}

section("what is refused");
{
  reset();
  for (const bad of ["../proj", "a/b", "..", ".", "", "-x"]) {
    const r = await trial(["--trial", "--project", bad, "--root", ROOT, "--commands-file", COMMANDS]);
    // "-x" passes the name pattern, so it is refused for having no folder instead.
    eq(`project ${JSON.stringify(bad)} is refused`, r.code, bad === "-x" ? 1 : 2);
  }
  const none = await trial(["--trial", "--project", "nope", "--root", ROOT, "--commands-file", COMMANDS]);
  eq("no such folder: exit 1", none.code, 1);
  ok("it names the project", /"nope"/.test(none.stderr), none.stderr);
  eq("no flags", (await trial(["--trial"])).code, 2);
  eq("an unknown flag", (await trial(trialArgs(["--wat"]))).code, 2);
  for (const limit of ["0", "-1", "abc"]) eq(`limit ${limit}`, (await trial(trialArgs(["--limit-min", limit]))).code, 2);
  eq("a missing commands file", (await trial(["--trial", "--project", "proj", "--root", ROOT, "--commands-file", "/no/such"])).code, 2);
  const blank = path.join(SCRATCH, "blank.txt");
  fs.writeFileSync(blank, "\n  \n");
  eq("an empty commands file", (await trial(["--trial", "--project", "proj", "--root", ROOT, "--commands-file", blank])).code, 2);
  eq("none of those started an agent", calls().length, 0);
  nothingLeft("after refusals");
}

section("a command never reaches a shell or a log line");
{
  const marker = path.join(SCRATCH, "shell-ran");
  const hostile = path.join(SCRATCH, "hostile.txt");
  const secret = `SECRET-$(touch ${marker})-\`touch ${marker}\`-; touch ${marker}`;
  fs.writeFileSync(hostile, `${secret}\n`);
  for (const mode of [undefined, "stderr-fail"]) {
    reset(mode);
    const r = await trial(["--trial", "--project", "proj", "--root", ROOT, "--commands-file", hostile]);
    ok("it arrives whole, in the prompt", calls()[0].args.at(-1).includes(`1. ${secret}\n`));
    ok("not on stdout or stderr", !`${r.stdout}${r.stderr}`.includes("SECRET"));
  }
  ok("no shell ran it", !fs.existsSync(marker));
  nothingLeft("after hostile commands");

  // A NUL byte makes execFile throw, after the worktree exists.
  fs.writeFileSync(hostile, "a\0b\n");
  reset();
  const r = await trial(["--trial", "--project", "proj", "--root", ROOT, "--commands-file", hostile]);
  eq("a NUL byte: exit 1", r.code, 1);
  ok("the command is not quoted", !r.stderr.includes("a\0b"));
  nothingLeft("after a NUL byte");
}

section("the dry run");
{
  reset();
  const r = await trial(trialArgs(), { COCKPIT_JOBS_DRY_RUN: "1" });
  eq("exit 0", r.code, 0);
  ok("prints the argv", /argv: \["claude","-p"/.test(r.stdout), r.stdout);
  eq("no agent", calls().length, 0);
  nothingLeft("after a dry run");
}

section("exceptions that are not honoured are said");
{
  fs.writeFileSync(WALL_FILE, "not json");
  reset();
  const r = await trial();
  eq("an unreadable list still runs", r.code, 0);
  ok("and says so", /could not be read/.test(r.stderr), r.stderr);
  ok("the list was not moved or rewritten", fs.readFileSync(WALL_FILE, "utf8") === "not json");
  fs.writeFileSync(WALL_FILE, JSON.stringify({ version: 1, projects: { proj: { sites: ["github.com"], localPorts: false, write: [] } } }));
  reset();
  const d = await trial();
  ok("a dropped exception is said", /ignored because it is not allowed: .*github\.com/.test(d.stderr), d.stderr);
  ok("and is not in the wall", !settingsOf(calls()[0].args).sandbox.network.allowedDomains.includes("github.com"));
  ok("no note file", !fs.existsSync(path.join(SCRATCH, "notes.json")));
  fs.rmSync(WALL_FILE);
}

section("the wall is a real start's wall");
{
  // Both through buildWallFor; only the worktree in it differs, which is the point of naming it.
  fs.writeFileSync(WALL_FILE, JSON.stringify({ version: 1, projects: { proj: { sites: ["example.org"], localPorts: true, write: [] } } }));
  const wallFor = buildWallFor({ projectsRoot: ROOT, home: os.homedir() });
  const wall = wallFor("proj", "same-name");
  const event = { id: "e", start: Date.UTC(2026, 10, 1, 20), end: Date.UTC(2026, 10, 1, 21) };
  const real = buildClaudeArgs({ event, project: "proj", item: "x", instructions: "y", zone: "UTC", wall });
  const tr = buildTrialArgs({ settings: wall.settings, commands: ["z"] });
  eq("the settings are byte for byte the same", flag(tr, "--settings"), flag(real, "--settings"));
  for (const name of ["--permission-mode", "--setting-sources", "--mcp-config", "--disallowedTools"]) {
    eq(`${name} is the same`, flag(tr, name), flag(real, name));
  }
  ok("both turn connectors off", tr.includes("--strict-mcp-config") && real.includes("--strict-mcp-config"));

  // And what the command really passes differs from a real start's only by the worktree.
  reset();
  await trial();
  const passed = flag(calls()[0].args, "--settings");
  const name = path.basename(calls()[0].cwd);
  const sameWorktree = JSON.stringify(wallFor("proj", name).settings);
  eq("the command passes exactly what buildWallFor gives", passed, sameWorktree);
  fs.rmSync(WALL_FILE);

  let threw = false;
  try { buildTrialArgs({ commands: ["z"] }); } catch { threw = true; }
  ok("no settings: it throws, as a real start does", threw);
  const args = buildTrialArgs({ settings: wall.settings, commands: ["--dangerously-skip-permissions"] });
  ok("a command cannot become a flag", !args.includes("--dangerously-skip-permissions"));
  ok("the prompt does not begin with a dash", !args.at(-1).startsWith("-"));
  eq("a flag follows --disallowedTools", flag(args, "--disallowedTools") && args[args.indexOf("--disallowedTools") + 2], "--append-system-prompt");
  eq("a flag follows --mcp-config", args[args.indexOf("--mcp-config") + 2], "--disallowedTools");
}

done();
