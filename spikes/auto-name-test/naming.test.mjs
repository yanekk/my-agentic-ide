// What the hook names a session, driven the way settings.json drives it: a real
// process, hook input on stdin, JSON or silence on stdout. Every case runs
// against a THROWAWAY COCKPIT_DIR (run.sh checks the real one afterwards) and a
// real git repo with a real linked worktree -- the worktree rules are the ones
// most easily got wrong by a fake.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
// The topic-namer's pure pieces are imported and driven directly (with an
// injected fake fetch), not spawned -- no case here ever touches the network.
import { asLabel, fetchTopic, decide, candidateTopic } from "../../bin/cockpit-auto-name.mjs";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const HOOK = join(ROOT, "bin", "cockpit-auto-name.mjs");
const T = mkdtempSync(join(process.env.COCKPIT_DIR || tmpdir(), "naming-"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); if (detail) console.log(`       got [${detail}]`); }
};
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// A main checkout "myrepo" with a linked worktree, laid out where the cockpit
// puts them so the path shape is the real one.
const repo = join(T, "myrepo");
mkdirSync(repo, { recursive: true });
sh("git", ["init", "-q", "-b", "main", "."], repo);
sh("git", ["config", "user.email", "t@t"], repo);
sh("git", ["config", "user.name", "t"], repo);
writeFileSync(join(repo, "f.txt"), "x\n");
sh("git", ["add", "-A"], repo);
sh("git", ["commit", "-qm", "init"], repo);
const wt = join(repo, ".claude", "worktrees", "browse-mode-review");
sh("git", ["worktree", "add", "-q", "-b", "wtbranch", wt], repo);
const plain = join(T, "notarepo");
mkdirSync(plain, { recursive: true });

