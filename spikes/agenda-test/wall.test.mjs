// `agenda wall`, driven as a real child process against a throwaway COCKPIT_DIR and a
// throwaway HOME: the secret folders it refuses are worked out from HOME, and no test
// may come near the real ones.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { section, ok, eq, done } from "./harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin", "cockpit-agenda.mjs");
const BASE = fs.realpathSync(process.env.COCKPIT_DIR);
const HOME = path.join(BASE, "home");
const PROJECTS = path.join(HOME, "src");
fs.mkdirSync(path.join(PROJECTS, "alpha", ".git"), { recursive: true });
fs.mkdirSync(path.join(PROJECTS, "__proto__", ".git"), { recursive: true });
fs.mkdirSync(path.join(PROJECTS, "plain"), { recursive: true });
fs.mkdirSync(path.join(HOME, ".ssh"), { recursive: true });
fs.mkdirSync(path.join(HOME, "caches"), { recursive: true });
fs.symlinkSync(path.join(HOME, ".ssh"), path.join(HOME, "caches", "innocent"));

let n = 0;
function fresh(panes = true) {
  const dir = path.join(BASE, `d${++n}`);
  fs.mkdirSync(dir);
  if (panes) fs.writeFileSync(path.join(dir, "panes.json"), JSON.stringify({ repo: PROJECTS }));
  return dir;
}
function run(dir, args, { env = {}, cwd = HOME } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: 20_000,
    // Built from nothing: this suite is often run BY an agent, and an inherited
    // CLAUDECODE would turn every change into a refusal.
    env: { PATH: process.env.PATH, HOME, TZ: "UTC", COCKPIT_DIR: dir, ...env },
  });
  return { status: r.status, out: r.stdout, all: r.stdout + r.stderr };
}
const file = (dir) => path.join(dir, "jobs-wall.json");
const bytes = (dir) => { try { return fs.readFileSync(file(dir), "utf8"); } catch { return null; } };
const rows = (dir) => JSON.parse(bytes(dir)).projects;
const wall = (dir, ...args) => run(dir, ["wall", ...args]);

section("each verb adds and removes");
{
  const dir = fresh();
  let r = wall(dir, "alpha", "allow-site", "One.Example.com");
  eq("allow-site exits 0", r.status, 0);
  ok("...and says an allowed site can receive data", /can also receive data/.test(r.out), r.out);
  eq("...stored lower case", rows(dir).alpha.sites, ["one.example.com"]);
  eq("the file is 0600", fs.statSync(file(dir)).mode & 0o777, 0o600);
  eq("the shape is DESIGN 3.5's", JSON.parse(bytes(dir)), { version: 1, projects: { alpha: { sites: ["one.example.com"], localPorts: false, write: [] } } });

  wall(dir, "alpha", "allow-site", "two.example.com");
  wall(dir, "alpha", "allow-site", "one.example.com");
  eq("two sites kept in order, and a repeat changes nothing", rows(dir).alpha.sites, ["one.example.com", "two.example.com"]);

  eq("allow-ports exits 0", wall(dir, "alpha", "allow-ports").status, 0);
  wall(dir, "alpha", "allow-ports");
  eq("...turns ports on", rows(dir).alpha.localPorts, true);

  const folder = path.join(HOME, "caches", "alpha");
  eq("allow-write exits 0 on a folder not made yet", wall(dir, "alpha", "allow-write", folder).status, 0);
  wall(dir, "alpha", "allow-write", folder);
  eq("...stored once", rows(dir).alpha.write, [folder]);

  r = run(dir, ["wall", "alpha", "allow-write", "rel"], { cwd: path.join(HOME, "caches") });
  eq("a relative folder is stored absolute", rows(dir).alpha.write[1], path.join(HOME, "caches", "rel"));
  eq("a quoted ~ is the home folder", [wall(dir, "alpha", "allow-write", "~/tilde").status, rows(dir).alpha.write[2]], [0, path.join(HOME, "tilde")]);

  eq("remove site", [wall(dir, "alpha", "remove", "site", "ONE.example.com").status, rows(dir).alpha.sites], [0, ["two.example.com"]]);
  eq("remove ports", [wall(dir, "alpha", "remove", "ports").status, rows(dir).alpha.localPorts], [0, false]);
  eq("remove write", [wall(dir, "alpha", "remove", "write", folder).status, rows(dir).alpha.write.length], [0, 2]);
  eq("remove write by the ~ form it was typed in", [wall(dir, "alpha", "remove", "write", "~/tilde").status, rows(dir).alpha.write], [0, [path.join(HOME, "caches", "rel")]]);
  eq("removing what is not there is fine", [wall(dir, "alpha", "remove", "site", "nope.example.com").status, rows(dir).alpha.sites], [0, ["two.example.com"]]);

  wall(dir, "alpha", "remove", "site", "two.example.com");
  wall(dir, "alpha", "remove", "write", path.join(HOME, "caches", "rel"));
  eq("the last exception takes the row with it", rows(dir), {});
}

