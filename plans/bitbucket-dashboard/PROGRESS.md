# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-04 — 2 fixed, 3 decided with the user

**Status:** Building. T03 classify brainstorm done 2026-09-05 — rules settled and recorded in
DESIGN §2.3 (see below / FINDINGS). Two things gate implementing T03: (1) a plan decision on how
to slot the per-PR comment fetch that the chosen sort needs; (2) real PRs, which the user provides
next round, to verify BitBucket's comment/author field names before the counting code is written.
Full suite green as of T05 (cockpit 475, bitbucket store 42, client 24, config 54).
**Last updated:** 2026-09-05
**Next `pir-work` will:** wait on the plan decision below, then (with real PRs) implement T03.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spawn spike: running agent in a repo's context | — | ✅ | Verified live 2026-09-04: `@{slug} {prompt}`+Enter in the fleet box spawns a running agent in `{projectsRoot}/{slug}`. Feeds T09 spawnAgent. See FINDINGS. |
| T01 | `config` settings + `bitbucket-test` suite | — | ✅ | Reviewed clean 2026-09-04 (a570b7b). All 8 items; readApiKey/maskedStatus kept as wrappers; ALL PASS/FAILURES sentinel endorsed over §5's example. |
| T02 | BitBucket HTTPS client | T01 | ✅ | Reviewed clean 2026-09-04; auth hand-verified with the user (FINDINGS). |
| T03 | Pure model: normalize, classify, sort, paginate | T02 | ⬜ | Rules settled (DESIGN §2.3). Chosen sort (unresolved threads) needs per-PR comment data → reopens T02/T04/T05; slotting is a plan decision. Real PRs next round verify field names. |
| T04 | Store: config reads, cache + view-state files | T01 | ✅ | Reviewed clean 2026-09-04, no fix. Fully testable, no hands-on half. |
| T05 | Daemon `refreshPRs` (tick, return, start) | T02, T04 | ✅ | Reviewed clean 2026-09-05, no fix. Interfaces vs T02/T04 correct, syntax/no import collisions, all 3 triggers wired, full suite green (475). Deviation (per-repo auth signal) sound. Probed: guard test genuinely defends overlap; orphan cache entries never pruned → FINDINGS for T06's renderer. |
| T06 | Pure renderer + hit-zones | T03 | ⬜ | All states: populated, empty, unconfigured, offline, expired. |
| T07 | Rewire welcome pane to 75/25 | T05, T06 | ⬜ | Touches the diff-slot pane; keep the park/swap invariant. Hand-verify look. |
| T08 | Clicks: mouse, verbs, dispatch (tabs, paging, Open) | T07 | ⬜ | Open uses BITBUCKET_BROWSER seam. |
| T09 | Review/Address auto-spawn | T00, T08 | ⬜ | Uses the T00 primitive. Hand-verified. |
| T10 | install.sh, docs, CLAUDE.md | T09 | ⬜ | New settings, new suite in the test command, the 30-row table if a truth emerges. |

**Review queue:** empty

## Plan decision needed (from the user)

- **How to slot the per-PR comment fetch.** The settled sort (DESIGN §2.3) needs each open PR's
  comments, which the cheap list call does not carry. This extends the client (T02, ✅), the
  cache shape (T04, ✅) and the daemon fetch (T05, ✅). Options: reopen those three tasks as
  scoped additions, or add one new task before T03. Recommendation: fold into T03's chain as a
  scoped reopen of T02/T04/T05 (thin slice, one concern), not a separate task. The user decides,
  since reopening finished tasks is a plan change.
- **Fuller cost the user should see:** decision A reopens three finished tasks, not just the
  client. The zero-plumbing fallback (B) is to sort by the free total `comment_count`. A stands
  unless the user says otherwise.

## Blocked on the user

- **Real PRs, next round.** The user provides workspace access so `normalizePR`'s comment/author
  field mapping is verified against real data before the counting code is written (T03 note).
- Everything else marked "hand-verified" (T02 token check, T07 look, T09 spawn) needs the
  user at the live cockpit when that task is reached; each task doc carries the exact command.
  (T00 done: verified 2026-09-04.)
