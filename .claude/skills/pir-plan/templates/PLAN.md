# Implementation plan

{N} tasks in {M} phases. Each has a file in [tasks/](tasks/) with its goal, the files it
touches, the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

The ordering principles this plan follows, and what each one buys — two or three sentences
each. The usual ones:

- **Everything testable automatically is built and tested before anything draws a pixel.** By
  the end of the headless phase every rule is implemented and proven; the UI phase then wires
  a surface to logic already known to be correct.
- **The riskiest unknown goes first, as a spike**, before anything is built on top of it.
- **The dangerous thing is built small before it is built full size.**
- **Recovery before autostart** — never install the thing that keeps it alive before the
  thing that lets it recover.

```
Phase 0  ▸  T00              prove the ground          throwaway
Phase 1  ▸  T01 … T0n        pure core, headless       no UI exists
Phase 2  ▸  …
```

---

## Phase 0 — Prove the ground

Nothing is designed on top of an assumption that has not been checked on this machine.

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-{slug}.md) | {the spike} | — |

**T00 gates {what}.** Say which design decisions ride on it and what each possible answer
would mean. It is throwaway code and it is deleted afterwards.

## Phase 1 — {name}

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-{slug}.md) | | T00 |

*(one section per phase, each with a line saying what is true at the end of it)*

---

## Critical path

```
T00 → T01 → … → T{n}
```

Which tasks are off it and can slot in wherever convenient.

## Rough sizing

Not hours — a relative sense of where the weight is.

| Weight | Tasks |
|---|---|
| **Heavy** | |
| **Medium** | |
| **Light** | |

The places this will overrun, and why.

## Decisions still open

What is unsettled, what will settle it, and whether it blocks. Say explicitly if nothing does.
