---
name: scheduled-run
description: Schedule an unattended agent run on the local cockpit by adding an entry to the `home-agentic-schedule` Google calendar — asks for whatever is missing, tries the job inside the agent wall, proposes the title, creates the entry once confirmed. Use in any project when the user asks for a "scheduled run", to "run this tonight/at 2am/later", to "schedule an agent", or to put work "on the agentic schedule". Prefer this over the `schedule` skill (cloud routines) for a run on this machine, unless the user asks for a cloud agent or routine.
---

# scheduled-run

The cockpit (the `agentic-ide` repo) treats every entry on the `home-agentic-schedule` calendar as a
job: at the entry's start time it starts a background `claude` in that project, inside a wall the
machine enforces. This skill tries the job inside that wall, then writes the entry. It starts no
scheduled run itself, and the trial's throwaway copy of the project is removed when the trial ends.

## 1. Gather the details

Work out what the request and conversation already give, then ask for everything still missing in
**one** message. Never invent a start time or instructions.

| Detail | Rule |
|---|---|
| **Project** | Default: the current repo. Find its name with `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`, because `--show-toplevel` gives the wrong answer inside a worktree. |
| **Start** | Date and time. Run `date` first to resolve "tonight" or "tomorrow". Must be in the future; if the user wants it now, use a couple of minutes from now. |
| **End** | The agent is told to wrap up by this time, and an entry whose end has passed is skipped rather than started. If not given, suggest one sized to the work and have the user confirm it. |
| **Instructions** | What the agent must do. See step 4. |
| **Trial commands** | The job's setup and a short test, as shell commands, one per line. See step 3. |

## 2. Check the project and the calendar

```sh
ROOT=$(sed -n 's/^ *start_dir *= *"\(.*\)".*/\1/p' ~/.claude/cockpit/config.lua)
test -e "$ROOT/{project}/.git" && echo ok || echo "not under $ROOT"
```

The project must match `^[A-Za-z0-9._-]+$` and be a git repo directly under that root. If it is not,
say so and ask which project to use: the cockpit would refuse the entry at its start time, when nobody
is watching. If `config.lua` does not exist, this machine has no cockpit: say so and stop.

Load the calendar tools with ToolSearch:
`select:mcp__claude_ai_Google_Calendar__list_calendars,mcp__claude_ai_Google_Calendar__create_event`.
Find the calendar whose `summary` is exactly `home-agentic-schedule` and use its `id`. If the tools or
the calendar are missing, say so and stop. Never put the entry on another calendar: the others do not
start agents, so the run would silently never happen.

## 3. Try the job inside the wall

Nobody is there at night to hear that the job cannot install its dependencies. So run its setup and a
short test now, in a throwaway copy of the project's last commit, with the same wall a real start gets.

Write the commands from what the project shows (its README, `package.json`, `Makefile`,
`.pir/settings.json`). If they are not clear, ask. Pick a short test, not the whole job. Tell the user
this is a short real run that uses some of their usage. Uncommitted changes are not in the copy. If the
user declines the trial, go on to step 4, and the confirmation says the job was not tried.

Run this as a **background** command (`run_in_background`), because a foreground one is cut off at 10
minutes, with the tool's own time limit above `--limit-min`. Then wait to be told it finished.

```sh
CHECKOUT=
[ -L ~/.wezterm.lua ] && CHECKOUT=$(dirname "$(dirname "$(readlink ~/.wezterm.lua)")")
[ -f "$CHECKOUT/bin/cockpit-jobs.mjs" ] || CHECKOUT=$(sed -n 's/^ *repo *= *"\(.*\)".*/\1/p' ~/.claude/cockpit/config.lua)
ROOT=$(sed -n 's/^ *start_dir *= *"\(.*\)".*/\1/p' ~/.claude/cockpit/config.lua)
COMMANDS=$(mktemp)
cat > "$COMMANDS" <<'EOF'
{setup command}
{short test command}
EOF
node "$CHECKOUT/bin/cockpit-jobs.mjs" --trial --project {project} --root "$ROOT" --limit-min 10 --commands-file "$COMMANDS" 2>&1
STATUS=$?
rm -f "$COMMANDS"
exit $STATUS
```

The errors are merged into the output on purpose. They hold what a report cannot: a wall exception
that was ignored, an exceptions list that could not be read, a copy that could not be removed.

