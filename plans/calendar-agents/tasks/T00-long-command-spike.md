# T00 — long-command-spike

**Phase:** 0 · **Depends on:** — · **Weight:** light (about 70 minutes of waiting)

## Goal

Find out whether an unattended background Claude can run the real `superfrog-re` test suite, about 70 minutes, and carry on to report the result. Tool commands have time limits and an agent might end its turn while a command still runs, either of which would make the overnight use fail. This is throwaway: only its answer stays.

## Design sections this implements

Gates the long-command wording in DESIGN §2.5.

## Files

`spikes/calendar-jobs-spike/start.sh` and `clean.sh`, deleted at the end of this task. `FINDINGS.md`.

## Interface

`start.sh` runs, from `~/src/superfrog-re`, the flags of DESIGN §2.4 with worktree `cal-spike`, name `superfrog-re / cal spike`, and this draft preamble line: "Nobody is present. Never ask. Run long commands in the background with the longest time limit allowed and do not end your turn until they have finished." The prompt tells it to run the `setup` and `test` lines of `.pir/settings.json` and report pass or fail, and not to fix anything. It prints the agent id.

## Tests

No automated tests; the output is an answer. Record each of:

- [ ] Did the suite run to its end, and how long did it take?
- [ ] Did the agent stay alive and report after the command ended, or end its turn early?
- [ ] Which commit did the worktree start from: `HEAD` of the checkout, or the remote's default branch?
- [ ] What did `claude agents --json` show during the run and afterwards?

## Done when

- [ ] `FINDINGS.md` has the four answers, dated, whatever the suite's own pass or fail was.
- [ ] DESIGN §2.5's wording is confirmed in a finding, or the failure has been raised with the owner.
- [ ] If the worktree started anywhere but the checkout's `HEAD`, that is raised with the owner: here `HEAD` and `origin/main` differ today, so an agent could test other code than expected.
- [ ] The spike's scripts are deleted and its agent and worktree removed.

## Outside actions

- Spike agent on `superfrog-re` tests — `worker`
- Remove the spike agent — `worker`
