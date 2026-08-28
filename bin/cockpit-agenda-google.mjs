// cockpit-agenda-google -- everything that touches the wire.
//
// Signing in through the browser, exchanging and refreshing tokens, listing an
// account's calendars, fetching a day's events. Nothing else in the agenda opens
// a socket, and nothing here decides what an event MEANS: turning Google's
// `{ start: { dateTime } | { date }, attendees, transparency, status }` into
// `{ start, end, allDay, reply }` is `normaliseEvent` on the pure side, where it
// is testable from fixtures (DESIGN 3.1). This module fetches bytes and parses
// JSON.
//
// The one judgement it does make is what a FAILURE means -- `classifyError`.
// DESIGN 2.7 gives "the network is down", "Google revoked you" and "that calendar
// is gone" three completely different behaviours on screen, so getting this wrong
// makes the column either shout at a wifi blip or stay silent about a dead
// sign-in.
//
// Everything is injectable so the tests never reach Google: `origin` re-points the
// endpoints at a loopback stub and `openBrowser` is a spy. There is no default
// browser opener on purpose (see signIn).
//
// NEVER LOG A TOKEN. ~/.claude/cockpit/daemon.log gets pasted into conversations
// when something is being debugged. Error messages here carry a status and a
// machine-readable reason, never a request body (which holds the client secret)
// and never a response body (which may hold tokens) -- the raw body rides along
// as a NON-ENUMERABLE property so that classification can read it while
// JSON.stringify(err) cannot.

import http from "node:http";
import { randomBytes, webcrypto } from "node:crypto";

// Verified live against accounts.google.com's discovery document on 2026-08-26
// (FINDINGS), which is why they are hard-coded rather than fetched at runtime:
// one fewer network call on a path that has to work when the network is flaky.
export const ENDPOINTS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  api: "https://www.googleapis.com/calendar/v3",
};

// `openid email` is not decoration: it is the only way to name WHICH account just
// signed in, which is what makes "you are already signed in to this one" possible
// (DESIGN 2.9). The calendar scope is read-only -- this tool never writes.
export const SCOPES = "https://www.googleapis.com/auth/calendar.readonly openid email";

// A hung Google request must not wedge the daemon's 60s tick (DESIGN 5.2).
const HTTP_TIMEOUT_MS = 10_000;

// A shared calendar can return more than one page for two days, and an uncapped
// `nextPageToken` loop is a hang waiting to happen.
const MAX_PAGES = 5;

const SIGNIN_TIMEOUT_MS = 180_000;

// The dry run binds NO port -- that is the whole point of it -- so there is no
// OS-assigned port to name. 0 is what the real flow asks the kernel for, so the
// printed URL says exactly what the live one would, minus the number only a bind
// can produce.
const DRY_RUN_PORT = 0;

const TIMEOUT_HINT =
  "sign-in timed out. Likely causes: the browser tab was closed, or this Google " +
  "account is not on the OAuth consent screen's Test users list -- an account " +
  "missing from that list is refused outright and never redirects back.";

// --- errors ----------------------------------------------------------------

// One error type for the whole module so `classifyError` has one thing to read.
// `kind` here is the SHAPE of the failure (how it arrived), not the meaning --
// the meaning is what classifyError computes from it.
class AgendaError extends Error {
  constructor(message, { kind, status = 0, endpoint = "", reason = "", code = "", detail = "", body = "" } = {}) {
    super(message);
    this.name = "AgendaError";
    this.agendaKind = kind;      // "http" | "network" | "parse" | "flow"
    this.status = status;
    this.endpoint = endpoint;    // "token" | "calendar" | ""
    this.reason = reason;        // e.g. "invalid_grant", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
    this.code = code;            // e.g. "PERMISSION_DENIED"
    this.detail = detail;        // Google's human-readable message
    // Non-enumerable: a response body can hold tokens, and this must not turn up
    // in a log line that stringified the error.
    Object.defineProperty(this, "body", { value: String(body ?? ""), enumerable: false });
  }
}

