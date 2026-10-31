# T05 — live-check

**Phase:** 3 · **Depends on:** T00, T04 · **Weight:** light

## Goal

Show a real entry on a real calendar starting a real agent, using this branch's code. This is what checks the assumptions no test can: that Google's real events carry `creator` and `description` as assumed, and that the name and worktree hold outside a probe. It does not touch the live daemon, which gets the code only after the merge.

## Design sections this implements

DESIGN §5.1, §5.3.

## Files

`FINDINGS.md`. Fixes to `parseJob` or `plainText`, with tests, if real data differs.

## Environment (the worker owns this)

`live-check.sh` builds and always deletes its scratch directory. The test agent is removed with `claude rm {id}` after the owner has seen it, unless they want it kept.

## Automated checks (the worker runs these)

```
bash spikes/calendar-jobs-test/live-check.sh
claude agents --json
```

Record the dry-run decision, the start, the agent's state and name, the worktree path, and its final message. The script's second real pass must start nothing.

## Outside actions

- Sign in and attach the jobs calendar — `person`
- Create the calendar and test entry — `person`
- Live one-shot check — `worker`

## Needs a person

Create a calendar in Google Calendar named for agents. Then, in a cockpit terminal at this task's worktree:

```
AGENDA_DRY_RUN=1 node bin/cockpit-agenda.mjs add agents --jobs
node bin/cockpit-agenda.mjs add agents --jobs
```

Add an entry on it starting now and ending in an hour, titled `agentic-ide`, description `Write the current date to a file called hello.txt, commit it, and report.` Add a second, all-day entry to prove the refusal.

Expect: the sign-in completes and the new calendar is offered in the list.
Tell me: when both entries exist. Afterwards: whether the agent list and final message look like what you wanted to find in the morning.

## Done when

- [ ] `FINDINGS.md` has a dated ✅ row for the owner's entry starting a real agent, and the all-day refusal, kept separate from the worker's machine results.
- [ ] Any difference in real event data is fixed with a test.
- [ ] The test agent is removed or kept as the owner says, and the scratch directory is gone.
