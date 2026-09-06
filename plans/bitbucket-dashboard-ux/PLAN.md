# Plan — richer two-line rows and reacting buttons

Extends the completed BitBucket dashboard. It adds one bounded network call per shown PR (the
diffstat), and otherwise touches the model, the pane and the docs. No config, no new tool. Read
DESIGN.md before any task.

## Phases

**Phase A — probe the one unknown.** The hover feasibility spike, first, because whether hover can
work at all decides T05's shape and there is no point designing around a guess.

**Phase B — the data and the pure core, tested headless.** The diffstat fetch and summary; the age,
tags and diff/branch fields on the row; and the two-line render with its separator and button
emphasis states. The pure parts are proven in the suite before a pixel is drawn.

**Phase C — wire the mouse.** Press feedback, then hover if the spike allowed it. Impure, live,
hand-verified.

**Phase D — record it.** CLAUDE.md and `docs/cockpit.md`; a truths-table row if the spike earned one.

## Tasks

| # | Task | Phase | Depends on | Weight |
|---|---|---|---|---|
| T00 | Spike: does WezTerm report mouse motion to the unfocused dashboard pane, smoothly? | A | — | light |
| T01 | Data: `listPRDiffstat` client call, pure `summarizeDiffstat`, daemon fetch for shown PRs, cache triple | B | — | medium |
| T02 | Pure model: `created_on`/comment times, `diff`/branch on the row, `ageLabel`, `activityTags` | B | T01 | medium |
| T03 | Pure renderer: two-line rows, drop order, row separator, hit-zone y, button hover/press variants | B | T02 | heavy |
| T04 | Pane: press feedback (flash the pressed button) | C | T03 | medium |
| T05 | Pane: hover highlight — **DROPPED (T00 + user, 2026-09-06): motion never reaches the unfocused pane; not built** | C | T00, T03 | — |
| T06 | Docs: CLAUDE.md, `docs/cockpit.md`, truths table | D | T01, T02, T03, T04 | light |

## Dependency graph

```
T00 → (T05 dropped — motion not delivered to the unfocused pane)

T01 → T02 → T03 ┬──────────→ T06
                └─→ T04 ─────┘
```

## Critical path

T01 → T02 → T03 → T04 → T06 is the path that runs. T00 answered its one question (hover cannot work)
and T05 is not built; T06 closes the plan.

## Open decisions

- **T05's existence.** Settled: dropped by T00's outcome and the user (2026-09-06, DESIGN §4;
  FINDINGS). Motion is delivered only to the focused pane, so hover to the unfocused dashboard pane
  is impossible. Everything up to T04 is unconditional and unaffected.
- **The diffstat cost.** One extra GET per shown PR (DESIGN §2.4). Accepted as the same bounded
  pattern as the parent's comment fetch; flagged to the user, who may still drop the file/line counts
  and keep only the free branch line — which would delete T01 and trim T02/T03.

## Notes on sizing

T03 is the weight: two-line layout, the drop order, the underline separator, the pagination budget,
the button hit-zone y, the two emphasis states, and the render/click test updates. T01 is real but
small — it mirrors the existing comment-fetch path. Everything else is light around them.
