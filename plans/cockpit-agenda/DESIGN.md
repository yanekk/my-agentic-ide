# cockpit-agenda — Design

> Read before changing behaviour. Every rule here carries its reason; a rule without one gets
> overturned by the first session that finds it inconvenient.

## 1. Purpose

The cockpit's fleet view has a resting screen — the pane that becomes an agent's revdiff the
moment you enter one. Today its right half is the NOTES column. This adds a second list under
it: **today's agenda**, drawn from Google calendars, so the screen you sit in front of while
agents work also answers "what is coming up".

Two calendars are the motivating case — a personal one and a company one — because the
question being answered is "what is the plan today, at home and at work" and the answer lives
in two accounts. Nothing in the design caps it at two.

The command is **`agenda`**, published exactly the way `note` is: a symlink in
`~/.claude/cockpit/bin`, a directory only cockpit-spawned shells have on PATH. Outside a
cockpit window `agenda` is simply not a command.

### Success criteria

- `agenda add home` and `agenda add work` each connect one Google calendar through the
  browser, and the column shows both accounts' events side by side, colour-coded, within one
  refresh.
- At 14:20 on a day with meetings at 09:30, 11:00, 14:00–15:00 and 17:30, the column shows the
  14:00 one as `NOW` and the 17:30 one below it, and nothing else.
- Unplugging the network does not blank the column; it adds one dim line saying how stale it is.
- Nothing secret is ever written inside the repository.

### Stance

- **The column is a glance, not a calendar app.** It answers "what is next" in a handful of
  rows. Anything that needs scrolling, selecting or editing is out of scope (§8) — the moment
  it becomes interactive it becomes a pane, and a pane costs the diff-slot invariant that the
  whole cockpit rests on (§2.6).
- **What is on screen is what is left.** A finished meeting taking up a row costs a row that
  a future meeting needed.
- **Failures are loud only when you can do something about them.** §2.7.

---

## 2. Behaviour specification

### 2.1 The model: a slug is one calendar

A **calendar** in this system is `{ slug, account, calendarId, title, colour }`. The slug is
the handle you type and the label shown against each of its events.

