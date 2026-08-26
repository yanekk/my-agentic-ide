# T00 — Can both Google accounts actually connect?

**Phase:** 0 · **Depends on:** — · **Weight:** light, but blocking, and needs the user

## Goal

Every task after this one assumes two things that cannot be checked from here: that a Google
OAuth registration can be created for this purpose at all, and that **both** the user's
personal account and their **company** account are permitted to grant it read access to their
calendars. Google Workspace administrators routinely block third-party apps outright, and if
this one is blocked, no amount of code gets around it — the work half of the feature does not
exist. There is a third unknown riding along: DESIGN §2.9 records, as *believed and not
verified*, that a client left in *Testing* publishing status issues refresh tokens that expire
after about a week.

This session writes **throwaway code**, walks the user through the console and both sign-ins,
records what happened, and deletes the code. Its deliverable is FINDINGS.md rows.

## Design sections this implements

`DESIGN.md` §2.9 (the registration and the loopback flow), §5.1 (what only a person can
establish), §5.2 (the seatbelts these commands run under). `PLAN.md` § Phase 0 states what each
possible answer means.

## Files

- `spikes/agenda-oauth-probe/` — created, and **deleted before the commit that closes this
  task**. Nothing under `bin/` is touched.
- `plans/cockpit-agenda/FINDINGS.md` — the actual deliverable.

## Interface

The probe is one self-contained script. It is not a design for T04; it exists only to make a
real round trip happen so a person can watch it.

```
spikes/agenda-oauth-probe/probe.mjs

  node probe.mjs --client <path-to-client.json>          full flow, opens a browser
  node probe.mjs --client <path> --dry-run               prints the URL, opens nothing
  node probe.mjs --client <path> --refresh <token>       exchanges a refresh token only

  client.json:  { "clientId": "...", "clientSecret": "..." }   ← the user pastes this,
                                                                 NEVER inside the repo

prints, on success:
  signed in as <email>
  refresh_token: <first 8 chars>…  (never the whole token)
  calendars:
    <calendarId>   <summary>   primary?   accessRole
```

Non-obvious, and the reasons:

- **Redirect must be `http://127.0.0.1:<port>` with the port from binding port 0.** Google
  permits any loopback port for a Desktop client; a hard-coded one fails when it is in use.
- **`access_type=offline` *and* `prompt=consent`.** Without both, Google returns a refresh
  token only on the first ever consent, so a re-run would look like a broken flow.
- **Scopes:** `https://www.googleapis.com/auth/calendar.readonly openid email`. `email` only so
  the probe can report *which* account signed in.
- **PKCE S256** — verifier from `crypto.randomBytes(64)` base64url, challenge from
  `webcrypto.subtle.digest('SHA-256', …)`. Confirmed supported (FINDINGS 2026-08-26).
- **The listener closes after 180 seconds or the first request, whichever comes first.** An
  abandoned browser tab must not leave a process listening (DESIGN §5.2).
- **Never print a whole token.** The user will paste this output back into the conversation.

## Tests

The automated half of this task is thin on purpose — the point of the spike is the part a
script cannot do.

- [ ] `--dry-run` prints an authorization URL and opens no browser and binds no port
- [ ] the URL carries `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`
      and both scopes
- [ ] the PKCE challenge is the base64url SHA-256 of the verifier (checked against a fixed
      vector, not against itself)
- [ ] the listener binds `127.0.0.1` only — a connection to the machine's LAN address is refused
- [ ] the listener exits on its own after its timeout with nothing left running
- [ ] no token, whole or partial, is written to any file

## Done when

- [ ] FINDINGS.md records, with the date and a ✅, whether the **personal** account connected
      and whether the **company** account connected
- [ ] FINDINGS.md records which **publishing status** (*Testing* / *In production*) was used and
      whether a refresh token was issued, superseding the 📌 row that says this is unverified
- [ ] `spikes/agenda-oauth-probe/` is deleted and the working tree is clean

## Needs a person

**This is the whole task.** Raise it at the start and wait — do not build around it.

Hand the user this, in order:

**1. Create the registration** (once, ~5 minutes, free) at
`https://console.cloud.google.com/` — new project → *APIs & Services* → enable **Google
Calendar API** → *OAuth consent screen* → **External** → add both email addresses as test
users → *Credentials* → *Create credentials* → **OAuth client ID** → **Desktop app**. Download
the JSON. Ask them to save it **outside the repository**:

```
mkdir -p ~/.claude/cockpit && mv ~/Downloads/client_secret_*.json ~/.claude/cockpit/probe-client.json
chmod 600 ~/.claude/cockpit/probe-client.json
```

**2. Look at it without signing in to anything** (the seatbelt — no browser, no port):

```
AGENDA_DRY_RUN=1 node spikes/agenda-oauth-probe/probe.mjs \
  --client ~/.claude/cockpit/probe-client.json --dry-run
```

Expect: one long `accounts.google.com` URL printed, and nothing else happens.
Tell me: that it printed a URL and that no browser opened.

**3. The personal account:**

```
node spikes/agenda-oauth-probe/probe.mjs --client ~/.claude/cockpit/probe-client.json
```

Expect: a browser opens, an "unverified app" warning to click past (*Advanced → Go to …*), a
consent screen asking to see your calendars, then the terminal prints the signed-in email and
a list of that account's calendars.
Tell me: did it complete, and does the calendar list include the one you actually want?

**4. The company account** — same command, but sign in with the work address:

Expect: either the same result, or a screen from your administrator refusing access.
Tell me: **exactly what it said.** If it refused, quote the wording — "blocked by your admin",
"app not verified", "access denied" and "this app is blocked" mean different things and point
at different remedies.

**If the company account is refused: stop. Do not choose a fallback.** Record it in FINDINGS.md
and come back to the user with the options priced — DESIGN §7 records that they deliberately
declined to build the private-link fallback on spec, and choosing one is theirs.
