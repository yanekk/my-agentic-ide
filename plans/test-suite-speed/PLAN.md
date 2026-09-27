# Implementation plan

10 tasks in 4 phases. Each has a file in [tasks/](tasks/). Track state in
[PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first. Do not start T01 until pir-pane
has merged to main (DESIGN §5).

## Shape of the build

- The runner and the new wait helper come first and touch disjoint parts of the script: T01 the
  section headings and the tail, T02 the helper block. Every conversion task depends on both, so
  no conversion edits a heading T01 is still rewriting.
- The conversions split by chain (DESIGN §4.1), so each is reviewable on its own and they touch
  disjoint line ranges. They can run at once.
- Concurrency (T08) is decided on the measured result of the conversions, not in advance.
- Stability is proven last, on the finished suite, then the docs quote the measured time.

```
Phase 1  ▸  T01 T02                  runner, helper
Phase 2  ▸  T03 T04 T05 T06 T07      conversions, one per chain
Phase 3  ▸  T08                      concurrency, conditional
Phase 4  ▸  T09 T10                  stability proof, docs
```

## Phase 1 — Runner and helper

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T01](tasks/T01-section-runner.md) | section-runner | — | medium |
| [T02](tasks/T02-waituntil.md) | waituntil | — | light |

At the end, `ONLY=`, `SECTIONS=1` and `TIMINGS=1` work, and the clean baseline per section is in
FINDINGS.md.

## Phase 2 — Conversions

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T03](tasks/T03-convert-main-early.md) | convert-main-early | T01, T02 | medium |
| [T04](tasks/T04-convert-browse.md) | convert-browse | T01, T02 | heavy |
| [T05](tasks/T05-convert-footer-agenda.md) | convert-footer-agenda | T01, T02 | medium |
| [T06](tasks/T06-convert-dashboard.md) | convert-dashboard | T01, T02 | medium |
| [T07](tasks/T07-convert-pir-pane.md) | convert-pir-pane | T01, T02 | medium |

T04 and T07 run their chain from section 1 through `ONLY=`, since both are late in the main
chain; they cannot be faster to iterate on than the prefix before them.

## Phase 3 — Concurrency

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T08](tasks/T08-concurrent-chains.md) | concurrent-chains | T03, T04, T05, T06, T07 | medium |

## Phase 4 — Proof and docs

| # | Task | Depends on | Weight |
|---|---|---|---|
| [T09](tasks/T09-stability-proof.md) | stability-proof | T08 | medium |
| [T10](tasks/T10-docs.md) | docs | T09 | light |

## Critical path

T01 → T04 → T08 → T09 → T10. T04 is the heaviest conversion: 145 s and the most window checks.

10 tasks, longest chain 5, up to 5 can run at once (T03–T07).

## Open

- pir-pane's 15/16 sections do not exist on main yet. T07 is written against their names on the
  pir-pane branch (2026-09-27, 95 sleeps in the script there). If pir-pane changes them before
  merging, T07 converts whatever merged.
