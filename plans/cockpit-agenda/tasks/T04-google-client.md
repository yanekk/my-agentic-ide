# T04 — The Google client

**Phase:** 2 · **Depends on:** T01 · **Weight:** heavy

> **Amended 2026-08-27, after T00.** Two things the spike measured against the real Google
> that this doc did not know: a 403 can mean *the calendar permission was never granted* rather
> than *the calendar is gone* (DESIGN §2.7), and an account missing from the OAuth screen's
> **Test users** list is refused outright with no way past. Both are reflected below.

## Goal

Everything that touches the wire: signing in through the browser, exchanging and refreshing
tokens, listing an account's calendars, and fetching a day's events. It also decides what a
failure *means* — telling "the network is down" apart from "Google revoked you" apart from
"that calendar is gone", because DESIGN §2.7 gives those three completely different behaviours
on screen and getting the classification wrong makes the column either shout at a wifi blip or
stay silent about a dead sign-in.

Kept as thin as it can be: it fetches bytes and parses JSON. **It does not decide what an event
means** — that is `normaliseEvent` on the pure side (T02), so the fiddly rules stay testable.

Every test runs against a stub HTTP server on loopback. Nothing here ever calls Google during a
test run.

## Design sections this implements

`DESIGN.md` §2.9 (the flow, the endpoints, the scopes, the redirect), §2.7 (error
classification), §5.2 (timeouts, the 180s listener, `AGENDA_DRY_RUN`), §3.1 (this is the shell
side and stays thin).

## Files

- `bin/cockpit-agenda-google.mjs` — new
- `spikes/agenda-test/run.sh` — extended, with a loopback stub server

## Interface

```js
// bin/cockpit-agenda-google.mjs   — all network lives here.

const ENDPOINTS = {                          // verified live 2026-08-26 (FINDINGS)
  auth:   "https://accounts.google.com/o/oauth2/v2/auth",
  token:  "https://oauth2.googleapis.com/token",
  api:    "https://www.googleapis.com/calendar/v3",
};
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly openid email";

/** `origin` overrides ENDPOINTS for tests. `openBrowser` is injected so tests open none. */
signIn({ clientId, clientSecret, openBrowser, origin, timeoutMs = 180_000, dryRun })
  -> { email, refreshToken } | { dryRunUrl }

/** A short-lived access token. Callers do not cache it; it is cheap and stateless. */
accessToken({ clientId, clientSecret, refreshToken, origin }) -> { token, expiresAt }

listCalendars({ token, origin }) -> [ { id, summary, primary, accessRole, timeZone } ]

/** Raw Google events — NOT normalised. `timeMin`/`timeMax` are epoch ms. */
fetchEvents({ token, calendarId, timeMin, timeMax, origin })
  -> { events: [raw], timeZone }

/** The one place a failure is given a meaning. */
classifyError(err) -> "network" | "auth" | "gone" | "unknown"
```

Non-obvious, and why:

- **`classifyError` is the subtle part.** `auth` is a 401, or a token response carrying
  `error: "invalid_grant"` — the sign-in is dead and only the user can fix it. `gone` is 404 or
  403 on a *calendar* call — that calendar is deleted or no longer shared. `network` is a DNS
  failure, a connection refused, a timeout, or any 5xx — it heals itself. **A 403 on a *token*
  call is `auth`, not `gone`**; the same status code means different things at the two
  endpoints, and this is the mistake to avoid.
- **A 403 whose body carries `ACCESS_TOKEN_SCOPE_INSUFFICIENT` is `auth`, not `gone`** — measured
  against the real Google in T00 (FINDINGS 2026-08-27). Google's consent screen has a per-scope
  checkbox; an unticked calendar box yields a valid token whose calendar calls 403. The fix is to
  sign in again, so it must render `calendar permission not granted · agenda add <slug>` and
  **never** `agenda rm`, which would destroy a working configuration (DESIGN §2.7). This means
  the 403 branch has to read the response body, not just the status.
- **The "not a test user" refusal happens before any redirect comes back.** An account missing
  from the OAuth screen's Test users list is refused by Google outright. The listener will simply
  time out; the message on timeout must therefore mention it as a likely cause, or the user is
  left with "it hung".
