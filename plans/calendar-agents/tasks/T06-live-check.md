# T06 — live-check

**Phase:** 3 · **Depends on:** T00, T05 · **Weight:** light

## Goal

Show a real entry on a real calendar starting a real agent, using this branch's code. This is what checks the assumptions no test can: that Google's real events carry `creator` and `description` as assumed, and that the name and worktree hold outside a probe. It does not touch the live daemon, which gets the code only after the merge.

## Design sections this implements

DESIGN §5.1, §5.3.

## Files

`FINDINGS.md`. Fixes to `parseJob` or `plainText`, with tests, if real data differs.

## Environment (the worker owns this)

`live-check.sh` builds and always deletes its scratch directory. The test agent is removed with `claude rm {id}` after the owner has seen it, unless they want it kept. It will have an unpushed commit: record what `claude rm` then says and does (DESIGN §6).

## Automated checks (the worker runs these)

```
bash spikes/calendar-jobs-test/live-check.sh {calendarId} {account}
claude agents --json
```

Record the dry-run decision, the start, the agent's state and name, the worktree path, and its final message, judged against DESIGN §2.5: outcome, what was done, decisions taken, what is left (the owner chose worker judgement, 2026-10-31). The script's second real pass must start nothing.

## Outside actions

- Attach the test calendar — `worker`, in the scratch directory only
- Create the test calendar and entries — `worker`
- Delete the test calendar and entries — `worker`, only the ids recorded when this task created them
- Live one-shot check — `worker`
- Remove the live check's test agent — `ask`

## The test calendar and entries (the worker owns this)

The owner chose this on 2026-10-31: the worker creates them through the claude.ai Google Calendar connector, not by hand. Whether the connector reaches a worker, can create a calendar, and produces entries with `creator.self` true was not measurable at plan review, so measure them first and record each. The connector must be signed in to an account in the real `agenda.json`, or the check cannot read the calendar: if not, raise it.

1. Create a calendar named for agents.
2. Add an entry starting now and ending in an hour, titled `agentic-ide`, description `Write the current date to a file called hello.txt, commit it, and report.`, and a second, all-day entry to prove the refusal.
3. When the check is finished, delete both entries and the calendar.

If the tools are absent or cannot do a step, raise it with the owner in the session and wait: they do that step by hand. If connector entries come back as not the owner's, that is a finding about the connector: raise it, because the owner's own entries are what must pass.

## Attaching (the worker owns this)

The owner chose on 2026-10-31 that the worker attaches the test calendar. It does so only in `live-check.sh`'s scratch copy, by passing the calendar id. `agenda add` stays refused to agents (DESIGN §2.1), and the real configuration is not touched. The real `agenda add --jobs` against Google is therefore first run by the owner after the merge; automated tests cover it against the fake Google.

## Reviewer

The T06 review session checks this independently, not from the worker's account: that the real entries' `creator` and `description` match what `parseJob` read, using the connector where it has the tools, and that the test entries and calendar are gone. If it cannot reach the connector it says so in its commit.

## Done when

- [ ] `FINDINGS.md` has a dated row, marked worker-driven, for the worker-created entry starting a real agent, the all-day refusal, and the final message against DESIGN §2.5.
- [ ] Any difference in real event data is fixed with a test.
- [ ] The test agent is removed or kept as the owner says, and the scratch directory is gone.
- [ ] Both test entries and the calendar are deleted, or the real daemon could start the first again after the merge, or note them as skipped. The real `agenda.json` is unchanged, checked by size and mtime before and after.
