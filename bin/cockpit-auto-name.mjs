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
// The name is picked from the strongest signal available at the first prompt:
//
//   slug        /pir-work <slug>       ->  agentic-ide / cockpit-agenda
//   worktree    .claude/worktrees/…    ->  agentic-ide / browse-mode-review
//   Haiku       a 1-3 word kebab topic Haiku infers from the first message
//   summary     Claude's own summary of the session (only when there is no key)
//   placeholder the opening words of the first prompt -- a stand-in, not a name
//
// The first REAL name (slug, worktree, Haiku topic, or -- no key -- the summary)
// is set and FREEZES the session: the machine never renames a frozen session, so
// "follows the work" is retired for the label (the daemon still moves the PANES
// when an agent enters a worktree; a different concern, untouched). Only the
// opening-words placeholder is non-frozen, so a placeholdered session keeps
// climbing on later prompts until a real name is reached (DESIGN 2.2).
//
// Two rules are absolute. It must never block a prompt, so every failure path
// exits 0 with no output -- the Haiku call included, bounded and collapsing to no
// answer on any failure. And it must never overwrite a name a PERSON typed --
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

const SLUG_RE = /^\s*\/?pir-(?:work|plan|review-plan)\s+([A-Za-z0-9][A-Za-z0-9._-]*)/;

// Per-route hold budgets. The public Anthropic API answers in ~1s, so 2s keeps
// the first-prompt hold barely noticeable. The company Bedrock gateway is far
// slower -- MEASURED 5.5-8s per call, every time (FINDINGS 2026-08-31), pure
// end-to-end latency that streaming does not shorten -- so a 2s cap there aborts
// every call and the session silently falls back to the opening-words
// placeholder. 15s lets the Haiku label win; it is only ever paid on the FIRST
// prompt of a new agent (later prompts are frozen and skip the call), and the
// hook's own kill-timeout in registerIn is set safely above it.
const ANTHROPIC_TIMEOUT_MS = 2000;
const BEDROCK_TIMEOUT_MS = 15000;
// The hook's kill-timeout (settings.json). Must clear BEDROCK_TIMEOUT_MS plus
// node startup and JSON handling, or Claude Code SIGKILLs the hook mid-call and
// no title is ever emitted -- the exact failure that made Bedrock naming look
// broken when this was 10s.
const HOOK_TIMEOUT_S = 20;

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

// Build the one POST that reaches Haiku, for whichever transport the provider
// names. Both routes send the SAME body payload (the low token cap, the system
// prompt, the tidied first message) and parse the SAME reply shape -- they differ
// only in URL, headers and one body field, so the "never throw, never hang,
// validate the label" contract in fetchTopic stays a single call site (DESIGN
// 3.3). Returns { url, headers, body } or null when the provider is under-filled
// (no api key / no gateway url / no model) or of an unknown kind -- a null here
// collapses to "no name" without ever calling fetch.
//
//   { kind: "anthropic", apiKey, model }   POST api.anthropic.com, x-api-key
//   { kind: "bedrock",   baseUrl, model }   POST the company gateway, no auth
export function buildRequest(provider, tidied) {
  const payload = {
    max_tokens: 16,
    system: LABEL_PROMPT,
    messages: [{ role: "user", content: "First message: " + tidied }],
  };

  if (provider?.kind === "anthropic") {
    const { apiKey, model = "claude-haiku-4-5" } = provider;
    if (!apiKey) return null;   // no key -> feature off, never spend a call
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",   // the public API's date-stamped version
        "content-type": "application/json",
      },
      // Anthropic carries the model in the BODY.
      body: JSON.stringify({ model: model, ...payload }),
    };
  }

  if (provider?.kind === "bedrock") {
    const { baseUrl, model } = provider;
    if (!baseUrl || !model) return null;   // no gateway or no model id -> route off
    // Bedrock carries the model in the URL PATH, verbatim -- the live probe used the
    // raw env value and encoding it risks the gateway's own routing (DESIGN 2.3).
    // A trailing slash on the base would double the separator, so strip it.
    const base = baseUrl.replace(/\/+$/, "");
    return {
      url: `${base}/model/${model}/invoke`,
      // No auth header: the gateway authorizes on Tailscale network identity alone,
      // proven live with a content-type-only request (FINDINGS 2026-08-31).
      headers: { "content-type": "application/json" },
      // `anthropic_version` is the Bedrock literal, NOT the public API's date, and
      // there is no `model` field -- it is in the path.
      body: JSON.stringify({ anthropic_version: "bedrock-2023-05-31", ...payload }),
    };
  }

  return null;   // unknown transport
}

