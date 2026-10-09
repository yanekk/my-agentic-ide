# fleet-picker-status — delivery report

## What was delivered

Pressing ← at the list now shows, under **Claude Agents** and **PIR**, one line per item that program has going: a status word, then its name. Items waiting for you come first, in yellow, then running ones, then failures in red, then recent finishes, dimmed.

- **Claude Agents** lists only the agents you dispatched from the fleet box, so pir's own workers do not appear twice.
- **PIR** lists every run (builds, planning runs, single runs), named the way pir's own dashboard names them, with a build's progress such as `3/7` after its word.
- A clean finish stays listed for one hour with its age (`done 12m`), then disappears. A failure stays until you dismiss it in its own program.
- The picker opens as fast as before: the frame appears at once with `…` under each entry, and the lists fill in about a fifth of a second later. Keys work throughout, and choosing before the lists arrive is fine.
- If a program's status cannot be read, its entry shows one dim line (`status unavailable`, or `pir service not running` when pir's service is down) and the picker otherwise works as before. With nothing going it says `nothing running`.
- The lists are for reading only: the keys, and what choosing a program does, are unchanged.
- It fits the window at every size tested, down to the smallest. At the small size the title is dropped to make room.

**Not delivered yet:** finished pir runs never show, because pir does not yet report when a run finished. That is the separate change in the pir project (`pir-ended-at.md`), yours to start. Until it lands, pir's list shows waiting, running and failed runs only.

## Decisions made for you

- **T05: In the smallest window, the 'pir is down' line is cut to 'status unavailable · pir service no…'. How should it read when it doesn't fit?**
  Answer: In the smallest window, the 'pir is down' line is cut to 'status unavailable · pir service no…'. How should it read when it doesn't fit? → Drop the prefix (Recommended)
  Why: DESIGN §2.7 has the line name the cause because starting pir's service is the person's fix; a cut that hides the cause defeats that. Dropping the prefix only when it doesn't fit keeps the cause and leaves the approved wording unchanged at the usual sizes. Record it in DESIGN §7 as T05 asks.

## What to check by hand

Nothing is required: there was no hands-on step in this plan, and a worker drove the picker at every size, in every situation, including once against your real Claude agents and pir runs (read-only). The one thing nobody has seen is how it looks in your own WezTerm window. It takes effect on your next ← after merging, with no rebuild. To check:

1. Go to the fleet list with no agent open and press ←.
2. Look for: the frame appearing at once, then your background agents and pir runs filling in under the two entries a moment later. Anything waiting on you should be at the top, in yellow.
3. Press Esc to close it.

## Risks and follow-ups

- **Finished pir runs are hidden** until the pir finish-time change is built in the pir project.
- **How Claude reports status is undocumented.** The picker reads Claude's agent list and a file Claude keeps for each agent. A future Claude update could change either. If that happens, the worst case is a recent finish being hidden or a new status showing under its raw name. The picker would not break.
- **The "failed" and "crashed" states were never seen for real.** They are handled as the plan expected, but no agent failed or crashed during the test.
- **Names with Chinese, Japanese or emoji characters** can run past the right edge of the slot. The picker treats every character as one column wide. The notes column has the same flaw. Open, not fixed.
- **The bottom hint is cut off in a very small slot** (30×8) to `enter or → open ·`. This was already the case before this change. Open.
- **One test of the picker failed once in about 40 runs** and passed on rerun. The test helper now gives up after 5 seconds rather than hanging, but why it hung is still unknown.
- **The test agent T00 started is stopped but still listed** in `claude agents`. Remove it with `claude rm 6ad675f8` when convenient. No step in the plan allowed the worker to remove it.
- **The footer shows an agent's name without stripping hidden control characters**, which the picker now does. Small, open.
- **A note in the build's log is wrong:** it says you chose the small-window wording for the pir-down line. I chose it on your behalf (listed with the other decisions).

## Branch

Synced with `main` at `a0b4538cbef1` on 2026-10-09T14:55:03Z.
Tests: green.
