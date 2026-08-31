#!/usr/bin/env node
// cockpit-auto-name -- names every claude session "<repo folder> / <what it is
// doing>", which is the text the fleet list shows and the cockpit reads back out
// of the fleet pane's header.
//
// Left alone, `claude agents` labels a session with a one-line summary Claude
// writes from your first message ("read handoff document"). That reads fine on
// its own and badly in a list of six: nothing says which repo it belongs to, and
// two agents in different projects can look identical. This adds the repo.
//
// It runs as a UserPromptSubmit HOOK -- the only place Claude Code accepts a
// session title from (`hookSpecificOutput.sessionTitle`; measured against the
// 2.1.251 binary, no other hook event carries the field). Registered in
// ~/.claude/settings.json by `--install`, which bin/install.sh calls, so unlike
// `note` and `agenda` this is deliberately NOT cockpit-only: an agent dispatched
// from the fleet view is a plain claude session and gets its name the same way
// one you start in a terminal does.
//
//   <this> < hook-input.json     name the session (what settings.json invokes)
//   <this> --install             register in ~/.claude/settings.json, idempotent
//   <this> --check               say what --install would do, write nothing
//
// The name is picked from the strongest signal available, and a stronger signal
// may later overwrite a weaker one but never the other way round:
//
//   slug (3)         /pir-work <slug>    ->  agentic-ide / cockpit-agenda
//   worktree (2)     .claude/worktrees/… ->  agentic-ide / browse-mode-review
//   aiTitle (1)      Claude's own summary of the session
//   placeholder (0)  the opening words of the first prompt
//
// Two rules are absolute. It must never block a prompt, so every failure path
// exits 0 with no output. And it must never overwrite a name a PERSON typed --
// see backedOff.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";

const DIR = process.env.COCKPIT_DIR || join(homedir(), ".claude", "cockpit");
const STATE_DIR = join(DIR, "auto-names");

const MAX_TITLE = 60;   // the whole title; the fleet list is a narrow column
const MAX_RIGHT = 44;   // the half after the slash
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// placeholder is deliberately lowest: it is the opening words of the FIRST
// prompt, and re-applying it on every later prompt would rename the session
// continuously. It is therefore only ever used for the first naming.
const RANK = { placeholder: 0, aiTitle: 1, worktree: 2, slug: 3 };

const SLUG_RE = /^\s*\/?pir-(?:work|plan|review-plan)\s+([A-Za-z0-9][A-Za-z0-9._-]*)/;

const done = () => process.exit(0);

// ---------------------------------------------------------------- naming ---

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }).trim();
  } catch { return ""; }
}

// The repo name must come from the MAIN checkout, never from `cwd`: an agent
// sits in .claude/worktrees/<name>, where --show-toplevel answers with the
// WORKTREE -- which would file that agent under a second, phantom repo, exactly
// the trap COCKPIT_REPO exists for in cockpit-note.mjs. --git-common-dir points
// into the main checkout's .git from both places.
export function repoContext(cwd) {
  if (!cwd) return null;
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top) return null;
  let common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) {
    // git < 2.31 has no --path-format, and answers relative in a main checkout.
    const raw = git(cwd, ["rev-parse", "--git-common-dir"]);
    common = raw ? resolve(cwd, raw) : "";
  }
  const mainRoot = common ? dirname(common) : top;
  const isWorktree = resolve(mainRoot) !== resolve(top);
  return { repo: basename(mainRoot), worktree: isWorktree ? basename(top) : null };
}

export function tidy(s) {
  return String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?-]+$/, "") + "…";
}

export function placeholder(prompt) {
  let t = tidy(prompt);
  if (!t) return null;
  t = t.replace(/^\/(\S+)\s*/, "$1 ").trim();   // "/foo bar" reads better as "foo bar"
  return t ? clip(t, MAX_RIGHT) : null;
}

// ---------------------------------------------------------- Haiku topic ---

// The guard. Haiku is asked for a kebab label, but a content-free first message
// ("hey") makes it answer with a clarifying SENTENCE instead (measured, spike
// 2026-08-31) -- so the model's output is never trusted, only what survives this.
// One to four lowercase alphanumeric words joined by single dashes; anything
// with spaces, capitals it cannot lowercase away, punctuation, or a sentence in
// it is rejected. A rejected answer is treated exactly like no answer.
export function asLabel(s) {
  const t = String(s ?? "").trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+){0,3}$/.test(t) ? t : null;
}

