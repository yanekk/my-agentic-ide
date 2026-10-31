---
setup: none
test:
  - bash spikes/agenda-test/run.sh
  - bash spikes/notes-test/run.sh
  - bash spikes/cockpit-test/run.sh
  - [ ! -e spikes/calendar-jobs-test/run.sh ] || bash spikes/calendar-jobs-test/run.sh
---

# Agents started from a calendar — Design

## 1. Purpose

Some work takes longer than a working day can spare: the `superfrog-re` test suite runs for about 70 minutes. The owner wants such work to run overnight unattended, and to find the result in the morning. This plan makes the cockpit watch one dedicated calendar and start an unattended background Claude for each entry on it, in the project and with the instructions the entry names. The tool is generic. The `superfrog-re` overnight test-and-fix run is its first use and nothing in the code knows about it.

### Success criteria

- An entry on the jobs calendar titled with a project folder name starts one background Claude in that project at the entry's start time, while the cockpit window is open.
- The agent works in its own worktree without a permission prompt or a question, stays in `claude agents` when it finishes, and its final message is the report.
- A skipped or refused entry leaves one line in the notes list and starts nothing.
- A crash or rebuild never starts an entry a second time.
- An invitation from another person cannot start an agent.

### Stance

The calendar is the only interface: no new screen, no job file, no command to queue work. The report is the agent's own final message: no report file and nothing sent off the machine.

---

## 2. Behaviour specification

### 2.1 The jobs calendar

One or more attached calendars carry `jobs: true` in `agenda.json`, and every entry on them is a job. A dedicated calendar was chosen over a title marker or saved recipes because invitations land on the primary calendar, so they cannot reach it, and instructions stay editable on the entry itself (user, 2026-10-31).

