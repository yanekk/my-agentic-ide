// The exceptions file: what a read promises about a file it does not like, and the
// mode and atomicity of a write. run.sh hands this suite its own COCKPIT_DIR.

import fs from "node:fs";

import { section, ok, eq, done } from "../agenda-test/harness.mjs";
import { WALL_FILE, readWall, writeWall } from "../../bin/cockpit-wall-store.mjs";

const dirOf = WALL_FILE.replace(/\/[^/]*$/, "");
const clear = () => fs.rmSync(WALL_FILE, { recursive: true, force: true });
const row = { sites: ["a.example.com"], localPorts: false, write: [] };

section("reading");
clear();
{
  const r = readWall();
  eq("an absent file reads as nothing, and readable", [Object.keys(r.projects), r.unreadable], [[], false]);
  eq("...and creates nothing", fs.existsSync(WALL_FILE), false);
}
for (const [what, text] of [["not JSON", "{oops"], ["an array", "[]"], ["no projects", "{\"version\":1}"], ["projects as a list", "{\"projects\":[]}"], ["null", "null"]]) {
  clear();
  fs.writeFileSync(WALL_FILE, text);
  const r = readWall();
  eq(`${what} reads as unreadable, with no rows`, [r.unreadable, Object.keys(r.projects)], [true, []]);
  eq("...and is neither moved nor rewritten", fs.readFileSync(WALL_FILE, "utf8"), text);
  eq("...and nothing is set aside beside it", fs.readdirSync(dirOf).filter((f) => f.includes("corrupt")), []);
}
clear();
fs.mkdirSync(WALL_FILE);
eq("a file that cannot be read at all is unreadable, not empty", readWall().unreadable, true);
clear();

section("writing");
writeWall({ projects: { one: row } });
eq("a write reads back", readWall(), { projects: Object.assign(Object.create(null), { one: row }), unreadable: false });
eq("the file is 0600", fs.statSync(WALL_FILE).mode & 0o777, 0o600);
eq("it carries the version", JSON.parse(fs.readFileSync(WALL_FILE, "utf8")).version, 1);
eq("no temp file is left", fs.readdirSync(dirOf).filter((f) => f.includes(".tmp")), []);
{
  const old = process.umask(0);
  fs.chmodSync(WALL_FILE, 0o644);
  writeWall({ projects: {} });
  process.umask(old);
  eq("a loose file is tightened by the next write", fs.statSync(WALL_FILE).mode & 0o777, 0o600);
}

section("a project called __proto__");
{
  clear();
  const empty = readWall();
  eq("looking it up in nothing finds nothing", empty.projects.__proto__, undefined);
  eq("...nor does constructor", empty.projects.constructor, undefined);
  const { projects } = readWall();
  projects.__proto__ = row;
  writeWall({ projects });
  const back = readWall();
  eq("it survives a write and a read as a row", back.projects.__proto__, row);
  eq("...listed as a key", Object.keys(back.projects), ["__proto__"]);
  eq("...and Object.prototype is untouched", ({}).sites, undefined);
}

clear();
ok("the suite left no file", !fs.existsSync(WALL_FILE));
done();