// One state dir per case, so a case can never inherit another's memory.
let seq = 0;
const freshState = () => {
  const d = join(T, `state${++seq}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// Returns the title the hook emitted, or null when it stayed silent.
function run({ state, cwd, prompt = "", sessionTitle = "", sessionId = "sess-1", transcript = "", env = {} }) {
  const input = JSON.stringify({
    session_id: sessionId, cwd, prompt, hook_event_name: "UserPromptSubmit",
    session_title: sessionTitle, transcript_path: transcript,
  });
  const out = execFileSync("node", [HOOK], {
    input, encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, COCKPIT_DIR: state, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.sessionTitle : null;
}

function transcriptWith(dir, title) {
  const p = join(dir, "t.jsonl");
  writeFileSync(p, JSON.stringify({ type: "ai-title", aiTitle: title, sessionId: "sess-1" }) + "\n");
  return p;
}

console.log("== naming ==");

{ // Outside a repo there is no left half to build, so nothing is named at all.
  ok("a non-repo directory is left alone", run({ state: freshState(), cwd: plain, prompt: "hello" }) === null);
}

{ // The ordinary case: most sessions are a sentence typed into a repo.
  const t = run({ state: freshState(), cwd: repo, prompt: "read the handoff document and continue" });
  ok("free-form prompt gets the repo prefix", t === "myrepo / read the handoff document and continue", t);
}

{ // The left half is the MAIN checkout even from inside a worktree -- the trap
  // that would otherwise file each agent under a phantom repo of its own.
  const t = run({ state: freshState(), cwd: wt, prompt: "carry on with the file browser" });
  ok("a worktree names itself, under the main repo", t === "myrepo / browse-mode-review", t);
}

{ // A plan slug is the strongest signal there is.
  ok("/pir-work names from the slug",
     run({ state: freshState(), cwd: repo, prompt: "/pir-work cockpit-agenda" }) === "myrepo / cockpit-agenda");
  ok("...with or without the leading slash",
     run({ state: freshState(), cwd: repo, prompt: "pir-work notes-column" }) === "myrepo / notes-column");
  ok("...and it outranks the worktree",
     run({ state: freshState(), cwd: wt, prompt: "/pir-work cockpit-agenda" }) === "myrepo / cockpit-agenda");
}

{ // /pir-plan is often typed bare; there is no slug to take, so fall through.
  const t = run({ state: freshState(), cwd: repo, prompt: "/pir-plan" });
  ok("a slugless plan command falls through to the words", t === "myrepo / pir-plan", t);
}

{ // The placeholder exists only until Claude's own summary does.
  const s = freshState();
  const first = run({ state: s, cwd: repo, prompt: "read the handoff document and continue" });
  const tr = transcriptWith(s, "read handoff document");
  const second = run({ state: s, cwd: repo, prompt: "yes go on", transcript: tr, sessionTitle: first });
  ok("Claude's own summary replaces the opening words", second === "myrepo / read handoff document", second);
}

{ // Ranks only ever climb.
  const s = freshState();
  const first = run({ state: s, cwd: repo, prompt: "/pir-work cockpit-agenda" });
  const tr = transcriptWith(s, "some summary");
  const second = run({ state: s, cwd: repo, prompt: "now something else", transcript: tr, sessionTitle: first });
  ok("a slug is never downgraded to a summary", second === null, second);
}

{ // The rule that matters most: a person's wording wins, forever.
  const s = freshState();
  run({ state: s, cwd: repo, prompt: "start work" });
  const second = run({ state: s, cwd: repo, prompt: "/pir-work cockpit-agenda", sessionTitle: "my own wording" });
  ok("a name typed by hand stops the rule dead", second === null, second);
  const third = run({ state: s, cwd: repo, prompt: "/pir-work cockpit-agenda", sessionTitle: "my own wording" });
  ok("...and it stays stopped", third === null, third);
}

{ // Sessions that were already named when the rule was installed.
  const t = run({ state: freshState(), cwd: repo, prompt: "carry on", sessionTitle: "skaut / cd-speech" });
  ok("an existing name is never taken over", t === null, t);
}

{ // A `claude` run started from inside another session carries that session's
  // id in its environment. Claude Code overwrites it for its own hooks, so this
  // guard does not fire in practice -- it is the belt to that braces, and the
  // failure it prevents (renaming the session that SPAWNED this one) is bad
  // enough to be worth asserting.
  const foreign = run({ state: freshState(), cwd: repo, prompt: "hello", sessionId: "child-1",
                        env: { CLAUDE_CODE_SESSION_ID: "parent-9" } });
  ok("a hook holding a foreign session id names nothing", foreign === null, foreign);
  const own = run({ state: freshState(), cwd: repo, prompt: "hello", sessionId: "own-1",
                    env: { CLAUDE_CODE_SESSION_ID: "own-1" } });
  ok("...while its own session still names itself", own === "myrepo / hello", own);
}

{ // The same computed title is not re-emitted on every prompt.
  const s = freshState();
  const first = run({ state: s, cwd: wt, prompt: "a" });
  ok("an unchanged title stays silent", run({ state: s, cwd: wt, prompt: "b", sessionTitle: first }) === null);
}

{ // The opening words are a first-naming device only.
  const s = freshState();
  const first = run({ state: s, cwd: repo, prompt: "first thing" });
  const second = run({ state: s, cwd: repo, prompt: "a completely different second thing", sessionTitle: first });
  ok("later prompts do not re-apply the opening words", second === null, second);
}

{ // The fleet list is a narrow column.
  const t = run({ state: freshState(), cwd: repo,
    prompt: "please investigate the intermittent failure in the calendar refresh that only happens on Mondays" });
  ok("a long prompt is clipped to the column", t.length <= 60 && t.endsWith("…"), `${t.length}: ${t}`);
  ok("...keeping the repo prefix", t.startsWith("myrepo / "), t);
}

{ // Whatever happens, a prompt must still go through.
  const s = freshState();
  const bad = execFileSync("node", [HOOK], { input: "not json", encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, COCKPIT_DIR: s } });
  ok("garbage input is silent, not fatal", bad.trim() === "");
  const empty = execFileSync("node", [HOOK], { input: "{}", encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, COCKPIT_DIR: s } });
  ok("input with no session is silent too", empty.trim() === "");
}

// ---- the label guard -----------------------------------------------------
// asLabel is the whole reason a naming call is safe: the model's answer is never
// trusted, only what survives this regex. A rejected answer is a no-answer.
console.log("== the label guard ==");
{
  ok("a clean kebab label is accepted", asLabel("oauth-loopback") === "oauth-loopback");
  ok("a single word is a label", asLabel("daemon") === "daemon");
  ok("trims and lowercases before matching", asLabel("  OAuth-Loopback  ") === "oauth-loopback");
  ok("four words is the ceiling", asLabel("a1-b2-c3-d4") === "a1-b2-c3-d4");
  ok("five dashed words are rejected", asLabel("one-two-three-four-five") === null);
  ok("a clarifying sentence is rejected (the 'hey' case)",
     asLabel("Hi! What would you like to name this session?") === null);
  ok("internal spaces are rejected", asLabel("oauth loopback") === null);
  ok("trailing punctuation is rejected", asLabel("oauth-loopback.") === null);
  ok("a leading or trailing dash is rejected", asLabel("-oauth") === null && asLabel("oauth-") === null);
  ok("a double dash is rejected", asLabel("oauth--loopback") === null);
  ok("empty and nullish are rejected", asLabel("") === null && asLabel(null) === null && asLabel(undefined) === null);
}

// ---- fetchTopic: two transports ------------------------------------------
// fetchTopic now takes a `provider` in place of the bare apiKey (DESIGN 3.3):
//   { kind: "anthropic", apiKey, model = "claude-haiku-4-5" }
//   { kind: "bedrock",   baseUrl, model }
// Every case injects opts.fetch, so nothing here reaches a real API or gateway.
// A naming call must never throw to its caller: every failure collapses to null,
// identically on both routes.
console.log("== fetchTopic (injected fetch, no network) ==");

// Shorthands for the two providers. The bedrock model carries a `:` on purpose --
// a real Bedrock model id has one, and the path must NOT percent-encode it.
const anthropic = (apiKey = "sk-test", model) => ({ kind: "anthropic", apiKey, ...(model ? { model } : {}) });
const BEDROCK_MODEL = "us.anthropic.claude-haiku-4-5:0";
const bedrock = (baseUrl = "https://gw.example.net", model = BEDROCK_MODEL) => ({ kind: "bedrock", baseUrl, model });

// A fake fetch that answers with a body and status; the throwing variant proves
// a rejected fetch never becomes a throw out of fetchTopic.
const answering = (text, { ok: okStatus = true } = {}) =>
  async () => ({ ok: okStatus, json: async () => ({ content: [{ text }] }) });

// The label guard, the failure paths and the timeout must hold IDENTICALLY on
// both transports, so every route-agnostic case is run once per provider.
for (const [label, provider] of [["anthropic", anthropic()], ["bedrock", bedrock()]]) {
  {
    const t = await fetchTopic("implement the OAuth loopback flow", provider,
      { fetch: answering("oauth-loopback") });
    ok(`${label}: a normal message returns the label`, t === "oauth-loopback", t);
  }
  { // The measured failure mode: a content-free message gets a sentence, guarded out.
    const t = await fetchTopic("hey", provider,
      { fetch: answering("Hi! What would you like to work on today?") });
    ok(`${label}: a sentence answer returns null`, t === null, t);
  }
  {
    const t = await fetchTopic("x", provider, { fetch: answering("OAuth Loopback.") });
    ok(`${label}: spaces/capitals/punctuation in the answer -> null`, t === null, t);
  }
  {
    const t = await fetchTopic("x", provider, { fetch: async () => { throw new Error("ENOTFOUND"); } });
    ok(`${label}: a rejecting fetch returns null, not a throw`, t === null, t);
  }
  {
    const t = await fetchTopic("x", provider, { fetch: answering("oauth-loopback", { ok: false }) });
    ok(`${label}: a non-2xx response returns null`, t === null, t);
  }
  {
    const badJson = async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } });
    ok(`${label}: malformed JSON returns null`, (await fetchTopic("x", provider, { fetch: badJson })) === null);
    const emptyBody = async () => ({ ok: true, json: async () => ({}) });
    ok(`${label}: an answerless body returns null`, (await fetchTopic("x", provider, { fetch: emptyBody })) === null);
  }
  { // A hung request must be cut at timeoutMs, not left to hold the prompt box.
    const hanging = (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const started = Date.now();
    const t = await fetchTopic("x", provider, { fetch: hanging, timeoutMs: 50 });
    ok(`${label}: a never-resolving fetch is aborted at timeoutMs`,
       t === null && Date.now() - started < 1500, `${t} in ${Date.now() - started}ms`);
  }
  { // An empty message must never even call fetch -- no hold, no spend, on either route.
    const explode = () => { throw new Error("fetch must not be called"); };
    ok(`${label}: an empty message returns null without calling fetch`,
       (await fetchTopic("   ", provider, { fetch: explode })) === null);
  }
}

{ // The label extraction is the SAME on both routes for the same reply body --
  // asserted head to head so a divergence here cannot hide.
  const same = answering("daemon-panes");
  const a = await fetchTopic("the daemon keeps losing panes", anthropic(), { fetch: same });
  const b = await fetchTopic("the daemon keeps losing panes", bedrock(), { fetch: same });
  ok("both routes extract the same label from the same body", a === "daemon-panes" && a === b, `${a} / ${b}`);
}

{ // An under-filled provider is off, and off means never calling fetch (no hold,
  // no spend): no api key, no gateway url, no model id, or an unknown kind.
  const explode = () => { throw new Error("fetch must not be called"); };
  ok("anthropic with no key -> null, no call",
     (await fetchTopic("x", { kind: "anthropic", apiKey: "" }, { fetch: explode })) === null);
  ok("bedrock with no baseUrl -> null, no call",
     (await fetchTopic("x", { kind: "bedrock", model: BEDROCK_MODEL }, { fetch: explode })) === null);
  ok("bedrock with no model -> null, no call",
     (await fetchTopic("x", { kind: "bedrock", baseUrl: "https://gw" }, { fetch: explode })) === null);
  ok("an unknown provider kind -> null, no call",
     (await fetchTopic("x", { kind: "mystery" }, { fetch: explode })) === null);
  ok("a null provider -> null, no call",
     (await fetchTopic("x", null, { fetch: explode })) === null);
}

console.log("== fetchTopic: the anthropic request shape ==");
{ // Endpoint, method, headers, model-in-body, low token cap.
  let captured = null;
  const capturing = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({ content: [{ text: "daemon-panes" }] }) };
  };
  const t = await fetchTopic("the daemon keeps losing panes", anthropic("sk-abc123", "claude-haiku-4-5"),
    { fetch: capturing });
  ok("posts to the messages endpoint", captured.url === "https://api.anthropic.com/v1/messages", captured?.url);
  ok("...as a POST", captured.init.method === "POST");
  ok("...with the x-api-key header", captured.init.headers["x-api-key"] === "sk-abc123");
  ok("...and the anthropic-version header", captured.init.headers["anthropic-version"] === "2023-06-01");
  const body = JSON.parse(captured.init.body);
  ok("...naming the model in the body", body.model === "claude-haiku-4-5", body.model);
  ok("...capping tokens low with a non-empty system prompt", body.max_tokens === 16 && typeof body.system === "string" && body.system.length > 0);
  ok("...passing the first message through", body.messages[0].content.includes("the daemon keeps losing panes"));
  ok("...and returning the guarded, clipped label", t === "daemon-panes", t);
}
{ // The anthropic model defaults when the provider omits it (existing callers).
  let captured = null;
  const capturing = async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({ content: [{ text: "x" }] }) }; };
  await fetchTopic("hello there", { kind: "anthropic", apiKey: "sk" }, { fetch: capturing });
  ok("the anthropic model defaults to claude-haiku-4-5", JSON.parse(captured.init.body).model === "claude-haiku-4-5");
}

console.log("== fetchTopic: the bedrock request shape (DESIGN 2.3) ==");
{ // Path built from baseUrl + model; content-type ONLY; body has the bedrock
  // literal and NO model field.
  let captured = null;
  const capturing = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({ content: [{ text: "daemon-panes" }] }) };
  };
  const t = await fetchTopic("the daemon keeps losing panes", bedrock("https://gw.example.net", BEDROCK_MODEL),
    { fetch: capturing });
  ok("posts to {baseUrl}/model/{model}/invoke",
     captured.url === `https://gw.example.net/model/${BEDROCK_MODEL}/invoke`, captured?.url);
  ok("...as a POST", captured.init.method === "POST");
  const hdrs = Object.keys(captured.init.headers);
  ok("...with a content-type header", captured.init.headers["content-type"] === "application/json");
  ok("...and NO auth header at all", hdrs.length === 1 && !("x-api-key" in captured.init.headers) && !("authorization" in captured.init.headers), hdrs.join(","));
  const body = JSON.parse(captured.init.body);
  ok("...carrying anthropic_version: bedrock-2023-05-31", body.anthropic_version === "bedrock-2023-05-31", body.anthropic_version);
  ok("...with NO model field in the body", !("model" in body), JSON.stringify(body));
  ok("...capping tokens low with a non-empty system prompt", body.max_tokens === 16 && typeof body.system === "string" && body.system.length > 0);
  ok("...passing the first message through", body.messages[0].content.includes("the daemon keeps losing panes"));
  ok("...and returning the guarded, clipped label", t === "daemon-panes", t);
}
{ // A trailing slash on the base must not double the separator.
  let captured = null;
  const capturing = async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({ content: [{ text: "x" }] }) }; };
  await fetchTopic("hello", bedrock("https://gw.example.net/", BEDROCK_MODEL), { fetch: capturing });
  ok("a trailing slash on baseUrl still yields a single-slash path",
     captured.url === `https://gw.example.net/model/${BEDROCK_MODEL}/invoke`, captured.url);
}
{ // The model id goes in the path VERBATIM -- a `:` is not percent-encoded (DESIGN 2.3).
  let captured = null;
  const capturing = async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({ content: [{ text: "x" }] }) }; };
  await fetchTopic("hello", bedrock("https://gw", "us.anthropic.claude-haiku-4-5:0"), { fetch: capturing });
  ok("the model id is verbatim in the path, its `:` not encoded",
     captured.url === "https://gw/model/us.anthropic.claude-haiku-4-5:0/invoke" && !captured.url.includes("%3A"), captured.url);
}

