# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-04 — 2 fixed, 3 decided with the user

**Status:** Building. **T07 built (🔍)** 2026-09-05: welcome pane rewired to 75/25 — dashboard on
the left via `model.renderDashboard`, notes/agenda on the right; below the split floor the
dashboard takes the whole pane. All four suites green (notes now 103, cockpit 486 — park/swap
unchanged). **T07's look is unverified — needs the user at a live cockpit** (command in the report
and the task doc). Still open, user's call: the folded T02/T04/T05 reopen never took the
pir-review alternation — whether to give it a fresh-eyes pass.
**Last updated:** 2026-09-05
**Next `pir-work` will:** review T07.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spawn spike: running agent in a repo's context | — | ✅ | Verified live 2026-09-04: `@{slug} {prompt}`+Enter in the fleet box spawns a running agent in `{projectsRoot}/{slug}`. Feeds T09 spawnAgent. See FINDINGS. |
| T01 | `config` settings + `bitbucket-test` suite | — | ✅ | Reviewed clean 2026-09-04 (a570b7b). All 8 items; readApiKey/maskedStatus kept as wrappers; ALL PASS/FAILURES sentinel endorsed over §5's example. |
| T02 | BitBucket HTTPS client | T01 | ✅ | Reviewed clean 2026-09-04; auth hand-verified with the user (FINDINGS). |
| T03 | Pure model: normalize, classify, sort, paginate | T02 | ✅ | Reviewed 2026-09-05. Model correct; tests genuine and cover the doc; purity holds; full suite green. Hand-verified vs real cribl PRs (read-only key): all comment accessors (inline/parent/resolution/deleted/user.uuid) and PR-list fields (author.nickname/uuid, participants, reviewers) match; resolved-vs-open confirmed (PR#85 vs #40). No model fix. Auth→Bearer folds into T02 reopen. |
| T04 | Store: config reads, cache + view-state files | T01 | ✅ | Reviewed clean 2026-09-04, no fix. Fully testable, no hands-on half. |
| T05 | Daemon `refreshPRs` (tick, return, start) | T02, T04 | ✅ | Reviewed clean 2026-09-05, no fix. All 3 triggers wired; orphan cache entries never pruned → T06 iterates config.repos. |
| T06 | Pure renderer + hit-zones | T03 | ✅ | Reviewed clean 2026-09-05, no fix. Tests genuine (zones re-walked vs coords; exact-rows/width at 5 widths). Purity holds (agenda-model is itself import-free). Probed pager reserve math, clip-vs-zone (buttons last), auth-vs-mixed split, tiny-n degradation, de-watched-repo test. 4 deviations all sound; greeting's `email:api-token` correct per current §2.6 (Bearer reopen updates it). |
| T07 | Rewire welcome pane to 75/25 | T05, T06 | 🔍 | Pane forwards config+cache+view to `renderDashboard` (left 75%), notes/agenda right 25%; split floor `rightW≥24` else full-width dashboard. Tests: notes-test +13 (now 103) — new §12, and §11 watch repointed agenda→bitbucket cache (piped child is 80 cols, non-split, so agenda column undrawn). cockpit-test 486 unchanged. **Look unverified — needs live cockpit.** |
| T08 | Clicks: mouse, verbs, dispatch (tabs, paging, Open) | T07 | ⬜ | Open uses BITBUCKET_BROWSER seam. |
| T09 | Review/Address auto-spawn | T00, T08 | ⬜ | Uses the T00 primitive. Hand-verified. |
| T10 | install.sh, docs, CLAUDE.md | T09 | ⬜ | New settings, new suite in the test command, the 30-row table if a truth emerges. |

**Review queue:** T07.

## Plan decisions (2026-09-05)

- **Sort = decision A (unresolved threads), folded into T03's chain** (user). The per-PR comment
  fetch that A needs extends the client (T02), the cache shape (T04) and the daemon fetch (T05) as
  scoped reopens — not a separate task, and not the free total-`comment_count` fallback (B). The
  comment-endpoint shape is now verified (FINDINGS 2026-09-05), so the reopen is unblocked.
- **Auth = Bearer Access Token** (user, 2026-09-05). The real read-only key is a BitBucket Access
  Token used as `Authorization: Bearer <token>` (no colon), which the T02 client's Basic
  `email:api-token` header (DESIGN §2.6) rejects with 400. The T02 reopen must switch `authHeader`
  to Bearer and rewrite DESIGN §2.6; DESIGN and the client both still say Basic until then.

## Scheduling decision for the user — RESOLVED 2026-09-05

- The user chose to do the folded **T02/T04/T05 reopen** before T07. It is built (see Status).
  T04 needed no code change — comments ride inside each raw PR, which the store already passes
  through. Automated tests are green; the live hand-check below is what remains.

## Blocked on the user

- **Reopen hand-check — DONE 2026-09-05** (FINDINGS ✅). Against the real cribl Bearer access
  token: `getUser` returned a uuid (identity resolves — the DESIGN §2.6 risk is closed),
  `listOpenPRs` 739, `listPRComments` #47424 → 11. Auth, listing and the comment fetch all work
  live. Nothing outstanding here.

- Items marked "hand-verified" that remain (T07 look, T09 spawn) need the user at the live cockpit
  when that task is reached; each task doc carries the exact command. (T00 verified 2026-09-04,
  T02 auth 2026-09-04, T03 field shapes 2026-09-05.)
