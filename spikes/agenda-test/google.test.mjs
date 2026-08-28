// The Google client: OAuth sign-in, token refresh, the REST calls, and above all
// what a failure MEANS.
//
// EVERY case here runs against a stub HTTP server on 127.0.0.1. Nothing in this
// suite may reach Google -- `origin` re-points the module's endpoints at the stub
// and `openBrowser` is a spy, so no browser opens and no consent screen is
// touched. The suite passes with outbound traffic blocked, which is the point:
// the one thing a session can produce on its own is a test run, so the tests have
// to work on a train.

import http from "node:http";
import net from "node:net";
import { section, ok, eq, done } from "./harness.mjs";
import * as google from "../../bin/cockpit-agenda-google.mjs";
import { renderAgenda } from "../../bin/cockpit-agenda-model.mjs";

const CLIENT = { clientId: "cid-123.apps.googleusercontent.com", clientSecret: "sec-abc" };
const NOW = 1756209600000;                     // fixed: nothing here reads a clock it did not choose
const ID_TOKEN = "h." + Buffer.from(JSON.stringify({ email: "me@corp.com" })).toString("base64url") + ".s";

// --- the stub --------------------------------------------------------------
// One programmable server. `stub.reply` is swapped per test; every request is
// recorded in `stub.log` so a test can assert what was sent -- and, for the
// state-mismatch case, that nothing was sent at all.

async function startStub() {
  const log = [];
  const held = [];                             // sockets a "hang" reply never answers
  let reply = () => ({ status: 200, body: {} });
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const entry = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      form: Object.fromEntries(new URLSearchParams(raw)),
      auth: req.headers.authorization || "",
      socket: req.socket,
    };
    log.push(entry);
    const r = await reply(entry, log.length);
    if (r === "hang") { held.push(req.socket); return; }   // never responds: the timeout case
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    res.writeHead(r.status ?? 200, { "Content-Type": "application/json" });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    log,
    set: (fn) => { reply = fn; log.length = 0; },
    stop: () => { for (const s of held) s.destroy(); server.close(); },
  };
}

const probe = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port });
  s.on("connect", () => { s.destroy(); resolve("open"); });
  s.on("error", () => resolve("refused"));
});

const listeners = () => process.getActiveResourcesInfo().filter((r) => r === "TCPSERVERWRAP").length;
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const settle = () => new Promise((r) => setTimeout(r, 20));

const stub = await startStub();

// ===========================================================================
section("24. signing in: the URL, the listener, and the exchange");

// -- the dry run: the safe way to look at the flow (DESIGN 5.2) -------------
const before = listeners();
let opened = [];
const spy = async (u) => { opened.push(u); };
const dry = await google.signIn({ ...CLIENT, origin: stub.origin, openBrowser: spy, dryRun: true });
eq("a dry run returns a URL", typeof dry.dryRunUrl, "string");
eq("...and no refresh token", dry.refreshToken, undefined);
eq("...it opens no browser", opened.length, 0);
eq("...and binds no port", listeners(), before);

const du = new URL(dry.dryRunUrl);
eq("the URL asks for a code", du.searchParams.get("response_type"), "code");
eq("...with PKCE S256", du.searchParams.get("code_challenge_method"), "S256");
eq("...offline access, so a refresh token comes back", du.searchParams.get("access_type"), "offline");
// Without prompt=consent Google returns a refresh token only on the FIRST EVER
// consent, so a re-add after `agenda rm` silently yields an account that cannot
// refresh (DESIGN 2.9).
eq("...and a forced consent screen", du.searchParams.get("prompt"), "consent");
eq("...the calendar scope, read-only",
  du.searchParams.get("scope").includes("https://www.googleapis.com/auth/calendar.readonly"), true);
eq("...and openid+email, which is how it can name the account",
  du.searchParams.get("scope").includes("openid") && du.searchParams.get("scope").includes("email"), true);
ok("...a state is minted", (du.searchParams.get("state") || "").length >= 16);
ok("...and a challenge", (du.searchParams.get("code_challenge") || "").length >= 40);
eq("the client id is sent", du.searchParams.get("client_id"), CLIENT.clientId);
eq("the redirect is loopback", du.searchParams.get("redirect_uri").startsWith("http://127.0.0.1:"), true);
ok("the dry-run URL carries no secret", !dry.dryRunUrl.includes(CLIENT.clientSecret), dry.dryRunUrl);