// ---- decide: the freeze model ---------------------------------------------
// decide is driven DIRECTLY here, with the Haiku candidate supplied as an
// argument, so no case touches the network (DESIGN 3.1). repoContext still shells
// to the real git fixtures above -- the worktree rules are the ones a fake gets
// wrong. A candidate is a string (a good call) or null (no key / failed / junk).
console.log("== decide: the freeze model ==");

const inp = (o) => ({ session_id: "sess-1", cwd: repo, prompt: "", session_title: "", transcript_path: "", ...o });

{ // A Haiku candidate on the first prompt is a real name and freezes.
  const out = decide(inp({ prompt: "please add the OAuth loopback flow" }), null, {}, "oauth-loopback");
  ok("a candidate on the first prompt names and freezes",
     out.title === "myrepo / oauth-loopback" && out.state.frozen === true && out.isNew === true, JSON.stringify(out));
}

{ // The headline change: a settled name does NOT follow a later worktree move.
  const st = { title: "myrepo / oauth-loopback", frozen: true };
  const out = decide(inp({ cwd: wt, prompt: "carry on", session_title: st.title }), st, {}, null);
  ok("a frozen name does not follow a move into a worktree", out.title === null, JSON.stringify(out));
}

{ // ...nor a later /pir-work slug.
  const st = { title: "myrepo / oauth-loopback", frozen: true };
  const out = decide(inp({ prompt: "/pir-work cockpit-agenda", session_title: st.title }), st, {}, null);
  ok("a frozen name does not follow a later slug", out.title === null, JSON.stringify(out));
}

