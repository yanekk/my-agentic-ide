# bitbucket-dashboard — Design

> Read before changing behaviour. Every rule here carries its reason; a rule without one gets
> overturned by the first session that finds it inconvenient.

## 1. Purpose

The cockpit's fleet view has a resting screen, shown while no agent is attached: the top pane
that becomes an agent's revdiff the moment you enter one. Today it is split greeting on the
left, NOTES and AGENDA on the right. This replaces the greeting with a **BitBucket pull-request
dashboard**: a live overview of the PRs that concern you, with one-click jumps into an
AI-assisted review or comment-addressing session. Notes and agenda move to a narrow column on
the right.

It is for one developer watching a handful of repositories in one BitBucket Cloud workspace,
who wants to see at a glance what is waiting on them and what is happening to their own PRs,
and to hand a PR to an agent without leaving the cockpit or retyping anything.

The credential and the watched repositories are set through the existing `config` command,
exactly as the Anthropic key already is.

### Success criteria

- With a key, a workspace and a repo list configured, the dashboard lists open PRs within one
  refresh, sorted most-recently-updated first, across the two tabs.
- Each row shows the repo, PR number, title (single line, truncated with an ellipsis if it does
  not fit), approval count and comment count; the To-review tab also shows the author.
- Clicking **Open** opens that PR in a browser. Clicking **Review** or **Address** starts a new
  cockpit agent already working in that repo, with a directive to review the PR or address its
  comments.
- Unplugging the network does not blank the dashboard; it adds one dim line saying how stale it
  is. An expired token says so and points at `config bitbucket-key`.
- Nothing secret is ever written inside the repository.

### Stance

- **The dashboard is a launchpad, not a PR client.** It answers "what needs me" and hands the
  work to an agent. It never comments, approves, merges or edits a PR itself (§8) — the moment
  it writes to BitBucket it owns a second source of truth it has to keep honest.
- **One fetch, read-only, bounded.** A refresh is one API call per watched repo plus one to
  identify you, and every call is a GET. This is what keeps it inside the rate limit and unable
  to damage anything (§2.9).
- **Failures are loud only when you can act on them.** Offline is a dim footnote; an expired
  token is a clear instruction (§2.n).
- **The pane still draws, the daemon still fetches.** The dashboard obeys the same split as the
  agenda: a pure display pane draws a cache file, the daemon owns the network (§3.1). This is
  what lets the top pane stay a single swappable diff slot (§2.1).

---

## 2. Behaviour specification

### 2.1 Where it lives, and why it stays one pane

The fleet-list top pane is one WezTerm pane running `cockpit-welcome.mjs`, which draws a
virtual split — it is not two real panes. That is load-bearing: the daemon swaps the whole top
pane in and out as the diff slot by parking exactly one pane and splitting the incoming one
into it, and a second real pane up here would make every agent switch a two-pane dance. So the
dashboard is drawn **inside the same single process**, as a wider left region of the same
virtual split.

The split changes from the current half-and-half to **dashboard ~75% on the left, NOTES over
AGENDA ~25% on the right**. The greeting is gone; its job — telling a first-time user what this
is — is taken over by the dashboard's unconfigured state (§2.n). At ~25% of a ~120-column
window the notes/agenda column is about 30 columns, above the existing 24-column floor below
which those sections already collapse to text-only, so they stay legible, just tighter.

Attaching an agent still parks this whole pane and swaps in revdiff at full width, exactly as
before. Nothing about the agent view changes.

### 2.2 The two tabs and their columns

One tab is shown at a time; a tab strip at the top switches between them by click (§2.8). The
active tab is remembered for the session (§3.5).

**To review** — PRs opened by other people that concern you. Columns, left to right: repository
slug, PR number, title, author, approval count, comment count, and two buttons **Review** and
**Open**.

**Mine** — PRs you opened. Columns: repository slug, PR number, title, approval count, comment
count, and two buttons **Address** and **Open**. No author column — it is always you.

**Titles are one line, truncated with an ellipsis** when they do not fit the column — they are
never word-wrapped. This is a deliberate choice (2026-09-04): a single-line title makes every row
the same height, which is what lets pagination be a simple fixed count of rows per page (§2.5)
instead of a height-aware pack, and keeps a click's target row trivially computable from its y.
The cost is that a long title is cut off on screen; the full title is one click away via **Open**,
and the PR number plus repo already identify the row. (The direction mock word-wrapped titles;
this supersedes it.)