// Google nests the useful reason two different ways depending on the endpoint:
// the API puts a machine reason in error.details[]/error.errors[], the token
// endpoint returns a bare `error: "invalid_grant"` string.
function readError(data, status) {
  const e = data && typeof data === "object" ? data.error : null;
  if (typeof e === "string") {
    return { reason: e, code: String(status), detail: String((data && data.error_description) || "") };
  }
  if (e && typeof e === "object") {
    const detailed = Array.isArray(e.details) ? e.details.find((d) => d && d.reason) : null;
    const legacy = Array.isArray(e.errors) ? e.errors.find((d) => d && d.reason) : null;
    return {
      reason: String((detailed && detailed.reason) || (legacy && legacy.reason) || ""),
      code: String(e.status || status),
      detail: String(e.message || ""),
    };
  }
  return { reason: "", code: String(status), detail: "" };
}

// The three ways Google has been seen to name "your token is valid but was never
// granted the calendar scope". One regex, because classifyError and describeError
// must agree about it: the first decides it is `auth`, the second is what makes the
// column say WHICH auth failure it was.
const SCOPE_SIGNAL = /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficientPermissions/i;

/**
 * The one place a failure is given a meaning (DESIGN 2.7).
 *
 *   "network"  heals itself -- keep the last events on screen, add a dim line
 *   "auth"     the sign-in is dead or was never granted the calendar permission
 *   "gone"     that calendar is deleted or no longer shared
 *   "unknown"  we do not know; drawn quietly, because the user cannot act on it
 */
export function classifyError(err) {
  if (!err || typeof err !== "object") return "unknown";
  if (err.agendaKind === "network") return "network";
  if (err.agendaKind === "parse") return "unknown";

  const status = Number(err.status) || 0;
  const text = `${err.reason || ""} ${err.code || ""} ${err.detail || ""} ${err.body || ""}`;

  // Body first, endpoint second. The same status code means different things at
  // the two endpoints AND different things for the same endpoint depending on what
  // the body says, so reading the status alone is the mistake to avoid.

  // The sign-in is dead: the refresh token was revoked, expired or reissued.
  if (/invalid_grant/i.test(text)) return "auth";

  // Measured against the real Google in T00 (FINDINGS 2026-08-27): Google's consent
  // screen carries a PER-SCOPE checkbox, and leaving the calendar box unticked
  // yields a perfectly valid token whose calendar calls 403. The fix is to sign in
  // again and tick it -- so this is `auth`, and must never render `agenda rm`,
  // which would destroy a working configuration and fix nothing.
  if (SCOPE_SIGNAL.test(text)) return "auth";

  // Google spends 403 on rate limits too, and a rate limit heals itself. Calling
  // it `gone` would tell the user to delete a calendar that is perfectly fine.
  if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError/i.test(text)) return "network";
  if (status === 429) return "network";

  if (status >= 500) return "network";
  if (status === 401) return "auth";
  // A 403 on a TOKEN call is auth, not gone: there is no calendar in that request
  // to be gone. Same code, two meanings.
  if (status === 403) return err.endpoint === "token" ? "auth" : "gone";
  if (status === 404) return err.endpoint === "calendar" ? "gone" : "unknown";
  // Any other 4xx from the token endpoint is a broken registration or a dead
  // grant: only the user can fix it, so it is loud.
  if (status >= 400) return err.endpoint === "token" ? "auth" : "unknown";
  return "unknown";
}

/**
 * The cache entry's `error` field, ready for the store: the kind plus the three
 * fields `renderAgenda` reads to tell "sign-in expired" from "calendar permission
 * not granted" (it greps reason/code/detail for "scope").
 */
