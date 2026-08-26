# {Project} — Design

> **Template.** Written by `/pir-plan`, read by every session that touches the behaviour it
> governs. Delete a section that does not apply rather than writing "n/a" into it.
>
> **Every rule here carries its reason.** A rule without one gets overturned by the first
> session that finds it inconvenient, and this file's whole value is that it carries the
> reasoning across sessions. Dense where something is surprising, absent where it is not.

## 1. Purpose

What this is for, who it is for, and the problem it exists to solve. One or two paragraphs.

### Success criteria

Concrete enough to be checkable. Three to five lines.

### Stance

The opinions this design takes and would not trade away — the things that would make it a
different product if they changed.

---

## 2. Behaviour specification

The rules, one subsection per area, **each with its rationale attached**. This is the part
task docs point back at, so number the subsections and keep the numbers stable: they get
cited from `tasks/`, from `PROGRESS.md` and from commit messages.

### 2.1 {The core model}

What it does. Why it does that and not the obvious alternative.

### 2.2 {…}

### 2.n The unhappy paths

Offline, corrupt file, two copies at once, crash mid-write, wrong input, the user doing
something nobody planned for. **Most of the real requirements live here** — a rule for each,
with what it costs.

---

## 3. Architecture

### 3.1 The boundary

```
{pure/}     — takes inputs as parameters, returns decisions. No clock, no I/O, no network.
{shell/}    — everything platform-shaped.
```

Which side each module sits on and why. **What enforces it** — name the test that scans the
pure side for forbidden imports, and say plainly: if that test fails the fix is to move the
code, never to relax the test.

The reason, in one line worth keeping: everything on the pure side is testable exhaustively
in milliseconds, and every rule that leaks across becomes a rule only a person can check.

### 3.2 Modules

One line each: what it owns, what it depends on.

### 3.3 The decision function

If there is one place where the whole behaviour comes together, describe it here — its
inputs, its output, and the fact that it is a function of its arguments and nothing else.

### 3.4 Data flow

### 3.5 Storage

Where state lives, in what format, and what happens to it on a crash mid-write.

---

## 4. Testing

What the layers are, what each proves, and what none of them can prove.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | |
| Language / runtime | |
| Toolchain | |
| **Deliberately absent** | *(what is not installed, so nobody proposes a workflow that needs it)* |

**The test command.**

```
{the one command}
```

**It is the only evidence a session may produce on its own.** If the obvious command does not
work here, say which one does and why — the next session will otherwise rediscover it.

**Dependencies.** What may be added and what may not, decided once rather than one library at
a time under pressure.

### 5.1 What the test command cannot reach

Each row is something only a person can establish. Add to it whenever the build finds
another.

| Cannot be tested automatically | Why it needs a person |
|---|---|
| | |

### 5.2 Seatbelts

For anything that could take the machine, the screen, the account or real money: the bound
that makes it safe to run.

| Flag / mechanism | Default | Effect |
|---|---|---|
| | | |

**Never ask the user to run the unbounded version to find something out, and never run it
yourself.** The seatbelt is what stands between a test and a power cycle.

---

## 6. Recovery

If this thing can lock someone out, break something, or leave state behind: the way back,
written for somebody under pressure who is not reading the code.

---

## 7. Decisions and rationale

The choices that were made deliberately, what the alternative was, and why it lost. Anything
the user changed their mind about goes here with the date.

---

## 8. Explicitly out of scope

What is deliberately not being built, **each with its reason**. A declined feature that keeps
getting re-proposed costs more than one that was refused in writing.