Both tables are sorted by `updated_on` descending, most recently touched at the top, because
the dashboard answers "what moved" and a freshly-updated PR is the one most likely to need you.

### 2.3 Which PRs show — provisional, and an open decision

This is deliberately not finalised in the plan. The exact inclusion rules for each tab are to
be settled with the user in a brainstorm during T02/T03, with real PRs in front of them, once
the client can fetch. See PLAN.md "Decisions still open" and the T03 task doc.

The **provisional** starting point, which the direction mock was built and approved against, is:

- **To review** = open PRs where you are a requested reviewer, plus open PRs authored by a
  configured teammate (`bitbucket-team`, §2.6). Deduplicated: a teammate's PR you also review
  appears once.
- **Mine** = open PRs you authored.

*Why provisional:* the user has ideas to test — for example filtering out PRs that already have
enough approvals, or drafts, or ones with no activity in N days. Which of those earn a row is a
product judgement best made against real data, not guessed at plan time. T03's classify
function is therefore written as one swappable pure function (§3.3) so trying an idea is cheap.

*Why author, not reviewer, for teammates:* "keep an eye on my teammates' PRs" means the ones
they wrote, so you can review them proactively even when unassigned. This is the reading the
user confirmed over "PRs where a teammate is a reviewer".

### 2.4 Approval and comment counts

Both come straight from the PR list response, so neither costs an extra call.

- **Comments** is the PR's `comment_count` field.
- **Approvals** is the number of entries in the PR's `participants` array with `approved: true`.
  A participant is anyone who touched the PR; `approved` is a boolean and `role` is
  `REVIEWER`/`PARTICIPANT`. Counting `approved === true` regardless of role matches what
  BitBucket's own UI calls the approval count. Both `participants` and `reviewers` are absent
  from the default list response and must be requested with a field expansion (§2.9).

A zero count is drawn as a dim `·`, not `0`, so the eye skips it and a row that has approvals or
comments stands out.

### 2.5 Overflow is paged, not scrolled

A terminal pane cannot scroll — it redraws a fixed number of rows each time. So when a tab has
more PRs than fit, the dashboard shows one page and a clickable pager `‹ prev · 1/3 · next ›`
(§2.8). Every PR's row and its buttons stay reachable, which a "+N more" fold like the notes
list could not offer, and acting on a row is the whole point of the dashboard. The current page
is remembered per tab for the session and resets to page 1 when the tab's contents change
enough that the page would be out of range.

### 2.6 Configuration, through `config`

Four new settings, set and read through the existing cockpit-only `config` command (extended in
T01). Reachable only inside a cockpit window, like today.

| Setting | Shown as | Holds |
|---|---|---|
| `bitbucket-key` | masked (`set · …oken`) | your credential, `email:api-token` |
| `bitbucket-workspace` | in full | the workspace slug |
| `bitbucket-repos` | in full | comma-separated repo slugs to watch |
| `bitbucket-team` | in full | comma-separated teammate identifiers (may be empty) |

`bitbucket-key` is masked on read for the same reason the Anthropic key is: agents inherit the
cockpit PATH and so have `config`, and it must never become a way to print a secret. The other
three carry nothing secret and are shown in full so you can see what is set.

**The credential is `email:api-token`**, used as HTTP Basic auth (`Authorization: Basic
base64(email:api-token)`). It is one pasted string; the client splits it on the first colon, so
a token that itself contains a colon survives. This was chosen over an app password (same
Basic-auth shape, older) and over a workspace access token (a single bearer, but it
authenticates as the workspace and has no "me", so "assigned to me" could not work).

**"Me" is resolved from the token**, not configured: the client calls `GET /2.0/user` once and
keeps the returned `uuid`. So the person the dashboard is "about" is whoever the token belongs
to, and there is nothing to keep in sync.

### 2.7 The Open button

Clicking **Open** on a row opens that PR's web page in the browser, via
`spawn("/usr/bin/open", [htmlUrl], { detached })`, the same mechanism the agenda uses for its
OAuth browser step. The URL is the PR's `links.html.href` from the cache. An env override
(`BITBUCKET_BROWSER`, §5.2) lets tests substitute a fake opener so no real browser launches.