// Ask Haiku for a topic, bounded by a hard timeout, and return a validated kebab
// label or null. A naming call must NEVER throw to its caller and never wedge the
// prompt box: every network error, non-2xx, malformed body, abort, or non-label
// answer collapses to null. The web call needs no import -- `fetch` is a node 24
// global -- which is what keeps the whole file inside node:* (DESIGN 3.1). fetch
// and the timeout are injectable so the suite drives every path with no network.
//
// `provider` names the transport and carries everything transport-specific
// (DESIGN 3.3); which provider a session uses is decided in candidateTopic (T02),
// not here -- this call only makes both reachable.
export async function fetchTopic(text, provider, opts = {}) {
  const {
    fetch = globalThis.fetch,
    timeoutMs = 2000,
  } = opts;
  const t = tidy(text);
  if (!t) return null;                     // no message: never spend a call
  const req = buildRequest(provider, t);
  if (!req) return null;                   // under-filled/unknown provider: no call

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(req.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: req.headers,
      body: req.body,
    });
    if (!res.ok) return null;
    const data = await res.json();
    // The reply is the Anthropic message shape on BOTH routes (FINDINGS), so the
    // label extraction is identical regardless of transport.
    const label = asLabel(data?.content?.[0]?.text);
    return label ? clip(label, MAX_RIGHT) : null;
  } catch {
    return null;   // network error, abort/timeout, or malformed JSON: no answer
  } finally {
    clearTimeout(timer);
  }
}

// The key file the config command writes (DESIGN 3.5). The hook reads it DIRECTLY
// rather than importing cockpit-config.mjs -- a relative import would trip the
// "imports nothing outside node:*" boundary check (DESIGN 3.2) -- so this mirrors
// cockpit-config's readApiKey by hand. Trim so a hand-appended newline is not part
// of the key; an absent or empty file means the feature is off (DESIGN 2.6).
function readKeyFile(dir = DIR) {
  try {
    const raw = readFileSync(join(dir, "anthropic-api-key"), "utf8").trim();
    return raw || null;
  } catch { return null; }
}