A Google *account* holds many calendars — your own (`primary`), plus every one you have
subscribed to: holidays, birthdays, a shared team calendar, a colleague's. **`agenda add
{slug}` attaches exactly one of them**, chosen from a list after sign-in.

*Why not "the account's own calendar, no picking":* a work schedule frequently lives on a
shared team calendar rather than on `primary`, and an account-shaped model has no way to reach
it short of a redesign. The picker is roughly forty lines and removes the entire failure class.

*Why not "the whole account, merged":* it drags in Company Holidays, birthdays and every room
calendar you were ever added to, with no way to mute one, into a list that is a handful of
rows tall.

**Sign-in is per account, calendars are per slug.** Adding a second calendar from an account
already signed in reuses the stored sign-in and does not open the browser. This is the reason
`accounts` and `calendars` are separate tables in §3.5 rather than one row per calendar.

### 2.2 The command surface

```
agenda                     the day, as the column shows it, plus per-calendar state
agenda add <slug>          sign in if needed, pick a calendar, attach it
agenda rm <slug>           detach it
agenda ls                  the configured calendars, one per line
agenda color <slug>        reroll its colour
agenda setup               paste the Google registration (§2.9); also runs implicitly
agenda help
```

**It is called `agenda`, not `cal`.** `/usr/bin/cal` — the month grid — already exists, and the
cockpit *prepends* its bin directory to PATH (`bin/cockpit-layout.sh`), so a `cal` symlink
would shadow the system command in every cockpit terminal **and in every agent**, which
inherits that PATH. An agent reaching for the month grid out of habit and silently getting
something else is a debugging cost paid at the worst possible moment. `agenda` collides with
nothing.

**`agenda rm` matches the slug exactly — no prefix resolution.** This is deliberately unlike
`note rm a3f9`, and the reason is the cost of being wrong: a note removed by mistake is one
line retyped, a calendar removed by mistake is the whole browser sign-in dance again. A note
id is a machine-minted string you retype off a screen, so prefixes earn their keep; a slug is
a word you chose and can type in full.

**Agents may read; agents may not connect.** `agenda`, `agenda ls` and `agenda help` work
anywhere in the cockpit. `agenda add`, `agenda rm`, `agenda color` and `agenda setup` **refuse
when `CLAUDECODE` is set**, printing why. An agent running `agenda add` would open a browser
window and ask *you* to sign in, unattended, to a flow it cannot complete — and `agenda rm`
from an agent is a configuration change nobody asked for. `CLAUDECODE` is the same
"an agent is running this" marker the notes store already relies on.

### 2.3 What the column shows

The header is `TODAY · Wed 26 Aug` on the left and the current clock on the right.

**Only what is left.** An event is *finished* when its end time is at or before now, and a
finished event is not shown. The list therefore shortens through the day rather than growing,
which is what keeps it inside a few rows.

**The event happening now is pinned at the top, marked `NOW`,** with a second line
`└ until HH:MM`. It is the timed event whose start is at or before now and whose end is after
now; if several overlap, the earliest start wins the `NOW` label and the others follow as
ordinary rows. *Why:* at 14:20 the first thing you want is not the next meeting but confirmation
of the one you are in and when it lets you go.

**All-day events are pinned above the timed ones**, labelled `ALL DAY`, in the order the
calendars were added. They have no start time to sort by, and they do not finish until the day
does. A multi-day all-day event (a week off) appears on every day it covers.

**When today has nothing left, the column rolls on to tomorrow.** The header becomes
`TOMORROW · Thu 27 Aug`, and it shows tomorrow's events from the start of the day — none of
which can be finished. This is the reason the fetch window is two days wide (§2.5) rather than
one: rolling over must not require a network round trip at 18:05.

If today has nothing left *and* tomorrow is empty, the column says `nothing today or tomorrow`.

**Overflow says how much it is hiding**: `… +N more · agenda`, the same contract the notes
column already keeps. Stopping silently at the fold reads as "that is all of them", and here
that is a false statement about your afternoon.

### 2.4 Which events count

| | | Why |
|---|---|---|
| All-day events | **shown** | A public holiday or a day off is the single most schedule-changing fact of the day. |
| Invitations you have not answered | **shown**, marked `?` | They are real claims on your time until you deal with them. Hiding them shows an 11:00 as free when it is not. |
| Events you marked "free" | **shown** | Focus blocks and reminders-to-self are exactly the personal-planning half of what this is for. Google's busy/free flag is about availability, not about whether you meant to do the thing. |
| Events you declined | **hidden** | You are not going. A row is scarce and a declined meeting spends one on nothing. |

"Declined" means *your own* response is `declined`. An event you are not an attendee of — your
own entries, and anything on a calendar you merely subscribe to — has no response and is
therefore never hidden by this rule.

Cancelled events (Google `status: "cancelled"`) are hidden unconditionally; they are not on
your calendar any more, they are tombstones in the API response.

### 2.5 Refreshing

**Every five minutes, and on return to the cockpit if the last fetch is older than five
minutes.** "On return" is the transition back to the fleet *list* — you opened the window, or
you stepped out of an agent — which the daemon already detects (`onExit` in `cockpitd.mjs`).

The window fetched is **from the start of today to the end of tomorrow**, local time, so the
roll-over in §2.3 is served from data already on disk.

**The daemon fetches; the pane only draws.** `cockpit-welcome.mjs` is pure display by
construction — it never runs a command and never moves a pane — which is what lets `cockpitd`
own it as a diff slot. Network I/O inside it would not break the pane machinery today, but it
would break the *rule*, and the rule is load-bearing. So `cockpitd` writes `agenda-cache.json`
and the pane watches the state directory and redraws, exactly as the strip already consumes
`terminals.json`.

**One tick, not two timers.** The daemon runs a 60-second tick that fetches any calendar whose
last fetch is older than five minutes; the on-return trigger calls the same function. A single
"is anything stale?" predicate is easier to reason about than a periodic timer racing an event.

**Nothing is scheduled when nothing is configured.** With no calendars the tick returns
immediately and no file is written, so the feature costs nothing until it is used.

**One fetch in flight at a time**, guarded like `reconcile` already is. Overlapping fetches
would interleave writes to the cache and burn quota on a slow network.

### 2.6 Where it is drawn, and why it is not a pane

The fleet view's resting pane is split down the middle: greeting on the left, NOTES on the
right. **The agenda goes below NOTES in that right column**, separated by a rule.

**It is drawn by `cockpit-welcome.mjs`, not given a WezTerm pane of its own.** The diff slot is
swapped by parking *exactly one* pane and splitting the incoming one into it — the measurement
is in `spikes/pane-swap/RESULTS.md`, and getting the order wrong brings revdiff back at 59 of
120 columns. A real agenda pane would make every agent switch a three-pane dance for a list
that nothing ever types into. This is the same reasoning that put the notes column in this pane
and it has not changed.

**How the column divides.** The agenda is capped at half the column's rows. If it wants fewer
it gives the slack back to notes; notes never fall below three rows. *Why not a fixed half:* in
the evening the agenda is two lines and a fixed half would show `nothing left today` above four
blank rows while notes overflowed below it.

**With no calendars configured** the section shows `no calendars` and `agenda add home` rather
than nothing, mirroring the notes empty state. A blank region with no explanation reads as a
bug.

**Below the existing narrow-pane threshold** the whole pane already drops back to a single
centred greeting. The agenda is not drawn there either; `agenda` in a terminal still reads it.

### 2.7 The unhappy paths

Failures split by whether waiting fixes them.

**Transient — network unreachable, a 5xx, a timeout.** The last events fetched stay on screen
and one dim line is added: `last updated 22m ago · offline`. *Why:* it heals itself in five
minutes, events rarely change inside twenty minutes, and an agenda that turns into an error
message every time a laptop wakes from sleep teaches you to ignore the line that matters.

**Permanent — the sign-in is revoked or expired (401/`invalid_grant`), or the calendar is gone
or no longer shared (404/403).** That calendar's events are replaced by one loud line naming
the command that fixes it: `work  sign-in expired · agenda add work`, `work  calendar gone ·
agenda rm work`. Other calendars are unaffected and keep showing their events. *Why:* nothing
improves until you act, and a silent gap in a two-calendar view is indistinguishable from a
quiet day.

**Staleness is only reported when a fetch has actually failed.** A cache five minutes old
during normal operation is not stale, it is current; saying "5m ago" every time would make the
line meaningless.

**A corrupt or unreadable state file starts clean rather than crashing the pane** — the same
call `cockpit-notes.mjs` makes. A cockpit that will not draw because a JSON file lost a brace
is worse than one that has forgotten which calendars were attached, and `agenda ls` will show
the loss immediately. Exception: `agenda.json` holds the sign-ins, so the CLI **moves** a
corrupt file aside to `agenda.json.corrupt-<ts>` before starting clean, and says so. Silently
discarding refresh tokens costs two browser round trips.

**Two writers at once** — you and an agent, or two terminals — take a lock, break it at five
seconds if stale, and read-modify-write under it. Identical to `notes.lock` and for the same
reason: two adds landing together would otherwise lose one.

**Every state write is atomic** (temp file + rename), so the renderers can watch the state
*directory* and never go deaf on a replaced inode. A crash mid-write leaves the previous file
intact.

**The sign-in can be abandoned.** The local server that catches the browser's answer closes
after **180 seconds** and `agenda add` exits saying so, leaving nothing behind. A shut browser
tab must not leave a process listening.

**The clock.** All the deciding is a function of a `now` passed in (§3.1). A clock that jumps
backwards makes previously-finished events reappear, which is correct behaviour and needs no
special case.

### 2.8 Colours

Each calendar gets one colour, drawn at random when it is added from a fixed palette of eight
mid-brightness 256-colour terminal colours, chosen to stay legible on light and dark
backgrounds. **No two configured calendars ever share one** while a free colour remains;
beyond eight, repeats are allowed rather than refusing to add a ninth. `agenda color <slug>`
rerolls, preferring an unused colour.

It renders as a `▌` bar down the left of each event row, plus the slug at the right of the row.
*Why both:* the bar is what you read at a glance; the slug is what survives a colourblind
reader, a monochrome terminal and a `--no-color` pipe.

### 2.9 The Google registration

Google requires the cockpit to identify itself with a client ID and secret, created once by you
in the Google Cloud console. **They are not in this repository and never will be** — they live
in `~/.claude/cockpit/agenda-client.json`, mode `0600`, alongside the sign-ins.

Kept in a **separate file from `agenda.json`** because it is machine setup you paste once, not
state the tool manages: a corrupt state file, or `agenda rm` on everything, must not cost you
the registration.

**Sign-in uses the loopback flow with PKCE.** Verified live against Google's discovery document
on 2026-08-26: `authorization_endpoint` `https://accounts.google.com/o/oauth2/v2/auth`,
`token_endpoint` `https://oauth2.googleapis.com/token`, `code_challenge_methods_supported`
includes `S256`. Scopes: `https://www.googleapis.com/auth/calendar.readonly` plus `openid email`
— the second only so the tool can name which account signed in, which is what makes "you are
already signed in to this account" possible.