### 2.8 The Review and Address buttons, and the spawn primitive

Clicking **Review** (To-review tab) or **Address** (Mine tab) starts a new cockpit agent that
is **immediately working in that PR's repository**, with a short directive:

- Review: `Review Bitbucket PR {url}` — issued against the repo `@{slug}`.
- Address: `Address the review comments on Bitbucket PR {url}` — against `@{slug}`.

The prompt is deliberately minimal. The agent is expected to have a BitBucket MCP (or
equivalent) to fetch the PR's diff and comments itself; the cockpit supplies only the PR URL,
the repo context and the directive. Wiring up that MCP is the user's environment, out of scope
here (§8) — a later session must not read a bare prompt as a bug.

**The spawn primitive** is a general daemon helper, `spawnAgent({ repo, prompt })`, built so a
future feature can reuse it. It:

1. focuses the fleet pane (`panes.fleet`), which at the list shows the new-session box;
2. types `@{repo} {prompt}` into that box;
3. sends a real Enter so the agent starts.

**It lands the agent in the repo context** by leaning on a fact of the layout: the fleet view
runs with its cwd at the projects root (`start_dir` in `config.lua`, §5), so `@{slug}` in the
new-session box resolves to `{projectsRoot}/{slug}` — the local clone. This is the same thing
the user would type by hand. T00 proves the exact reference form works and that a real Enter
into that box spawns a running agent; the primitive is not built until it has.

