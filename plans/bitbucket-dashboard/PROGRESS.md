# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-04 — 2 fixed, 3 decided with the user

**Status:** Building. T03 pure model implemented 🔍 (normalize/classify/paginate, 41 model tests;
purity grep and the full suite green — agenda, notes, cockpit, bitbucket all PASS). Two follow-ons
are carried, both needing the user's real workspace next round: (1) verify BitBucket's comment-object
field names against real PRs (isolated in normalizePR's three accessors); (2) the per-PR comment
fetch that feeds the sort, folded into T02/T04/T05 as scoped reopens (decision A, confirmed).
**Last updated:** 2026-09-05
**Next `pir-work` will:** review T03 (the pure model). The folded comment-fetch plumbing follows,
with real PRs.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spawn spike: running agent in a repo's context | — | ✅ | Verified live 2026-09-04: `@{slug} {prompt}`+Enter in the fleet box spawns a running agent in `{projectsRoot}/{slug}`. Feeds T09 spawnAgent. See FINDINGS. |
| T01 | `config` settings + `bitbucket-test` suite | — | ✅ | Reviewed clean 2026-09-04 (a570b7b). All 8 items; readApiKey/maskedStatus kept as wrappers; ALL PASS/FAILURES sentinel endorsed over §5's example. |
| T02 | BitBucket HTTPS client | T01 | ✅ | Reviewed clean 2026-09-04; auth hand-verified with the user (FINDINGS). |
| T03 | Pure model: normalize, classify, sort, paginate | T02 | 🔍 | Built: normalizePR, classify, paginate + 41 tests, purity grep + full suite green. Comment reduction isolated in 3 accessors — real-PR field check pending (FINDINGS). Deviations: run.sh purity grep already present (T01), not re-added; normalizePR takes {meUuid,repo}; author.nickname; reviewers as uuids. |
| T04 | Store: config reads, cache + view-state files | T01 | ✅ | Reviewed clean 2026-09-04, no fix. Fully testable, no hands-on half. |
| T05 | Daemon `refreshPRs` (tick, return, start) | T02, T04 | ✅ | Reviewed clean 2026-09-05, no fix. Interfaces vs T02/T04 correct, syntax/no import collisions, all 3 triggers wired, full suite green (475). Deviation (per-repo auth signal) sound. Probed: guard test genuinely defends overlap; orphan cache entries never pruned → FINDINGS for T06's renderer. |
| T06 | Pure renderer + hit-zones | T03 | ⬜ | All states: populated, empty, unconfigured, offline, expired. |
| T07 | Rewire welcome pane to 75/25 | T05, T06 | ⬜ | Touches the diff-slot pane; keep the park/swap invariant. Hand-verify look. |
| T08 | Clicks: mouse, verbs, dispatch (tabs, paging, Open) | T07 | ⬜ | Open uses BITBUCKET_BROWSER seam. |
| T09 | Review/Address auto-spawn | T00, T08 | ⬜ | Uses the T00 primitive. Hand-verified. |
| T10 | install.sh, docs, CLAUDE.md | T09 | ⬜ | New settings, new suite in the test command, the 30-row table if a truth emerges. |

**Review queue:** T03 (the pure model — normalize/classify/paginate).

## Plan decision (resolved 2026-09-05)

- **Sort = decision A (unresolved threads), folded into T03's chain** (user, 2026-09-05). The
  per-PR comment fetch that A needs extends the client (T02), the cache shape (T04) and the daemon
  fetch (T05) as scoped reopens riding with T03's chain — not a separate task, and not the free
  total-`comment_count` fallback (B). Those reopens are queued for next round: they need a live
  token and the real comment-endpoint shape, so they wait on the user's workspace.

## Blocked on the user

- **Real PRs, next round.** The user provides workspace access for two things: verifying the
  comment-object field names in normalizePR's accessors (nickname vs display_name too), and then
  building the folded T02/T04/T05 comment fetch above against the real endpoint.
- Everything else marked "hand-verified" (T02 token check, T07 look, T09 spawn) needs the
  user at the live cockpit when that task is reached; each task doc carries the exact command.
  (T00 done: verified 2026-09-04.)