section("usage");
{
  const dir = fresh();
  for (const args of [["alpha", "allow-site"], ["alpha", "allow-site", "a.example.com", "b.example.com"], ["alpha", "allow-ports", "x"], ["alpha", "allow-write"],
    ["alpha", "remove"], ["alpha", "remove", "site"], ["alpha", "remove", "write"], ["alpha", "remove", "ports", "x"], ["alpha", "remove", "bogus", "x"], ["alpha", "open-everything"]]) {
    const r = wall(dir, ...args);
    eq(`\`wall ${args.join(" ")}\` is a usage error with no write`, [r.status, /usage/.test(r.all), bytes(dir)], [1, true, null]);
  }
}

section("an agent may read and may not change");
{
  const dir = fresh();
  wall(dir, "alpha", "allow-site", "one.example.com");
  const before = bytes(dir);
  const asAgent = { env: { CLAUDECODE: "1" } };
  for (const args of [["alpha", "allow-site", "two.example.com"], ["alpha", "allow-ports"], ["alpha", "allow-write", path.join(HOME, "x")],
    ["alpha", "remove", "site", "one.example.com"], ["alpha", "remove", "ports"], ["alpha", "remove", "write", "/x"], ["bad name", "allow-ports"]]) {
    const r = run(dir, ["wall", ...args], asAgent);
    eq(`an agent's \`wall ${args.join(" ")}\` exits 1, file untouched`, [r.status, bytes(dir)], [1, before]);
    ok("...saying it changes what agents may do", /not available to an agent/.test(r.all) && /what agents may do/.test(r.all), r.all);
    ok("...and not that a browser is coming", !/browser/.test(r.all), r.all);
  }
  const list = run(dir, ["wall"], asAgent);
  eq("an agent may list", [list.status, /alpha/.test(list.out)], [0, true]);
  const one = run(dir, ["wall", "alpha"], asAgent);
  eq("an agent may read a project", [one.status, /one\.example\.com/.test(one.out)], [0, true]);
}

section("forbidden values write nothing");
{
  const dir = fresh();
  for (const site of ["*", "github.com", "GitHub.com", "api.github.com", "*.github.com", "*.com", "https://x.example.com", "x.example.com/path", "nodots"]) {
    const r = wall(dir, "alpha", "allow-site", site);
    eq(`site ${site} refused`, [r.status, bytes(dir)], [1, null]);
    ok("...saying why", /cannot be allowed/.test(r.all), r.all);
  }
  const home = (p) => path.join(HOME, p);
  for (const folder of ["/", HOME, "~", home(".ssh"), home(".ssh/sub"), home(".SSH"), home(".aws"), home(".config/gh"), home(".claude"), home(".claude/x"), home(".claude/cockpit"),
    home("Library/Keychains"), path.dirname(HOME), home("src/other/.git"), home("src/alpha"), home("src/alpha/.git/hooks"), PROJECTS, home("x*"), `${home("x")}\nz`,
    "~/.ssh", "~/x/../.ssh", home("caches/innocent"), home("caches/innocent/deeper")]) {
    const r = wall(dir, "alpha", "allow-write", folder);
    eq(`folder ${JSON.stringify(folder.replace(HOME, "~"))} refused`, [r.status, bytes(dir)], [1, null]);
    ok("...saying why", /cannot be allowed/.test(r.all), r.all);
  }
  ok("a link into a secret folder is named as that", /\.ssh/.test(wall(dir, "alpha", "allow-write", home("caches/innocent")).all));
  // path.resolve("") is the cwd, so an unset shell variable would have allowed wherever the person stood.
  const blank = run(dir, ["wall", "alpha", "allow-write", ""], { cwd: home("caches") });
  eq("an empty folder is refused, not read as the cwd", [blank.status, bytes(dir)], [1, null]);
  ok("...saying so", /must be a path/.test(blank.all), blank.all);
  const standing = fresh();
  run(standing, ["wall", "alpha", "allow-write", "."], { cwd: home("caches") });
  run(standing, ["wall", "alpha", "remove", "write", ""], { cwd: home("caches") });
  eq("an empty `remove write` does not take the cwd's row", rows(standing).alpha.write, [home("caches")]);
}