{ // A person renaming AFTER the freeze is caught and wins forever.
  const st = { title: "myrepo / oauth-loopback", frozen: true };
  const out = decide(inp({ prompt: "carry on", session_title: "my own wording" }), st, {}, null);
  ok("a human rename after freezing backs off and wins",
     out.title === null && out.state.backedOff === true, JSON.stringify(out));
}

{ // No key -> candidate null: placeholder now (unfrozen), then Claude's summary
  // freezes it -- exactly today's behaviour (DESIGN 2.6).
  const first = decide(inp({ prompt: "read the handoff document" }), null, {}, null);
  ok("no candidate -> placeholder, unfrozen",
     first.title === "myrepo / read the handoff document" && !first.state.frozen, JSON.stringify(first));
  const trPath = transcriptWith(freshState(), "read handoff document");
  const second = decide(inp({ prompt: "yes go on", session_title: first.title, transcript_path: trPath }),
    first.state, {}, null);
  ok("...then Claude's summary is taken and freezes",
     second.title === "myrepo / read handoff document" && second.state.frozen === true, JSON.stringify(second));
}

{ // Timeout with a key -> candidate null now, a candidate on a later prompt freezes.
  const first = decide(inp({ prompt: "investigate the flaky calendar tests" }), null, {}, null);
  ok("a timed-out call -> placeholder, unfrozen",
     first.title.startsWith("myrepo / ") && !first.state.frozen, JSON.stringify(first));
  const second = decide(inp({ prompt: "still on it", session_title: first.title }), first.state, {}, "flaky-tests");
  ok("...a later candidate names and freezes",
     second.title === "myrepo / flaky-tests" && second.state.frozen === true, JSON.stringify(second));
}