Redirect is `http://127.0.0.1:<port>` with the port taken by binding **port 0** and reading
back what the OS gave. Google permits any loopback port for a Desktop client; hard-coding one
would fail whenever it was already in use.

`access_type=offline` and `prompt=consent` are both passed, because without them Google
returns a refresh token only on the *first ever* consent and a re-add after `agenda rm` would
silently produce an account that cannot refresh.

> **Believed, not verified.** A Google OAuth client left in **Testing** publishing status
> issues refresh tokens that expire after about seven days, which would mean re-signing-in
> weekly. Setting the client to **In production** is believed to remove that, at the cost of an
> "unverified app" warning screen to click past. **T00 must confirm the publishing status that
> works**, and FINDINGS.md must record the answer. If it turns out weekly re-auth is
> unavoidable, §2.7's loud `sign-in expired · agenda add work` line is already the right
> behaviour and no redesign follows — which is why this is a risk and not a blocker.

---

## 3. Architecture

### 3.1 The boundary

```
PURE    bin/cockpit-agenda-model.mjs     rules and drawing. Parameters in, decisions out.
                                         No fs, no net, no Date.now(), no process.env.
SHELL   bin/cockpit-agenda-store.mjs     the state files, the lock, atomic writes
        bin/cockpit-agenda-google.mjs    OAuth and the Calendar REST calls
        bin/cockpit-agenda.mjs           the `agenda` command
        bin/cockpit-welcome.mjs          draws the pane (already exists)
        bin/cockpitd.mjs                 the refresh schedule (already exists)
```