`agenda add <slug> --jobs` and `agenda jobs <slug> on|off` set the flag. Both refuse a primary calendar (`chosen.primary` in `add`; `calendarId === account` in `jobs`, since a primary calendar's id is the account address), because invitations arrive there. `add --jobs` also refuses a calendar whose `accessRole` is not `owner`, because others control a calendar shared to you. Both inherit `refuseIfAgent`, so an agent cannot promote a calendar. Setting the flag records `jobsSince` (epoch ms); entries that ended before it are ignored, so attaching a calendar does not report its history as missed.

A jobs calendar still draws in the agenda column like any other, because it is a real part of the day and hiding it would need a new rule nobody asked for.

### 2.2 What an entry means

The title, trimmed, is the project: a folder name matching `^[A-Za-z0-9._-]+$`, not `.` or `..`, such that `{projects root}/{title}/.git` exists. The projects root is `panes.repo` (`start_dir`). The name pattern stops a title from walking out of the root. The description, converted to plain text, is the instructions. Google returns descriptions as HTML when they are formatted in its editor, so `<br>`, `</p>` and `</div>` become newlines, other tags are dropped, and the five basic entities are decoded.

An entry is refused, with a note, when: the project is invalid or missing; the description is empty; it is all-day, because it has no start time and is probably a mistake (user, 2026-10-31); or it was not created by the account owner (`creator.self`, or `creator.email` equal to the account), as a second defence if the calendar is ever shared (user, 2026-10-31).

### 2.3 When it starts

An undecided entry starts when `start <= now < end`. So a start missed because the cockpit was closed or the network was down still happens if the entry is still running, and the end time is how the owner says "too late after this" (user, 2026-10-31). When `now >= end` the entry is skipped with a note. There is no queue: overlapping entries all start, since each has its own worktree (user, 2026-10-31).

Each entry is decided once, keyed by calendar slug and event id. Google's expanded recurring instances have their own ids, so a repeating entry runs once per occurrence. Consequence: moving an entry that has already been decided does not run it again; the owner makes a new entry (user, 2026-10-31). Edits or deletion before the decision take effect, because decisions read the current fetch. Edits after it change nothing.

Decisions are made only on a calendar's fresh, successful fetch (`error` null, `fetchedAt` within 5 minutes). A stale cache could still hold a deleted entry, and starting it is worse than starting late.

### 2.4 Starting the agent

The daemon runs, with `execFile` and no shell because the description is untrusted text, with its cwd at the project:

```
claude --bg -n "{project} / cal {MM-DD HH:MM} {id4}" --permission-mode bypassPermissions \
  -w "cal-{YYYYMMDD-HHMM}-{id4}" --disallowedTools AskUserQuestion \
  --append-system-prompt "{preamble}" "{prompt}"
```

It does not use `spawnAgent`, which types into the fleet box and so works only with `claude agents` shown and nothing attached, and cannot pass flags (measured need; see §7). The name has a date and id so it is unique, because the daemon cannot resolve duplicate agent names (`CLAUDE.md § Known limits`).

`--bg` keeps the session listed when it finishes, which is the report path the owner chose (user, 2026-10-31). `bypassPermissions` is because a permission prompt would stall the agent until morning. `--disallowedTools AskUserQuestion` removes the question tool (measured: it is absent from the agent's tools).

### 2.5 The instructions the agent is given

The preamble says: nobody is present and nobody will answer until morning; never wait for a reply and never ask; make the most defensible decision and record it; work only in the current worktree on its branch and commit there; never push, merge, or touch anything outside the worktree; the deadline is `{end, HH:MM}`, so wrap up by then; do not end the turn while work is still running; final message states outcome, what was done, decisions taken, and what is left. T00 settles the wording for long-running commands.

This is an instruction and not a wall: with bypass the agent could run anything on the machine. The owner accepted that (user, 2026-10-31).

The deadline is told and not enforced. A stuck agent can spend until the usage limit (user, 2026-10-31). A usage-limit stall is simply visible in the morning; there is no retry.

### 2.6 Telling the owner

Problems go to the notes list through `addNote(panes.repo, text, "calendar")`, so they carry an author and do not read as the owner's own. One note per event: refused (with the reason), skipped because it ended, failed to start (with the first line of Claude's error), and possibly-not-started. A jobs calendar's fetch failing with `auth` adds one note per episode, cleared on the next success, because otherwise the first sign of a lost sign-in is a morning with no run. Network failures add no note: they are usually brief, and an entry they cost is already reported as skipped.

A successful start adds no note, because the agent list already shows it (user, 2026-10-31).

### 2.7 The unhappy paths

- **Crash around the start.** The ledger records `starting` before `claude --bg` runs. On the next daemon start a leftover `starting` becomes `unknown` with a note and is never retried. A rare missed run is preferred to any chance of a second run (user, 2026-10-31).
- **Untrusted project.** `claude --bg` exits 1 with `Workspace not trusted. Run claude in {dir} once…` (measured). It becomes a failed-to-start note carrying that line, and is not retried.
- **Cockpit closed.** Nothing runs; §2.3 applies on reopening. The window must stay open overnight (user, 2026-10-31).
- **Closed across midnight.** The agenda fetch starts at today's midnight, so an entry that ended before it would vanish without a note. Jobs calendars therefore fetch from 7 days back. The pane's own filter must still show only what is left of today; T02 tests it.
- **Corrupt ledger.** Moved aside as `calendar-jobs.json.corrupt-{ts}`, then one note, and a fresh ledger with `notBefore` set to now. Entries that started before `notBefore` are ignored, because an empty ledger would otherwise re-run every entry still inside its window. A rare lost run is preferred, as in the crash case.
- **Two daemons.** Not guarded beyond the existing rebuild kill, which is how the agenda and BitBucket refreshes already stand.

---

## 3. Architecture

### 3.1 The boundary

```
bin/cockpit-jobs-model.mjs   pure. Events, ledger, now as arguments; returns decisions and argv.
bin/cockpit-jobs-store.mjs   the ledger file.
bin/cockpit-jobs.mjs         execFile, notes, the tick, --once.
```

The model reads no clock, file, environment or network. A grep in `spikes/calendar-jobs-test/run.sh` refuses `Date.now`, `new Date()` with no argument, `process.`, and imports of `node:fs`, `node:child_process` or `https`. If that test fails, the fix is to move the code, never to relax the test. Everything on the pure side is testable in milliseconds, and each rule that leaks across needs a rig.

### 3.2 Modules

- `cockpit-jobs-model.mjs`: `plainText`, `parseJob`, `decideJobs`, `buildPreamble`, `buildClaudeArgs`, `noteText`.
- `cockpit-jobs-store.mjs`: read and write `calendar-jobs.json`.
- `cockpit-jobs.mjs`: `jobsTick`, `recoverStarting`, the `--once` entry point. Depends on the three above, the agenda store and `cockpit-notes.mjs`.
- `cockpit-agenda-model.mjs`: `normaliseEvent` gains a `jobs` option.
- `cockpit-agenda-store.mjs`, `cockpit-agenda.mjs`: the flag and its commands.
- `cockpitd.mjs`: the wider fetch, the tick, the recovery at start.

### 3.3 The decision function

`decideJobs({ calendars, cache, ledger, now, projectExists, projectsRoot, zone })` returns `{ start: [...], notes: [...], ledgerChanges: [...] }`. It is a function of its arguments and nothing else.

### 3.4 Data flow

`refreshAgenda` fetches each calendar every minute into `agenda-cache.json`, with `description` and `creatorOwn` on entries of jobs calendars only, so other calendars' meeting text is not stored in a second form. A separate 30 s tick (`COCKPIT_JOBS_TICK_MS`) reads the cache, decides, writes `starting`, and runs Claude. It is a separate timer because `refreshAgenda` returns early when nothing is stale. The tick has an in-flight guard like `agendaFetching`, and it never awaits inside the reconcile path.

### 3.5 Storage

`~/.claude/cockpit/calendar-jobs.json`, `0600`, written temp-then-rename, one writer (the daemon), lockless like `bitbucket-cache.json`:

```
{ version: 1, notBefore?: epochMs, entries: { "{slug}/{eventId}": { state, at, agentId?, reason? } },
  authNoted: { "{slug}": true } }
```

`state` is `starting | started | refused | missed | failed | unknown`. Entries older than 30 days are pruned, which is safe because fetches reach back only 7. A crash mid-write leaves the previous file.

---

## 4. Testing

`spikes/calendar-jobs-test/run.sh` holds the pure model tests, the store tests and the tick against a fake `claude` on `PATH` in a throwaway `COCKPIT_DIR`. `spikes/agenda-test` covers the flag, the commands and the normalised fields. `spikes/cockpit-test` covers the daemon wiring against its WezTerm stub. None of them can prove that Google's real events carry the fields as assumed, or that the real Claude behaves as it did at plan time; that is T00 and T05.

There is no new surface: the agent list, notes column and agenda column are unchanged, so no rig or drill is planned. `agenda` output is tested through `spikes/agenda-test/cli.test.mjs`.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS 25.5 (Darwin), Mac mini on AC. `sleep 0`, kept awake by caffeinate, `autorestart 0` |
| Language / runtime | Node (the repo's), Bash; zero npm dependencies |
| Claude Code | 2.1.316, `Claude Max` account here. `skipDangerousModePermissionPrompt: true` in `~/.claude/settings.json` |
| **Deliberately absent** | `timeout` (GNU coreutils) is not installed; no new always-on service |

**The test command.** The `test` lines of the block on top. Measured 2026-10-31 in a fresh worktree: agenda, notes and cockpit (934 checks, rc 0) pass, and the tree stays clean. The calendar-jobs line is guarded until T01 creates that suite, after the `pir-pane` precedent. Setup is `none`: the repo has no packages. New suites print one summary line on pass and full failures, no colour, in the manner of `spikes/agenda-test`. Nothing here forces colour (`env | grep -i color` shows only `COLORTERM`). `spikes/cockpit-test` prints daemon log lines on a pass; that is existing behaviour and stays out of scope.

Environment settings passed to `claude --bg` do not reach the session (measured: a variable read back `<unset>`), so nothing in this feature may depend on one. The worktree folder name is the only marker available.

**Dependencies.** None added.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| Creating the jobs calendar and adding a real entry | Google sign-in in a browser; the app's scope is read-only so no worker can write an entry |
| A full real night through the live daemon | The live daemon runs from the main checkout, so it only has this code after the merge and a window reopen |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `COCKPIT_JOBS_DRY_RUN=1` | off | Prints the decisions and argv, writes nothing, starts nothing |
| `COCKPIT_DIR` | `~/.claude/cockpit` | Tests use a throwaway directory; `run.sh` checks the real ledger is untouched |
| Fake `claude` first on `PATH` | test only | `run.sh` fails if the real binary could be reached |
| `AGENDA_DRY_RUN=1` | off | The existing guard on `agenda add`, applies to `--jobs` too |

Never point a test tick at the real jobs calendar without the dry run, because a real start is a real unattended agent with bypass permissions.

### 5.3 Outside the code — who acts

| Bin | Who runs it | Permission rule |
|---|---|---|
| `worker` | The worker, then tells the person in one line | `allow` |
| `ask` | The worker, after explaining it. The machine's permission prompt is the person's yes | `ask` |
| `person` | The person: a login, a device, a judgement no tool can make | none |

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Spike agent on `superfrog-re` tests | `bash spikes/calendar-jobs-spike/start.sh` | worker | Owner asked for this run; own worktree, no push | `claude rm {id}` | ~70 min, modest usage | `claude agents --json` |
| Remove the spike agent | `bash spikes/calendar-jobs-spike/clean.sh {id}` | worker | Removes only the spike's own worktree | none needed; the report is in FINDINGS first | none | `claude agents --json` |
| Live one-shot check | `bash spikes/calendar-jobs-test/live-check.sh` | worker | Starts one agent from the owner's own test entry, in a project they name | `claude rm {id}` | tiny, entry names the work | `node bin/cockpit-agenda.mjs ls` |
| Sign in and attach the jobs calendar | `node bin/cockpit-agenda.mjs add agents --jobs` | person | Browser login | `agenda rm agents` | none | none |
| Create the calendar and test entry | Google Calendar | person | App scope is read-only | delete it | none | none |

Credentials measured here 2026-10-31: `agenda-client.json` and `agenda.json` exist, with one account and one calendar (`home`); Claude is signed in (the probes ran). `permissions.allow` already holds `Bash(claude --bg:*)` for this repo.

---

## 6. Recovery

To stop everything starting: `agenda jobs {slug} off`, or close the cockpit window. To stop one running agent: `claude stop {id}`. To remove it and its worktree: `claude rm {id}`, which refuses while there is uncommitted work (measured). No agent can push, by instruction, so `main` and the remote are unchanged until the owner merges a branch by hand.

---

## 7. Decisions and rationale

- **Dedicated calendar**, not a title marker or local recipes: see §2.1 (user, 2026-10-31). Risk accepted: anyone with write access could start agents, hence the creator check.
- **Bypass in a worktree**, not an allow-list: a list stalls or fails unattended and needs upkeep. Accepted that this is not a hard wall (user, 2026-10-31).
- **Report is the agent's final message**, not a note, file, calendar write or push (user, 2026-10-31).
- **Inside the daemon**, not a `launchd` service: extends the existing fetch and is far smaller; a closed window means no run (user, 2026-10-31).
- **Deadline told, not enforced** (user, 2026-10-31, against the planner's recommendation of a hard stop).
- **Not the "finished" ding** (user, 2026-10-31): a separate task to silence these agents was proposed and removed, so they ding on the Stop hook like any session, also at night.
- **Survey.** Extended: `refreshAgenda`, `normaliseEvent`, `agenda`, `addNote`. Not extended: `spawnAgent` (§2.4). Not used: `pir` single runs, whose planner talks to a person; cloud routines (`/schedule`), which cannot reach this machine.
- **T00 uses the real `superfrog-re` suite**, not a stand-in sleep (user, 2026-10-31).
- No mock: there is no new screen.

---

## 8. Explicitly out of scope

- Separate always-on service: declined, §7.
- Enforced time limit: declined, §7.
- Writing back to the calendar: needs a wider Google scope and a new sign-in.
- Reports off the machine, and any push: nobody is watching what leaves.
- Retry after a failed start or a usage-limit stall: a retry at an unknown hour is a surprise, and the morning view shows the state.
- Per-project allow-lists, and model or effort choice per entry: nobody asked; the title and description are the whole format.
- A queue or concurrency limit: declined in the requirements.