{ // A first-prompt slug uses the slug and freezes; the candidate is irrelevant.
  const out = decide(inp({ prompt: "/pir-work cockpit-agenda" }), null, {}, null);
  ok("a first-prompt slug names and freezes",
     out.title === "myrepo / cockpit-agenda" && out.state.frozen === true, JSON.stringify(out));
}

{ // A first prompt already inside a worktree uses the worktree name and freezes.
  const out = decide(inp({ cwd: wt, prompt: "carry on in here" }), null, {}, null);
  ok("a first-prompt worktree names and freezes",
     out.title === "myrepo / browse-mode-review" && out.state.frozen === true, JSON.stringify(out));
}

{ // The coincidence gap: a REAL name whose TEXT equals the placeholder it replaces
  // must still freeze. Otherwise the "nothing changed" early-out drops the freeze
  // and the session climbs/re-fetches for ever (DESIGN 2.2).
  const first = decide(inp({ prompt: "read the docs" }), null, {}, null);
  ok("placeholder set, unfrozen (coincidence setup)",
     first.title === "myrepo / read the docs" && !first.state.frozen, JSON.stringify(first));
  const trPath = transcriptWith(freshState(), "read the docs");   // summary == placeholder text
  const second = decide(inp({ prompt: "go on", session_title: first.title, transcript_path: trPath }),
    first.state, {}, null);
  ok("a real name equal to the placeholder still freezes, silently",
     second.title === null && second.state?.frozen === true, JSON.stringify(second));
}

