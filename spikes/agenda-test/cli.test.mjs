// The `agenda` command: setup, add, ls, rm, color, and the day.
//
// The CLI is driven as a real child process -- it is a program, and its exit code
// and its stdout are half of what this task delivers. Three seatbelts hold for
// EVERY case here (DESIGN 5.2), and run.sh checks two of them from the outside:
//
//   * COCKPIT_DIR is a throwaway directory. Your real ~/.claude/cockpit holds live
//     refresh tokens and no test may read or write one.
//   * AGENDA_ORIGIN points at a loopback stub. Nothing reaches Google.
//   * AGENDA_TTY points at a file, and by default at a path that does not exist.
//     No test can ever read the terminal the suite was started from -- which,
//     without this, is exactly what a prompt would block on.
//
// The "browser" is a script that reads the redirect out of the URL and calls it
// back, so the whole loopback flow is exercised without a browser existing.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { section, ok, eq, done } from "./harness.mjs";
import { PALETTE, errorKind, parseGoogleClient } from "../../bin/cockpit-agenda-model.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CLI = path.join(ROOT, "bin", "cockpit-agenda.mjs");
const BASE = process.env.COCKPIT_DIR;          // run.sh hands each suite its own
const SECRET = "TOPSECRET-never-print-me";
const NO_TTY = path.join(BASE, "there-is-no-terminal-here");

// --- the loopback stub ------------------------------------------------------

let signInEmail = "me@corp.com";
const idToken = (email) => `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;

const CALENDARS = [
  { id: "primary", summary: "Jan", primary: true, accessRole: "owner" },
  { id: "team@group.calendar.google.com", summary: "Team calendar", accessRole: "reader" },
  { id: "holidays@group.v.calendar.google.com", summary: "Polish holidays", accessRole: "reader" },
];

// Offsets on every stamp, so which machine runs this changes nothing.
const EVENTS = [
  { id: "e1", summary: "standup", start: { dateTime: "2026-08-26T09:30:00Z" }, end: { dateTime: "2026-08-26T09:45:00Z" } },
  { id: "e2", summary: "design review", start: { dateTime: "2026-08-26T14:00:00Z" }, end: { dateTime: "2026-08-26T15:00:00Z" } },
];

function defaultReply(req) {
  if (req.path === "/token") {
    if (req.form.grant_type === "authorization_code") {
      return { status: 200, body: { access_token: "at-1", refresh_token: `rt-${signInEmail}`, id_token: idToken(signInEmail), expires_in: 3599 } };
    }
    return { status: 200, body: { access_token: "at-2", expires_in: 3599 } };
  }
  if (req.path.endsWith("/users/me/calendarList")) return { status: 200, body: { items: CALENDARS } };
  if (req.path.includes("/events")) return { status: 200, body: { items: EVENTS, timeZone: "Europe/Warsaw" } };
  return { status: 404, body: { error: { message: "no stub for that" } } };
}

async function startStub() {
  const log = [];
  let reply = defaultReply;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const entry = {
      method: req.method, path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      form: Object.fromEntries(new URLSearchParams(raw)),
    };
    log.push(entry);
    const r = await reply(entry, log.length);
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    res.writeHead(r.status ?? 200, { "Content-Type": "application/json" });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    log,
    set: (fn) => { reply = fn || defaultReply; log.length = 0; },
    stop: () => server.close(),
  };
}

const stub = await startStub();

// --- the fake browser -------------------------------------------------------
// What a browser does with the consent URL, minus the consent: read the redirect
// it was told to come back to, and come back to it. Every invocation is logged,
// which is how "adding a second calendar from the same account opens NO browser"
// is asserted rather than assumed.

const FAKE_BROWSER = path.join(BASE, "fake-browser.mjs");
fs.writeFileSync(FAKE_BROWSER, `#!/usr/bin/env node
import fs from "node:fs";
const url = new URL(process.argv[2]);
fs.appendFileSync(process.env.FAKE_BROWSER_LOG, url.toString() + "\\n");
const back = new URL(url.searchParams.get("redirect_uri"));
back.searchParams.set("code", "auth-code-1");
back.searchParams.set("state", url.searchParams.get("state"));
fetch(back.toString()).catch(() => {});
`, { mode: 0o755 });

// --- running the command ----------------------------------------------------

let caseNo = 0;
/** A fresh state directory per case, so nothing inherits another case's files. */
function freshDir(name) {
  const d = path.join(BASE, `${String(++caseNo).padStart(2, "0")}-${name}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeTty(dir, ...answers) {
  const p = path.join(dir, "answers.tty");
  fs.writeFileSync(p, answers.length ? `${answers.join("\n")}\n` : "");
  return p;
}

function writeClientFile(dir, clientId = "cid-123.apps.googleusercontent.com") {
  fs.writeFileSync(path.join(dir, "agenda-client.json"),
    `${JSON.stringify({ version: 1, clientId, clientSecret: SECRET }, null, 2)}\n`, { mode: 0o600 });
}

const browserLog = (dir) => {
  const p = path.join(dir, "browser.log");
  try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean); } catch { return []; }
};

/**
 * `timeoutMs` is not belt and braces: a prompt that found no answer would
 * otherwise hang this suite forever, and a hang is the one failure a test run
 * cannot report.
 */
function run(args, { dir, tty = NO_TTY, env = {}, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], {
      // Built from nothing rather than spread from process.env: this suite is
      // itself often run BY an agent, and an inherited CLAUDECODE would silently
      // turn every `add` into a refusal.
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, TZ: "UTC",
        COCKPIT_DIR: dir,
        AGENDA_ORIGIN: stub.origin,
        AGENDA_BROWSER: FAKE_BROWSER,
        AGENDA_TTY: tty,
        FAKE_BROWSER_LOG: path.join(dir, "browser.log"),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, out, err, all: out + err, ms: Date.now() - started });
    });
  });
}

