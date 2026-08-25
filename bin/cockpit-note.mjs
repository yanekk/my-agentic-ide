#!/usr/bin/env node
// note — add, list, edit and remove the cockpit's notes.
//
// Reachable ONLY from inside the cockpit. There is no install step and nothing
// on your normal PATH: bin/cockpit-layout.sh symlinks this to
// ~/.claude/cockpit/bin/note and puts that directory on PATH for the shells it
// and the daemon spawn. Outside a cockpit window `note` simply is not a command.
//
// The agents inherit it too -- they run under the fleet pane, so its environment
// is theirs -- which means an agent can leave you a note ("skipped the flaky
// test, see run.sh:212"). Those are marked with the agent's name so a note you
// wrote and a note you were handed never read the same.
//
//   note "rebase before opening the PR"    add (the short form)
//   note add rebase before the PR          add (quotes optional)
//   note                                   list, newest first
//   note ls
//   note show a3f9                         one note, in full
//   note edit a3f9 [new text]              replace it; no text opens $EDITOR
//   note rm a3f9                           remove it
//
// Ids accept any unique prefix, so the 4 characters in the notes column are
// usually the whole handle you need.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  DIR, absTime, addNote, cockpitRepo, editNote, oneLine,
  readNotes, relTime, removeNote, resolve,
} from "./cockpit-notes.mjs";

const ESC = "\x1b[";
const tty = process.stdout.isTTY;
const dim = (s) => (tty ? `${ESC}2m${s}${ESC}0m` : s);
const bold = (s) => (tty ? `${ESC}1m${s}${ESC}0m` : s);
const cyan = (s) => (tty ? `${ESC}36m${s}${ESC}0m` : s);

const die = (msg) => { console.error(`note: ${msg}`); process.exit(1); };

const USAGE = `note — the cockpit's notes, shown in the right half of the fleet view.

  note "text"            add a note
  note add text...       add a note (quotes optional)
  note                   list, newest first
  note ls
  note show <id>         print one note in full
  note edit <id> [text]  replace the text; without text, open $EDITOR
  note rm <id>           remove it

Ids take any unique prefix. Notes are one line each, kept per repo in
~/.claude/cockpit/notes.json, and never touch the repo itself.`;

// `note help` must answer even where the command should not work at all -- it is
// how you find out what this thing is, and refusing to explain itself is the one
// unhelpful failure mode.
const argv = process.argv.slice(2);
if (["help", "-h", "--help"].includes(argv[0])) { console.log(USAGE); process.exit(0); }

const repo = cockpitRepo();
if (!repo) {
  die("not inside a cockpit (no COCKPIT_REPO and no ~/.claude/cockpit/panes.json).\n" +
      "      This command only exists in cockpit terminals -- open a WezTerm cockpit window.");
}

/**
 * Who is writing? Agent shells are spawned by claude and carry CLAUDECODE, which
 * is the only reliable marker -- CLAUDE_CODE_AGENT holds the agent TYPE
 * ("claude"), not the name you see in the fleet list. The name comes from
 * terminals.json, which the daemon keeps pointed at the attached agent; an agent
 * writing a note is overwhelmingly the one you are attached to. If that is
 * unreadable the note is still attributed to an agent, just an unnamed one --
 * better than silently claiming you wrote it.
 */
function author() {
  if (!process.env.CLAUDECODE) return null;
  try {
    const { agent } = JSON.parse(fs.readFileSync(path.join(DIR, "terminals.json"), "utf8"));
    if (agent && agent !== "repo") return agent;
  } catch { /* no cockpit state yet */ }
  return "claude";
}

const byline = (n) => (n.author ? dim(` — ${n.author}`) : "");

function list() {
  const notes = readNotes(repo);
  if (!notes.length) {
    console.log(dim("no notes yet. `note \"something worth remembering\"` adds one."));
    return;
  }
  const now = Date.now();
  for (const n of notes) {
    console.log(`${cyan(n.id)}  ${dim(relTime(n.ts, now).padEnd(6))}${n.text}${byline(n)}`);
  }
}

function show(id) {
  const notes = readNotes(repo);
  const { note, error } = resolve(notes, id);
  if (!note) die(error);
  console.log(`${cyan(note.id)}  ${dim(absTime(note.ts))}${byline(note)}`);
  console.log(note.text);
}

function add(text) {
  const t = oneLine(text);
  if (!t) die('nothing to add. Try: note "rebase before opening the PR"');
  const n = addNote(repo, t, author());
  console.log(`${cyan(n.id)}  ${dim("added")}  ${n.text}`);
}

/**
 * Edit in $EDITOR when no replacement text is given. The note is one line, so the
 * buffer is one line plus a commented hint; everything commented is dropped and
 * the rest collapses back to a single line. An empty buffer aborts rather than
 * blanking the note -- quitting without saving must be a way out, not a delete.
 */
function editInEditor(note) {
  const editor = process.env.VISUAL || process.env.EDITOR
    || (spawnSync("which", ["nano"], { encoding: "utf8" }).status === 0 ? "nano" : "vi");
  const file = path.join(os.tmpdir(), `cockpit-note-${note.id}-${process.pid}.txt`);
  fs.writeFileSync(file,
    `${note.text}\n\n# Editing note ${note.id}. Notes are ONE LINE: everything above the\n` +
    `# comments is collapsed into one. Lines starting with # are ignored.\n` +
    `# Save an empty buffer to abort -- it will not blank the note.\n`);
  try {
    const r = spawnSync(editor, [file], { stdio: "inherit", shell: false });
    if (r.error || r.status !== 0) die(`editor '${editor}' failed`);
    const text = oneLine(fs.readFileSync(file, "utf8")
      .split("\n").filter((l) => !l.trimStart().startsWith("#")).join(" "));
    if (!text) { console.log(dim("unchanged (empty buffer)")); return; }
    if (text === note.text) { console.log(dim("unchanged")); return; }
    const n = editNote(repo, note.id, text);
    console.log(`${cyan(n.id)}  ${dim("edited")}  ${n.text}`);
  } finally {
    try { fs.unlinkSync(file); } catch { /* the editor may have moved it */ }
  }
}

function edit(id, rest) {
  const { note, error } = resolve(readNotes(repo), id);
  if (!note) die(error);
  const text = oneLine(rest.join(" "));
  if (!text) return editInEditor(note);
  const n = editNote(repo, note.id, text);
  console.log(`${cyan(n.id)}  ${dim("edited")}  ${n.text}`);
}

function remove(id) {
  const { note, error } = resolve(readNotes(repo), id);
  if (!note) die(error);
  removeNote(repo, note.id);
  console.log(`${cyan(note.id)}  ${dim("removed")}  ${note.text}`);
}

// --- dispatch --------------------------------------------------------------
// Bare `note <text>` adds, because adding is what you do a dozen times to every
// once you edit. That costs the literal words below as note text -- `note ls` can
// only ever mean "list" -- which `note add ls` covers.
const [verb, ...rest] = argv;

switch (verb) {
  case undefined:
  case "ls": case "list":            list(); break;
  case "add": case "new":            add(rest.join(" ")); break;
  case "show": case "cat":           show(rest[0]); break;
  case "edit":                       edit(rest[0], rest.slice(1)); break;
  case "rm": case "remove": case "del": case "delete": remove(rest[0]); break;
  default:                           add([verb, ...rest].join(" ")); break;
}
