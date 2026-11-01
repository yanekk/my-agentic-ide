// cockpit-wall-store -- the exceptions a person has allowed through the calendar wall.
//
//   ~/.claude/cockpit/jobs-wall.json  0600
//   { version: 1, projects: { "{project}": { sites: [], localPorts: false, write: [] } } }
//
// Only `agenda wall` writes it, only readers race it, so it is lockless with a
// temp-then-rename (calendar-agent-sandbox DESIGN 3.5). A person's rows live here, so
// nothing quarantines or repairs it: an unreadable file means no exceptions for the
// run (DESIGN 2.7) and stays exactly where it is for that person to fix.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.COCKPIT_DIR || path.join(os.homedir(), ".claude", "cockpit");
export const WALL_FILE = path.join(DIR, "jobs-wall.json");

const MODE = 0o600;

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Never throws. `projects` has no prototype, because a project called `__proto__`
 * passes the title pattern: on a plain object assigning it would change the
 * prototype and drop the row, and looking it up would find Object.prototype.
 */
export function readWall() {
  const projects = Object.create(null);
  let text;
  try { text = fs.readFileSync(WALL_FILE, "utf8"); }
  catch (e) { return { projects, unreadable: e?.code !== "ENOENT" }; }
  let data;
  try { data = JSON.parse(text); } catch { return { projects, unreadable: true }; }
  if (!isObject(data) || !isObject(data.projects)) return { projects, unreadable: true };
  // JSON.parse makes `__proto__` an own key, so copying over the keys keeps it.
  for (const name of Object.keys(data.projects)) projects[name] = data.projects[name];
  return { projects, unreadable: false };
}

export function writeWall({ projects }) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${WALL_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, { mode: MODE });
  // The mode above only applies on creation and is masked by umask.
  fs.chmodSync(tmp, MODE);
  fs.renameSync(tmp, WALL_FILE);
}
