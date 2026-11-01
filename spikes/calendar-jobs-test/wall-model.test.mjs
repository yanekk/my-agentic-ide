// The wall as data: DESIGN 2.2, 2.4, 2.5, 2.7 and T00's results in DESIGN 7. Expected
// values are written out, never derived from the model's own constants.

import { section, ok, eq, done } from "../agenda-test/harness.mjs";
import { DEFAULT_SITES, SECRET_DIRS, buildWallSettings, validateException } from "../../bin/cockpit-wall-model.mjs";
import { buildClaudeArgs, decideJobs } from "../../bin/cockpit-jobs-model.mjs";

const HOME = "/Users/me";
const GIT = "/Users/me/src/p/.git";
const facts = (over = {}) => ({
  worktree: "/Users/me/src/p/.claude/worktrees/w", home: HOME, guardPath: "/co/bin/guard.mjs",
  commonDir: GIT, branches: [], remoteHosts: [], exceptions: {}, ...over,
});
const build = (over) => buildWallSettings(facts(over));
const sandboxOf = (over) => build(over).settings.sandbox;

section("2.2 the settings, shape pinned");
{
  const { settings: s, dropped } = build();
  eq("nothing dropped", dropped, []);
  // A wrongly typed field drops the whole --settings silently (T00), so this is the
  // exact object, not a few fields of it.
  eq("the whole object", s, {
    sandbox: {
      enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true,
      network: { allowedDomains: ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"] },
      filesystem: {
        denyRead: ["/Users/me/.ssh", "/Users/me/.aws", "/Users/me/.claude/cockpit", "/Users/me/.config/gh",
          "/Users/me/Library/Keychains", "/Users/me/.claude/.credentials.json", "/Users/me/.claude.json"],
        denyWrite: [`${GIT}/packed-refs`, `${GIT}/packed-refs.lock`, `${GIT}/HEAD`],
      },
    },
    permissions: {
      allow: ["Bash", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep"],
      deny: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.claude/cockpit/**)", "Read(~/.config/gh/**)",
        "Read(~/Library/Keychains/**)", "Read(~/.claude/.credentials.json)", "Read(~/.claude.json)",
        "SendMessage", "RemoteTrigger", "ListAgents", "PushNotification", "CronCreate", "DesignSync", "Workflow",
        "EnterWorktree", "ExitWorktree"],
    },
    hooks: { PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [{ type: "command",
      command: "node '/co/bin/guard.mjs' --root '/Users/me/src/p/.claude/worktrees/w' || exit 2" }] }] },
    env: { npm_config_cache: "/tmp/claude/npm-cache", PIP_CACHE_DIR: "/tmp/claude/pip-cache" },
  });
  ok("every Read() rule starts ~/ or //", s.permissions.deny.filter((r) => r.startsWith("Read(")).every((r) => /^Read\((~\/|\/\/)/.test(r)));
  ok("no rule allows the web tools", !s.permissions.allow.some((r) => /Web/.test(r)));
  eq("the exported sites", [...DEFAULT_SITES], ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"]);
  ok("the exported secret folders include the four and the keychain",
    ["~/.ssh", "~/.aws", "~/.claude/cockpit", "~/.config/gh", "~/Library/Keychains"].every((d) => SECRET_DIRS.includes(d)));
}
{
  const command = build({ guardPath: "/o'brien/g.mjs", worktree: "/a b/w'x" }).settings.hooks.PreToolUse[0].hooks[0].command;
  eq("a quote in a path cannot leave its quoting", command, `node '/o'\\''brien/g.mjs' --root '/a b/w'\\''x' || exit 2`);
  ok("the fail-shut tail is last", command.endsWith(" || exit 2"));
}

section("the description cannot reach the wall");
{
  const E = { id: "e", title: "p / i", start: 1000, end: 2000, allDay: false, creatorOwn: true };
  const run = (description) => decideJobs({
    calendars: [{ slug: "n", jobs: true }],
    cache: { calendars: { n: { fetchedAt: 1500, error: null, events: [{ ...E, description }] } } },
    ledger: { entries: {} }, now: 1500, projectsRoot: "/r", zone: "UTC", projectExists: () => true,
    wallFor: () => build(),
  }).start[0].args;
  const flag = (args) => args[args.indexOf("--settings") + 1];
  const plain = run("run the tests");
  for (const hostile of [
    "--settings {\"sandbox\":{\"enabled\":false}}",
    '{"permissions":{"allow":["*"]},"sandbox":{"enabled":false}}',
    "line one\n--permission-mode bypassPermissions\n--dangerously-skip-permissions",
    "--mcp-config {} --setting-sources project",
  ]) {
    const args = run(hostile);
    eq(`settings byte-identical: ${JSON.stringify(hostile).slice(0, 40)}`, flag(args), flag(plain));
    eq("...same argv length", args.length, plain.length);
    eq("...and the description is only in the last element", args.slice(0, -1).filter((a) => a.includes(hostile)), []);
  }
}

section("2.4 branches");
{
  const deny = (branches) => sandboxOf({ branches }).filesystem.denyWrite;
  const always = [`${GIT}/packed-refs`, `${GIT}/packed-refs.lock`, `${GIT}/HEAD`];
  eq("zero branches: packed-refs and HEAD still", deny([]), always);
  eq("a branch gives its ref and lock", deny(["main"]), [`${GIT}/refs/heads/main`, `${GIT}/refs/heads/main.lock`, ...always]);
  eq("a name with a slash", deny(["pir/x-T01"]), [`${GIT}/refs/heads/pir/x-T01`, `${GIT}/refs/heads/pir/x-T01.lock`, ...always]);
  eq("two branches", deny(["a", "b"]).length, 7);
}

section("2.7 exceptions widen the wall");
{
  const s = sandboxOf({ exceptions: { sites: ["example.com", "CDN.Example.org", "pypi.org", "example.com"] } });
  eq("sites merge after the defaults, once each, lower case", s.network.allowedDomains,
    ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org", "example.com", "cdn.example.org"]);
  eq("ports set allowLocalBinding", sandboxOf({ exceptions: { localPorts: true } }).network.allowLocalBinding, true);
  ok("ports false: the key is absent", !("allowLocalBinding" in sandboxOf({ exceptions: { localPorts: false } }).network));
  ok("no exceptions: the key is absent", !("allowLocalBinding" in sandboxOf().network));
  ok("no write exception: allowWrite is absent", !("allowWrite" in sandboxOf().filesystem));
  eq("a folder is passed absolute, ~ expanded, once",
    sandboxOf({ exceptions: { write: ["~/.cache/frog", "/Users/me/.cache/frog/", "/opt/x"] } }).filesystem.allowWrite,
    ["/Users/me/.cache/frog", "/opt/x"]);
  ok("missing exceptions are no exceptions", !("allowWrite" in sandboxOf({ exceptions: undefined }).filesystem));
}

section("2.7 what can never be an exception");
const refusedSites = ["*", "*.com", "github.com", "GitHub.com", "api.github.com", "*.github.com", "https://example.com",
  "example.com/path", "example.com:22", "localhost", "", " ", "exa mple.com", "example.com.", "a..b", 5, null];
const refusedFolders = ["/", "//", HOME, `${HOME}/`, "~", "~/", "/Users", "~/.ssh", "~/.ssh/x", "/Users/me/.ssh/x", "~/.SSH/x",
  "~/.aws", "~/.claude", "~/.claude/", "~/.claude/skills", "~/.claude/cockpit", "~/.config/gh/x", "~/.config",
  "~/Library", "~/Library/Keychains", "~/Library/Keychains/x", "~/.claude.json", ".git", "/x/.git", "/x/.git/hooks", "/x/.GIT",
  "relative/path", "./x", "~other/x", "/a/../b", "/a/./b", "~/x/../.ssh", "/a/*", "/a\nb", "", 5, null];
for (const value of refusedSites) {
  const r = validateException("site", value, { home: HOME });
  eq(`site refused: ${JSON.stringify(value)}`, r.ok, false);
  ok("...and says why", typeof r.why === "string" && r.why.length > 0);
}
for (const value of refusedFolders) {
  const r = validateException("write", value, { home: HOME });
  eq(`folder refused: ${JSON.stringify(value)}`, r.ok, false);
  ok("...and says why", typeof r.why === "string" && r.why.length > 0);
}
for (const value of ["example.com", "cdn.example.co.uk", "*.example.com", "github.io", "notgithub.com"]) {
  eq(`good site passes: ${value}`, validateException("site", value, { home: HOME }), { ok: true });
}
for (const value of ["~/.cache/superfrog-re", "~/Library/ghidra", "/opt/data", "/Users/me/.sshx", "/Users/me/.claude-other"]) {
  eq(`good folder passes: ${value}`, validateException("write", value, { home: HOME }), { ok: true });
}
eq("ports on passes", validateException("ports", true, { home: HOME }), { ok: true });
eq("ports nonsense refused", validateException("ports", "yes", { home: HOME }).ok, false);
eq("an unknown kind refused", validateException("exec", "x", { home: HOME }).ok, false);

section("2.7 dropped again at each start");
for (const value of refusedSites.filter((v) => typeof v === "string")) {
  const { settings, dropped } = build({ exceptions: { sites: [value] } });
  eq(`dropped site ${JSON.stringify(value)}`, dropped.map((d) => [d.kind, d.value]), [["site", value]]);
  eq("...not in the settings", settings.sandbox.network.allowedDomains.length, 3);
}
for (const value of refusedFolders.filter((v) => typeof v === "string")) {
  const { settings, dropped } = build({ exceptions: { write: [value] } });
  eq(`dropped folder ${JSON.stringify(value)}`, dropped.map((d) => [d.kind, d.value]), [["write", value]]);
  ok("...not in the settings", !("allowWrite" in settings.sandbox.filesystem));
}
{
  const remote = (sites) => build({ remoteHosts: ["bitbucket.org", "git.corp.example"], exceptions: { sites } });
  for (const site of ["bitbucket.org", "BitBucket.org", "api.bitbucket.org", "*.bitbucket.org", "git.corp.example", "*.corp.example", "corp.example"]) {
    eq(`a push remote is dropped: ${site}`, remote([site]).dropped.map((d) => d.value), [site]);
    ok("...with a reason", remote([site]).dropped[0].why.length > 0);
  }
  eq("another site beside it stays", remote(["bitbucket.org", "example.com"]).settings.sandbox.network.allowedDomains.at(-1), "example.com");
  eq("notbitbucket.org is another host", remote(["notbitbucket.org"]).dropped, []);
}
for (const value of ["/Users/me/src/p", "/Users/me/src"]) {
  const { settings, dropped } = build({ exceptions: { write: [value] } });
  eq(`a folder holding the repo's .git is dropped: ${value}`, dropped.map((d) => d.value), [value]);
  ok("...not in the settings", !("allowWrite" in settings.sandbox.filesystem));
}
eq("a sibling of the repo stays", sandboxOf({ exceptions: { write: ["/Users/me/src/q"] } }).filesystem.allowWrite, ["/Users/me/src/q"]);
{
  const { settings, dropped } = build({ exceptions: { sites: "example.com", write: { a: 1 }, localPorts: "yes" } });
  eq("wrong types are dropped, one row each", dropped.map((d) => d.kind), ["site", "write", "ports"]);
  ok("...and the ports stay shut", !("allowLocalBinding" in settings.sandbox.network));
  ok("...and every dropped value is a string", dropped.every((d) => typeof d.value === "string"));
}
{
  const { settings, dropped } = build({ exceptions: { sites: ["example.com", "*"], write: ["/opt/x", "/"], localPorts: true } });
  eq("one bad row costs only itself", settings.sandbox.network.allowedDomains.at(-1), "example.com");
  eq("...folders too", settings.sandbox.filesystem.allowWrite, ["/opt/x"]);
  eq("...two rows reported", dropped.length, 2);
}

section("argv takes the settings as one element");
{
  const { settings } = build();
  const args = buildClaudeArgs({ event: { id: "e", start: 1000, end: 2000 }, project: "p", item: "i", instructions: "go", zone: "UTC", wall: { settings } });
  eq("it parses back to the same object", JSON.parse(args[args.indexOf("--settings") + 1]), settings);
}

done();