{ // The placeholder is not settled, so it still climbs: a later worktree move is
  // taken and freezes (DESIGN 2.2 -- retirement is of REAL names, not stand-ins).
  const first = decide(inp({ prompt: "start here" }), null, {}, null);
  const second = decide(inp({ cwd: wt, prompt: "now in the worktree", session_title: first.title }),
    first.state, {}, null);
  ok("a placeholder climbs to a worktree name and freezes",
     second.title === "myrepo / browse-mode-review" && second.state.frozen === true, JSON.stringify(second));
}

// ---- candidateTopic: the gate ---------------------------------------------
// Whether the Haiku call happens at all. The injected fetch THROWS, so any case
// that wrongly reaches it fails loudly; a correctly gated case never calls it.
console.log("== candidateTopic: the gate ==");

const keyDir = freshState();
writeFileSync(join(keyDir, "anthropic-api-key"), "sk-secret\n");
const noKeyDir = freshState();
const explode = () => { throw new Error("fetchTopic must not be called"); };
const answers = (label) => async () => ({ ok: true, json: async () => ({ content: [{ text: label }] }) });

{ // No COCKPIT_REPO: a plain claude session is never held or charged (DESIGN 2.4).
  const c = await candidateTopic(inp({ prompt: "add the oauth flow" }), null, {}, { fetch: explode, dir: keyDir });
  ok("no COCKPIT_REPO -> no call", c === null, c);
}
{ // COCKPIT_REPO but no key file: the feature is off (DESIGN 2.6).
  const c = await candidateTopic(inp({ prompt: "add the oauth flow" }), null,
    { COCKPIT_REPO: repo }, { fetch: explode, dir: noKeyDir });
  ok("COCKPIT_REPO but no key -> no call", c === null, c);
}
{ // A /pir-work slug outranks Haiku, so the call is skipped (DESIGN 2.3).
  const c = await candidateTopic(inp({ prompt: "/pir-work cockpit-agenda" }), null,
    { COCKPIT_REPO: repo }, { fetch: explode, dir: keyDir });
  ok("a slug first message -> no call", c === null, c);
}
{ // A worktree cwd outranks Haiku, so the call is skipped (DESIGN 2.3).
  const c = await candidateTopic(inp({ cwd: wt, prompt: "carry on" }), null,
    { COCKPIT_REPO: repo }, { fetch: explode, dir: keyDir });
  ok("a worktree cwd -> no call", c === null, c);
}
{ // A frozen session is already named: no retry, no spend.
  const c = await candidateTopic(inp({ prompt: "add the oauth flow", session_title: "myrepo / x" }),
    { title: "myrepo / x", frozen: true }, { COCKPIT_REPO: repo }, { fetch: explode, dir: keyDir });
  ok("a frozen session -> no call", c === null, c);
}
{ // A session the person has renamed is theirs: no spend on it either.
  const c = await candidateTopic(inp({ prompt: "add the oauth flow", session_title: "my own wording" }),
    { title: "myrepo / placeholder" }, { COCKPIT_REPO: repo }, { fetch: explode, dir: keyDir });
  ok("a hand-renamed session -> no call", c === null, c);
}
{ // All gates open: the call is made and its guarded label comes back.
  const c = await candidateTopic(inp({ prompt: "add the oauth loopback flow" }), null,
    { COCKPIT_REPO: repo }, { fetch: answers("oauth-loopback"), dir: keyDir });
  ok("cockpit + key + prose first prompt -> the guarded label", c === "oauth-loopback", c);
}

