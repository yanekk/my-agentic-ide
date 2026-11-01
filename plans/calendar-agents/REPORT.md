# calendar-agents — delivery report

## What was delivered

**Delivered.** The cockpit can now start unattended Claude agents from a dedicated Google calendar. All seven tasks are done and the tests pass.

- **How you queue work:** make an entry on the jobs calendar. The title is the project's folder name and the description is the instructions. At the start time, while the cockpit window is open, one background agent starts in its own separate copy of that project.
- **Late starts:** an entry missed because the window was closed still starts if its end time has not passed. After that it is skipped with a note.
- **How agents behave:** they never stop to ask anything, are told to commit only in their own copy and never to push, and stay in `claude agents` when finished. Their final message is the report.
- **Problems:** a refused, skipped or failed entry starts nothing and leaves one line in your notes list. A lost sign-in or lost calendar also leaves a note.
- **Safety:** an entry is decided only once, so a crash or rebuild cannot start it a second time. Entries created by someone else are refused, and primary calendars and calendars you do not own cannot be marked as jobs calendars.

**Proven for real.**

- The 70-minute question is answered: an unattended agent ran the full `superfrog-re` test suite to its end (75 minutes, passed) and reported the result.
- In the live check, a real calendar entry started a real agent, an all-day entry was refused with a note, and a second pass started nothing. Your real calendar settings were untouched.

**Also fixed.** The random failures in the cockpit test suite are gone. They came from timing clashes in the test script, not the product.

**Not delivered, by decision.** There is no enforced time limit, no retry and no report sent off the machine.

**Not yet in use.** Your live cockpit does not have this until you merge and reopen the window, and no jobs calendar is attached yet. No full night has been run through the live cockpit.

## Decisions made for you

- **T03: The same Google calendar can currently be marked as a jobs calendar twice, under two different names (I tried it: `agenda add a --jobs` and `agenda add b --jobs` both picked the same calendar and both were accepted). The start-record tracks each entry per name, so one calendar entry would start two unattended agents, which goes against the plan's aim of never starting an entry twice. The plan doesn't cover this. What should happen? / When `agenda add x --jobs` signs in to a Google account for the first time and you then pick a calendar that is refused, the calendar is not attached, but the new sign-in stays saved. The task doc says of a refusal that "nothing is written". Should the sign-in stay?** (night)
  Answer: The same Google calendar can currently be marked as a jobs calendar twice, under two different names (I tried it: `agenda add a --jobs` and `agenda add b --jobs` both picked the same calendar and both were accepted). The start-record tracks each entry per name, so one calendar entry would start two unattended agents, which goes against the plan's aim of never starting an entry twice. The plan doesn't cover this. What should happen? → Refuse the second; When `agenda add x --jobs` signs in to a Google account for the first time and you then pick a calendar that is refused, the calendar is not attached, but the new sign-in stays saved. The task doc says of a refusal that "nothing is written". Should the sign-in stay? → Keep the sign-in
  Why: Refusing the second name protects the success criterion that an entry never starts twice, and is a small check easily removed. A kept sign-in starts nothing and saves a browser round trip; record it as an accepted exception to the task doc.
- **T01: I found and fixed why the cockpit test suite failed at random: two timing clashes inside the test script itself, not in the product. The failing section and the part that clashed with it now pass 22 runs out of 22. Task T01 also says two full runs of that suite must pass, but my standing rules say a worker must never run a whole suite, because it loads the machine other workers share. Which rule should win for T01? If I hear nothing, I will stay stopped here, since this is the only step left apart from the paperwork.** (night)
  Answer: I found and fixed why the cockpit test suite failed at random: two timing clashes inside the test script itself, not in the product. The failing section and the part that clashed with it now pass 22 runs out of 22. Task T01 also says two full runs of that suite must pass, but my standing rules say a worker must never run a whole suite, because it loads the machine other workers share. Which rule should win for T01? If I hear nothing, I will stay stopped here, since this is the only step left apart from the paperwork. → Run both full
  Why: The task is about a flake that only appears when the whole suite runs, so its own acceptance needs the full runs. Exception for T01 only: two runs, one after the other, about 2 minutes each. Record it in the task's notes.

## What to check by hand

After merging, your first real use is the remaining check:

1. **Reopen the cockpit window**, so it picks up the new code.
2. **Attach your jobs calendar:** in a cockpit terminal run `agenda add <name> --jobs`, then pick the calendar from the list. Create a new calendar in Google first, because your main one is refused.
3. **Make an entry by hand** in Google Calendar, with the project folder name as the title and a small instruction as the description, starting now and ending in an hour. Within about a minute an agent should appear in `claude agents`. This matters because the live check used entries made by a connector, so an entry typed by you has not been seen yet.
4. **If you get a note saying the entry was "not created by you"**, the check on who made an entry is wrong for hand-made entries, and that needs fixing before you rely on it.
5. **Try a first real night** with the window left open, then read the agent's final message in the morning. Look at `claude agents` to see it, and at the notes list for anything skipped.

To stop everything starting, run `agenda jobs <name> off` or close the window.

## Risks and follow-ups

**Risks you accepted.**

- Agents run with no permission checks. Staying in their own copy is an instruction, not a wall, so one could touch anything on the machine.
- The deadline is told, not enforced, so a stuck agent can spend until the usage limit.
- The window must stay open overnight, or nothing runs.

**Worth knowing.**

- **Which code agents use:** you chose to have new agents start from your local code rather than GitHub. That setting is in your personal Claude settings and affects every new agent's separate copy in every project on this machine. Nothing installs it, so on another machine calendar agents would start from the GitHub version, which can be far behind. They also test whatever is checked out, half-finished work included.
- **New projects:** a project Claude has never been opened in fails to start, with a note saying so. Open Claude there once to fix it.
- **Removing a finished agent:** removal stops at its unpushed commits and gives you a value to pass to discard them. Merge the agent's work first if you want it.
- **Who made an entry:** on the test calendar, Google marked the creator differently from what the plan assumed, and ownership now rests on comparing email addresses, with a test added. The comparison is exact, so a difference in capitals in the address would refuse an entry rather than start it. This errs on the safe side.
- **Status words:** an agent showing `blocked` may simply have finished and reported, so read its message before assuming it is stuck.
- **Links in instructions:** a link whose visible text differs from its address reaches the agent as the text only. Paste plain addresses in descriptions.

**Follow-ups, found and left alone.**

- Two of the cockpit's existing background commands could in rare cases hang if the program they call ignores being told to stop. This was there before this work.
- The project notes (`CLAUDE.md`) give an out-of-date count of calendar tests.
- Nothing adds the local-code setting to the installer. Add it if you ever set this up on a second machine.

## Branch

Synced with `main` at `052bf9e6c78f` on 2026-11-01T07:11:16Z.
Tests: green.