**`now` is always an argument.** Every function that depends on the time takes it as a
parameter, which is what makes "what does 14:20 on a busy Wednesday look like" a millisecond
test instead of a wait.

**Normalising a Google event is on the pure side**, not in the network module. Turning
`{ start: { dateTime } | { date }, attendees, transparency, status }` into
`{ start, end, allDay, reply }` is where every fiddly rule in §2.4 lives, and it is exhaustively
testable from recorded JSON fixtures — but only if it never touches the wire itself.
`cockpit-agenda-google.mjs` fetches bytes and parses JSON; the model decides what they mean.

**What enforces it.** `spikes/agenda-test/run.sh` greps `cockpit-agenda-model.mjs` for
`node:fs`, `node:http`, `node:https`, `node:child_process`, `fetch(`, `Date.now(`, `new Date()`
with no argument, and `process.env`, and fails on a hit. **If that check fails the fix is to
move the code, never to relax the check.** Every rule that leaks across this line becomes a
rule only a person can verify, and a person is slow and sometimes away.

### 3.2 Modules

| Module | Owns | Depends on |
|---|---|---|
| `cockpit-agenda-model.mjs` | normalise, select, render, the palette, colour allocation | nothing |
| `cockpit-agenda-store.mjs` | `agenda.json`, `agenda-client.json`, `agenda-cache.json`, the lock | `node:fs`, `node:crypto` |
| `cockpit-agenda-google.mjs` | sign-in, token refresh, `calendarList`, `events` | `node:http`, `fetch`, store (tokens) |
| `cockpit-agenda.mjs` | the CLI, published as `agenda` | all three |
| `cockpit-welcome.mjs` | draws NOTES over AGENDA in the right column | model, store |
| `cockpitd.mjs` | the 5-minute tick and the on-return refresh | google, store |