section("project names and folders");
{
  const dir = fresh();
  for (const bad of ["..", ".", "a/b", "../alpha", "a b", ""]) {
    const r = wall(dir, bad, "allow-ports");
    eq(`bad name ${JSON.stringify(bad)} refused`, [r.status, bytes(dir)], [1, null]);
    eq(`...for remove too`, [wall(dir, bad, "remove", "ports").status, bytes(dir)], [1, null]);
    eq(`...and for reading`, wall(dir, bad).status, 1);
  }
  for (const args of [["allow-site", "a.example.com"], ["allow-ports"], ["allow-write", path.join(HOME, "x")]]) {
    for (const missing of ["typo", "plain"]) {
      const r = wall(dir, missing, ...args);
      eq(`${args[0]} on ${missing}, not a project, refused with no write`, [r.status, /no project/.test(r.all), bytes(dir)], [1, true, null]);
    }
  }
  const nopanes = fresh(false);
  const r = wall(nopanes, "alpha", "allow-ports");
  eq("no known projects root refuses with no write", [r.status, /projects root/.test(r.all), bytes(nopanes)], [1, true, null]);

  fs.writeFileSync(file(dir), JSON.stringify({ version: 1, projects: { gone: { sites: ["a.example.com"], localPorts: true, write: [] }, alpha: { sites: ["b.example.com"], localPorts: false, write: [] } } }));
  eq("`remove` works on a project with no folder", [wall(dir, "gone", "remove", "site", "a.example.com").status, rows(dir).gone.sites], [0, []]);
  wall(dir, "gone", "remove", "ports");
  eq("...until the row is gone, leaving the others", Object.keys(rows(dir)), ["alpha"]);

  const proto = fresh();
  eq("__proto__ can be read with nothing there", wall(proto, "__proto__").status, 0);
  eq("__proto__ is an ordinary project", wall(proto, "__proto__", "allow-site", "a.example.com").status, 0);
  eq("...stored as a row", Object.keys(JSON.parse(bytes(proto).replace(/"__proto__"/, '"p"')).projects), ["p"]);
  ok("...shown in the list", /__proto__/.test(wall(proto).out));
  eq("...and removable", [wall(proto, "__proto__", "remove", "site", "a.example.com").status, bytes(proto).includes("__proto__")], [0, false]);
}

section("an unreadable file");
{
  const dir = fresh();
  const junk = "{not json";
  fs.writeFileSync(file(dir), junk);
  for (const args of [[], ["alpha"]]) {
    const r = wall(dir, ...args);
    eq(`reading \`wall ${args.join(" ")}\` says so and exits 1`, [r.status, /cannot be read/.test(r.out)], [1, true]);
    eq("...leaving it where it is, as it was", [bytes(dir), fs.readdirSync(dir).filter((f) => f.includes("corrupt"))], [junk, []]);
  }
  ok("a project's defaults still show", /registry\.npmjs\.org/.test(wall(dir, "alpha").out));
  for (const args of [["allow-site", "a.example.com"], ["allow-ports"], ["allow-write", path.join(HOME, "x")], ["remove", "ports"], ["remove", "site", "a.example.com"]]) {
    const r = wall(dir, "alpha", ...args);
    eq(`\`${args[0]}\` refuses on it with no write`, [r.status, bytes(dir)], [1, junk]);
    ok("...saying rows would be lost", /would lose/.test(r.all), r.all);
  }
}

section("reading");
{
  const dir = fresh();
  ok("nothing yet says so", /no project has an exception/.test(wall(dir).out));
  const plain = wall(dir, "alpha");
  eq("a project with none exits 0", plain.status, 0);
  ok("...showing the defaults", ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"].every((s) => plain.out.includes(s)), plain.out);
  ok("...and no exceptions", /no exceptions/.test(plain.out), plain.out);
  eq("reading writes nothing", bytes(dir), null);

  wall(dir, "alpha", "allow-site", "one.example.com");
  wall(dir, "alpha", "allow-ports");
  const shown = wall(dir, "alpha");
  ok("exceptions are shown", /one\.example\.com/.test(shown.out) && /ports/.test(shown.out), shown.out);
  ok("the list has the project", /^alpha\s.*1 site.*ports/m.test(wall(dir).out));

  // A hand edit can hold anything, and the terminal must survive it.
  fs.writeFileSync(file(dir), JSON.stringify({ version: 1, projects: { alpha: { sites: ["github.com", "evil\u001b]0;x\u0007.example.com", 7], write: "nope", localPorts: "yes" }, "b\u001b[2J": 3 } }));
  const hand = wall(dir, "alpha");
  eq("a hand-edited row still reads", hand.status, 0);
  ok("...marking what a start would ignore", /github\.com.*ignored/.test(hand.out), hand.out);
  ok("...with no escape reaching the terminal", !hand.out.includes("\u001b") && !wall(dir).out.includes("\u001b"), JSON.stringify(hand.out));
  ok("...and localPorts must be exactly true to count", !/local ports allowed/.test(hand.out), hand.out);
}

section("the dry run and the help");
{
  const dir = fresh();
  const r = run(dir, ["wall", "alpha", "allow-ports"], { env: { AGENDA_DRY_RUN: "1" } });
  eq("AGENDA_DRY_RUN=1 changes nothing", [r.status, /nothing written/.test(r.out), bytes(dir)], [0, true, null]);
  const refused = run(dir, ["wall", "alpha", "allow-site", "github.com"], { env: { AGENDA_DRY_RUN: "1" } });
  eq("...and still refuses what would be refused", refused.status, 1);
  const help = run(dir, ["help"]);
  ok("help lists the verb", ["agenda wall <project>", "allow-site", "allow-ports", "allow-write", "remove site|ports|write"].every((s) => help.out.includes(s)), help.out);
}

done();