const state = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "agenda.json"), "utf8")); }
  catch { return { accounts: {}, calendars: [] }; }
};
const cache = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "agenda-cache.json"), "utf8")); }
  catch { return { calendars: {} }; }
};
const slugs = (dir) => state(dir).calendars.map((c) => c.slug);
const colourOf = (dir, slug) => (state(dir).calendars.find((c) => c.slug === slug) || {}).colour;

// ===========================================================================
section("28. help, and what works with nothing configured at all");

// `agenda help` must answer where the command should not otherwise work: it is
// how you find out what this thing is, and refusing to explain itself is the one
// unhelpful failure mode.
{
  const dir = freshDir("help");
  const r = await run(["help"], { dir });
  eq("`agenda help` exits 0 with no registration", r.status, 0);
  ok("...and prints the whole command surface",
    ["agenda add <slug>", "agenda rm <slug>", "agenda color <slug>", "agenda setup", "agenda ls"]
      .every((s) => r.out.includes(s)), r.out);
  eq("...and writes nothing at all", fs.readdirSync(dir).filter((f) => f.startsWith("agenda")).length, 0);

  const asAgent = await run(["help"], { dir, env: { CLAUDECODE: "1" } });
  eq("`agenda help` answers an agent too", asAgent.status, 0);
  ok("...with the same usage", asAgent.out.includes("agenda add <slug>"));
}

{
  const dir = freshDir("bare-empty");
  const r = await run([], { dir });
  eq("bare `agenda` with nothing configured exits 0", r.status, 0);
  // The SAME lines the column draws, because it is the same function: an
  // invitation written twice is an invitation that disagrees with itself.
  ok("...and prints the column's own invitation",
    r.out.includes("no calendars") && r.out.includes("agenda add home"), r.out);
  ok("...including the section header", r.out.includes("AGENDA"), r.out);

  const l = await run(["ls"], { dir });
  eq("`agenda ls` with none configured exits 0", l.status, 0);
  ok("...and says how to start", l.out.includes("agenda add home"), l.out);
}

// ===========================================================================
section("29. setup: the shape Google actually downloads");

// The parse is pure and lives in the model, beside normaliseEvent -- both turn a
// Google shape into ours (DESIGN 2.9). It returns { error } and never throws.
{
  const nested = { installed: { client_id: "nested-id", client_secret: "nested-secret", auth_uri: "https://x" } };
  eq("the real, NESTED desktop download parses",
    parseGoogleClient(JSON.stringify(nested)), { clientId: "nested-id", clientSecret: "nested-secret" });
  eq("a `web` wrapper parses too",
    parseGoogleClient(JSON.stringify({ web: { client_id: "w-id", client_secret: "w-sec" } })),
    { clientId: "w-id", clientSecret: "w-sec" });
  eq("a flat snake_case object parses",
    parseGoogleClient(JSON.stringify({ client_id: "f-id", client_secret: "f-sec" })),
    { clientId: "f-id", clientSecret: "f-sec" });
  eq("a flat camelCase object parses",
    parseGoogleClient(JSON.stringify({ clientId: "c-id", clientSecret: "c-sec" })),
    { clientId: "c-id", clientSecret: "c-sec" });
  eq("camelCase nested under `installed` parses",
    parseGoogleClient(JSON.stringify({ installed: { clientId: "n-id", clientSecret: "n-sec" } })),
    { clientId: "n-id", clientSecret: "n-sec" });

  ok("valid JSON with no client id returns an error, not an exception",
    typeof parseGoogleClient(JSON.stringify({ installed: { client_secret: "s" } })).error === "string");
  ok("valid JSON with no secret is told apart from it",
    /secret/.test(parseGoogleClient(JSON.stringify({ installed: { client_id: "i" } })).error));
  ok("text that is not JSON returns an error", typeof parseGoogleClient("not json at all").error === "string");
  ok("an empty file returns an error", typeof parseGoogleClient("").error === "string");
  ok("a JSON array returns an error", typeof parseGoogleClient("[1,2,3]").error === "string");
  ok("undefined returns an error", typeof parseGoogleClient(undefined).error === "string");
  // A parsed JSON object still inherits Object.prototype, so a plain lookup would
  // hand back a FUNCTION here -- the trap T02's review found in responseStatus.
  ok("a file whose only keys are inherited ones is still an error",
    typeof parseGoogleClient(JSON.stringify({ installed: {} })).error === "string");
}

{
  const dir = freshDir("setup");
  const download = path.join(dir, "client_secret_1234.apps.googleusercontent.com.json");
  const original = `${JSON.stringify({ installed: { client_id: "real-id", client_secret: SECRET, redirect_uris: ["http://localhost"] } }, null, 4)}\n`;
  fs.writeFileSync(download, original);
  const before = fs.statSync(download);

  const r = await run(["setup", download], { dir });
  eq("`agenda setup <path>` on the real nested download exits 0", r.status, 0);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "agenda-client.json"), "utf8"));
  eq("...and stores OUR flat shape, not Google's",
    { clientId: stored.clientId, clientSecret: stored.clientSecret },
    { clientId: "real-id", clientSecret: SECRET });
  eq("...0600, because it holds a secret",
    (fs.statSync(path.join(dir, "agenda-client.json")).mode & 0o777).toString(8), "600");
  ok("...it never echoes the secret", !r.all.includes(SECRET), r.all);
  ok("...and says where it put it", r.out.includes("agenda-client.json"), r.out);

  // Reading someone's ~/Downloads and moving nothing is the least surprising
  // thing this can do (DESIGN 2.9).
  const after = fs.statSync(download);
  ok("the download is left exactly where it was", fs.existsSync(download));
  eq("...unmodified", fs.readFileSync(download, "utf8"), original);
  eq("...same size and mtime", [after.size, after.mtimeMs], [before.size, before.mtimeMs]);
}

