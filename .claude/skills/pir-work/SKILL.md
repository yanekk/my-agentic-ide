---
name: pir-work
description: Do exactly one unit of work on a plan — read plans/{slug}/PROGRESS.md, pick the one task the queue says is next, and dispatch to review or implement. Use when the user says "pir-work", "pir-work {slug}", or asks what to do next / to continue the project. One task per invocation, then stop.
---

# work

**Do exactly one of these, then stop.**

```
read plans/{slug}/PROGRESS.md
  ├─ any task marked 🔍 ?  → REVIEW the lowest-numbered one
  ├─ else any task 🟡 ?    → FINISH it
  └─ else                  → IMPLEMENT the next ⬜ whose dependencies are ✅
```

Then update `PROGRESS.md`, commit, report, **and stop.** One unit of work per `pir-work`.

That is the whole point: the session that reviews a task is never the session that wrote
it. A reviewer holding the implementation in context is not a reviewer, and the alternation
is what buys the fresh eyes.

## Which plan

The slug is the argument: `work screen-time` works on `plans/screen-time/`.

**With no slug**, list `plans/`. If there is exactly one plan, use it and say which in your
first line. If there are several, show them with their `Next work will:` lines and **ask**
— guessing wrong here spends a whole session on the wrong project. If there are none, say
so and point at `/pir-plan`.

## The dispatch

1. **Read `plans/{slug}/PROGRESS.md` in full.** It is the handoff — the queue and the task
   states. The findings log lives beside it in `FINDINGS.md`; read the entries that touch
   the task you are picking up. The `Next work will:` line is a summary written by the
   previous session, not the authority; the status table is. If the two disagree, trust the
   table and say so in your report.
2. **Apply the tree above** to the status table. Lowest task number wins within a branch.
   The legend is: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review ·
   ✅ reviewed and done · ⛔ blocked, needs a human.
3. **Announce the pick in one line** before doing anything — which task, which branch of the
   tree, and why it and not another. If the pick is surprising, that line is where the user
   catches it.
4. **Dispatch:**
   - 🔍 → invoke the **`pir-review`** skill
   - 🟡 → invoke the **`pir-implement`** skill; it handles a part-built task the same
     way as a fresh one, starting from what is already committed
   - ⬜ → invoke the **`pir-implement`** skill
5. **Stop.** Do not pick up a second task because the first was small.

## Blocked tasks

Some tasks need a human — a reboot, a second account, a device, an API key, a decision.
**If the task the tree selects is ⛔, say so and stop rather than picking a different one out
of order.** Order exists for a reason: the dependencies in `PLAN.md` are real, and a task
built ahead of its foundation is a task rewritten.

Report what it is blocked on and what you need from the user to unblock it, then stop.

## Never both halves in one session

A session that implements a task marks it 🔍 and stops; the next `pir-work` reviews it.
**Never review your own work in the same session** — not even "quickly, since it's fresh".
Marking 🔍 is how you hand it to the next session, and it is the only fresh-eyes pass this
project gets.

Equally: never implement the next task after reviewing one. The review verdict and the
`PROGRESS.md` update are where a review session ends.
