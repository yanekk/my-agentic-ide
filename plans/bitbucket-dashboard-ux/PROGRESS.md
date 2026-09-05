# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — `/pir-review-plan bitbucket-dashboard-ux` runs before the first build.

**Status:** planned, not started.
**Last updated:** 2026-09-05
**Next `pir-work` will:** stop — the plan is not reviewed yet. After review, implement T00 or T01
(both have no dependencies).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Hover-feasibility spike (motion to the unfocused pane) | — | ⬜ | Throwaway. Gates T04. Hands-on: only real in live WezTerm. |
| T01 | Pure model: created_on + comment times, ageLabel, activityTags | — | ⬜ | NEW <24h, ACTIVE ≥3 comments/24h, STALE >14d. Fixtures gain created_on. |
| T02 | Pure renderer: two-line rows + emphasis states | T01 | ⬜ | Heavy. Reworks layout/pagination/hit-zone y; updates render+click tests. |
| T03 | Pane: press-flash feedback | T02 | ⬜ | Built regardless of the spike. Hands-on for the live flash. |
| T04 | Pane: hover highlight | T00, T02 | ⬜ | GATED on T00 + user. May become "not built". |
| T05 | Docs: CLAUDE.md, docs/cockpit.md, truths table | T01, T02, T03, T04 | ⬜ | Truths row only if the spike earned one. |

**Review queue:** empty.

## Open for the plan review / the user

- **T04 is conditional** (DESIGN §4). The plan-review need not resolve it — T00 does, at build time,
  with the user. Everything up to T03 is unconditional.
