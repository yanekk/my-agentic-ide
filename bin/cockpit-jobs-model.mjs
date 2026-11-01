// cockpit-jobs-model -- what a jobs-calendar entry means and what happens to it.
//
// PURE side of the boundary (calendar-agents DESIGN 3.1): events, ledger and the
// time arrive as arguments, decisions and argv leave as return values. It reads no
// clock, file, environment or network, so a whole night of behaviour is a
// millisecond test. spikes/calendar-jobs-test/run.sh greps this file; if that grep
// fails, MOVE THE CODE, never relax the grep.
//
// node:crypto is allowed: a hash of the event id is a function of its input.

import { createHash } from "node:crypto";
import { safeText } from "./cockpit-agenda-model.mjs";

const FRESH_MS = 5 * 60 * 1000;   // DESIGN 2.3

// --- plain text ------------------------------------------------------------

// Only real HTML names count as tags. A description is often plain text with code
// in it, and a generic "<word ...>" pattern would eat `cat <in >out` or a `<branch>`
// placeholder from the instructions of an agent nobody is watching. An unknown tag
// surviving as text is harmless; a lost shell redirect is not.
const HTML_TAGS = "a|abbr|b|big|blockquote|br|center|code|del|div|em|font|h[1-6]|hr|html-blob|html|body|head|i|ins|li|ol|p|pre|s|small|span|strike|strong|sub|sup|table|tbody|td|th|thead|tr|tt|u|ul";
// Quoted attributes are consumed whole, because a URL can legally hold a ">".
// After a tag name only name=value counts as an attribute: single letters are tag
// names too, so anything looser reads `sort <a >b` and `x <b and c> d` as tags.
const ATTR = `\\s+[^\\s"'<>/=]+\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'<>]+)`;
const TAG = new RegExp(`</?(?:${HTML_TAGS})(?:(?:${ATTR})+\\s*)?(?:\\s*/)?>`, "gi");
const LINE_BREAK = /<br\s*\/?>|<\/(?:p|div|li)\s*>/gi;

// &nbsp; and the numeric apostrophes are beyond DESIGN 2.2's five names: Google's
// editor writes them, and a description of just "&nbsp;" must read as empty.
const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
  "&#39;": "'", "&#x27;": "'", "&nbsp;": " ",
};

/** A Google description, as HTML or as plain text, to plain text. */
export function plainText(html) {
  return String(html ?? "")
    .replace(LINE_BREAK, "\n")
    .replace(TAG, "")
    // One pass, after the tags: "&lt;b&gt;" stays the literal text <b>, and
    // "&amp;lt;" stays the literal text &lt;.
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/gi, (m) => ENTITIES[m.toLowerCase()])
    .trim();
}

// --- one entry -------------------------------------------------------------

// The pattern is what stops a title walking out of the projects root.
export function validProjectName(name) {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}