// ---- candidateTopic: the route (DESIGN 2.1/2.2) ---------------------------
// Which TRANSPORT the namer selects from the session's own environment. Bedrock
// wins over the key and is exclusive: a Bedrock session must never read or use the
// key. Every case injects fetch (capturing or throwing) and, where the point is
// that the key is untouched, a readKey spy -- so nothing here reaches a network,
// a gateway or a real key.
console.log("== candidateTopic: the route (DESIGN 2.1/2.2) ==");

const GW = "https://gw.example.net";
const HAIKU = "us.anthropic.claude-haiku-4-5:0";
const SMALLFAST = "us.anthropic.claude-small-fast:0";
const ANTHRO_URL = "https://api.anthropic.com/v1/messages";

// A full "on Bedrock" env (flag + gateway + DEFAULT_HAIKU), with overrides.
const bedrockEnv = (over = {}) => ({
  COCKPIT_REPO: repo,
  CLAUDE_CODE_USE_BEDROCK: "1",
  ANTHROPIC_BEDROCK_BASE_URL: GW,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: HAIKU,
  ...over,
});

// A fetch that records where it was aimed and answers with a label.
const capturing = (label = "oauth-loopback") => {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ content: [{ text: label }] }) }; };
  fn.calls = calls;
  return fn;
};
// A key reader that COUNTS its reads, so "the key is never read on Bedrock" is an
// assertion on a spy, not an inference from which URL fetch got.
const spyKey = () => { const s = () => { s.reads++; return "sk-should-not-be-read"; }; s.reads = 0; return s; };

