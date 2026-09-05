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
| T05 | Pane: hover highlight — **gated on T00 and the user's call** | C | T00, T03 | medium |
| T06 | Docs: CLAUDE.md, `docs/cockpit.md`, truths table | D | T01, T02, T03, T04, T05 | light |

## Dependency graph

```
T00 ─────────────────────────┐
                             ├─→ T05 ─┐
T01 → T02 → T03 ┬────────────┘        ├─→ T06
                └─→ T04 ──────────────┘
```

## Critical path

T01 → T02 → T03 → T04 → T06 is the path that always runs. T00 → T05 runs in parallel and rejoins at
T06; if the spike kills hover, T05 becomes a one-line "not built, see FINDINGS" and T06 still closes
the plan.

## Open decisions

- **T05's existence.** Settled by T00's outcome and the user (DESIGN §4). Everything up to T04 is
  unconditional; T05 is the only task that may not be built.
- **The diffstat cost.** One extra GET per shown PR (DESIGN §2.4). Accepted as the same bounded
  pattern as the parent's comment fetch; flagged to the user, who may still drop the file/line counts
  and keep only the free branch line — which would delete T01 and trim T02/T03.

## Notes on sizing

T03 is the weight: two-line layout, the drop order, the underline separator, the pagination budget,
the button hit-zone y, the two emphasis states, and the render/click test updates. T01 is real but
small — it mirrors the existing comment-fetch path. Everything else is light around them.