export function describeError(err) {
  const kind = classifyError(err);
  let reason = String((err && err.reason) || "");
  const code = String((err && err.code) || "");
  const detail = String((err && err.detail) || "");
  // classifyError reads the raw response body as well; describeError deliberately
  // does not carry it, because a body can hold tokens and this object is written to
  // the cache file. So a scope failure whose only signal was in the body would
  // arrive as a bare `auth` and the column would say "sign-in expired" -- the wrong
  // sentence for a consent checkbox. Name it in `reason`, which is what the model
  // greps (FINDINGS 2026-08-28).
  if (kind === "auth" && !SCOPE_SIGNAL.test(`${reason} ${code} ${detail}`) && SCOPE_SIGNAL.test(String((err && err.body) || ""))) {
    reason = reason ? `${reason} ACCESS_TOKEN_SCOPE_INSUFFICIENT` : "ACCESS_TOKEN_SCOPE_INSUFFICIENT";
  }
  return { kind, reason, code, detail };
}

// --- http ------------------------------------------------------------------

function endpointsFor(origin) {
  if (!origin) return ENDPOINTS;
  const base = String(origin).replace(/\/+$/, "");
  return { auth: `${base}/o/oauth2/v2/auth`, token: `${base}/token`, api: `${base}/calendar/v3` };
}

