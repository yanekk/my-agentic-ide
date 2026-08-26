---
name: pir-review
description: Review one implemented (🔍) task with fresh eyes, fix what it finds, and mark it ✅. Invoked by the `pir-work` skill after it picks the lowest-numbered 🔍 task from plans/{slug}/PROGRESS.md — do not invoke it directly; run `pir-work` instead.
---

# review

**Invoked by the `pir-work` skill, which has already chosen the task.** If you reached this
without a task chosen by `pir-work`, stop and run `pir-work`.

**You must not have written the code you are reviewing.** If this session implemented it,
stop — a reviewer holding the implementation in context is not a reviewer. That the task is
🔍 and this is a fresh session is the entire mechanism.

## The procedure

Read the task doc and the implementing commit (`git show`, and the full diff — not just the
summary), then check all four:

1. **Acceptance criteria** — walk the task's "Done when" and its checklist line by line.
   Each item is either verified, or verifiable only by hand and therefore *unverified* —
   there is no third state and no benefit of the doubt.
2. **Tests** — the test command passes, *and* the tests cover the cases the task doc lists. A
   green suite that tests nothing is the failure mode here. Read the tests for what they
   actually assert: a test that would still pass with the implementation gutted is not a
   test. And a number that moved because the behaviour changed is not the same as a number
   the test will defend — when a change makes something take longer or cost more, check that
   the assertion moved with it in both directions.
3. **The traps** — the testability boundary held, no reaching for a clock or the network
   from the pure side, whatever else `DESIGN.md` and `CLAUDE.md § Things that will bite you`
   name. Every entry on that list has already cost somebody a day.
4. **Correctness generally** — read the diff adversarially for what the task doc did not
   anticipate: edge cases, concurrency, error paths, what happens at a boundary, what happens
   when the file is corrupt, what happens when the clock goes backwards or the network
   returns half an answer. Probe past the doc. **This is where reviews find real defects** —
   the first three checks mostly confirm; the fourth is the one that pays.

Check the deviations the implementing session recorded in `PROGRESS.md` — each one is a
decision that has not been reviewed yet. And check for deviations it did *not* record.

## Fix what you find

**In a separate commit from the review verdict.** A defect recorded and left is a defect
rediscovered in three weeks. The fix itself goes in unreviewed — that is the accepted cost of
not stalling.

```
T05 review: fix warning threshold      ← a fix found while reviewing
T05 review: clean                      ← review found nothing; the PROGRESS update is the commit
```

If a finding is out of this task's scope, it goes in the findings log,
`plans/{slug}/FINDINGS.md` — about forty words — and is left alone. The scope rule binds a
review session exactly as it binds an implementing one.

## Close it out

Mark the task ✅ in `PROGRESS.md` and **note in its cell what the review found** — including
"clean, no fix commit" when that is the answer, and including what you probed beyond the doc.
That note is what tells the next session whether a green tick means anything. Update the
`Next work will:` line and the review queue. Commit, report, stop.

**Sixty words in that cell.** The verdict, the defects by name, and one clause for what you
probed — enough that the next session knows what the ✅ is worth. The reasoning goes in the
review commit message, which is written for exactly this and is already in `git log`.

**Do not start the next task.** The verdict is where a review session ends.

## Unverified halves stay unverified

A task whose automated half is green and whose hands-on half has never been seen is not ✅ on
the strength of the tests alone. Say which half is which — in `PROGRESS.md` and in the report
— and give the user the exact command with its seatbelt. Never run the unbounded dangerous
version to find out for yourself.

**Ask the moment you need it and wait for the answer.** The user is the hands on the real
machine and has asked to be stopped for, not handed homework at the end — see `CLAUDE.md`.
Finish anything that does not depend on the answer while you wait, then fold the answer in
and close the review with it. When it comes back it goes in `FINDINGS.md` with the date:
"verified by hand" is worth as much as any test, and only if it is written down.
