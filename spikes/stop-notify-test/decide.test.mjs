// The Stop-hook sound decision: who dings and who does not. The whole point is
// that a PIR worker finishing its task goes quiet while a worker parked on a
// question still dings, and that EVERYTHING else keeps the old unconditional
// ding. Pure functions, no disk, no afplay -- the IO is injected.

import { workerContext, extractKind, latestKind, decideSound, registerIn, unregisterIn }
  from "../../bin/cockpit-stop-notify.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); if (detail) console.log(`       got [${detail}]`); }
};

// --- workerContext: recognise a PIR worker by its worktree ------------------
const wc = (cwd) => workerContext(cwd);
ok("plain slug worktree parses to plan + task",
   JSON.stringify(wc("/Users/x/src/repo/.claude/worktrees/pir-remote-grant-T04"))
     === JSON.stringify({ main: "/Users/x/src/repo", plan: "remote-grant", task: "T04" }));
ok("a deeper cwd inside the worktree still parses",
   wc("/r/.claude/worktrees/pir-single-T12/plans/single/tasks")?.task === "T12");
ok("dashed plan slug is captured whole (anchored on -T{nn})",
   wc("/r/.claude/worktrees/pir-a-b-c-T09")?.plan === "a-b-c");
ok("an ordinary agent worktree is NOT a worker",
   wc("/r/.claude/worktrees/some-agent-thing") === null);
ok("the main checkout is NOT a worker",
   wc("/Users/x/src/repo") === null);
ok("null / empty cwd is not a worker",
   wc(null) === null && wc("") === null && wc(undefined) === null);

// --- extractKind ------------------------------------------------------------
ok("kind from the v1 header",
   extractKind("[pir:v1 kind=question task=T04]\nwhat about X?") === "question");
ok("header kind is lowercased",
   extractKind("[pir:v1 kind=DONE task=T01]") === "done");
ok("falls back to a bare kind: marker",
   extractKind("no header here\nkind: decision\nbody") === "decision");
ok("no kind at all -> null", extractKind("just prose") === null);
ok("non-string -> null", extractKind(null) === null);

// --- latestKind: newest report for THIS task, off an injected fs -------------
// Filenames are `${Date.now()}-${Txx}-${rand}.json`; content is {from,text}.
const rep = (ts, task, kind) => ({
  name: `${ts}-${task}-abc.json`,
  json: JSON.stringify({ from: "w", text: `[pir:v1 kind=${kind} task=${task}]\nx` }),
});
function fakeFs(files) {
  const byName = Object.fromEntries(files.map((f) => [f.name, f.json]));
  return {
    readdirSync: () => Object.keys(byName),
    readFileSync: (p) => {
      const n = p.split("/").pop();
      if (!(n in byName)) throw new Error("ENOENT");
      return byName[n];
    },
    statSync: () => ({ mtimeMs: 0 }),
  };
}
const lk = (files, task = "T04") => latestKind("/main", "plan", task, fakeFs(files));

ok("empty reports dir -> null",
   lk([]) === null);
ok("picks the newest report for the task",
   lk([rep(1000, "T04", "question"), rep(2000, "T04", "implemented")]) === "implemented");
ok("ignores other tasks' reports in the same folder",
   lk([rep(3000, "T09", "question"), rep(2000, "T04", "done")]) === "done");
ok("a question that is the newest wins",
   lk([rep(2000, "T04", "implemented"), rep(3000, "T04", "question")]) === "question");
ok("missing reports dir -> null (readdir throws)",
   latestKind("/main", "plan", "T04", { readdirSync: () => { throw new Error("ENOENT"); },
     readFileSync: () => "", statSync: () => ({ mtimeMs: 0 }) }) === null);
ok("a corrupt report file is skipped, not thrown",
   latestKind("/main", "plan", "T04", {
     readdirSync: () => ["9-T04-a.json", "8-T04-b.json"],
     readFileSync: (p) => p.endsWith("9-T04-a.json") ? "{not json" : JSON.stringify({ text: "[pir:v1 kind=done task=T04]" }),
     statSync: () => ({ mtimeMs: 0 }),
   }) === "done");