async function httpJson(url, { method = "GET", form, token, endpoint = "", timeoutMs } = {}) {
  // 10s per call, and every caller may shorten it -- which is also the only way a
  // test can prove the timeout without waiting ten seconds for it.
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  let res, text;
  try {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
    res = await fetch(url, { method, headers, body: form ? form.toString() : undefined, signal: controller.signal });
    // Read inside the timeout too: a response whose headers arrive and whose body
    // never does would otherwise hang for as long as the connection stays open.
    text = await res.text();
  } catch (e) {
    // DNS failure, connection refused, a dropped socket, or our own abort. All of
    // them heal themselves, and aborting destroys the socket rather than leaking
    // it. The message names no URL query, which for the redirect would carry a code.
    const timedOut = controller.signal.aborted;
    throw new AgendaError(
      timedOut ? `${endpoint || "http"} request timed out after ${budget}ms`
               : `${endpoint || "http"} request failed (${(e && e.code) || (e && e.name) || "network error"})`,
      { kind: "network", endpoint, reason: timedOut ? "timeout" : String((e && e.code) || "network") },
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null, unparseable = false;
  if (text && text.trim()) {
    try { data = JSON.parse(text); } catch { unparseable = true; }
  }

  if (!res.ok) {
    const { reason, code, detail } = unparseable ? { reason: "", code: String(res.status), detail: "" } : readError(data, res.status);
    throw new AgendaError(
      `${endpoint || "http"} call failed with HTTP ${res.status}${reason ? ` (${reason})` : ""}`,
      { kind: "http", status: res.status, endpoint, reason, code, detail, body: text },
    );
  }
  if (unparseable) {
    // A malformed 200 is nothing the user can act on, so it classifies `unknown`
    // and draws quietly rather than shouting a command that would not help.
    throw new AgendaError(`${endpoint || "http"} returned a ${res.status} that is not JSON`, {
      kind: "parse", status: res.status, endpoint, body: text,
    });
  }
  return data || {};
}

// Follow `nextPageToken`, capped. Also hands back the payload's `timeZone`, which
// is the calendar's own zone and is what places all-day boundaries (T02).
async function pagedItems(url, params, { token, endpoint, timeoutMs }) {
  const items = [];
  let pageToken = "", timeZone = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const data = await httpJson(u.toString(), { token, endpoint, timeoutMs });
    if (Array.isArray(data.items)) items.push(...data.items);
    if (!timeZone && typeof data.timeZone === "string") timeZone = data.timeZone;
    pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
    if (!pageToken) break;
  }
  return { items, timeZone };
}

// --- PKCE ------------------------------------------------------------------

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url(SHA-256(verifier)) -- RFC 7636's S256, which Google advertises. */
export async function pkceChallenge(verifier) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function authUrl(ep, { clientId, redirectUri, challenge, state }) {
  const u = new URL(ep.auth);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  // Both, always. Without them Google returns a refresh token only on the FIRST
  // EVER consent, so a re-add after `agenda rm` would silently yield an account
  // that cannot refresh (DESIGN 2.9).
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

// The id_token comes straight from the token endpoint over TLS, so its signature
// buys nothing here -- it is not accepted from anywhere else, and all we want is
// which account this is.
function emailFromIdToken(idToken) {
  if (typeof idToken !== "string") return "";
  const parts = idToken.split(".");
  if (parts.length < 2) return "";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

// --- sign-in ---------------------------------------------------------------

const PAGE_OK = "Signed in. You can close this tab and go back to the terminal.";
const PAGE_BAD = "Sign-in refused. Go back to the terminal.";

function reply(res, status, message) {
  const body = `<!doctype html><meta charset="utf-8"><title>cockpit agenda</title>` +
    `<body style="font:16px system-ui;padding:3rem"><p>${message}</p>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/**
 * The loopback + PKCE flow (DESIGN 2.9).
 *
 * `openBrowser` is REQUIRED and deliberately has no default: a missing spy in a
 * test must fail loudly rather than open a real browser at Google's consent screen.
 * The CLI passes `/usr/bin/open`.
 *
 * -> { email, refreshToken }, or { dryRunUrl } when `dryRun` is set.
 */
export async function signIn({ clientId, clientSecret, openBrowser, origin, timeoutMs = SIGNIN_TIMEOUT_MS, dryRun = false } = {}) {
  if (!clientId || !clientSecret) {
    throw new AgendaError("no Google client registered -- run `agenda setup <path-to-downloaded-json>` first", { kind: "flow" });
  }
  const ep = endpointsFor(origin);
  const verifier = base64url(randomBytes(32));
  const challenge = await pkceChallenge(verifier);
  const state = base64url(randomBytes(16));

  if (dryRun) {
    // Binds nothing, opens nothing, exchanges nothing -- the safe way to look at
    // the flow (DESIGN 5.2).
    return { dryRunUrl: authUrl(ep, { clientId, redirectUri: `http://127.0.0.1:${DRY_RUN_PORT}`, challenge, state }) };
  }
  if (typeof openBrowser !== "function") {
    throw new AgendaError("signIn needs an openBrowser function (or dryRun)", { kind: "flow" });
  }

  const server = http.createServer();
  // Keep-alive sockets keep the server object alive after close(); track and
  // destroy them so an abandoned sign-in leaves nothing listening and no handle.
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });

  await new Promise((resolve, rejectListen) => {
    server.once("error", rejectListen);
    // 127.0.0.1 only, and port 0: Google permits any loopback port for a Desktop
    // client, and hard-coding one fails the day it is already in use.
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;
  const url = authUrl(ep, { clientId, redirectUri, challenge, state });

  let timer = null;
  const answer = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new AgendaError(TIMEOUT_HINT, { kind: "flow", reason: "timeout" })), timeoutMs);
    server.on("request", (req, res) => {
      const q = new URL(req.url || "/", redirectUri).searchParams;
      const code = q.get("code"), error = q.get("error"), got = q.get("state");
      // Not the redirect at all (a favicon probe, a stray curl): answer and keep
      // waiting rather than failing the sign-in on someone else's request.
      if (!code && !error) { reply(res, 404, "Nothing here."); return; }
      // Any local process can hit this port, so the state we minted must come back --
      // and it is checked on the REDIRECT, before anything in it is believed, not
      // only on the branch that carries a code. A stray `?error=access_denied` was
      // otherwise taken at face value and killed the sign-in blaming Google for a
      // refusal that never happened. RFC 6749 4.1.2.1 requires the state to be echoed
      // on the error redirect too, so a genuine Deny still reaches the branch below.
      if (got !== state) {
        reply(res, 400, PAGE_BAD);
        reject(new AgendaError("sign-in refused: the redirect carried the wrong state", { kind: "flow", reason: "state_mismatch" }));
        return;
      }
      if (error) {
        reply(res, 200, PAGE_BAD);
        reject(new AgendaError(`sign-in was refused at Google (${error})`, { kind: "flow", reason: error }));
        return;
      }
      reply(res, 200, PAGE_OK);
      resolve(code);
    });
  });
  // The browser can come back -- and be refused -- while `openBrowser` below is
  // still being awaited, i.e. before anything is watching this promise. Node calls
  // that an unhandled rejection and kills the process, so claim it here; the real
  // handler is the `await answer` a few lines down, which still sees the rejection.
  answer.catch(() => {});

  let code;
  try {
    // Not awaited for its result: an opener that fails is not fatal, because the
    // CLI prints the URL too and it can be pasted by hand.
    try { await openBrowser(url); } catch { /* the URL is on screen; keep listening */ }
    code = await answer;
  } finally {
    clearTimeout(timer);
    server.close();
    for (const s of sockets) s.destroy();
  }

  const form = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const data = await httpJson(ep.token, { method: "POST", form, endpoint: "token" });

  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
  if (!refreshToken) {
    throw new AgendaError(
      "Google returned no refresh token -- the sign-in cannot be kept. Check that the consent screen was completed fresh (access_type=offline, prompt=consent).",
      { kind: "flow", endpoint: "token", reason: "no_refresh_token" },
    );
  }
  const email = emailFromIdToken(data.id_token);
  if (!email) {
    throw new AgendaError("Google did not say which account signed in (no email in the id_token)", {
      kind: "flow", endpoint: "token", reason: "no_email",
    });
  }
  return { email, refreshToken };
}