// The system prompt. Authored here from DESIGN 2.5 / T01's spec -- the spike's
// exact wording was not kept, so its real-message label quality is confirmed
// live with the capped key in T04, not inherited. Examples are the three from
// FINDINGS (2026-08-31).
const LABEL_PROMPT = [
  "You label a coding-agent session for a compact fleet list.",
  "Read the developer's first message and reply with the subject of the work as a 1-3 word topic.",
  "Output ONLY that topic: lowercase, words joined by single hyphens (kebab-case), nothing else.",
  "It is the noun subject, not an instruction -- no verbs, no filler words, no punctuation, no quotes, no explanation.",
  "Examples:",
  '  "implement the OAuth loopback flow" -> oauth-loopback',
  '  "the daemon keeps losing track of which pane is which" -> daemon-panes',
  '  "the calendar tests fail at random on CI" -> flaky-tests',
].join("\n");

// Ask Haiku for a topic, bounded by a hard timeout, and return a validated kebab
// label or null. A naming call must NEVER throw to its caller and never wedge the
// prompt box: every network error, non-2xx, malformed body, abort, or non-label
// answer collapses to null. The web call needs no import -- `fetch` is a node 24
// global -- which is what keeps the whole file inside node:* (DESIGN 3.1). fetch
// and the timeout are injectable so the suite drives every path with no network.
export async function fetchTopic(text, apiKey, opts = {}) {
  const {
    fetch = globalThis.fetch,
    timeoutMs = 2000,
    model = "claude-haiku-4-5",
  } = opts;
  const t = tidy(text);
  if (!t || !apiKey) return null;   // no message or no key: never spend a call

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        system: LABEL_PROMPT,
        messages: [{ role: "user", content: "First message: " + t }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const label = asLabel(data?.content?.[0]?.text);
    return label ? clip(label, MAX_RIGHT) : null;
  } catch {
    return null;   // network error, abort/timeout, or malformed JSON: no answer
  } finally {
    clearTimeout(timer);
  }
}

// Claude writes its own summary into the transcript as a {"type":"ai-title"}
// record, but only AFTER the first reply -- which is why it cannot be used at
// the moment a session is first named, and why the opening words stand in until
// it appears. Read newest-first: a session may be re-summarised.
export function aiTitle(path) {
  if (!path) return null;
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"ai-title"')) continue;
      const rec = JSON.parse(lines[i]);
      if (rec.type === "ai-title" && rec.aiTitle) return tidy(rec.aiTitle);
    }
  } catch { /* no transcript yet, or caught mid-write */ }
  return null;
}