{
  const dir = freshDir("setup-bad");
  const missing = path.join(dir, "not-here.json");
  const r = await run(["setup", missing], { dir });
  eq("`agenda setup` on a missing path exits 1", r.status, 1);
  ok("...naming the path", r.all.includes(missing), r.all);
  eq("...and writes nothing", fs.existsSync(path.join(dir, "agenda-client.json")), false);

  const junk = path.join(dir, "screenshot.json");
  fs.writeFileSync(junk, "this is not json\n");
  const j = await run(["setup", junk], { dir });
  eq("an unparseable file exits 1", j.status, 1);
  // "invalid JSON" alone is useless in a folder of six downloads.
  ok("...and names THE FILE IT READ", j.all.includes(junk), j.all);

  const wrong = path.join(dir, "some-other-config.json");
  fs.writeFileSync(wrong, JSON.stringify({ installed: { project_id: "p" } }));
  const w = await run(["setup", wrong], { dir });
  eq("a file that parses but has no client id exits 1", w.status, 1);
  ok("...names the file", w.all.includes(wrong), w.all);
  ok("...and shows the shape it wanted", w.all.includes("client_secret"), w.all);
}

// ===========================================================================
section("30. adding a calendar, end to end");

const added = freshDir("add");
{
  writeClientFile(added);
  stub.set(null);
  const r = await run(["add", "work"], { dir: added, tty: writeTty(added, "2") });
  eq("`agenda add work` exits 0", r.status, 0);
  eq("...one calendar is configured", slugs(added), ["work"]);

  const cal = state(added).calendars[0];
  eq("...it is the one that was picked", [cal.calendarId, cal.title],
    ["team@group.calendar.google.com", "Team calendar"]);
  eq("...attributed to the account that signed in", cal.account, "me@corp.com");
  ok("...and it has a colour from the palette",
    PALETTE.some((c) => c.name === cal.colour), String(cal.colour));

  eq("the sign-in is stored against the account", Object.keys(state(added).accounts), ["me@corp.com"]);
  ok("...as a refresh token", state(added).accounts["me@corp.com"].refreshToken.startsWith("rt-"));
  eq("...0600, because it holds one", (fs.statSync(path.join(added, "agenda.json")).mode & 0o777).toString(8), "600");

  // Fetched immediately, so the column has rows before the daemon's next tick
  // rather than up to a minute later.
  eq("the calendar is fetched at once", cache(added).calendars.work.events.length, 2);
  eq("...with no error", cache(added).calendars.work.error, null);
  ok("...and normalised, not raw Google",
    Number.isFinite(cache(added).calendars.work.events[0].start), JSON.stringify(cache(added).calendars.work.events[0]));

  eq("exactly one browser was opened", browserLog(added).length, 1);
  ok("...at the consent screen, with PKCE",
    new URL(browserLog(added)[0]).searchParams.get("code_challenge_method") === "S256");
  ok("the calendars were listed for you to pick from",
    r.out.includes("Team calendar") && r.out.includes("Polish holidays"), r.out);
  ok("...and no secret was printed", !r.all.includes(SECRET));
}

{
  // Sign-in is per ACCOUNT, calendars are per slug (DESIGN 2.1) -- which is the
  // whole reason they are separate tables.
  fs.writeFileSync(path.join(added, "browser.log"), "");
  stub.set(null);
  const r = await run(["add", "home"], { dir: added, tty: writeTty(added, "1", "3") });
  eq("a second calendar from the SAME account exits 0", r.status, 0);
  eq("...opens no browser at all", browserLog(added).length, 0);
  ok("...because it asked which account instead", r.out.includes("me@corp.com"), r.out);
  eq("...and there is still one sign-in", Object.keys(state(added).accounts).length, 1);
  eq("...two calendars now", slugs(added), ["work", "home"]);

  // No two configured calendars share a colour while a free one remains
  // (DESIGN 2.8) -- two rows in one colour is two rows you cannot tell apart.
  ok("the two calendars got different colours",
    colourOf(added, "work") !== colourOf(added, "home"),
    `${colourOf(added, "work")} / ${colourOf(added, "home")}`);
}

{
  const dir = freshDir("second-account");
  writeClientFile(dir);
  stub.set(null);
  signInEmail = "me@corp.com";
  await run(["add", "work"], { dir, tty: writeTty(dir, "2") });
  fs.writeFileSync(path.join(dir, "browser.log"), "");
  signInEmail = "personal@gmail.com";
  // The last option on the menu is always "a different account".
  const r = await run(["add", "life"], { dir, tty: writeTty(dir, "2", "1") });
  eq("a DIFFERENT account exits 0", r.status, 0);
  eq("...and does open a browser", browserLog(dir).length, 1);
  eq("...two sign-ins are stored", Object.keys(state(dir).accounts).sort(), ["me@corp.com", "personal@gmail.com"]);
  eq("...the new calendar belongs to the new account",
    state(dir).calendars.find((c) => c.slug === "life").account, "personal@gmail.com");
  signInEmail = "me@corp.com";
}

{
  const dir = freshDir("duplicate");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const r = await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  eq("adding a slug that already exists exits 1", r.status, 1);
  ok("...and points at the command that frees it", r.all.includes("agenda rm work"), r.all);
  eq("...leaving the one that was there", slugs(dir), ["work"]);
  eq("...and opening no browser for it", browserLog(dir).length, 1);
}

// ===========================================================================
section("30b. `agenda add <slug>` on a calendar that is already connected");