// A boolean-ish env flag is "on" only when present, non-empty, and not a
// spelled-out off value. This is the reading Claude Code itself gives
// CLAUDE_CODE_USE_BEDROCK (DESIGN 2.2), so the namer routes on exactly the same
// signal Claude Code used to route the session to Bedrock in the first place.
export function truthy(v) {
  const t = String(v ?? "").trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

// Decide whether to spend a Haiku call on this prompt, and if so make it, over
// whichever transport the session's environment selects. The call -- and therefore
// the hold (2s on the Anthropic route, up to 15s on the slow Bedrock gateway) --
// happens ONLY for a cockpit session (COCKPIT_REPO present, DESIGN
// 2.4) that has no settled name yet and whose first message is ordinary prose. It is
// skipped when a stronger deterministic signal already names the session: a /pir-work
// slug or a worktree cwd outranks the Haiku topic anyway (DESIGN 2.1/2.3), so calling
// Haiku would only hold the prompt and spend a discarded call -- and agents dispatched
// into a worktree are the common cockpit case.
//
// Past the guards, the ROUTE is chosen from env (DESIGN 2.1/2.2): a Bedrock session
// names through the company gateway with no key; otherwise the anthropic key path,
// exactly as before; with neither available, naming is off. Bedrock is checked first
// and is EXCLUSIVE -- see the body. Returns the guarded kebab label or null.
// fetch/timeout/dir/readKey are injectable so the suite drives every branch with no
// network and no real key.
export async function candidateTopic(input, state, env = {}, opts = {}) {
  const { fetch, timeoutMs, model, dir = DIR, readKey = readKeyFile } = opts;

  if (!env.COCKPIT_REPO) return null;                                 // 2.4: cockpit only
  // Mirror decide's guards, so we never hold or spend on a session we will not
  // name: a foreign-id hook, an already-settled name, a name the person owns.
  if (env.CLAUDE_CODE_SESSION_ID && env.CLAUDE_CODE_SESSION_ID !== input.session_id) return null;
  if (state?.frozen || state?.backedOff) return null;
  const current = tidy(input.session_title);
  if (current && (!state || state.title !== current)) return null;    // person renamed it

  const prompt = tidy(input.prompt);
  if (!prompt || SLUG_RE.test(prompt)) return null;                   // 2.3: a slug wins anyway
  const ctx = repoContext(input.cwd);
  if (!ctx || ctx.worktree) return null;                             // 2.3: a worktree wins anyway

  // The route (DESIGN 2.1/2.2), decided per call from the session's own environment.
  // Bedrock is checked FIRST and is EXCLUSIVE: a session on Bedrock reaches Haiku only
  // through the company gateway, never the key path -- quietly routing a work prompt to
  // the public API from a company session is a policy breach, not a fallback. So this
  // branch never falls through to readKey: under-configured, it returns null (naming
  // off) rather than reaching for the key.
  if (truthy(env.CLAUDE_CODE_USE_BEDROCK)) {
    const baseUrl = env.ANTHROPIC_BEDROCK_BASE_URL;
    // Bedrock addresses the model by id in the request; DEFAULT_HAIKU is the explicit
    // Haiku slot, SMALL_FAST Claude Code's documented small-fast fallback (DESIGN 2.2).
    const bedrockModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_SMALL_FAST_MODEL;
    if (!tidy(baseUrl) || !bedrockModel) return null;   // on Bedrock but under-configured: OFF
    // The gateway is slow (5.5-8s measured), so it gets the long budget; a test
    // may still override via opts.timeoutMs.
    return fetchTopic(input.prompt, { kind: "bedrock", baseUrl, model: bedrockModel },
      { fetch, timeoutMs: timeoutMs ?? BEDROCK_TIMEOUT_MS });
  }

  const apiKey = readKey(dir);
  if (!apiKey) return null;                                          // 2.6: not on Bedrock, no key -> off
  return fetchTopic(input.prompt, { kind: "anthropic", apiKey, model },
    { fetch, timeoutMs: timeoutMs ?? ANTHROPIC_TIMEOUT_MS });
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

// The whole decision, as a pure function of the hook input, the state we last
// wrote, and the guarded Haiku candidate runHook produced (a kebab label, or null
// when there is no key / the call failed / the answer was junk). Returns the title
// to emit, or null to stay silent, alongside the state to persist -- so the tests
// can drive it without a process each and without the network (DESIGN 3.1/3.3).
//
// The order (DESIGN 3.3): backedOff short-circuit; the live human-rename check;
// then, if the session is frozen, stop -- the machine never moves a settled name;
// then pick the strongest signal and, if it is a REAL name, freeze. The opening-
// words placeholder is the one non-frozen outcome, so an unnamed session keeps
// climbing until a real name is reached.
export function decide(input, state, env = {}, candidate = null) {
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
  // This runs BEFORE the frozen check, so a hand rename of a frozen name is
  // still caught and wins.
  const current = tidy(input.session_title);
  if (current && (!state || state.title !== current)) {
    return { title: null, state: { backedOff: true } };
  }

  // The freeze: a settled name is never moved by the machine. "Follows the work"
  // is retired for the label here (DESIGN 2.2).
  if (state?.frozen) return { title: null };

  const ctx = repoContext(input.cwd);
  if (!ctx) return { title: null };      // not a git repo: leave the session alone

  // Strongest signal wins (DESIGN 2.1). A slug, a worktree or a Haiku candidate is
  // a REAL name and freezes; Claude's own summary is real too, and only ever fills
  // in when there is no key (a key would have produced a candidate ahead of it);
  // the opening-words placeholder is a first-naming stand-in and does NOT freeze.
  let right = null, real = false;
  const slug = SLUG_RE.exec(tidy(input.prompt));
  if (slug) {
    right = slug[1]; real = true;
  } else if (ctx.worktree) {
    right = ctx.worktree; real = true;
  } else if (candidate) {
    right = clip(candidate, MAX_RIGHT); real = true;
  } else {
    const ai = aiTitle(input.transcript_path);
    if (ai) {
      right = clip(ai, MAX_RIGHT); real = true;
    } else if (!state) {
      // placeholder is a FIRST-naming device only: re-applying the opening words
      // on every later prompt would rename the session continuously, so it is
      // taken only when there is no prior state to climb from.
      const p = placeholder(input.prompt);
      if (p) { right = p; real = false; }
    }
  }
  if (!right) return { title: null };

  const title = clip(`${ctx.repo} / ${right}`, MAX_TITLE);
  const nextState = real ? { title, frozen: true } : { title };
  if (state && title === state.title) {
    // The title text is unchanged, so nothing is emitted -- but a REAL name whose
    // text happens to equal the placeholder it replaces must still freeze. Without
    // this, a candidate/summary that coincides with the opening words leaves the
    // session unfrozen for ever: it keeps re-fetching Haiku (a hold + spend on
    // every later prompt) and stays free to be renamed by a later slug/worktree --
    // the "follows the work" behaviour DESIGN 2.2 retires. Persist only the
    // freeze-crossing; a same-state re-emit still stays silent.
    if (nextState.frozen && !state.frozen) return { title: null, state: nextState };
    return { title: null };
  }
  return { title, state: nextState, isNew: !state };
}

async function runHook() {
  let input;
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { return done(); }

  const state = readState(input.session_id);
  // The one impure step: hold the prompt while Haiku names an ordinary first
  // message, bounded by fetchTopic's per-route timeout (2s Anthropic, 15s the
  // slow Bedrock gateway). Whether the call happens at
  // all -- the COCKPIT_REPO gate, the key, "no name yet", prose not a slug, not a
  // worktree -- is decided in candidateTopic; here the result is just data.
  const candidate = await candidateTopic(input, state, process.env);
  const out = decide(input, state, process.env, candidate);
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
  next.hooks.UserPromptSubmit = [...kept, { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] }];
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

// async because runHook now holds the prompt on an awaited fetch; install stays
// synchronous inside it. The entrypoint below awaits the returned promise before
// exiting, or process.exit would kill the pending Haiku call.
async function main() {
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
  await runHook();
}

// Importable by the tests without running anything. Awaiting main() lets the
// Haiku hold finish before exit; any rejection still exits 0 -- never block a
// prompt.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch(() => { /* never block a prompt */ }).finally(() => process.exit(0));
}
