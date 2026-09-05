# Plan — two-line rows and reacting buttons

Extends the completed BitBucket dashboard. Model + pane + docs only: no client, store, daemon,
config, or tool changes. Read DESIGN.md before any task.

## Phases

**Phase A — probe the one unknown.** The hover feasibility spike, first, because whether hover can
work at all decides T04's shape and there is no point designing around a guess.

**Phase B — the pure core, tested headless.** Age, tags, and the two-line render including the
button emphasis states. All of it is a pure function of a PR and `now`, so it is proven in the
suite before a pixel is drawn.

**Phase C — wire the mouse.** Press feedback, then hover if the spike allowed it. Impure, live,
hand-verified.

**Phase D — record it.** CLAUDE.md and `docs/cockpit.md`; a truths-table row if the spike earned
one.

## Tasks

| # | Task | Phase | Depends on | Weight |
|---|---|---|---|---|
| T00 | Spike: does WezTerm report mouse motion to the unfocused dashboard pane, smoothly? | A | — | light |
| T01 | Pure model: `created_on`/comment times on the row; `ageLabel`; `activityTags` (NEW/ACTIVE/STALE) | B | — | medium |
| T02 | Pure renderer: two-line rows, pagination + hit-zone y for two lines, button hover/press variants | B | T01 | heavy |
| T03 | Pane: press feedback (flash the pressed button) | C | T02 | medium |
| T04 | Pane: hover highlight — **gated on T00 and the user's call** | C | T00, T02 | medium |
| T05 | Docs: CLAUDE.md, `docs/cockpit.md`, truths table | D | T01, T02, T03, T04 | light |

## Dependency graph

```
T00 ─────────────┐
                 ├─→ T04 ─┐
T01 → T02 ┬──────┘        ├─→ T05
          └─→ T03 ────────┘
```

## Critical path

T01 → T02 → T03 → T05 is the path that always runs. T00 → T04 runs in parallel with the T01→T02
core and rejoins at T05; if the spike kills hover, T04 becomes a one-line "not built, see FINDINGS"
and T05 still closes the plan.

## Open decisions

- **T04's existence.** Settled by T00's outcome and the user (DESIGN §4). Everything up to T03 is
  unconditional; T04 is the only task that may not be built.

## Notes on sizing

T02 is the weight: it reworks `computeLayout`/`buildRow`/`renderDashboard` for two lines, redoes the
pagination budget (PRs-per-page now counts two lines each), restamps the button hit-zone y, adds the
two emphasis states, and updates the render/click tests that assumed one line. Everything else is
small around it.
