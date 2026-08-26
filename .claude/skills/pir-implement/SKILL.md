---
name: pir-implement
description: Implement one task from a plan's tasks/ folder and hand it to the next session for review. Invoked by the `pir-work` skill after it picks a ⬜ or 🟡 task from plans/{slug}/PROGRESS.md — do not invoke it directly; run `pir-work` instead, so the queue chooses the task.
---

# implement

**Invoked by the `pir-work` skill, which has already chosen the task.** If you reached this
without a task chosen by `pir-work`, stop and run `pir-work` — the queue decides what
gets built, and picking out of order is how a task gets built ahead of its dependencies.

The shared rules in `CLAUDE.md` apply in full and are not repeated here — scope, commit
messages, where sessions run, and above all **anything the tests cannot establish is
verified with the user, not asserted.** The project's own rules and traps are in
`plans/{slug}/DESIGN.md` and its *Things that will bite you* list; every entry on that list
has already cost somebody a day.

## The procedure

1. **Read the task doc first, in full** — `plans/{slug}/tasks/T<NN>-*.md`. Goal, files,
   interface, acceptance criteria, test list. Then read `DESIGN.md` for anything the task
   touches whose *why* you do not already hold, and the entries in `FINDINGS.md` that touch
   it. A task implemented from its title is a task reimplemented.
2. **If the task is 🟡**, read the commits already on it before writing anything. You are
   finishing someone's work, not restarting it — what is committed is a decision already
   made unless it is wrong.
3. **Implement only what the task specifies.** Not the obvious next thing, not the tidy-up
   next door. See *Scope* below.
4. **Write the tests the task doc lists**, plus the ones its edge cases imply. A green suite
   that tests nothing is the failure mode here — the whole point of the testability boundary
   is that a full run of behaviour is checkable in milliseconds.
5. **Leave the test command green.** It is named in `DESIGN.md § Environment`, and it is the
   only evidence this session can produce on its own. If it is not green, the task is 🟡, not
   🔍 — hand over a half-built task honestly rather than a finished-looking one.
6. **Update `PROGRESS.md`:** mark the task **🔍**, and write in its Notes cell what you
   built, how many tests, and — the part that earns its keep — **every deviation from the
   task doc and why.** A deviation recorded is a review that starts from the right place; a
   deviation unrecorded is a defect the reviewer has to rediscover. Set the `Next work will:`
   line and the review queue.

   **Sixty words in that cell, and a deviation gets one line each.** The cell is an index for
   the next session, not the account of what you did — the account is the commit message you
   are about to write, and writing it twice is what turns a tracker into a history nobody can
   read. If a deviation genuinely needs a paragraph, it needs the commit message; name it in
   the cell and point there.
7. **Commit**, message `T<NN>: <what it does>`.
8. **Report and stop.** Do not review it. Marking 🔍 hands it to the next session.

## Deviating from the task doc

The task docs were written before the code and some of them are wrong. Deviating is allowed
and sometimes correct — **recording it is not optional.** Say in `PROGRESS.md` what the doc
said, what you did instead, and which rule or design section made you.

If the deviation is a disagreement with `DESIGN.md` rather than with a task doc, say so in
the report and do not quietly implement something else. DESIGN's rules were decided
deliberately and most carry a rationale.

## Scope is strict

`CLAUDE.md § Scope is strict` binds this session: touch only the task you picked up, and put
everything else you notice in the findings log, `plans/{slug}/FINDINGS.md` — **about forty
words, newest first.** The pull is strongest here, in an implementing session, because the
neighbouring code is open in front of you and the fix looks like it costs nothing. Log it and
leave it.

## What you may not claim

The test command is the only evidence this session can produce on its own. If a "Done when"
item can only be established by taking the screen, logging in as somebody else, rebooting,
pointing a camera at something, calling a paid service or watching a real person, then **this
session cannot establish it** — mark that half unverified in `PROGRESS.md` and in the report,
and give the user the exact command with its seatbelt, **the moment you need it, then wait
for the answer**, rather than leaving it as homework at the end. Never run the unbounded
dangerous version to find out for yourself. See `CLAUDE.md` for the handover format and
`DESIGN.md § Environment` for this project's table and seatbelts.