// One small file per session rather than one shared JSON keyed by session id.
// Every agent runs its own hook concurrently, so a shared file would need the
// read-modify-write lock notes.json needs; a file each needs no lock at all.
const statePath = (id) => join(STATE_DIR, `${String(id).replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

function readState(id) {
  try { return JSON.parse(readFileSync(statePath(id), "utf8")); } catch { return null; }
}

function writeState(id, state, isNew) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const p = statePath(id);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, p);                 // atomic, like every cockpit state write
    if (isNew) prune();                 // once per session, never once per prompt
  } catch { /* naming is best-effort; never fail a prompt over its bookkeeping */ }
}

// Sessions are forgotten, not accumulated: one file per session would otherwise
// grow without bound on a machine that has been running agents for a year.
function prune() {
  try {
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    for (const f of readdirSync(STATE_DIR)) {
      const p = join(STATE_DIR, f);
      try { if (statSync(p).mtimeMs < cutoff) unlinkSync(p); } catch { /* raced */ }
    }
  } catch { /* nothing to prune */ }
}

// The whole decision, as a pure function of the hook input plus the state we
// last wrote. Returns the title to emit, or null to stay silent, alongside the
// state to persist -- so the tests can drive it without a process each.
export function decide(input, state, env = {}) {
  const sessionId = input.session_id;
  if (!sessionId) return { title: null };

  // A `claude` run started from inside another session inherits that session's
  // id in its environment. Claude Code overwrites it for its own hooks, so in
  // practice this never fires -- it is here for the case where it does not, in
  // which the hook would otherwise rename the session that SPAWNED it.
  const envSid = env.CLAUDE_CODE_SESSION_ID;
  if (envSid && envSid !== sessionId) return { title: null };

  if (state?.backedOff) return { title: null };

  // A title we did not set means a person typed one (/rename, or the fleet
  // list). Stand down permanently: their wording outranks anything computed
  // here, and a name that fights the person who typed it is worse than none.
  const current = tidy(input.session_title);
  if (current && (!state || state.title !== current)) {
    return { title: null, state: { backedOff: true } };
  }

  const ctx = repoContext(input.cwd);
  if (!ctx) return { title: null };      // not a git repo: leave the session alone

  let right = null, rank = -1;
  const slug = SLUG_RE.exec(tidy(input.prompt));
  if (slug) {
    right = slug[1];
    rank = RANK.slug;
  } else if (ctx.worktree) {
    right = ctx.worktree;
    rank = RANK.worktree;
  } else {
    const ai = (!state || state.rank <= RANK.aiTitle) ? aiTitle(input.transcript_path) : null;
    if (ai) {
      right = clip(ai, MAX_RIGHT);
      rank = RANK.aiTitle;
    } else if (!state) {
      const p = placeholder(input.prompt);
      if (p) { right = p; rank = RANK.placeholder; }
    }
  }
  if (!right) return { title: null };

  const title = clip(`${ctx.repo} / ${right}`, MAX_TITLE);
  if (state) {
    if (rank < state.rank) return { title: null };
    if (title === state.title) return { title: null };   // nothing changed; do not churn
  }
  return { title, state: { title, rank }, isNew: !state };
}

function runHook() {
  let input;
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { return done(); }

  const state = readState(input.session_id);
  const out = decide(input, state, process.env);
  if (out.state) writeState(input.session_id, out.state, out.isNew);
  if (!out.title) return done();

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", sessionTitle: out.title },
  }) + "\n");
}

// --------------------------------------------------------------- install ---

// Registering itself keeps the knowledge of WHERE it hooks in one file with the
// hook, and gives the tests the same code path bin/install.sh runs rather than a
// copy of it that would drift.
export function registerIn(settings, command) {
  const next = structuredClone(settings ?? {});
  next.hooks ??= {};
  const groups = Array.isArray(next.hooks.UserPromptSubmit) ? next.hooks.UserPromptSubmit : [];
  // Drop any previous registration of OURS -- keyed on the script's basename, so
  // a checkout that moved is re-pointed rather than left as a second, dead entry
  // beside the new one. Everyone else's UserPromptSubmit hooks are untouched.
  const mine = (h) => typeof h?.command === "string" && h.command.endsWith("cockpit-auto-name.mjs");
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !mine(h)) }))
    .filter((g) => g.hooks.length > 0);
  const had = groups.length !== kept.length ||
    groups.some((g, i) => (g.hooks ?? []).length !== (kept[i]?.hooks ?? []).length);
  next.hooks.UserPromptSubmit = [...kept, { hooks: [{ type: "command", command, timeout: 10 }] }];
  return { settings: next, replaced: had };
}

function install({ settingsPath, command, dryRun }) {
  let raw = null;
  try { raw = readFileSync(settingsPath, "utf8"); } catch { /* first run: none yet */ }

  let settings = {};
  if (raw !== null && raw.trim() !== "") {
    try {
      settings = JSON.parse(raw);
    } catch {
      // A malformed settings.json silently disables EVERY setting in it, so it
      // is never overwritten on a guess -- that would trade one broken feature
      // for all of them.
      process.stderr.write(`cockpit-auto-name: ${settingsPath} is not valid JSON -- not touching it.\n`);
      process.exit(1);
    }
  }

  const { settings: next, replaced } = registerIn(settings, command);
  const before = JSON.stringify(settings);
  const after = JSON.stringify(next);
  // --check runs before the installer writes anything, so it must not report in
  // the past tense -- "registered:" there reads as done and it is not.
  const verb = before === after ? "already registered"
    : dryRun ? (replaced ? "will re-point" : "will register")
    : (replaced ? "re-pointed" : "registered");

  if (!dryRun && before !== after) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    const tmp = `${settingsPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    renameSync(tmp, settingsPath);      // atomic: a half-written settings.json is a dead one
  }
  process.stdout.write(`${verb}: ${command}\n`);
  return verb;
}

// ------------------------------------------------------------------ main ---

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? "") : null;
  };
  const wantsInstall = argv.includes("--install");
  const wantsCheck = argv.includes("--check");

  if (wantsInstall || wantsCheck) {
    install({
      settingsPath: flag("--settings") || join(homedir(), ".claude", "settings.json"),
      command: flag("--command") || new URL(import.meta.url).pathname,
      dryRun: wantsCheck && !wantsInstall,
    });
    return;
  }
  runHook();
}

// Importable by the tests without running anything.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { main(); } catch { /* never block a prompt */ }
  process.exit(0);
}
