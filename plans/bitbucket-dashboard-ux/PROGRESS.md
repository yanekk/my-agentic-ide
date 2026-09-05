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
| T00 | Hover-feasibility spike (motion to the unfocused pane) | — | ⬜ | Throwaway. Gates T05. Hands-on: only real in live WezTerm. |
| T01 | Data: listPRDiffstat + summarizeDiffstat + daemon fetch + cache triple | — | ⬜ | One GET per shown PR, bounded by concernsMe. Read-only. Hands-on for the live call. |
| T02 | Pure model: created_on + comment times, diff/branch, ageLabel, activityTags | T01 | ⬜ | NEW <24h, ACTIVE ≥3 comments/24h, STALE >14d. diff=null when unfetched. |
| T03 | Pure renderer: two-line rows, drop order, separator, emphasis states | T02 | ⬜ | Heavy. Underline separator (no extra line); reworks layout/pagination/hit-zone y. |
| T04 | Pane: press-flash feedback | T03 | ⬜ | Built regardless of the spike. Hands-on for the live flash. |
| T05 | Pane: hover highlight | T00, T03 | ⬜ | GATED on T00 + user. May become "not built". |
| T06 | Docs: CLAUDE.md, docs/cockpit.md, truths table | T01–T05 | ⬜ | Truths row only if the spike earned one. |

**Review queue:** empty.

## Open for the plan review / the user

- **T05 is conditional** (DESIGN §4). The plan-review need not resolve it — T00 does, at build time,
  with the user. Everything up to T04 is unconditional.
- **The diffstat cost** (DESIGN §2.4): one extra GET per shown PR for the file/line counts. Flagged to
  the user 2026-09-05; they may still drop just those counts (deleting T01, trimming T02/T03) and keep
  the free branch line.