### 3.3 The decision function

```js
renderAgenda({ width, rows, calendars, cache, now }) -> string[]
```

A function of its arguments and nothing else. Given the configured calendars, the cached
events and a millisecond timestamp, it returns the lines to print — including the `NOW` row,
the `?` marks, the colour bars, the stale line, the loud error lines and the overflow line.
Everything in §2.3, §2.4, §2.7 and §2.8 is provable through this one call.

### 3.4 Data flow

```
agenda add ──▶ google.signIn ──▶ store.putAccount
           └─▶ google.listCalendars ──▶ you pick ──▶ store.putCalendar (+ model.pickColour)

cockpitd tick (60s) ──▶ stale? ──▶ google.accessToken ──▶ google.fetchEvents
                                                     └─▶ model.normalise ──▶ store.putCache
                                                                                    │
cockpit-welcome  ◀── fs.watch(~/.claude/cockpit) ◀──────────────────────────────────┘
       └─▶ model.renderAgenda({ …, now: Date.now() }) ──▶ the right column
```

The only two places `Date.now()` is called are the pane's draw loop and the daemon's tick.
Everywhere else it is a parameter.

### 3.5 Storage

All under `~/.claude/cockpit/`, **never in the repository**. A checked-in file here would appear
in `revdiff --untracked HEAD` — the very diff an agent is reviewed on — so your calendar would
become a change the agent thinks it has to explain. It would also put refresh tokens in git.

Unlike `notes.json`, **none of this is keyed by repo**: notes are about a project, an agenda is
about you.

```
agenda-client.json   0600   { version, clientId, clientSecret }
agenda.json          0600   { version,
                              accounts:  { "<email>": { refreshToken, addedAt } },
                              calendars: [ { slug, account, calendarId, title, colour, addedAt } ] }
agenda-cache.json    0600   { version,
                              calendars: { "<slug>": { fetchedAt, events: [...], error } } }
agenda.lock                 the write lock (5s stale break), as notes.lock
```

`0600` on the cache too: it holds your meeting titles.

Every write is temp-file-plus-rename under the lock. A crash mid-write leaves the previous file
whole; the renderers watch the directory, so a replaced inode does not deafen them.

---

## 4. Testing

| Layer | Proves | Runs |
|---|---|---|
| Model unit tests | §2.3, §2.4, §2.7 display rules, §2.8 colours — every case from fixtures and a fixed `now` | milliseconds, offline |
| Boundary check | the pure module imports nothing forbidden (§3.1) | a grep |
| Store tests | atomic write, lock contention, corrupt file, file modes | a temp dir |
| Google client tests | OAuth code exchange, refresh, error classification — against a **stub HTTP server on loopback**, never Google | offline |
| CLI tests | `add`/`rm`/`ls`/`color`, the agent refusal, exit codes | a temp dir |
| Pane render test | the column at several sizes, escapes stripped | the existing frame harness |