// DESIGN 2.7 prints the fixing command ON the loud line -- an expired sign-in
// draws `home  sign-in expired · agenda add home`. T08 found by hand that this
// command then refused, so the column named something that turns you away. The
// user's decision: typing it REPAIRS the sign-in, keeping the calendar as it is.
{
  const dir = freshDir("repair-expired");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  await run(["add", "home"], { dir, tty: writeTty(dir, "1", "2") });
  const before = { work: colourOf(dir, "work"), home: colourOf(dir, "home"), order: slugs(dir) };
  const browsers = browserLog(dir).length;

  // What the daemon would have written once the token died: BOTH calendars on the
  // account carry the auth error, because they share the one sign-in. Without this
  // the "other calendar cleared" assertion below passes for the wrong reason -- its
  // error was already null -- and a repair that fixed only the named calendar would
  // sail through it (caught by mutating `shared` to `[cal]`).
  const broken = cache(dir);
  for (const slug of ["work", "home"]) {
    broken.calendars[slug] = {
      fetchedAt: 0, events: [],
      error: { kind: "auth", reason: "invalid_grant", code: "", detail: "", since: 1 },
    };
  }
  fs.writeFileSync(path.join(dir, "agenda-cache.json"), JSON.stringify(broken));

  // The refresh token is dead until a fresh authorization_code lands -- which is
  // what the re-sign-in does, so the re-fetch afterwards has to work.
  let reSignedIn = false;
  stub.set((req) => {
    if (req.path === "/token" && req.form.grant_type === "refresh_token" && !reSignedIn) {
      return { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } };
    }
    if (req.path === "/token" && req.form.grant_type === "authorization_code") reSignedIn = true;
    return defaultReply(req);
  });

  // No terminal: repair has nothing to ask -- the account is known and there is no
  // calendar to pick -- so unlike `add` it must not need one.
  const r = await run(["add", "work"], { dir, tty: NO_TTY });
  eq("`agenda add` on an expired calendar exits 0", r.status, 0);
  ok("...saying the sign-in expired rather than refusing", /expired/i.test(r.all), r.all);
  eq("...and it opened a browser to fix it", browserLog(dir).length, browsers + 1);
  eq("...the calendar is not re-added", slugs(dir), before.order);
  eq("...it keeps its colour", colourOf(dir, "work"), before.work);
  eq("...and so does every other calendar", colourOf(dir, "home"), before.home);
  eq("...one sign-in, not two", Object.keys(state(dir).accounts), ["me@corp.com"]);
  // The whole ACCOUNT was dark, so both its calendars clear at once rather than a
  // tick apart -- that is the reason repairing beats `rm` + `add`.
  eq("...the repaired calendar's error is cleared", cache(dir).calendars.work.error, null);
  eq("...and so is the OTHER calendar's on the same sign-in", cache(dir).calendars.home.error, null);
  ok("...both were actually re-fetched", cache(dir).calendars.work.fetchedAt > 0 &&
     cache(dir).calendars.home.fetchedAt > 0, JSON.stringify(cache(dir).calendars));
}

// The exact sequence a person hit by hand in T08: revoke the cockpit's access at
// Google, `agenda rm` the calendar, then add it again and pick the known account.
// Removing the calendar leaves the ACCOUNT behind -- deliberately, it is what saves
// a browser round trip normally -- so the menu offers a sign-in that is already
// dead, and nothing on this machine can know that until a call fails. It used to
// surface Google's own words ("token call failed with HTTP 400 (invalid_grant)")
// and name nothing to do about it.
{
  const dir = freshDir("dead-account-on-menu");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "home"], { dir, tty: writeTty(dir, "1") });
  await run(["rm", "home"], { dir });
  eq("removing the calendar leaves the sign-in behind", Object.keys(state(dir).accounts), ["me@corp.com"]);
  eq("...and no calendars", slugs(dir), []);

  let reSignedIn = false;
  stub.set((req) => {
    if (req.path === "/token" && req.form.grant_type === "refresh_token" && !reSignedIn) {
      return { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } };
    }
    if (req.path === "/token" && req.form.grant_type === "authorization_code") reSignedIn = true;
    return defaultReply(req);
  });

  // Account 1 (the known, dead one), then calendar 2.
  const r = await run(["add", "home"], { dir, tty: writeTty(dir, "1", "2") });
  eq("picking an account whose sign-in was revoked still exits 0", r.status, 0);
  ok("...saying the stored sign-in expired", /sign-in for .*expired|stored sign-in .*expired/i.test(r.all), r.all);
  ok("...never showing Google's raw words", !/invalid_grant/i.test(r.all), r.all);
  eq("...and the calendar is attached after all", slugs(dir), ["home"]);
  eq("...on the same account, not a second one", Object.keys(state(dir).accounts), ["me@corp.com"]);
  eq("...with its events fetched", cache(dir).calendars.home.error, null);
}

// Refusing is still right when nothing is wrong: a working calendar must not be
// dragged through a browser round trip by a mistyped slug.
{
  const dir = freshDir("repair-healthy");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const browsers = browserLog(dir).length;

  const r = await run(["add", "work"], { dir, tty: NO_TTY });
  eq("a HEALTHY calendar still refuses", r.status, 1);
  // "it is working", not "its sign-in works": the probe now asks the events call
  // too, so this sentence is claiming more than it used to and has to say so.
  ok("...saying it is working", /is working/i.test(r.all), r.all);
  ok("...and pointing at the command that frees the slug", r.all.includes("agenda rm work"), r.all);
  eq("...opening no browser at all", browserLog(dir).length, browsers);
}

// A wifi blip is not an expiry. Sending somebody through a sign-in because their
// network is down spends a browser round trip on something it cannot fix.
{
  const dir = freshDir("repair-offline");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const browsers = browserLog(dir).length;
  const tokenBefore = state(dir).accounts["me@corp.com"].refreshToken;

  stub.set((req) => (req.path === "/token" && req.form.grant_type === "refresh_token"
    ? { status: 500, body: { error: { message: "backend error" } } }
    : defaultReply(req)));

  const r = await run(["add", "work"], { dir, tty: NO_TTY });
  eq("a calendar whose sign-in cannot be CHECKED refuses", r.status, 1);
  ok("...saying nothing was changed", /nothing was changed/i.test(r.all), r.all);
  eq("...and it did not open a browser", browserLog(dir).length, browsers);
  eq("...nor touch the stored sign-in", state(dir).accounts["me@corp.com"].refreshToken, tokenBefore);
}