// The title is untrusted and ends up in the agent's name. The fleet header is
// `──── name ─` and HEADER in cockpitd.mjs ends the name at whitespace before a `─`,
// so one in the item would cut the name short and the daemon could not resolve it.
function cleanItem(text) {
  return safeText(text).replace(/─/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * What the entry says, or why it cannot be run. The title is `{project} / {item}`,
 * split at the first slash, so an item may hold more of them. The folder's existence
 * is decideJobs' check, because it needs the injected projectExists.
 * creatorOwn must be strictly true: this is a security rule, so a malformed value
 * refuses rather than passes.
 */
export function parseJob(event) {
  if (event.allDay) return { refuse: "all-day" };
  if (event.creatorOwn !== true) return { refuse: "not-yours" };
  const title = String(event.title ?? "");
  const slash = title.indexOf("/");
  const item = slash < 0 ? "" : cleanItem(title.slice(slash + 1));
  if (!item) return { refuse: "bad-title" };
  const project = title.slice(0, slash).trim();
  if (!validProjectName(project)) return { refuse: "bad-project", project };
  const instructions = plainText(event.description);
  if (!instructions) return { refuse: "empty" };
  return { project, item, instructions };
}

// --- time, in the zone passed ----------------------------------------------

const formatters = new Map();

function formatter(zone) {
  const name = typeof zone === "string" && zone ? zone : "UTC";
  let dtf = formatters.get(name);
  if (dtf) return dtf;
  try {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: name, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    // A bad zone must not stop a job; UTC is wrong by an hour or two, and matches
    // what the agenda model does with one.
    dtf = formatter("UTC");
  }
  formatters.set(name, dtf);
  return dtf;
}

function civil(ts, zone) {
  const out = {};
  for (const p of formatter(zone).formatToParts(new Date(ts))) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

// --- what the agent is told ------------------------------------------------

/** The long-command sentence is the wording calendar-agents T00 ran for 75 minutes. */
export function buildPreamble({ end, zone }) {
  const { hour, minute } = civil(end, zone);
  return [
    "Nobody is present, and nobody will answer until morning. Never wait for a reply and never ask a question.",
    "When a choice comes up, make the most defensible decision and record it.",
    "Work only in the current worktree, on its branch, and commit there. Never push and never merge.",
    "The machine enforces a wall around this run. It blocks writing outside this worktree, moving existing git branches, reading secret folders such as ~/.ssh, any site other than the package registries, pushing, connectors, and messages to other sessions.",
    "Do not try to work around a block. Carry on with what you can still do, commit that, and list each block in your final message.",
    "Run each git command alone and in its plain form: a line mixing git with other commands, or using git -c, is refused.",
    `The deadline is ${hour}:${minute}, so wrap up by then.`,
    "Run long commands in the background with the longest time limit allowed and do not end your turn until they have finished.",
    "Do not end your turn while work is still running.",
    "Your final message is the report. State the outcome, what was done, the decisions taken, each thing the wall blocked, and what is left.",
  ].join("\n");
}

// The tail of an instance id is a timestamp recurring events share, so the name
// needs a hash of the id, not a slice of it (DESIGN 2.4).
function id4(id) {
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 4);
}

const NAME_ITEM_MAX = 30;
const characters = new Intl.Segmenter("en", { granularity: "grapheme" });

// A fleet header too long for its pane is truncated, and the daemon can no longer
// resolve the agent from it, so the name's length is bounded. Whole graphemes, so an
// emoji is never cut in half. The full title stays on the entry and in the notes.
function clipItem(item) {
  return Array.from(characters.segment(item), (s) => s.segment).slice(0, NAME_ITEM_MAX).join("").trim();
}

/** The folder name `-w` is given. decideJobs needs it first, to ask for the wall. */
export function worktreeName({ event, zone }) {
  const { year, month, day, hour, minute } = civil(event.start, zone);
  return `cal-${year}${month}${day}-${hour}${minute}-${id4(event.id)}`;
}

// What makes a run walled, shared by a real start and a trial so they cannot drift.
// --mcp-config and --disallowedTools take several values, so a flag must follow each
// or it would swallow the prompt (measured: the agent sat idle with its prompt read as
// deny rules). Every caller puts --append-system-prompt next.
// --setting-sources user: a project's committed hook otherwise runs outside the sandbox.
function wallFlags(settings) {
  return [
    "--settings", JSON.stringify(settings),
    "--setting-sources", "user",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--disallowedTools", "AskUserQuestion",
  ];
}

/**
 * The argv for execFile("claude", ...).
 * The date and id stay in the name after the item: a recurring entry repeats its
 * title, and the daemon leaves the panes alone on an ambiguous name.
 * The prompt's fixed first line keeps it from beginning with "-", which Claude's
 * option parser would read as a flag whatever execFile does.
 * With no wall this throws, because an agent with none must never be started.
 */
export function buildClaudeArgs({ event, project, item, instructions, zone, wall }) {
  if (!wall?.settings) throw new TypeError("a start needs its wall");
  const { month, day, hour, minute } = civil(event.start, zone);
  const tag = id4(event.id);
  return [
    "--bg",
    "-n", `${project} / ${clipItem(item)} ${month}-${day} ${hour}:${minute} ${tag}`,
    "--permission-mode", "dontAsk",
    "-w", worktreeName({ event, zone }),
    ...wallFlags(wall.settings),
    "--append-system-prompt", buildPreamble({ end: event.end, zone }),
    `Instructions from the calendar entry:\n${instructions}`,
  ];
}

// --- the trial (DESIGN 2.10) -------------------------------------------------

const TRIAL_PREAMBLE = [
  "This is a trial of a scheduled job. Nobody is present: never wait for a reply and never ask a question.",
  "The machine enforces a wall around this run. Do not try to work around a block; record it and go on to the next command.",
  "Run each git command alone and in its plain form: a line mixing git with other commands, or using git -c, is refused.",
  "Run long commands with the longest time limit allowed and do not end your turn until they have finished.",
].join("\n");

/**
 * The argv for `claude -p`, with the wall a real start gets. Without settings it throws,
 * as buildClaudeArgs does. The prompt's fixed first line keeps a command from being read
 * as one of Claude's flags, and each command stays on its own numbered line.
 */
export function buildTrialArgs({ settings, commands }) {
  if (!settings) throw new TypeError("a trial needs its wall");
  const list = commands.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return [
    "-p",
    "--model", "haiku",
    "--permission-mode", "dontAsk",
    ...wallFlags(settings),
    "--append-system-prompt", TRIAL_PREAMBLE,
    "Run these commands in order, each one even if an earlier one failed. Do not fix anything and do not commit anything.\n"
      + `${list}\n`
      + "Your final message is the report: for each command, whether it passed, and each thing the wall blocked.",
  ];
}

// --- the notes the owner reads ---------------------------------------------

const REFUSALS = {
  "bad-title": () => 'its title must read "project / item name"',
  "bad-project": (project) => `no project folder is named "${oneLine(project, 60)}"`,
  empty: () => "its description is empty",
  "all-day": () => "it is an all-day entry, so it has no start time",
  "not-yours": () => "it was not created by the calendar's owner",
};

// Titles and Claude's error are not ours: strip control characters, because this
// lands in the pane, and bound the length, because a note is one line.
function oneLine(text, max = 120) {
  const line = safeText(String(text ?? "").split("\n")[0]).trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The text of one note. `detail` holds what the kind needs: refused { title, reason,
 * project }, missed { title }, failed { title, line }, unknown { title }, auth { slug },
 * gone { slug }, corrupt { path }, wall { title, line }, wall-list { project },
 * wall-dropped { project, value }. Auth, gone, corrupt and unknown are written by the tick, not by
 * decideJobs; the words all live here.
 */
export function noteText(kind, detail = {}) {
  const title = oneLine(detail.title, 60) || "(no title)";
  const slug = oneLine(detail.slug, 60);
  switch (kind) {
    case "refused": {
      const why = Object.hasOwn(REFUSALS, detail.reason) ? REFUSALS[detail.reason](detail.project) : oneLine(detail.reason);
      return `Calendar entry "${title}" not started: ${why}.`;
    }
    case "missed":
      return `Calendar entry "${title}" skipped: it ended before it could start.`;
    case "failed":
      return `Calendar entry "${title}" failed to start: ${oneLine(detail.line)}`;
    case "unknown":
      return `Calendar entry "${title}" may not have started: the cockpit stopped while starting it. It will not be retried; check the agent list.`;
    case "auth":
      return `Jobs calendar "${slug}" lost its sign-in, so its entries will not start. Run: agenda add ${slug}`;
    case "gone":
      return `Jobs calendar "${slug}" can no longer be found, so its entries will not start. Run: agenda rm ${slug}`;
    case "corrupt":
      return `The calendar job record was unreadable and was moved to ${oneLine(detail.path, 200)}. Entries that had already started will not run again.`;
    case "wall":
      return `Calendar entry "${title}" not started: its wall could not be set up (${oneLine(detail.line)}). It will not be retried.`;
    case "wall-list":
      return `The wall exceptions list could not be read, so "${oneLine(detail.project, 60)}" started with none. A run that hits a block reports it. Check: agenda wall`;
    case "wall-dropped":
      return `A wall exception for "${oneLine(detail.project, 60)}" was ignored because it is not allowed: ${oneLine(detail.value, 80)}`;
    default:
      return `Calendar job: ${oneLine(kind)} ${oneLine(detail.title)}`.trim();
  }
}

// --- the decision ----------------------------------------------------------

function askWall(wallFor, project, name) {
  try {
    const wall = wallFor(project, name);
    if (wall?.settings) return wall;
    return { unavailable: wall?.unavailable ?? "no wall was given" };
  } catch (e) {
    // The constructor name only: the message can carry anything.
    return { unavailable: `${e?.name ?? "Error"} while working it out` };
  }
}

/**
 * What to do right now, a function of its arguments alone. DESIGN 2.2, 2.3, 2.7.
 *
 * `ledgerChanges` holds refused and missed. A started entry is NOT in it: the tick
 * writes `starting` itself immediately before it runs Claude (DESIGN 2.7), so what
 * is decided and what is recorded cannot be split across two writers.
 *
 * `wallFor(project, worktreeName)` gives { settings, dropped, listUnreadable? } or
 * { unavailable: reason }. Anything else, a throw or no wallFor at all reads as
 * unavailable: this is what stops an unconfined start, so it fails shut.
 */
export function decideJobs({ calendars, cache, ledger, now, projectsRoot, zone, projectExists, wallFor }) {
  const start = [];
  const notes = [];
  const ledgerChanges = [];
  const decided = ledger?.entries ?? {};
  const notBefore = ledger?.notBefore;
  const root = String(projectsRoot ?? "").replace(/\/+$/, "");
  // Two rows with one key would be two agents, and the ledger would only record one.
  const seen = new Set();

  for (const cal of Array.isArray(calendars) ? calendars : []) {
    if (cal.jobs !== true) continue;
    const entry = cache?.calendars?.[cal.slug];
    // A stale cache can still hold a deleted entry, and starting one is worse than
    // starting late. Nothing at all is decided on it, not even `missed`.
    if (!entry || entry.error != null || !(now - entry.fetchedAt <= FRESH_MS)) continue;

    for (const event of Array.isArray(entry.events) ? entry.events : []) {
      // A row with no usable times cannot be judged, and formatting one would throw
      // and cost every other entry its start. normaliseEvent never writes one, so
      // this only meets a damaged cache, and the next fetch replaces that.
      if (!Number.isFinite(event?.start) || !Number.isFinite(event?.end)) continue;
      const key = `${cal.slug}/${event.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (Object.hasOwn(decided, key)) continue;
      // A fetch without the job fields, not an entry without an owner. Reading it
      // as "not yours" would refuse the entry for good.
      if (typeof event.creatorOwn !== "boolean") continue;
      // A fresh ledger after corruption: an entry still inside its window may
      // already have run (DESIGN 2.7).
      if (Number.isFinite(notBefore) && event.start < notBefore) continue;
      // Turning the flag on must not report the calendar's history as missed.
      if (Number.isFinite(cal.jobsSince) && event.end < cal.jobsSince) continue;

      // Before the faults, because an ended entry is skipped whatever else is wrong.
      if (now >= event.end) {
        ledgerChanges.push({ key, state: "missed" });
        notes.push({ key, text: noteText("missed", { title: event.title }) });
        continue;
      }
      // Judged at its start and not before, so it can be corrected until then.
      if (now < event.start) continue;

      const job = parseJob(event);
      const reason = job.refuse ?? (projectExists(job.project) ? null : "bad-project");
      if (reason) {
        ledgerChanges.push({ key, state: "refused", reason });
        notes.push({ key, text: noteText("refused", { title: event.title, reason, project: job.project }) });
        continue;
      }
      const wall = askWall(wallFor, job.project, worktreeName({ event, zone }));
      if (!wall.settings) {
        ledgerChanges.push({ key, state: "failed", reason: "wall" });
        notes.push({ key, text: noteText("wall", { title: event.title, line: wall.unavailable }) });
        continue;
      }
      if (wall.listUnreadable) notes.push({ key, text: noteText("wall-list", { project: job.project }) });
      for (const d of wall.dropped ?? []) {
        notes.push({ key, text: noteText("wall-dropped", { project: job.project, value: d.value }) });
      }
      start.push({
        key,
        project: job.project,
        title: event.title,
        cwd: `${root}/${job.project}`,
        args: buildClaudeArgs({ event, project: job.project, item: job.item, instructions: job.instructions, zone, wall }),
        end: event.end,
      });
    }
  }
  return { start, notes, ledgerChanges };
}
