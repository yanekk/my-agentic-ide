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
import { asLabel, fetchTopic } from "../../bin/cockpit-auto-name.mjs";

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

{ // An agent that creates a worktree mid-session and moves into it.
  const s = freshState();
  const first = run({ state: s, cwd: repo, prompt: "start here" });
  const second = run({ state: s, cwd: wt, prompt: "now in the worktree", sessionTitle: first });
  ok("the name follows a move into a worktree", second === "myrepo / browse-mode-review", second);
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

// ---- fetchTopic ----------------------------------------------------------
// Every case injects opts.fetch, so nothing here reaches the real API. A naming
// call must never throw to its caller: every failure collapses to null.
console.log("== fetchTopic (injected fetch, no network) ==");

// A fake fetch that answers with a body and status; the throwing variant proves
// a rejected fetch never becomes a throw out of fetchTopic.
const answering = (text, { ok: okStatus = true } = {}) =>
  async () => ({ ok: okStatus, json: async () => ({ content: [{ text }] }) });

{
  const t = await fetchTopic("implement the OAuth loopback flow", "sk-test",
    { fetch: answering("oauth-loopback") });
  ok("a normal message returns the label", t === "oauth-loopback", t);
}
{ // The measured failure mode: a content-free message gets a sentence, guarded out.
  const t = await fetchTopic("hey", "sk-test",
    { fetch: answering("Hi! What would you like to work on today?") });
  ok("a sentence answer returns null", t === null, t);
}
{
  const t = await fetchTopic("x", "sk-test", { fetch: answering("OAuth Loopback.") });
  ok("spaces/capitals/punctuation in the answer -> null", t === null, t);
}
{
  const t = await fetchTopic("x", "sk-test", { fetch: answering("one-two-three-four-five") });
  ok("a five-word dashed answer -> null", t === null, t);
}
{
  const t = await fetchTopic("x", "sk-test", { fetch: async () => { throw new Error("ENOTFOUND"); } });
  ok("a rejecting fetch returns null, not a throw", t === null, t);
}
{
  const t = await fetchTopic("x", "sk-test", { fetch: answering("oauth-loopback", { ok: false }) });
  ok("a non-2xx response returns null", t === null, t);
}
{
  const badJson = async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } });
  ok("malformed JSON returns null", (await fetchTopic("x", "sk-test", { fetch: badJson })) === null);
  const emptyBody = async () => ({ ok: true, json: async () => ({}) });
  ok("an answerless body returns null", (await fetchTopic("x", "sk-test", { fetch: emptyBody })) === null);
}
{ // A hung request must be cut at timeoutMs, not left to hold the prompt box.
  const hanging = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const started = Date.now();
  const t = await fetchTopic("x", "sk-test", { fetch: hanging, timeoutMs: 50 });
  ok("a never-resolving fetch is aborted at timeoutMs", t === null && Date.now() - started < 1500, `${t} in ${Date.now() - started}ms`);
}
{ // No key and no message must never even call fetch -- no hold, no spend.
  const explode = () => { throw new Error("fetch must not be called"); };
  ok("no key returns null without calling fetch", (await fetchTopic("x", "", { fetch: explode })) === null);
  ok("an empty message returns null without calling fetch", (await fetchTopic("   ", "sk-test", { fetch: explode })) === null);
}
{ // The request shape: endpoint, method, headers, and the low token cap.
  let captured = null;
  const capturing = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({ content: [{ text: "daemon-panes" }] }) };
  };
  const t = await fetchTopic("the daemon keeps losing panes", "sk-abc123",
    { fetch: capturing, model: "claude-haiku-4-5" });
  ok("posts to the messages endpoint", captured.url === "https://api.anthropic.com/v1/messages", captured?.url);
  ok("...as a POST", captured.init.method === "POST");
  ok("...with the x-api-key header", captured.init.headers["x-api-key"] === "sk-abc123");
  ok("...and the anthropic-version header", captured.init.headers["anthropic-version"] === "2023-06-01");
  const body = JSON.parse(captured.init.body);
  ok("...naming the model", body.model === "claude-haiku-4-5", body.model);
  ok("...capping tokens low with a non-empty system prompt", body.max_tokens === 16 && typeof body.system === "string" && body.system.length > 0);
  ok("...passing the first message through", body.messages[0].content.includes("the daemon keeps losing panes"));
  ok("...and returning the guarded, clipped label", t === "daemon-panes", t);
}

rmSync(T, { recursive: true, force: true });
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