// Signing in as the wrong person would store a second account and leave this
// calendar pointing at the dead one -- fixed-looking and still broken.
{
  const dir = freshDir("repair-wrong-account");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const tokenBefore = state(dir).accounts["me@corp.com"].refreshToken;

  let reSignedIn = false;
  stub.set((req) => {
    if (req.path === "/token" && req.form.grant_type === "refresh_token" && !reSignedIn) {
      return { status: 400, body: { error: "invalid_grant" } };
    }
    if (req.path === "/token" && req.form.grant_type === "authorization_code") reSignedIn = true;
    return defaultReply(req);
  });
  signInEmail = "somebody.else@gmail.com";
  const r = await run(["add", "work"], { dir, tty: NO_TTY });
  signInEmail = "me@corp.com";

  eq("signing in as a different account exits 1", r.status, 1);
  ok("...naming the account the calendar actually belongs to", r.all.includes("me@corp.com"), r.all);
  eq("...and stores no second sign-in", Object.keys(state(dir).accounts), ["me@corp.com"]);
  eq("...leaving the old token exactly as it was", state(dir).accounts["me@corp.com"].refreshToken, tokenBefore);
  // The escape offered has to exist on the path that printed it. `agenda add work`
  // on an existing slug shows NO account menu -- it goes straight to the repair --
  // so "pick a different account" would name a picker the user never saw. Same
  // species as the `agenda rm` browser sentence T08 itself fixed.
  ok("...and the way out names no menu this path never showed",
     !/different account/i.test(r.all) && r.all.includes("agenda rm work"), r.all);
}