// --- decideSound: the whole rule --------------------------------------------
const decide = (cwd, kind) => decideSound({ cwd }, () => kind);
const W = "/r/.claude/worktrees/pir-p-T04";

ok("non-worker always dings (the old behaviour, preserved)",
   decide("/r", null).play === true);
ok("worker, done -> SILENT",
   decide(W, "done").play === false);
ok("worker, implemented -> SILENT",
   decide(W, "implemented").play === false);
ok("worker, question -> DINGS",
   decide(W, "question").play === true);
ok("worker, decision -> DINGS",
   decide(W, "decision").play === true);
ok("worker, conflict -> DINGS (parked waiting for the person)",
   decide(W, "conflict").play === true);
ok("worker with no readable report -> SILENT (default to done)",
   decide(W, null).play === false);
ok("worker, an unknown kind -> SILENT (only needs-person kinds ding)",
   decide(W, "weird").play === false);

// --- registerIn / unregisterIn: settings.json safety ------------------------
const CMD = "/repo/bin/cockpit-stop-notify.mjs";
const stopCmds = (s) => (s.hooks?.Stop ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);

// Superseding the legacy unconditional afplay.
{
  const legacy = { hooks: { Stop: [{ hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff", async: true }] }] } };
  const { settings, replaced } = registerIn(legacy, CMD);
  ok("install removes the legacy afplay Glass line", !stopCmds(settings).includes("afplay /System/Library/Sounds/Glass.aiff"));
  ok("install adds our script", stopCmds(settings).includes(CMD));
  ok("install reports it replaced something", replaced === true);
  ok("our entry keeps async:true", settings.hooks.Stop.at(-1).hooks[0].async === true);
}

// Other people's Stop hooks are left alone.
{
  const other = { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
  const { settings } = registerIn(other, CMD);
  ok("a foreign Stop hook survives install", stopCmds(settings).includes("say done"));
  ok("...and ours is added beside it", stopCmds(settings).includes(CMD));
}

// Re-pointing a moved checkout: drop the old path, add the new, no duplicate.
{
  const old = { hooks: { Stop: [{ hooks: [{ type: "command", command: "/old/bin/cockpit-stop-notify.mjs", async: true }] }] } };
  const { settings } = registerIn(old, CMD);
  const mine = stopCmds(settings).filter((c) => c.endsWith("cockpit-stop-notify.mjs"));
  ok("a moved checkout is re-pointed, not duplicated", mine.length === 1 && mine[0] === CMD);
}

// Idempotence: installing twice changes nothing the second time.
{
  const once = registerIn({}, CMD).settings;
  const twice = registerIn(once, CMD).settings;
  ok("install is idempotent", JSON.stringify(once) === JSON.stringify(twice));
}

// Nothing else in settings is disturbed.
{
  const full = { model: "m", hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "/x/cockpit-auto-name.mjs" }] }] } };
  const { settings } = registerIn(full, CMD);
  ok("unrelated settings survive install", settings.model === "m");
  ok("a UserPromptSubmit hook is untouched",
     settings.hooks.UserPromptSubmit[0].hooks[0].command === "/x/cockpit-auto-name.mjs");
}

// Uninstall removes only ours.
{
  const mixed = { hooks: { Stop: [{ hooks: [
    { type: "command", command: CMD, async: true },
    { type: "command", command: "say done" },
  ] }] } };
  const { settings, removed } = unregisterIn(mixed);
  ok("uninstall removes ours", !stopCmds(settings).includes(CMD));
  ok("uninstall keeps the foreign hook", stopCmds(settings).includes("say done"));
  ok("uninstall reports it removed something", removed === true);
}
{
  const { removed } = unregisterIn({ hooks: { Stop: [{ hooks: [{ command: "say hi" }] }] } });
  ok("uninstall on a settings without ours removes nothing", removed === false);
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