{ // On Bedrock: the gateway route, the DEFAULT_HAIKU model in the path, no key read.
  const f = capturing("oauth-loopback");
  const key = spyKey();
  const c = await candidateTopic(inp({ prompt: "add the oauth loopback flow" }), null,
    bedrockEnv(), { fetch: f, readKey: key, dir: keyDir });
  ok("on Bedrock -> the gateway URL and the guarded label",
     c === "oauth-loopback" && f.calls.length === 1 && f.calls[0].url === `${GW}/model/${HAIKU}/invoke`,
     `${c} ${f.calls[0]?.url}`);
  ok("...the key is never read on Bedrock (proven by the spy)", key.reads === 0, String(key.reads));
  ok("...and the bedrock call carries no auth header", !("x-api-key" in f.calls[0].init.headers));
}
{ // On Bedrock with only SMALL_FAST set: it is used as the model.
  const f = capturing("x");
  await candidateTopic(inp({ prompt: "some ordinary prose" }), null,
    bedrockEnv({ ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined, ANTHROPIC_SMALL_FAST_MODEL: SMALLFAST }),
    { fetch: f, dir: keyDir });
  ok("only SMALL_FAST set -> that model id in the path",
     f.calls[0]?.url === `${GW}/model/${SMALLFAST}/invoke`, f.calls[0]?.url);
}
{ // DEFAULT_HAIKU wins over SMALL_FAST when both are present.
  const f = capturing("x");
  await candidateTopic(inp({ prompt: "some ordinary prose" }), null,
    bedrockEnv({ ANTHROPIC_SMALL_FAST_MODEL: SMALLFAST }), { fetch: f, dir: keyDir });
  ok("DEFAULT_HAIKU wins over SMALL_FAST", f.calls[0]?.url === `${GW}/model/${HAIKU}/invoke`, f.calls[0]?.url);
}
{ // On Bedrock but no base URL: OFF -- and the key is NOT read as a fall-back.
  const key = spyKey();
  const c = await candidateTopic(inp({ prompt: "prose" }), null,
    bedrockEnv({ ANTHROPIC_BEDROCK_BASE_URL: undefined }), { fetch: explode, readKey: key, dir: keyDir });
  ok("Bedrock on, no base URL -> null, no fetch", c === null, c);
  ok("...and the key is not read (no fall-through)", key.reads === 0, String(key.reads));
}
{ // On Bedrock but no model in either var: OFF, key not read.
  const key = spyKey();
  const c = await candidateTopic(inp({ prompt: "prose" }), null,
    bedrockEnv({ ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined }), { fetch: explode, readKey: key, dir: keyDir });
  ok("Bedrock on, no model id -> null, no fetch", c === null, c);
  ok("...key still not read", key.reads === 0, String(key.reads));
}
{ // The flag set to an OFF value is NOT on Bedrock: the key route runs even though
  // the gateway vars are present. (`0`, `false`, empty, whitespace, and FALSE.)
  for (const off of ["0", "false", "FALSE", "", "  "]) {
    const f = capturing("from-key");
    const c = await candidateTopic(inp({ prompt: "some prose here" }), null,
      { COCKPIT_REPO: repo, CLAUDE_CODE_USE_BEDROCK: off, ANTHROPIC_BEDROCK_BASE_URL: GW, ANTHROPIC_DEFAULT_HAIKU_MODEL: HAIKU },
      { fetch: f, dir: keyDir });
    ok(`USE_BEDROCK=${JSON.stringify(off)} is off -> the anthropic key route`,
       c === "from-key" && f.calls[0]?.url === ANTHRO_URL, `${c} ${f.calls[0]?.url}`);
  }
}
{ // No Bedrock flag at all, key present: the anthropic route, as before.
  const f = capturing("oauth-loopback");
  const c = await candidateTopic(inp({ prompt: "add the oauth flow" }), null,
    { COCKPIT_REPO: repo }, { fetch: f, dir: keyDir });
  ok("no Bedrock flag + key -> the anthropic route",
     c === "oauth-loopback" && f.calls[0]?.url === ANTHRO_URL, `${c} ${f.calls[0]?.url}`);
}
{ // The upstream guards still short-circuit BEFORE any route choice, even with a
  // full Bedrock env -- so no route is selected and fetch never fires. The proof is
  // `f.calls.length === 0`, NOT merely `c === null`: fetchTopic SWALLOWS a throwing
  // fetch and returns null (its catch), and the Bedrock route never reads the key,
  // so a bare `fetch: explode` + `c === null` would pass even with a guard gutted
  // (verified: removing the worktree guard left the whole count unchanged). A
  // capturing fetch that records its calls is what actually closes the guard.
  const key = spyKey();
  const f0 = capturing();
  ok("no COCKPIT_REPO short-circuits before the route",
     (await candidateTopic(inp({ prompt: "prose" }), null, bedrockEnv({ COCKPIT_REPO: undefined }),
        { fetch: f0, readKey: key })) === null && f0.calls.length === 0 && key.reads === 0);
  const f1 = capturing();
  ok("a worktree cwd short-circuits before the bedrock route",
     (await candidateTopic(inp({ cwd: wt, prompt: "carry on" }), null, bedrockEnv(), { fetch: f1 })) === null
        && f1.calls.length === 0);
  const f2 = capturing();
  ok("a slug short-circuits before the bedrock route",
     (await candidateTopic(inp({ prompt: "/pir-work cockpit-agenda" }), null, bedrockEnv(), { fetch: f2 })) === null
        && f2.calls.length === 0);
  const f3 = capturing();
  ok("a frozen state short-circuits before the bedrock route",
     (await candidateTopic(inp({ prompt: "prose", session_title: "myrepo / x" }),
        { title: "myrepo / x", frozen: true }, bedrockEnv(), { fetch: f3 })) === null
        && f3.calls.length === 0);
  const f4 = capturing();
  ok("a hand-renamed title short-circuits before the bedrock route",
     (await candidateTopic(inp({ prompt: "prose", session_title: "my own wording" }),
        { title: "myrepo / placeholder" }, bedrockEnv(), { fetch: f4 })) === null
        && f4.calls.length === 0);
}

rmSync(T, { recursive: true, force: true });
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