**A watched repo must be cloned under the projects root, in a folder named for its BitBucket
slug — this is a known limit, not guarded against** (decided 2026-09-04). The spawn types
`@{slug}` and relies on `{projectsRoot}/{slug}` existing; if a watched repo is not cloned
locally, or its local folder is named differently from its BitBucket slug, Review/Address lands
the agent in the wrong place or nowhere useful. This is the same accepted cost as the stray
click below — agents are cheap and killable — so it is documented, not prevented with a
pre-flight check the user did not want. T00 records what a missing clone actually does, so the
behaviour is known. (Open still works regardless: it uses the PR's own web URL, not the clone.)

**This deliberately inverts the cockpit's central injection rule.** Everywhere else, injected
text has its Enter (`\r`) swapped for a newline (`\n`) so a review arrives unsent and editable.
The spawn primitive does the opposite on purpose — it sends a real Enter — because its whole
job is to launch, not to draft. That inversion is why it is a named primitive with its own
spike, not a reuse of `injectReview`.

The accepted cost: a stray click launches an agent. Agents are cheap and killable, so this is a
known limit (§8), not a thing guarded against with a confirm step the user rejected.

### 2.9 Fetch cadence and the call budget

The daemon fetches on the same three triggers as the agenda, for the same reasons: every minute
(the dashboard should not be more than a minute stale), on return to the fleet list (so it is
fresh the instant you look at it), and once at startup.

A refresh is **one GET per watched repo, plus one `GET /2.0/user`** the first time (the uuid is
then cached). Each repo call is
`GET /2.0/repositories/{workspace}/{repo}/pullrequests?state=OPEN&fields=%2Bvalues.participants,%2Bvalues.reviewers&pagelen=50`,
following `next` if a repo has more than 50 open PRs (rare). The three lists (§2.3) are then
sorted out client-side from that one response per repo, which is why no per-role query and no
per-PR call is needed. For a handful of repos this is a few calls a minute, far inside
BitBucket Cloud's authenticated rate limit, so no backoff logic is designed in; if a real
workspace ever makes this tight, that is a finding, not a guess to pre-build against.

### 2.n The unhappy paths

Most of the real requirements are here.

- **Unconfigured.** No key, or no workspace, or no repos: the dashboard shows its own greeting —
  the product's name and the two or three `config` lines that turn it on. This replaces the old
  fleet-view greeting, so a first-time user still learns what the cockpit is.
- **Configured, nothing to show.** A tab with no PRs shows a one-line empty state ("nothing
  waiting on you") rather than an empty table, so it reads as "checked, all clear" not "broken".
- **Offline / transient failure.** The last good cache is kept and drawn, with one dim line
  `last updated {n}m ago · offline`, exactly like the agenda. A blank dashboard would be worse
  than a slightly stale one.
- **Expired or bad token (401/403).** Distinguished from offline because you can act on it: the
  dashboard shows `sign-in expired · config bitbucket-key`. Any other HTTP or network error is
  treated as transient (offline).
- **One repo fails, others succeed.** Each repo is cached independently; a repo that 404s or
  errors keeps its own last events and its own error line, and does not blank the others. A repo
  slug that never resolves shows a dim per-repo error so a typo in `bitbucket-repos` is visible.
- **Corrupt cache file.** The pane reads defensively and falls back to the unconfigured/empty
  state rather than throwing — this is the resting screen of the whole cockpit, and a pane that
  will not paint because a JSON file lost a brace is worse than one showing nothing. The pane
  never rescues or rewrites the file (that is the daemon's job); it just tolerates it.
- **The clock.** All "n minutes ago" staleness is computed from a single `now` passed into the
  pure model (§3.1), never read inside it.

---

## 3. Architecture

### 3.1 The boundary

```
pure    cockpit-bitbucket-model.mjs   normalize a raw PR, classify into tabs, sort,
                                       paginate, render the dashboard lines, compute click
                                       hit-zones. Takes now and width as parameters. No clock,
                                       no I/O, no network, no process.env.
shell   cockpit-bitbucket-client.mjs  the HTTPS calls to BitBucket. Basic auth, GET only.
        cockpit-bitbucket-store.mjs   reads the config settings, reads/writes the cache and
                                       view-state files.
        cockpitd.mjs (additions)      the fetch loop, the cmd-verb dispatch, the spawn primitive.
        cockpit-welcome.mjs (additions) draws the model's output; captures clicks.
        cockpit-config.mjs (additions)  the four new settings.
```

**What enforces it.** `spikes/bitbucket-test/run.sh` greps `cockpit-bitbucket-model.mjs` for
`node:fs`, `node:http`, `node:https`, `node:child_process`, `fetch(`, `Date.now(`, a
zero-argument `new Date()`, and `process.env`, and fails on a hit — the same check the agenda
model is held to. **If that check fails the fix is to move the code, never to relax the check.**
Everything on the pure side is tested exhaustively in milliseconds; every rule that leaks across
this line becomes a rule only a person can check in a live pane.

### 3.2 Modules

- `cockpit-bitbucket-model.mjs` — pure. Owns the shapes and every decision: what a normalized PR
  is, which tab a PR lands on, the sort, the pagination, the rendered lines, the hit-zones.
- `cockpit-bitbucket-client.mjs` — the BitBucket HTTPS client. `getUser` and `listOpenPRs`.
  Endpoints are built from a base origin so a test can re-point them at a loopback stub.
- `cockpit-bitbucket-store.mjs` — reads the four config settings; reads and atomically writes
  `bitbucket-cache.json` and `bitbucket-view.json`.
- `cockpit-config.mjs` — extended so the settings table carries both masked-secret settings and
  shown-in-full plain settings.
- `cockpitd.mjs` — `refreshPRs(reason)` mirroring `refreshAgenda`; the new cmd verbs; the
  `spawnAgent` primitive.
- `cockpit-welcome.mjs` — the 75/25 split; draws the dashboard from the cache via the model;
  enables mouse reporting and turns a click into a cmd verb via the model's hit-zones.

### 3.3 The decision functions

Two pure entry points carry the whole behaviour, both functions of their arguments and nothing
else:

```
classify(prs, { meUuid, team })        -> { toReview: PR[], mine: PR[] }   // sorted, deduped
renderDashboard({ width, rows, cache, view, now })
                                       -> { lines: string[], hitZones: Zone[] }
```

`classify` is the one the T03 brainstorm shapes (§2.3); keeping it a single pure function is
what makes trying a filter idea a one-line change with a test, not a refactor. A `Zone` is
`{ verb, x0, x1, y }` — the daemon-bound verb a click in that cell emits (§3.4).

### 3.4 Data flow

```
config settings ─┐
                 ├─► cockpitd.refreshPRs ─► client.getUser + client.listOpenPRs
watched repos  ──┘         │
                           ▼  writes bitbucket-cache.json  (atomic)
cockpit-welcome  ◄── watches DIR, reads cache + view ──► model.renderDashboard ─► pane
       │ click
       ▼ appends a verb to ~/.claude/cockpit/cmd
cockpitd cmd dispatch ─► bb-tab/bb-page: rewrite bitbucket-view.json
                        bb-open:  spawn /usr/bin/open <htmlUrl>
                        bb-review/bb-address: spawnAgent({ repo, prompt })
```

Clicks reach the daemon the same way the strip's do: the display pane enables its own mouse
reporting and appends a fixed verb to the `cmd` channel; the daemon owns every consequence. A
verb carries the repo slug and PR id (`bb-open:{slug}/{id}`) so the daemon can find the PR in
the cache without the pane and the daemon having to agree on row order.

### 3.5 Storage

All under `~/.claude/cockpit/`, all `0600` (the cache holds PR titles), none in the repo — a
checked-in file would land in the very diff an agent is reviewed on.

- `bitbucket-key`, `bitbucket-workspace`, `bitbucket-repos`, `bitbucket-team` — one file each,
  written by `config`, matching how the Anthropic key is stored (own file per setting so an
  unrelated `--unset` or corruption costs nothing else).
- `bitbucket-cache.json` — the fetched PRs per repo, each with `fetchedAt` and an `error` field,
  plus the cached `meUuid`. Written only by the daemon, read by the pane.
- `bitbucket-view.json` — the session's active tab and per-tab page. Written only by the daemon
  (on a click verb), read by the pane. This keeps the pane pure display: it never decides which
  tab is active, it draws the one the daemon recorded.

**No lock, unlike the agenda.** Each of these files has a single writer — `config` for a
setting, the daemon for the cache and view — so an atomic temp-then-rename write is enough for
the read/write race, and the shared-file locking the agenda needs (agents write its files too)
would be cost without a hazard here. A crash mid-write leaves the previous file intact because
the rename is atomic.

---

## 4. Testing

- **The model** is tested exhaustively as pure functions: classify with every tab membership and
  the dedup case, sort stability, pagination boundaries (exactly full, one over, empty), the
  render for each state (populated, empty, unconfigured, offline, expired), and the hit-zones a
  render produces. `now` and `width` are parameters, so a stale-by-22-minutes line is a
  millisecond test.
- **The client** is tested against a loopback stub via the origin seam: auth header shape, the
  field-expansion query, `next` pagination, and the 401/403-vs-transient error split. It never
  reaches api.bitbucket.org in a test.
- **The daemon additions** are tested in the existing cockpit integration harness with WezTerm
  stubbed: a fetch writes the cache, a `bb-tab` verb rewrites the view file, a `bb-open` verb
  calls the fake opener, and a `bb-review` verb sends `@repo prompt` and an Enter to the fleet
  pane.
- **What none of them prove** is in §5.1: that a real token authenticates, that the pane looks
  right in a live WezTerm, and that a real click spawns a running agent in the repo context.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (darwin) |
| Language / runtime | Node.js, ES modules, zero external dependencies (no package.json anywhere) |
| Toolchain | WezTerm as terminal + multiplexer; `claude agents` as the fleet view |
| **Deliberately absent** | no test framework and no npm — suites are plain `.mjs` run by a `run.sh`; do not add a dependency to get one |

**The test command.**

```
spikes/agenda-test/run.sh && spikes/notes-test/run.sh && spikes/cockpit-test/run.sh && spikes/bitbucket-test/run.sh
```

`spikes/bitbucket-test/` is new in this plan (T01 creates it). It follows the agenda suite's
conventions: each `*.test.mjs` run in a throwaway `COCKPIT_DIR`, plus bash checks for the model
purity grep, the origin seam (no test may name a non-loopback BitBucket origin), the browser
seam (no test may name a real opener), and that the real `~/.claude/cockpit` is untouched. It is
**quiet on pass** (one `bitbucket-test: N ok` line), **no colour** (the shared harness prints plain
text, so there is nothing to suppress — like the other suites, none of which force colour off), and **loud on failure** (full message, file, line; non-zero exit), matching the other
suites — see the agenda suite for how verbose output is turned back on to debug.

**Dependencies.** None may be added. The zero-dependency rule is a project invariant; the
BitBucket client uses `node:https` directly, as the Google client does.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| The `email:api-token` credential authenticates against the real workspace | Needs the user's private token and private workspace; read-only (T02) |
| A real click spawns a running agent already in the repo context | Needs the live WezTerm cockpit and `claude agents`; the stub cannot model claude spawning a session (T00, T09) |
| The 75/25 dashboard looks right and stays legible in a live pane | Rendering is only real in WezTerm at a real width (T07) |
| A click lands in the right pane region in live WezTerm | Mouse coordinates are only real in the running mux (T08) |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `BITBUCKET_ORIGIN` | api.bitbucket.org | re-points the client at a loopback stub; the cockpit integration test sets a dead port so an accidental real fetch fails loudly |
| `BITBUCKET_BROWSER` | `/usr/bin/open` | overrides the Open-button opener so a test launches no browser |
| GET-only client | — | the client has no method that mutates BitBucket; the dashboard cannot comment, approve or merge even by mistake |
| explicit-click spawn | — | an agent is spawned only by a click on a real row; there is no bulk or automatic spawn |

**Never ask the user to run an unbounded version to find something out, and never run it
yourself.** The token hand-check (T02) uses read-only calls only; it never writes to BitBucket.

---

## 6. Recovery

Nothing here can lock anyone out. The credential is removed with `config bitbucket-key --unset`,
which returns the dashboard to its unconfigured state. A corrupt `bitbucket-cache.json` or
`bitbucket-view.json` can simply be deleted; the daemon rewrites the cache on its next fetch and
the pane falls back to the unconfigured/empty state until it does. A spawned agent that was
started by a stray click is killed from the fleet view like any other.

---

## 7. Decisions and rationale

All dates 2026-09-03.

- **Dashboard replaces the greeting; notes/agenda shrink to ~25%.** The user chose this over
  taking the whole top pane (which would drop the notes/agenda glance) and over a half-width
  dashboard (too narrow for a six-column table with buttons).
- **BitBucket Cloud, API v2.0.** The user's product.
- **Credential is an Atlassian API token as `email:api-token`.** Chosen over app password
  (older, same shape) and over a workspace access token (no user identity, so no "assigned to
  me"). Probed against the public API: the list call with `fields=+values.participants,
  +values.reviewers` returns approvals, reviewers, `comment_count` and `updated_on` in one call,
  so counts and sort cost nothing extra.
- **One workspace, a chosen repo list.** Chosen over all-repos-in-a-workspace (unbounded call
  count) and multiple workspaces (deferred, §8).
- **To-review = my review queue + teammates' authored PRs; Mine = my authored PRs** — but
  provisional and to be re-decided in a brainstorm against real data (§2.3).
- **Buttons auto-start the agent, in the repo context.** The user first chose "leave the prompt
  unsent", then changed their mind (🔄): the buttons now fully spawn a running agent, and the
  spawn is built as a general reusable primitive because another feature will reuse it. The
  agent must land in the repo context, as if the user had typed `@{repo}`.
- **Local clones, minimal prompt.** The agent works in the locally-cloned repo under the
  projects root; the prompt carries only the PR URL, the repo reference and the directive,
  because the agent's own MCPs do the BitBucket fetching.
- **Overflow is paged, not a "+N more" fold.** A fold hides rows whose buttons are the point of
  the dashboard.
- **Direction mock approved** (parked at `prototype/`). The user confirmed the two-tab layout,
  the columns and the 75/25 split, and raised the paging requirement, before any design.

## 8. Explicitly out of scope

- **Writing to BitBucket from the cockpit** — commenting, approving, merging, editing. The
  dashboard hands work to an agent; it never becomes a second place that mutates a PR (§1
  stance).
- **Multiple workspaces.** One workspace covers the user's case; multi-workspace is more config
  and more calls for no confirmed need. A later extension if it is ever wanted.
- **Configuring the agent's BitBucket MCP.** The spawn prompt assumes the agent can already
  reach BitBucket; setting that up is the user's environment (§2.8).
- **A general PR browser** — search, filters beyond the tabs, per-PR detail views. The dashboard
  is a glance and a launchpad; anything that needs its own screen is a different product.
- **Rate-limit backoff.** The bounded call budget (§2.9) makes it unnecessary until measured
  otherwise.
