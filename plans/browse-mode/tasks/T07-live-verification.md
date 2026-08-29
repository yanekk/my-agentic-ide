# T07 — Verified by hand, in a real cockpit

**Phase:** 3 · **Depends on:** T03, T06 · **Weight:** light (but the session waits)

## Goal

Nothing built so far is known to *draw* correctly. The test command stubs WezTerm and the
spikes run against a headless mux with no screen: between them they prove the daemon reacts
correctly and the geometry is right, and neither can prove the thing is usable. This task is
the only evidence that browse mode works for a person, and its result goes in FINDINGS with the
date — a ✅ there is the entire record that anything was seen working for real.

## Design sections this implements

DESIGN §5.1 (what the test command cannot reach), and the success criteria in §1.

## Files

```
plans/browse-mode/FINDINGS.md    the answers, with the date
plans/browse-mode/PROGRESS.md    T07 state
```

No product code. If this task finds a defect, that defect is a **new task** — not a fix
smuggled into the verification.

## Needs a person

**Raise this the moment the task is picked up and wait for the answer.** It is not homework
left at the end of a report. Everything that does not depend on the answer is finished first,
but the session ends when the answer is in.

Re-open the WezTerm window first — that is the supported way to rebuild everything, and it is
the seatbelt here: nothing in this check runs against a half-migrated cockpit.

```
1. Open a fresh WezTerm window and enter an agent in the fleet list.
2. Focus the diff pane. Press ⌥] until the strip says: browse
3. In the bottom-right terminal, type: browse
4. Type a few letters to find a file. Press Enter.
5. Press Enter on two more files.
6. Type: c/healQuitDiff        then press Enter on a result.
7. Press ⌥] twice to leave browse and ⌥[ twice to come back.
8. Press ⌥w-free: switch to another agent and back.
```

Expect: at 2 the top pane becomes an empty editor. At 4 the file appears there and **the cursor
stays in the terminal** — you can keep typing in broot without clicking. At 5 there are three
tabs. At 6 it opens **on the matching line**. At 7 all three tabs are still there. At 8 they are
still there and it is still your agent's files.

Tell me:
- Did focus ever jump out of the browser?
- Did the tabs survive steps 7 and 8?
- Did step 6 land on the right line?
- Is the tree readable at that terminal width, or is it too cramped to use?
- Does the redraw when the viewer comes back look acceptable, or does it read as a glitch?

## Tests

None. This task exists precisely because no test reaches it.

## Done when

- [ ] every question above has an answer from the user, written into FINDINGS with the date
- [ ] any defect found is recorded as a new task, not fixed here
- [ ] PROGRESS says plainly which half of the plan is test-proven and which half is
      person-proven