**Exit status 0:** the output ends in the agent's report. Show the user, in plain words, what passed
and what was blocked. **Any other status:** the output says why. Passing the time limit gives no
report, so propose a shorter test or a higher `--limit-min`. `the wall could not be set up` means a
real start would fail the same way, so say so before going on.

**For each block**, propose changing the job or adding an exception. An exception lasts for every later
run of that project, and only the user can add one: `agenda wall` refuses agents, Claude's `!` commands
included. So give them the exact line to type in a cockpit terminal, and never try it yourself.

| Blocked | Exception to propose |
|---|---|
| A site | `agenda wall {project} allow-site {host}`. Say that an extra site could also receive data. |
| Opening local ports | `agenda wall {project} allow-ports` |
| Writing to a folder | `agenda wall {project} allow-write {path}`. This covers shell commands only, so the agent must use the shell to write there. |

`agenda wall {project} remove site|ports|write [value]` takes one back. There is no exception for a
push, GitHub or the project's own git remotes, the listed secrets, connectors, web fetches or messages
to other sessions; propose changing the job. A window or GPU test also fails in the wall (`no GPU
adapter`), and the agent reports it as blocked.

After an exception is added, run the trial again. **The user may schedule despite a block.** The
confirmation then names it.

A clean trial does not prove the start: a trial skips the check that the project is trusted, so a
refusal there only shows up as the note from the failed start.

## 4. Draft the entry

**Title**: `{project} / {item}`, for example `agentic-ide / nightly test sweep`. The item is your
proposal: what tells this run apart, in a few plain words. Keep it to 30 characters, since the agent's
name is clipped there, and leave out the `─` character.

**Instructions** go in the description as plain text. Write them for an agent that has seen nothing:

- It has no access to this conversation, so spell out paths, branches, names and what "done" means.
- It works in a fresh worktree, so uncommitted changes in the user's checkout are not there. If the
  instructions depend on them, tell the user they must be committed first.
- Nobody can answer it. Say what to do when a choice comes up, if that matters.
- Do not rely on what the wall blocks: a dependency from GitHub, a write to another repo and a web fetch
  will not work. Packages from npm and PyPI do.
- The cockpit already tells it to stay in the worktree, commit there, never push, carry on past a
  block and report in its final message. Do not repeat that.

The user's own wording is the source. Add only the context the agent would lack, and do not widen the
task.

## 5. Confirm

Show the draft and wait for a yes, even when every detail was provided, because the title is a proposal:

```
Title:   agentic-ide / nightly test sweep
Starts:  Mon 2 Nov, 02:00   Ends: 04:00
Calendar: home-agentic-schedule
Trial:   setup and test passed, nothing blocked

Instructions:
<the description, in full>
```

The `Trial` line names every block the user is scheduling despite, or says the job was not tried.

Under it, say once, briefly:

- Nobody is asked anything during the run, and **the cockpit window must be open** at the start time.
  If it is closed, the run starts on reopening only if the end time has not passed; otherwise it is
  skipped and leaves a note.
- **The wall blocks** writes outside its worktree, moving existing branches, a push, reading `~/.ssh`,
  `~/.aws`, the GitHub and Claude logins, the keychain and the cockpit's own folder, every site except
  npm and PyPI, web fetches, connectors and messages to other sessions.
- **It does not cover** reading anything else on the machine, temporary folders, data sent to an allowed
  site, tags and branches the run creates, or what its commits do once merged. Detail:
  `docs/cockpit.md` in the cockpit checkout, § Agents started from a calendar.

## 6. Create it

Call `create_event` with:

- `calendarId`: the id from step 2
- `summary`, `description`
- `startTime`, `endTime`: local time, no offset. Set `timeZone` only if the user named a zone.
- `availability`: `AVAILABILITY_FREE`, so a night run does not mark the user as busy
- `useDefaultReminders`: `false`, because this is not a meeting to be reminded of
- `notificationLevel`: `NONE`

No attendees, and never `allDay`: an all-day entry has no start time and is refused. One-off unless the
user asks for a repeat; then pass an `RRULE` in `recurrenceData` and show it in the confirmation.

## 7. Report

Say what was created, when it starts, and give the entry's link if the result has one. Add that the
entry can be edited until it starts, and that deleting it cancels the run.