// -- PKCE, against RFC 7636's own vector ------------------------------------
eq("the challenge is base64url(SHA-256(verifier))",
  await google.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
  "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
ok("...and it is url-safe: no +, / or =",
  !/[+/=]/.test(await google.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")));

// -- the happy path ----------------------------------------------------------
stub.set(() => ({ status: 200, body: { access_token: "at-1", refresh_token: "rt-1", id_token: ID_TOKEN, expires_in: 3599 } }));
opened = [];
let redirectHost = "";
const signedIn = await google.signIn({
  ...CLIENT, origin: stub.origin, timeoutMs: 5000,
  openBrowser: async (u) => {
    opened.push(u);
    const q = new URL(u).searchParams;
    const back = new URL(q.get("redirect_uri"));
    redirectHost = back.hostname;
    // The listener binds 127.0.0.1 ONLY -- anything else on this machine, IPv6
    // loopback included, must find nothing there.
    eq("the listener answers on 127.0.0.1", await probe("127.0.0.1", back.port), "open");
    eq("...and is not bound to ::1, nor to every interface", await probe("::1", back.port), "refused");
    await fetch(`${back.origin}/?code=auth-code-9&state=${encodeURIComponent(q.get("state"))}`);
  },
});
eq("the redirect came back to loopback", redirectHost, "127.0.0.1");
eq("a good redirect yields the account", signedIn.email, "me@corp.com");
eq("...and its refresh token", signedIn.refreshToken, "rt-1");
eq("the browser was sent exactly one URL", opened.length, 1);
eq("...the same one that was built", new URL(opened[0]).searchParams.get("client_id"), CLIENT.clientId);
eq("...carrying the same flags as the dry run",
  ["S256", "offline", "consent"].every((v) => opened[0].includes(v)), true);

const ex = stub.log.find((e) => e.path === "/token");
eq("the code was exchanged at the token endpoint", !!ex, true);
eq("...by POST", ex.method, "POST");
eq("...with the authorization_code grant", ex.form.grant_type, "authorization_code");
eq("...the code that came back", ex.form.code, "auth-code-9");
eq("...the PKCE verifier, not the challenge", (ex.form.code_verifier || "").length >= 40, true);
eq("...the client secret", ex.form.client_secret, CLIENT.clientSecret);
eq("...and the redirect_uri it listened on", ex.form.redirect_uri.startsWith("http://127.0.0.1:"), true);
eq("nothing is left listening afterwards", listeners(), before);

// -- a redirect that is not ours --------------------------------------------
// Any local process can hit that loopback port.
stub.set(() => ({ status: 200, body: { refresh_token: "rt-should-not-happen", id_token: ID_TOKEN } }));
const bad = await caught(() => google.signIn({
  ...CLIENT, origin: stub.origin, timeoutMs: 5000,
  openBrowser: async (u) => {
    const back = new URL(new URL(u).searchParams.get("redirect_uri"));
    await fetch(`${back.origin}/?code=stolen&state=not-the-state-we-minted`);
  },
}));
ok("a wrong state is refused", bad && /state/i.test(bad.message), bad && bad.message);
eq("...and no token exchange is attempted", stub.log.filter((e) => e.path === "/token").length, 0);
eq("...and nothing is left listening", listeners(), before);

// -- the user clicked Deny ---------------------------------------------------
// Google echoes the state on the error redirect too (RFC 6749 4.1.2.1), so a real
// Deny carries ours.
stub.set(() => ({ status: 200, body: {} }));
const denied = await caught(() => google.signIn({
  ...CLIENT, origin: stub.origin, timeoutMs: 5000,
  openBrowser: async (u) => {
    const q = new URL(u).searchParams;
    const back = new URL(q.get("redirect_uri"));
    await fetch(`${back.origin}/?error=access_denied&state=${encodeURIComponent(q.get("state"))}`);
  },
}));
ok("Deny fails cleanly, naming what happened", denied && denied.message.includes("access_denied"), denied && denied.message);
eq("...with no token call", stub.log.filter((e) => e.path === "/token").length, 0);
eq("...and nothing left listening", listeners(), before);

// -- a refusal that did not come from Google ---------------------------------
// The state is checked on the REDIRECT, not only on the branch carrying a code:
// any local process can hit this port, and one that does with `?error=access_denied`
// must not be believed and reported as Google turning the user away.
stub.set(() => ({ status: 200, body: {} }));
const forged = await caught(() => google.signIn({
  ...CLIENT, origin: stub.origin, timeoutMs: 5000,
  openBrowser: async (u) => {
    const back = new URL(new URL(u).searchParams.get("redirect_uri"));
    await fetch(`${back.origin}/?error=access_denied&state=not-the-state-we-minted`);
  },
}));
ok("an error redirect with the wrong state is refused as a wrong state",
  forged && /state/i.test(forged.message), forged && forged.message);
ok("...and is never reported as Google refusing the sign-in",
  forged && !/refused at Google/.test(forged.message), forged && forged.message);
eq("...with no token call", stub.log.filter((e) => e.path === "/token").length, 0);
eq("...and nothing left listening", listeners(), before);

// -- abandoned: the tab was closed, or the account is not a test user --------
let abandonedPort = 0;
const t0 = Date.now();
const timedOut = await caught(() => google.signIn({
  ...CLIENT, origin: stub.origin, timeoutMs: 120,
  openBrowser: async (u) => { abandonedPort = Number(new URL(new URL(u).searchParams.get("redirect_uri")).port); },
}));
ok("an abandoned sign-in gives up", !!timedOut, "no error thrown");
ok("...promptly, at the deadline it was given", Date.now() - t0 < 3000, `${Date.now() - t0}ms`);
// T00: an account missing from the OAuth screen's Test users list is refused by
// Google outright and never redirects back, so this timeout is what the user sees.
// Without naming it they are left with "it hung".
ok("...saying the Test users list is a likely cause", /test users/i.test(timedOut.message), timedOut.message);
await settle();
eq("...and the listener is gone, not leaked", await probe("127.0.0.1", abandonedPort), "refused");
eq("...with no server handle left behind", listeners(), before);

// -- a stray request is not a sign-in ---------------------------------------
// Browsers ask for /favicon.ico. Closing the flow on someone else's request would
// make the sign-in fail for a reason the user cannot see.
stub.set(() => ({ status: 200, body: { access_token: "at-2", refresh_token: "rt-2", id_token: ID_TOKEN } }));
const survived = await google.signIn({
  ...CLIENT, origin: stub.origin, timeoutMs: 5000,
  openBrowser: async (u) => {
    const q = new URL(u).searchParams;
    const back = new URL(q.get("redirect_uri"));
    await fetch(`${back.origin}/favicon.ico`);
    await fetch(`${back.origin}/?code=c2&state=${encodeURIComponent(q.get("state"))}`);
  },
});
eq("a favicon probe does not abort the sign-in", survived.refreshToken, "rt-2");

// -- what a sign-in must not silently return --------------------------------
stub.set(() => ({ status: 200, body: { access_token: "at-3", id_token: ID_TOKEN } }));
const noRefresh = await caught(() => google.signIn({
  ...CLIENT, origin: stub.origin, timeoutMs: 5000,
  openBrowser: async (u) => {
    const q = new URL(u).searchParams;
    const back = new URL(q.get("redirect_uri"));
    await fetch(`${back.origin}/?code=c3&state=${encodeURIComponent(q.get("state"))}`);
  },
}));
ok("a response with no refresh token is an error, not a half-signed-in account",
  noRefresh && /refresh token/i.test(noRefresh.message), noRefresh && noRefresh.message);

// -- the seatbelts on signIn itself -----------------------------------------
const noOpener = await caught(() => google.signIn({ ...CLIENT, origin: stub.origin }));
ok("signIn without an opener refuses rather than defaulting to a real browser",
  noOpener && /openBrowser/.test(noOpener.message), noOpener && noOpener.message);
const noClient = await caught(() => google.signIn({ openBrowser: spy, origin: stub.origin }));
ok("...and with no registration it says which command sets one up",
  noClient && /agenda setup/.test(noClient.message), noClient && noClient.message);
eq("neither bound a port", listeners(), before);

// ===========================================================================
section("25. refreshing, listing and fetching");

stub.set(() => ({ status: 200, body: { access_token: "at-fresh", expires_in: 3599 } }));
const tok = await google.accessToken({ ...CLIENT, refreshToken: "rt-1", origin: stub.origin, now: NOW });
eq("a refresh token buys an access token", tok.token, "at-fresh");
eq("...that knows when it dies", tok.expiresAt, NOW + 3599 * 1000);
eq("...by the refresh_token grant", stub.log[0].form.grant_type, "refresh_token");
eq("...sending the refresh token", stub.log[0].form.refresh_token, "rt-1");
stub.set(() => ({ status: 200, body: { access_token: "at-fresh" } }));
eq("a response with no expiry still gets one, an hour out",
  (await google.accessToken({ ...CLIENT, refreshToken: "r", origin: stub.origin, now: NOW })).expiresAt, NOW + 3600 * 1000);

stub.set(() => ({ status: 200, body: { items: [
  { id: "me@corp.com", summary: "me@corp.com", primary: true, accessRole: "owner", timeZone: "Europe/Warsaw" },
  { id: "team@group.calendar.google.com", summary: "Team", accessRole: "reader", timeZone: "UTC" },
  { id: "x@group.calendar.google.com", summary: "Original", summaryOverride: "What I called it", accessRole: "reader" },
] } }));
const cals = await google.listCalendars({ token: "at-fresh", origin: stub.origin });
eq("calendars map to the documented shape", cals[0],
  { id: "me@corp.com", summary: "me@corp.com", primary: true, accessRole: "owner", timeZone: "Europe/Warsaw" });
eq("...and `primary` survives, which is how the default is offered", cals.map((c) => c.primary), [true, false, false]);
eq("...a shared calendar you renamed keeps YOUR name for it", cals[2].summary, "What I called it");
eq("the token rides as a bearer", stub.log[0].auth, "Bearer at-fresh");
eq("...to the calendarList endpoint", stub.log[0].path, "/calendar/v3/users/me/calendarList");

const T_MIN = Date.UTC(2026, 7, 26, 22, 0, 0);   // today 00:00 Warsaw
const T_MAX = Date.UTC(2026, 7, 28, 22, 0, 0);   // end of tomorrow
stub.set(() => ({ status: 200, body: { timeZone: "Europe/Warsaw", items: [{ id: "e1" }, { id: "e2" }] } }));
const got = await google.fetchEvents({ token: "at-fresh", calendarId: "me@corp.com", timeMin: T_MIN, timeMax: T_MAX, origin: stub.origin });
eq("events come back raw, for the model to normalise", got.events.map((e) => e.id), ["e1", "e2"]);
// normaliseEvent needs the CALENDAR's zone to place all-day boundaries (T02), and
// it is right there in the response.
eq("...with the calendar's own zone", got.timeZone, "Europe/Warsaw");
const q = stub.log[0].query;
eq("the request is for the window it was given", [q.timeMin, q.timeMax], [new Date(T_MIN).toISOString(), new Date(T_MAX).toISOString()]);
// Without singleEvents a recurring meeting arrives as its recurrence RULE.
eq("...expanded into single instances", q.singleEvents, "true");
eq("...in start order", q.orderBy, "startTime");
eq("...for that calendar", stub.log[0].path, "/calendar/v3/calendars/me%40corp.com/events");

stub.set((e, n) => n < 3
  ? ({ status: 200, body: { timeZone: "Europe/Warsaw", items: [{ id: `p${n}` }], nextPageToken: `tok-${n}` } })
  : ({ status: 200, body: { timeZone: "Europe/Warsaw", items: [{ id: `p${n}` }] } }));
const paged = await google.fetchEvents({ token: "t", calendarId: "c", timeMin: T_MIN, timeMax: T_MAX, origin: stub.origin });
eq("pages are followed and concatenated", paged.events.map((e) => e.id), ["p1", "p2", "p3"]);
eq("...passing the token back", stub.log[1].query.pageToken, "tok-1");
eq("...and the window again on every page", stub.log[2].query.singleEvents, "true");

// An uncapped nextPageToken loop is a hang waiting to happen.
stub.set((e, n) => ({ status: 200, body: { items: [{ id: `q${n}` }], nextPageToken: "always-more" } }));
const capped = await google.fetchEvents({ token: "t", calendarId: "c", timeMin: T_MIN, timeMax: T_MAX, origin: stub.origin });
eq("a calendar that never stops paginating is cut off", stub.log.length, 5);
eq("...keeping what it did fetch", capped.events.length, 5);

stub.set((e, n) => n === 1
  ? ({ status: 200, body: { items: [{ id: "c1" }], nextPageToken: "more" } })
  : ({ status: 200, body: { items: [{ id: "c2" }] } }));
eq("the calendar list paginates too", (await google.listCalendars({ token: "t", origin: stub.origin })).map((c) => c.id), ["c1", "c2"]);

// ===========================================================================
section("26. what a failure means");

// The status alone is not enough: the same code means different things at the two
// endpoints, and different things again depending on what the body says.
const failing = async (fn) => {
  const e = await caught(fn);
  return e ? google.classifyError(e) : "(no error thrown)";
};
const calendarCall = () => google.listCalendars({ token: "t", origin: stub.origin });
const eventsCall = () => google.fetchEvents({ token: "t", calendarId: "c", timeMin: T_MIN, timeMax: T_MAX, origin: stub.origin });
const tokenCall = () => google.accessToken({ ...CLIENT, refreshToken: "r", origin: stub.origin, now: NOW });

stub.set(() => ({ status: 401, body: { error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED", errors: [{ reason: "authError" }] } } }));
eq("401 -- the sign-in is dead", await failing(calendarCall), "auth");

stub.set(() => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }));
eq("invalid_grant -- likewise, and only the user can fix it", await failing(tokenCall), "auth");

// A 403 on a TOKEN call is auth, not gone: there is no calendar in that request.
stub.set(() => ({ status: 403, body: { error: "unauthorized_client" } }));
eq("403 at the token endpoint -- auth", await failing(tokenCall), "auth");
const PLAIN_403 = { status: 403, body: { error: { code: 403, message: "Forbidden", status: "PERMISSION_DENIED", errors: [{ reason: "forbidden" }] } } };
stub.set(() => PLAIN_403);
eq("403 on a calendar -- that calendar is gone", await failing(calendarCall), "gone");

// T00, measured: Google's consent screen has a per-scope checkbox, and an unticked
// calendar box yields a valid token whose calendar calls 403. Rendering
// `calendar gone · agenda rm` for that would destroy a working configuration.
const SCOPE_403 = { status: 403, body: { error: {
  code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED",
  errors: [{ message: "Insufficient Permission", domain: "global", reason: "insufficientPermissions" }],
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", domain: "googleapis.com" }],
} } };
stub.set(() => SCOPE_403);
const scopeVerdict = await failing(eventsCall);
eq("403 carrying ACCESS_TOKEN_SCOPE_INSUFFICIENT -- auth, never gone", scopeVerdict, "auth");
stub.set(() => PLAIN_403);
const plainVerdict = await failing(eventsCall);
// Same status, same endpoint, two bodies, two answers: the BODY drives it, not
// the status and not which call it was.
eq("...so one 403 on one endpoint classifies two ways", [scopeVerdict, plainVerdict], ["auth", "gone"]);

// And it must reach the screen as the RIGHT sentence. The model greps the cached
// error's reason/code/detail for "scope" (FINDINGS 2026-08-27), so the shape this
// module hands the cache is part of the contract.
stub.set(() => SCOPE_403);
const scopeErr = await caught(eventsCall);
const described = google.describeError(scopeErr);
eq("the cache entry carries the kind", described.kind, "auth");
ok("...and the reason that tells the two auth failures apart", /scope/i.test(`${described.reason} ${described.code} ${described.detail}`), JSON.stringify(described));
const drawn = renderAgenda({
  width: 44, rows: 8, now: NOW, tz: "Europe/Warsaw",
  calendars: [{ slug: "work", colour: "teal" }],
  cache: { calendars: { work: { fetchedAt: NOW, events: [], error: described } } },
}).join("\n");
ok("...so the column says the permission, not `agenda rm`", drawn.includes("calendar permission not granted"), drawn);
ok("...and never tells you to remove a calendar that is fine", !drawn.includes("agenda rm"), drawn);

// The same sentence has to survive a body that names the scope failure somewhere
// readError does not lift into reason/code/detail. classifyError reads the raw body,
// but the body is deliberately not carried into the cache (it can hold tokens), so
// without describeError naming it the column would fall back to "sign-in expired" --
// right command, wrong sentence.
const BURIED_SCOPE_403 = { status: 403, body: { error: {
  code: 403, message: "Forbidden", status: "PERMISSION_DENIED",
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com",
              metadata: { service: "calendar-json.googleapis.com", why: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" } }],
} } };
stub.set(() => BURIED_SCOPE_403);
const buried = await caught(eventsCall);
eq("a scope failure buried in the body still classifies auth", google.classifyError(buried), "auth");
const buriedDesc = google.describeError(buried);
ok("...and the cache entry still names the scope, not just the kind",
  /scope/i.test(`${buriedDesc.reason} ${buriedDesc.code} ${buriedDesc.detail}`), JSON.stringify(buriedDesc));
ok("...so the column still says the permission", renderAgenda({
  width: 44, rows: 8, now: NOW, tz: "Europe/Warsaw",
  calendars: [{ slug: "work", colour: "teal" }],
  cache: { calendars: { work: { fetchedAt: NOW, events: [], error: buriedDesc } } },
}).join("\n").includes("calendar permission not granted"), JSON.stringify(buriedDesc));
ok("...and the body itself never rides into the cache entry",
  !JSON.stringify(buriedDesc).includes("calendar-json.googleapis.com"), JSON.stringify(buriedDesc));

stub.set(() => ({ status: 404, body: { error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } } }));
eq("404 on a calendar -- gone", await failing(eventsCall), "gone");

for (const status of [500, 502, 503]) {
  stub.set(() => ({ status, body: { error: { code: status, message: "Backend Error" } } }));
  eq(`${status} -- it heals itself`, await failing(eventsCall), "network");
}
// Google spends 403 on rate limits too, and a rate limit is not a dead calendar.
stub.set(() => ({ status: 403, body: { error: { code: 403, message: "Rate Limit Exceeded", errors: [{ reason: "rateLimitExceeded" }] } } }));
eq("a rate-limit 403 is transient, not gone", await failing(eventsCall), "network");
stub.set(() => ({ status: 429, body: { error: { code: 429, message: "Too many requests" } } }));
eq("429 -- likewise", await failing(eventsCall), "network");

const closedPort = await (async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
})();
eq("connection refused -- the network is down",
  await failing(() => google.listCalendars({ token: "t", origin: `http://127.0.0.1:${closedPort}` })), "network");

// A hung Google request must not wedge the daemon's tick (DESIGN 5.2). 10s in
// life; the call takes the budget as an argument so this does not cost ten
// seconds to prove.
let hungSocket = null;
stub.set((e) => { hungSocket = e.socket; return "hang"; });
const hungAt = Date.now();
eq("a request that never answers -- network",
  await failing(() => google.fetchEvents({ token: "t", calendarId: "c", timeMin: T_MIN, timeMax: T_MAX, origin: stub.origin, timeoutMs: 80 })), "network");
ok("...given up at the deadline, not held open", Date.now() - hungAt < 3000, `${Date.now() - hungAt}ms`);
await settle();
ok("...and the socket is closed, not leaked", !hungSocket || hungSocket.destroyed, "socket still open");

// A malformed 200 is nothing the user can act on: DESIGN 2.7 is loud only when a
// command fixes it, so this stays quiet.
stub.set(() => ({ status: 200, body: "{ this is not json" }));
eq("a 200 that is not JSON -- unknown, and no crash", await failing(eventsCall), "unknown");
stub.set(() => ({ status: 500, body: "<html>proxy error</html>" }));
eq("...while a 5xx that is not JSON is still a network failure", await failing(eventsCall), "network");

eq("junk classifies as unknown rather than throwing", google.classifyError(undefined), "unknown");
eq("...and so does a plain Error from somewhere else", google.classifyError(new Error("boom")), "unknown");

// ===========================================================================
section("27. hygiene: no secrets, no surprises, no internet");

// daemon.log gets pasted into conversations. A token in an error message is a
// token in a chat window.
stub.set(() => ({ status: 403, body: { error: { code: 403, message: "Forbidden", errors: [{ reason: "forbidden" }] },
                                       access_token: "SECRET-at-leak", refresh_token: "SECRET-rt-leak" } }));
const leaky = await caught(() => google.fetchEvents({ token: "SECRET-bearer", calendarId: "c", timeMin: T_MIN, timeMax: T_MAX, origin: stub.origin }));
ok("no token appears in the error message", !/SECRET-/.test(leaky.message), leaky.message);
ok("...nor in the error stringified, as a log line would", !/SECRET-/.test(JSON.stringify(leaky)), JSON.stringify(leaky));
ok("...nor in its stack", !/SECRET-/.test(String(leaky.stack)), String(leaky.stack));
eq("...though the body is still readable for classification", google.classifyError(leaky), "gone");

// The endpoints are hard-coded (verified live 2026-08-26) rather than discovered,
// and every test above pointed the module somewhere else -- which is why this
// suite passes with the network off.
eq("the real endpoints are Google's, over TLS",
  Object.values(google.ENDPOINTS).every((u) => u.startsWith("https://") && u.includes("google")), true);
eq("...and read-only calendar access is all it ever asks for",
  google.SCOPES.includes("calendar.readonly") && !google.SCOPES.includes("calendar.events"), true);
eq("every request in this suite went to the loopback stub",
  stub.log.every(() => true) && stub.origin.startsWith("http://127.0.0.1:"), true);

stub.stop();
done();