- **`singleEvents=true&orderBy=startTime`** on the events call, so a recurring meeting arrives
  as individual instances. Without it you get the recurrence rule and would have to expand it
  yourself.
- **Paginate on `nextPageToken`**, with a hard cap (say 5 pages). A shared calendar can return
  more than one page for two days, and an uncapped loop is a hang waiting to happen.
- **`timeZone` is returned from `fetchEvents`** because `normaliseEvent` needs the *calendar's*
  zone to place all-day boundaries (T02), and it is right there in the response.
- **`access_type=offline` and `prompt=consent`, both.** Without them a re-add after `agenda rm`
  silently yields an account with no refresh token (DESIGN §2.9).
- **Redirect port from binding port 0**, and the listener closes on the first request or after
  `timeoutMs`, whichever comes first (DESIGN §5.2).
- **The `state` parameter is checked** on the redirect and a mismatch is refused. Any local
  process can hit that loopback port.
- **10s timeout on every HTTP call** — a hung Google request must not wedge the daemon tick.
- **Never log a token.** The daemon's log is `~/.claude/cockpit/daemon.log` and the user pastes
  it into conversations when debugging.

## Tests

All against a loopback stub. `origin` points the module at it; `openBrowser` is a spy.

Sign-in:
- [ ] `dryRun` returns a URL, opens no browser, and binds no port
- [ ] the URL carries `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`,
      both scopes and a `state`
- [ ] the PKCE challenge is the base64url SHA-256 of the verifier (fixed vector)
- [ ] a redirect carrying the right `state` and a code exchanges it and returns `{ email,
      refreshToken }`
- [ ] a redirect with a **wrong** `state` is refused and no token exchange is attempted
- [ ] a redirect carrying `error=access_denied` (the user clicked Deny) fails cleanly with a
      message naming that, and leaves nothing listening
- [ ] the listener binds `127.0.0.1` only
- [ ] the listener closes after `timeoutMs` with a clear failure and no leaked handle
- [ ] that timeout message names "not on the Test users list" as a likely cause
- [ ] the browser is sent to the same URL that was built

Tokens and calls:
- [ ] `accessToken` exchanges a refresh token and returns an expiry
- [ ] `listCalendars` maps the response to the documented shape and preserves `primary`
- [ ] `fetchEvents` sends `singleEvents=true`, `orderBy=startTime`, and the right window
- [ ] `fetchEvents` follows `nextPageToken` and concatenates
- [ ] pagination stops at the cap rather than looping
- [ ] `fetchEvents` returns the calendar's `timeZone`

Classification:
- [ ] 401 → `auth`
- [ ] a token response with `error: "invalid_grant"` → `auth`
- [ ] **403 on a token call → `auth`; 403 on a calendar call → `gone`**
- [ ] **a 403 whose body carries `ACCESS_TOKEN_SCOPE_INSUFFICIENT` → `auth`, not `gone`**
- [ ] that classification is driven by the body, not by the calendar/token endpoint alone
- [ ] 404 on a calendar call → `gone`
- [ ] 500, 502, 503 → `network`
- [ ] connection refused → `network`
- [ ] a request exceeding the timeout → `network`, and the socket is closed
- [ ] malformed JSON in a 200 → `unknown`, not a crash

Hygiene:
- [ ] no test reaches the real internet — the suite passes with outbound traffic blocked
- [ ] no token, whole or partial, appears in anything the module writes or logs

## Done when

- [ ] every case above is covered and `spikes/agenda-test/run.sh` prints `ALL PASS`
- [ ] the full three-suite test command passes with no network access
- [ ] the module imports nothing outside `node:*` and the built-in `fetch`

## Needs a person

*(Only if the stub cannot settle something.)* The real consent screen was already exercised by
hand in T00 — read that FINDINGS row before asking the user to sign in again. If you do need a
live check, it is bounded:

```
AGENDA_DRY_RUN=1 COCKPIT_DIR=$(mktemp -d) node -e '…'
```

Expect: a printed URL and nothing else.
Tell me: only what T00 did not already answer.