// The consent screen's PER-SCOPE checkbox (T00, measured 2026-08-27) leaves a
// grant that refreshes PERFECTLY and 403s only on the events call. The column
// therefore draws `calendar permission not granted · agenda add work` -- and a
// repair that probed only the TOKEN saw nothing wrong and refused, which is the
// exact dead end DESIGN 2.7 forbids and worse: it pointed at `agenda rm`, which
// would destroy a working configuration and fix nothing.
{
  const dir = freshDir("repair-missing-scope");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const browsers = browserLog(dir).length;

  // The token call keeps working throughout -- that is the whole trap.
  const scope403 = { status: 403, body: { error: { status: "PERMISSION_DENIED",
    message: "Request had insufficient authentication scopes.",
    details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } };
  let consented = false;
  stub.set((req) => {
    if (req.path === "/token" && req.form.grant_type === "authorization_code") consented = true;
    if (req.path.includes("/events") && !consented) return scope403;
    return defaultReply(req);
  });

  // What the pane is drawing at that moment, from the same classification the
  // command is about to make: it must be the scope wording, naming `agenda add`.
  eq("the column calls it a permission, not an expiry",
     errorKind({ kind: "auth", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", code: "", detail: "" }), "scope");

  const r = await run(["add", "work"], { dir, tty: NO_TTY });
  eq("`agenda add` on a scope-less grant exits 0", r.status, 0);
  ok("...saying the permission was never granted, not that a sign-in expired",
     /permission/i.test(r.all) && !/sign-in .*expired/i.test(r.all), r.all);
  ok("...telling the user the one thing that fixes it", /tick/i.test(r.all), r.all);
  ok("...never sending them to `agenda rm`, which would destroy a fine calendar",
     !/agenda rm/.test(r.all), r.all);
  eq("...and it opened a browser to re-consent", browserLog(dir).length, browsers + 1);
  eq("...the calendar is not re-added", slugs(dir), ["work"]);
  eq("...and its events arrive once the box is ticked", cache(dir).calendars.work.error, null);
}

// A calendar that is genuinely GONE is not signed back into existence, and the
// column says `agenda rm` for it -- so the repair must agree rather than opening a
// browser that cannot help.
{
  const dir = freshDir("repair-gone");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const browsers = browserLog(dir).length;

  stub.set((req) => (req.path.includes("/events")
    ? { status: 404, body: { error: { status: "NOT_FOUND", message: "Not Found" } } }
    : defaultReply(req)));

  const r = await run(["add", "work"], { dir, tty: NO_TTY });
  eq("a gone calendar refuses", r.status, 1);
  ok("...saying it is gone", /gone/i.test(r.all), r.all);
  ok("...and pointing at `agenda rm`, the only thing that helps", r.all.includes("agenda rm work"), r.all);
  eq("...opening no browser", browserLog(dir).length, browsers);
}

// DESIGN 5.2: `AGENDA_DRY_RUN=1` opens no browser. It is one of the two seatbelts
// every hands-on check in this project is handed over under, and the repair branch
// sits ABOVE `add`'s own dry-run block -- so it needs its own check or the flag
// silently stops meaning anything on exactly the command T08 added.
{
  const dir = freshDir("repair-dry-run");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const browsers = browserLog(dir).length;
  const tokenBefore = state(dir).accounts["me@corp.com"].refreshToken;

  stub.set((req) => (req.path === "/token" && req.form.grant_type === "refresh_token"
    ? { status: 400, body: { error: "invalid_grant" } }
    : defaultReply(req)));

  const r = await run(["add", "work"], { dir, tty: NO_TTY, env: { AGENDA_DRY_RUN: "1" } });
  eq("a dry-run repair exits 0", r.status, 0);
  ok("...printing the URL it would have opened", /https?:\/\/\S*oauth2\S*auth/.test(r.all), r.all);
  eq("...and opening no browser at all", browserLog(dir).length, browsers);
  eq("...writing nothing", state(dir).accounts["me@corp.com"].refreshToken, tokenBefore);
  eq("...and leaving the calendars alone", slugs(dir), ["work"]);
}

// ===========================================================================
section("31. ls, rm and color");

{
  const dir = freshDir("ls-rm");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "2") });
  await run(["add", "home"], { dir, tty: writeTty(dir, "1", "3") });

  const l = await run(["ls"], { dir });
  eq("`agenda ls` exits 0", l.status, 0);
  eq("...one line per calendar", l.out.trim().split("\n").length, 2);
  ok("...naming the slug, the colour, the account and the title",
    l.out.includes("work") && l.out.includes("me@corp.com") &&
    l.out.includes("Team calendar") && l.out.includes(colourOf(dir, "work")), l.out);

  const bare = await run([], { dir });
  eq("bare `agenda` exits 0 with calendars configured", bare.status, 0);
  ok("...and says the state of each one", bare.out.includes("2 events"), bare.out);

  // Exact match, deliberately unlike `note rm a3f9`: a note removed by mistake is
  // one line retyped, a calendar removed by mistake is the whole sign-in dance
  // again (DESIGN 2.2).
  const prefix = await run(["rm", "wor"], { dir });
  eq("`agenda rm wor` -- a prefix -- is refused", prefix.status, 1);
  ok("...saying the slug is wanted in full", /prefix/i.test(prefix.all), prefix.all);
  eq("...and removes nothing", slugs(dir).length, 2);

  const nope = await run(["rm", "nope"], { dir });
  eq("`agenda rm nope` exits 1", nope.status, 1);
  ok("...naming the slug it could not find", nope.all.includes("nope"), nope.all);

  ok("the cache has the calendar before it is removed", Boolean(cache(dir).calendars.work));
  const gone = await run(["rm", "work"], { dir });
  eq("`agenda rm work` exits 0", gone.status, 0);
  eq("...and it is gone", slugs(dir), ["home"]);
  // Otherwise the events of a calendar you removed sit in the cache forever, and
  // a slug re-added later would show yesterday's meetings before its first fetch.
  eq("...its cached events went with it", cache(dir).calendars.work, undefined);
  eq("...the other calendar's did not", Boolean(cache(dir).calendars.home), true);

  const before = colourOf(dir, "home");
  const c = await run(["color", "home"], { dir });
  eq("`agenda color home` exits 0", c.status, 0);
  ok("...and the colour changed", colourOf(dir, "home") !== before, `${before} -> ${colourOf(dir, "home")}`);
  ok("...to one from the palette", PALETTE.some((p) => p.name === colourOf(dir, "home")));

  const cn = await run(["color", "nope"], { dir });
  eq("`agenda color` on an unknown slug exits 1", cn.status, 1);
  ok("...naming it", cn.all.includes("nope"), cn.all);
}

{
  // "Prefers an unused one" is the whole rule: with seven of eight taken there is
  // exactly one colour a reroll may land on.
  const dir = freshDir("colour-preference");
  const taken = PALETTE.slice(0, 7).map((c) => c.name);
  fs.writeFileSync(path.join(dir, "agenda.json"), JSON.stringify({
    version: 1, accounts: {},
    calendars: taken.map((colour, i) => ({ slug: `c${i}`, account: "a@b.c", calendarId: `id${i}`, title: `t${i}`, colour, addedAt: 1 })),
  }, null, 2), { mode: 0o600 });
  const r = await run(["color", "c0"], { dir });
  eq("a reroll with one colour free exits 0", r.status, 0);
  eq("...and takes the free one", colourOf(dir, "c0"), PALETTE[7].name);
}

// ===========================================================================
section("32. an agent may read, and may not connect");

{
  const dir = freshDir("agent");
  writeClientFile(dir);
  stub.set(null);
  await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const asAgent = { CLAUDECODE: "1" };
  const answers = writeTty(dir, "1", "1");

  // The reason given must be TRUE of the verb refused. `rm` and `color` open no
  // browser, and telling somebody one is coming sends them looking for a window
  // that never appears (T08's hands-on pass found exactly that).
  const opensBrowser = new Set(["add", "setup"]);
  for (const args of [["add", "other"], ["rm", "work"], ["color", "work"], ["setup", "/tmp/whatever.json"]]) {
    const r = await run(args, { dir, tty: answers, env: asAgent });
    eq(`an agent running \`agenda ${args[0]}\` exits 1`, r.status, 1);
    ok(`...saying why, and that a person must do it`, /agent/i.test(r.all), r.all);
    eq(`...and the browser is mentioned only if ${args[0]} opens one`,
       /open a browser/.test(r.all), opensBrowser.has(args[0]));
  }
  eq("...and nothing an agent ran changed anything", slugs(dir), ["work"]);
  eq("...no browser was opened for it", browserLog(dir).length, 1);

  const bare = await run([], { dir, env: asAgent });
  eq("an agent may still read the day", bare.status, 0);
  ok("...and see the calendars", bare.out.includes("work"), bare.out);
  const l = await run(["ls"], { dir, env: asAgent });
  eq("an agent may still run `agenda ls`", l.status, 0);
  ok("...and get the list", l.out.includes(state(dir).calendars[0].title), l.out);
}

// ===========================================================================
section("33. the ways `add` refuses, and what it leaves behind");

{
  // A script, a CI run, a cron job: with no terminal there is nobody to pick a
  // calendar, so this must exit rather than block forever on a read.
  const dir = freshDir("no-tty");
  writeClientFile(dir);
  const r = await run(["add", "work"], { dir, tty: NO_TTY, timeoutMs: 8000 });
  eq("`agenda add` with no terminal exits 1", r.status, 1);
  ok("...promptly, rather than hanging", r.ms < 5000, `${r.ms}ms`);
  ok("...saying it needs an interactive terminal", /interactive terminal/.test(r.all), r.all);
  eq("...and it opened no browser first", browserLog(dir).length, 0);
  eq("...and wrote no state", fs.existsSync(path.join(dir, "agenda.json")), false);
}

{
  const dir = freshDir("picker-junk");
  writeClientFile(dir);
  stub.set(null);
  // 0, a word and a number past the end are all just typos, and the list is still
  // on the screen: re-ask rather than crash or guess.
  const r = await run(["add", "work"], { dir, tty: writeTty(dir, "0", "nope", "99", "-1", "3") });
  eq("junk at the picker still ends in a calendar", r.status, 0);
  eq("...the one that was finally typed", state(dir).calendars[0].title, "Polish holidays");
  ok("...having said what it wanted, each time",
    (r.out.match(/please type a number from 1 to 3/g) || []).length === 4, r.out);
}

{
  const dir = freshDir("picker-eof");
  writeClientFile(dir);
  stub.set(null);
  const r = await run(["add", "work"], { dir, tty: writeTty(dir) });   // an empty answer file
  eq("an answer file that runs out exits 1", r.status, 1);
  eq("...and adds nothing", slugs(dir), []);
}

{
  // The one that matters: a sign-in that fails must leave NOTHING. A half-added
  // account is a calendar that can never be fetched and a loud line forever.
  const dir = freshDir("signin-fails");
  writeClientFile(dir);
  stub.set((req) => (req.path === "/token"
    ? { status: 400, body: { error: "invalid_grant", error_description: "Bad Request" } }
    : defaultReply(req)));
  const r = await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  eq("a failed sign-in exits 1", r.status, 1);
  eq("...no account is stored", Object.keys(state(dir).accounts), []);
  eq("...no calendar is stored", slugs(dir), []);
  eq("...and no cache entry either", Object.keys(cache(dir).calendars), []);
  ok("...but it says what went wrong", /invalid_grant|400/.test(r.all), r.all);
  ok("...without printing the secret", !r.all.includes(SECRET));
  stub.set(null);
}

{
  // The add SUCCEEDS and the first fetch fails: the calendar is attached and the
  // column says why it has no rows (DESIGN 2.7). An add that half-succeeded and
  // left nothing to look at would be worse.
  const dir = freshDir("first-fetch-fails");
  writeClientFile(dir);
  let exchanged = false;
  stub.set((req) => {
    if (req.path === "/token" && req.form.grant_type === "authorization_code") { exchanged = true; return defaultReply(req); }
    if (req.path.includes("/events")) {
      return { status: 403, body: { error: { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes.", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } };
    }
    return defaultReply(req);
  });
  const r = await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  eq("a first fetch that fails does not fail the add", r.status, 0);
  eq("...the calendar is attached", slugs(dir), ["work"]);
  ok("...the exchange did happen", exchanged);
  // describeError, not a bare classifyError string: the object is what lets the
  // column say "calendar permission not granted" instead of "sign-in expired"
  // (FINDINGS 2026-08-28).
  eq("...and the cache carries a described error", cache(dir).calendars.work.error.kind, "auth");
  ok("...naming the scope signal the column greps for",
    /scope/i.test(JSON.stringify(cache(dir).calendars.work.error)), JSON.stringify(cache(dir).calendars.work.error));
  // The described error carries the four fields the column reads and NOTHING else.
  // The raw response body can hold tokens, and this object is written to a file
  // (T04's non-enumerable `body` is what keeps it out) -- `since` is the daemon's
  // "how long has it been broken", added here so a first failure already has one.
  eq("...and only the fields the column reads, never the response body",
    Object.keys(cache(dir).calendars.work.error).sort(), ["code", "detail", "kind", "reason", "since"]);
  stub.set(null);
}

{
  const dir = freshDir("bad-args");
  const noSlug = await run(["add"], { dir });
  eq("`agenda add` with no slug exits 1", noSlug.status, 1);
  const spaced = await run(["add", "my work"], { dir });
  eq("a slug with a space is refused", spaced.status, 1);
  // `agenda rm` takes the slug in full, so a slug that cannot be typed in full
  // could never be removed.
  ok("...saying why", /space/i.test(spaced.all), spaced.all);
  const unknown = await run(["wat"], { dir });
  eq("an unknown verb exits 1", unknown.status, 1);
  ok("...and points at help", unknown.all.includes("agenda help"), unknown.all);
}

// ===========================================================================
section("34. no secrets, no browser, no internet");

{
  const dir = freshDir("hygiene");
  writeClientFile(dir);
  stub.set(null);
  const r = await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  const ls = await run(["ls"], { dir });
  const bare = await run([], { dir });

  ok("the secret never reaches stdout or stderr, on any command",
    ![r.all, ls.all, bare.all].some((s) => s.includes(SECRET)));

  // The one file it is allowed in. Anything else -- the state, the cache, a temp
  // file left behind -- would be a second copy nobody knows about.
  const leaked = fs.readdirSync(dir)
    .filter((f) => f !== "agenda-client.json")
    .filter((f) => {
      try { return fs.readFileSync(path.join(dir, f), "utf8").includes(SECRET); } catch { return false; }
    });
  eq("...nor any file but agenda-client.json", leaked, []);

  eq("no temp file is left behind", fs.readdirSync(dir).filter((f) => f.includes(".tmp")).length, 0);
  eq("no lock is left behind", fs.readdirSync(dir).filter((f) => f === "agenda.lock").length, 0);
}

{
  // AGENDA_DRY_RUN is the seatbelt for looking at the flow by hand (DESIGN 5.2):
  // it must bind nothing, open nothing and write nothing -- and therefore it must
  // not need a terminal either.
  const dir = freshDir("dry-run");
  writeClientFile(dir);
  const r = await run(["add", "work"], { dir, tty: NO_TTY, env: { AGENDA_DRY_RUN: "1" } });
  eq("AGENDA_DRY_RUN=1 exits 0 with no terminal at all", r.status, 0);
  ok("...printing the URL it would have opened", r.out.includes("code_challenge_method=S256"), r.out);
  eq("...opening no browser", browserLog(dir).length, 0);
  eq("...and writing nothing", fs.existsSync(path.join(dir, "agenda.json")), false);
  ok("...and not printing the secret", !r.all.includes(SECRET));

  const dir2 = freshDir("dry-run-unregistered");
  const u = await run(["add", "work"], { dir: dir2, env: { AGENDA_DRY_RUN: "1" } });
  eq("a dry run with no registration exits 1", u.status, 1);
  ok("...pointing at setup", u.all.includes("agenda setup"), u.all);
}

{
  // DESIGN 2.7: agenda.json holds the sign-ins, so a corrupt one is MOVED ASIDE
  // and said out loud, never silently replaced -- discarding a refresh token
  // costs two browser round trips.
  const dir = freshDir("corrupt");
  fs.writeFileSync(path.join(dir, "agenda.json"), "{ this is not json", { mode: 0o600 });
  const r = await run([], { dir });
  eq("a corrupt agenda.json still draws a column", r.status, 0);
  ok("...and says it was set aside", /set aside/i.test(r.all), r.all);
  eq("...the broken file is kept", fs.readdirSync(dir).filter((f) => f.includes("corrupt-")).length, 1);
}

// ===========================================================================
section("35. what came off the wire is not allowed to draw itself");

{
  // A calendar title is whatever the person who sent you the invitation typed,
  // and an account name comes off an id_token. T03's review found three ways such
  // a string escaped the PANE's drawing; the command draws the same strings into a
  // TERMINAL, where an ESC retitles the window and a NEWLINE forges a row that
  // reads exactly like another configured calendar.
  const dir = freshDir("wire-escapes");
  const ESC = String.fromCharCode(27), BEL = String.fromCharCode(7);
  const nasty = `Team ${ESC}]0;PWNED${BEL} call\nFAKE  fake@evil.com  forged`;
  fs.writeFileSync(path.join(dir, "agenda.json"), JSON.stringify({
    version: 1, accounts: {},
    calendars: [{ slug: "work", account: `a@b.c${ESC}[2J`, calendarId: "x", title: nasty, colour: "cyan", addedAt: 1 }],
  }), { mode: 0o600 });

  const l = await run(["ls"], { dir });
  eq("`agenda ls` on a hostile title exits 0", l.status, 0);
  eq("...and still draws exactly one line", l.out.trim().split("\n").length, 1);
  ok("...with no escape character in it", !l.out.includes(ESC), JSON.stringify(l.out));
  ok("...the readable part of the title survives", l.out.includes("Team") && l.out.includes("call"), l.out);

  // Bare `agenda` draws the same title through the model AND the account through
  // the CLI's own per-calendar lines -- both halves have to be safe.
  const bare = await run([], { dir });
  eq("bare `agenda` exits 0 on it", bare.status, 0);
  ok("...printing no escape character either", !bare.out.includes(ESC), JSON.stringify(bare.out));

  const gone = await run(["rm", "work"], { dir });
  eq("`agenda rm` exits 0", gone.status, 0);
  ok("...and its confirmation is clean too", !gone.all.includes(ESC), JSON.stringify(gone.all));
}

{
  // Google's own error text reaches the terminal by two more routes: the first
  // fetch after an add, and anything the top-level handler catches.
  const dir = freshDir("wire-errors");
  writeClientFile(dir);
  const ESC = String.fromCharCode(27);
  stub.set((req) => (req.path.includes("/events")
    ? { status: 500, body: { error: { message: `boom ${ESC}[2J\nFORGED LINE` } } }
    : defaultReply(req)));
  const r = await run(["add", "work"], { dir, tty: writeTty(dir, "1") });
  eq("an add whose first fetch fails still exits 0", r.status, 0);
  ok("...and Google's message cannot draw with it", !r.all.includes(ESC), JSON.stringify(r.all));
  stub.set(null);
}

{
  // `__proto__` is not tidiness. The cache is an object keyed by slug, so storing
  // an entry under this one sets the object's PROTOTYPE and stores nothing --
  // the calendar attaches, its events vanish on every fetch, and bare `agenda`
  // reads Object.prototype back as the entry and dies on `entry.events.length`.
  const dir = freshDir("proto-slug");
  writeClientFile(dir);
  stub.set(null);
  const r = await run(["add", "__proto__"], { dir, tty: writeTty(dir, "1") });
  eq("`agenda add __proto__` is refused", r.status, 1);
  eq("...and nothing is attached", slugs(dir), []);
  ok("...saying so by name", r.all.includes("__proto__"), r.all);

  // And a state file that already carries one -- hand-edited, or written before
  // this rule -- must still get an answer. DESIGN 6 sends you to bare `agenda`
  // when the column looks wrong; dying is the one thing it may not do.
  const legacy = freshDir("proto-legacy");
  fs.writeFileSync(path.join(legacy, "agenda.json"), JSON.stringify({
    version: 1, accounts: {},
    calendars: [{ slug: "__proto__", account: "a@b.c", calendarId: "x", title: "T", colour: "cyan", addedAt: 1 }],
  }), { mode: 0o600 });
  const b = await run([], { dir: legacy });
  eq("bare `agenda` on a state file that already has one exits 0", b.status, 0);
  ok("...saying that calendar was never fetched", /never fetched/.test(b.out), b.out);
  const rmv = await run(["rm", "__proto__"], { dir: legacy });
  eq("...and it can still be removed", rmv.status, 0);
  eq("...leaving none", slugs(legacy), []);
}

stub.stop();
done();
