# pir-usage-reader — delivery report

## What was delivered

All six tasks are built and reviewed, and the tests are green.

- **The usage bar can now be fed by pir.** Every 30 seconds the cockpit asks pir's local usage service for the latest numbers. When pir has heard something newer than what the bar shows, the bar takes it. During a pir run the bar stays current and no longer greys out as "as of …" after 15 minutes.
- **Your ordinary Claude sessions still feed the bar as before.** Whichever reading is newest wins, so the two sources never fight. After a limit resets, the bar shows the fresh number, not the old high one.
- **Nothing changes when pir's service is missing or broken.** The cockpit behaves exactly as it did before. The daemon's log gets one short line each time the connection to pir changes state, and never one per check. It never logs your percentages. On a machine without pir's service it writes nothing at all.
- **It only ever talks to your own machine.** If the address pir advertises points anywhere else, the cockpit refuses it.
- **The installer has one more line,** printed only when pir is installed. It says whether pir's usage service is answering. It never fails the install and never starts the service.
- **A check script for the real machine** is ready for after the merge.

**Not delivered:** nothing in the plan was dropped. The footer looks exactly as it did, by design. It shows no mark for "pir feed off".

## Decisions made for you

None.

## What to check by hand

None of this can be seen working for real until two things have happened. This build must be merged, and pir's usage service must be finished, merged and installed in the pir project. Today the installed pir has no service at all, so the new feature sits idle and the bar behaves as before. Once both are in place, a session works through the plan's after-merge checklist with you:

1. **The session checks** that pir's service is running and that the cockpit and pir agree on the numbers. If pir has nothing to report yet, start a pir run and it tries again.
2. **You close and reopen the cockpit window** while a pir run is working. This closes every agent terminal and diff view. Glance at the usage bar, bottom right. You should see coloured numbers and no "as of".
3. **The session follows the numbers for about 20 minutes** while the pir run keeps working. You don't need to watch.
4. **With your yes,** the session turns pir's service off and back on. This confirms the cockpit notices both changes and writes one log line for each. It turns the service back on even if a step fails.

The only thing that needs your eyes is the glance in step 2.

## Risks and follow-ups

- **The real pir service is not built yet.** The cockpit was built against pir's written description of the service and tested against a stand-in. If pir's team changes that description while finishing its side, this side has to change with it. The after-merge check is where any mismatch would show.
- **One big test suite is sometimes timing-sensitive.** In one of four runs, with other builds running at the same time, two unrelated checks failed. The three reruns passed. This is a known flaky spot, not something this build changed.
- **That suite also fails two checks when run from a folder whose path includes a shortcut** (a symlink, as temporary folders often do). It passes when run from the real path. The problem is older than this plan.
- **Small follow-up:** the earlier usage-limits plan has a status line that disagrees with its own task table. That plan also still has its own hands-on check open.

## Branch

Synced with `main` at `53d40ea5a54b` on 2026-10-01T07:33:08Z.
Tests: green.