// --- tokens and calls ------------------------------------------------------

/**
 * A short-lived access token. Callers do not cache it: it is cheap and stateless,
 * and a cached one is a token sitting in a file for no reason.
 *
 * `now` is a parameter so a test can pin the expiry; the daemon passes its own tick.
 */
export async function accessToken({ clientId, clientSecret, refreshToken, origin, now = Date.now(), timeoutMs } = {}) {
  const ep = endpointsFor(origin);
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const data = await httpJson(ep.token, { method: "POST", form, endpoint: "token", timeoutMs });
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new AgendaError("the token endpoint returned no access token", { kind: "flow", endpoint: "token", reason: "no_access_token" });
  }
  const ttl = Number(data.expires_in);
  return { token: data.access_token, expiresAt: now + (Number.isFinite(ttl) ? ttl : 3600) * 1000 };
}

export async function listCalendars({ token, origin, timeoutMs } = {}) {
  const ep = endpointsFor(origin);
  const { items } = await pagedItems(`${ep.api}/users/me/calendarList`, {}, { token, endpoint: "calendar", timeoutMs });
  return items.map((c) => ({
    id: String(c.id ?? ""),
    // summaryOverride is what you renamed a shared calendar to; it is the name you
    // would recognise in the picker.
    summary: String(c.summaryOverride ?? c.summary ?? c.id ?? ""),
    primary: c.primary === true,
    accessRole: String(c.accessRole ?? ""),
    timeZone: String(c.timeZone ?? ""),
  }));
}

/**
 * Raw Google events for a window -- NOT normalised (that is the model's job).
 * `timeMin`/`timeMax` are epoch ms; the caller computes them from `dayBounds`
 * (FINDINGS 2026-08-27: a day is not always 24 hours).
 */
export async function fetchEvents({ token, calendarId, timeMin, timeMax, origin, timeoutMs } = {}) {
  const ep = endpointsFor(origin);
  const { items, timeZone } = await pagedItems(
    `${ep.api}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      // Without singleEvents a recurring meeting arrives as its recurrence RULE
      // and would have to be expanded here; orderBy=startTime requires it.
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    },
    { token, endpoint: "calendar", timeoutMs },
  );
  return { events: items, timeZone };
}