**None of them prove the feature works.** They cannot sign in to Google, cannot see the pane,
and cannot tell whether your company's administrator allows any of it. That is §5.1.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS, Darwin 25.5.0 |
| Runtime | Node v24.2.0 — `fetch`, `node:http`, `webcrypto.subtle` and `randomBytes` all confirmed present on 2026-08-26 |
| Timezone | `Intl` reports `Europe/Warsaw`; the machine's zone is used and followed |
| Host terminal | WezTerm; `revdiff`, `claude`, `node`, `wezterm` on PATH |
| Browser opener | `/usr/bin/open` |
| **Deliberately absent** | **No `package.json`, no `node_modules`, no npm anywhere in this repo.** Also no `gcloud`, no `google-chrome` binary, no Python toolchain assumed. |

**The test command.**

```
spikes/agenda-test/run.sh && spikes/notes-test/run.sh && spikes/cockpit-test/run.sh
```

**It is the only evidence a session may produce on its own.** All three, not just the first:
T06 edits `cockpit-welcome.mjs` (covered by `notes-test`) and T07 edits `cockpitd.mjs` (covered
by `cockpit-test`). Baseline measured 2026-08-26: notes-test 39 assertions ALL PASS,
cockpit-test 108 assertions ALL PASS. A session that breaks either has broken something it did
not mean to touch.

**Dependencies.** **Nothing may be added.** This repository has zero dependencies and no
package manifest, and that is a property worth keeping: it is a personal environment that must
survive being cloned onto a new machine with nothing but node and wezterm. Node 24 supplies
everything this design needs — `fetch` for the REST calls, `node:http` for the one-shot
loopback listener, `webcrypto.subtle.digest` for the PKCE challenge, `node:crypto.randomBytes`
for the verifier and the colours. If a task believes it needs a library, that is a design
question for the user, not a `npm install`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| Creating the Google registration | A browser, a Google account and a click-through in a console no script can drive |
| Whether the **company** account may connect at all | Workspace administrators can block third-party apps; only that account, on that network, can answer |
| Whether the sign-in flow completes end to end | A real browser, a real consent screen, a real redirect back to loopback |
| Whether refresh tokens survive past a week (§2.9) | Requires elapsed real time and a real Google client |
| That the column looks right in the actual pane | Nothing here can see the screen; the frame harness proves the string, not the pixels |
| That colours are distinguishable on the user's terminal theme | Only the person looking at it |
| That the 5-minute and on-return refreshes fire in a live cockpit | Needs a running WezTerm, a real daemon and elapsed time |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| Loopback listener | `127.0.0.1`, port 0, **closes after 180s or the first request** | An abandoned browser tab cannot leave a listening process behind |
| `CLAUDECODE` refusal | on | `agenda add/rm/color/setup` refuse when an agent is running them, so nothing opens a browser unattended |
| HTTP timeout | 10s per call | A hung Google request cannot wedge the daemon tick |
| Fetch concurrency | 1 in flight | Overlapping ticks cannot interleave cache writes |
| `COCKPIT_DIR` | `~/.claude/cockpit` | Every test points it at a temp dir, so **no test can ever touch your real sign-ins** |
| `AGENDA_DRY_RUN=1` | off | `agenda add` prints the URL it *would* open and exits, opening no browser — the safe way to inspect the flow |
| File modes | `0600` | Tokens and meeting titles are not world-readable |

**Never ask the user to run an unbounded sign-in to find something out, and never run one
yourself.** `AGENDA_DRY_RUN=1` and `COCKPIT_DIR=$(mktemp -d)` are the two bounds that make
every hands-on check safe to hand over.

---

## 6. Recovery

Written for somebody under pressure who is not reading the code.

- **The column is showing nonsense or nothing.** `agenda` in any cockpit terminal prints the
  state of every calendar and why. Nothing here can break the fleet view or an agent.
- **Start over completely:** `rm ~/.claude/cockpit/agenda*.json`. You lose the sign-ins and the
  colours; you keep the Google registration only if you spare `agenda-client.json`. Notes,
  panes and agents are untouched — different files.
- **Revoke the cockpit's access to a Google account** from that account's
  [third-party access page](https://myaccount.google.com/connections); it is out of this tool's
  hands and always available. The column then shows `sign-in expired`, which is correct.
- **The feature is in the way.** `agenda rm` every slug, or delete the files above: with no
  calendars configured the daemon tick returns immediately, nothing is fetched, and the column
  falls back to notes alone.

---

## 7. Decisions and rationale

| Decision | Alternative | Why it lost | Date |
|---|---|---|---|
| Right column, agenda stacked under notes | Left half under the greeting (more free space); three columns | User's call. Three columns was argued against and dropped: at ~38 columns a note's text field falls to ~22 characters and almost every note truncates mid-word. | 2026-08-26 |
| A slug is one calendar, picked from a list | The account's own calendar; the whole account merged | A work schedule often lives on a shared team calendar, unreachable by the first; the third drags in holidays and room calendars with no way to mute them. | 2026-08-26 |
| What is left, then roll on to tomorrow | Whole day with past dimmed; what is left, then stop | User's call. The whole-day version never shrinks and overflows exactly the part still ahead of you. | 2026-08-26 |
| Named `agenda`, not `cal` | Shadow `/usr/bin/cal`; shadow it but pass old-style arguments through | User's call. The cockpit prepends its bin directory to PATH and agents inherit it, so shadowing reaches further than the terminal you typed in. | 2026-08-26 |
| Quiet when it heals itself, loud when it will not | Never shout; always shout | User's call. Always-shout turns a wifi blip into an error screen and teaches you to ignore the one line that matters. | 2026-08-26 |
| Declined events hidden; all-day, unanswered and "free" shown | Various | User's call. §2.4 carries the per-row reasons. | 2026-08-26 |
| Find out whether the company account can connect **first**, as T00 | Build the private-iCal-link fallback up front; ignore the risk | User's call. The fallback is a bearer URL on disk and admins can disable those separately anyway, so it is not a guaranteed escape hatch — not worth building on spec. | 2026-08-26 |
| The daemon fetches, the pane draws | The pane fetches for itself | `cockpit-welcome.mjs` being pure display is what lets `cockpitd` own it as a diff slot. Network there would not break the machinery today, but it would break the rule the machinery depends on. | 2026-08-26 |
| Normalising Google's event shape sits on the **pure** side | In the network module, next to the fetch | It is where every rule in §2.4 lives; on the pure side it is exhaustively testable from fixtures. | 2026-08-26 |
| Zero dependencies, as the rest of the repo | An OAuth or Google API library | Node 24 has `fetch`, `node:http` and webcrypto; the repo has no package manifest at all and that portability is worth keeping. | 2026-08-26 |

---

## 8. Explicitly out of scope

| Not building | Why |
|---|---|
| Creating, editing, moving or replying to events | The cockpit is a review surface, not a calendar client. Write access also turns a read-only scope into one that can destroy your day. |
| Anything beyond today, and tomorrow when today is empty | The column is a handful of rows. A week does not fit and would need scrolling, which needs a real pane (§2.6). |
| A week or month view | Same. `/usr/bin/cal` is still there for the grid, which is exactly why the command is not called `cal`. |
| Reminders, alerts or notifications | This is a glance, not an alarm clock. Something that interrupts you needs a whole design about when it is allowed to. |
| Non-Google calendars — CalDAV, Exchange, `.ics` subscriptions | Two Google accounts is the stated need. Each extra protocol is its own auth story. |
| Scrolling, selecting or clicking an event | Interactivity means a real WezTerm pane, which costs the diff-slot invariant (§2.6). The `agenda` command is the full view. |
| Sharing one Google registration between machines | It is per-machine setup by design; syncing secrets is a different problem with worse failure modes. |
