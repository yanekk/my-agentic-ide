# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-04 — 2 fixed, 3 decided with the user

**Status:** Building. **T09 code review clean** 2026-09-05 — spawnAgent + bb-review/address
read adversarially against DESIGN §2.8; two stale "inert until T09" comments fixed
(cockpitd.mjs, run.sh §14d). §14d tests genuine (the `\r`-vs-`\n` submit really distinguished:
CR count + a `STDIN:\n` refute). Full test command green (cockpit 510). **Hands-on half
UNVERIFIED and blocking ✅** — a live click starting a real agent can't be stubbed; T09 stays
🔍 until the user runs it. Still open, user's call: the folded T02/T04/T05 reopen never took
the pir-review alternation.
**Last updated:** 2026-09-05
**Next `pir-work` will:** close T09 to ✅ once the user reports the live spawn hand-check.

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
| T06 | Pure renderer + hit-zones | T03 | ✅ | Reviewed clean 2026-09-05, no fix. Iterates config.repos (de-watched repo not drawn); pager/clip/zone math and tiny-n probed; greeting credential per §2.6. |
| T07 | Rewire welcome pane to 75/25 | T05, T06 | ✅ | Reviewed clean 2026-09-05, no code fix; hand-verified live with the user (aligned, titles readable; 9+9 real cribl PRs). Probed split-threshold ripple (full-width fallback now ~93 cols), double-clip no-op, removed-greeting refs, genuine team-match in tests. First-view zero was fetch latency, not a bug (FINDINGS). |
| T08 | Clicks: mouse, verbs, dispatch (tabs, paging, Open) | T07 | ✅ | Reviewed clean; two fixes (wheel-click excluded, tab switch resets to page 1) both hand-verified live 2026-09-05. See FINDINGS. |
| T09 | Review/Address auto-spawn | T00, T08 | 🔍 | Code review clean 2026-09-05; 2 stale-comment fixes (see commit). spawnAgent activates fleet then types (welcome pane ≠ fleet, so the activate is needed and correct); absent id = safe no-op shared with Open; prompt not logged. Probed the queued-verb-then-attach race — narrow, and DESIGN §2.8 accepts stray launches. **Live spawn hand-check still blocks ✅** (needs user). |
| T10 | install.sh, docs, CLAUDE.md | T09 | ⬜ | New settings, new suite in the test command, the 30-row table if a truth emerges. |

**Review queue:** empty (T09 code review done). T09 → ✅ once the user reports the live spawn hand-check.

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

- **T08 core hand-check — DONE 2026-09-05** (FINDINGS ✅). Tabs switch; a bottom-row Open opened
  the right PR (real clicks land on the drawn row). Live paging was not seen — 9 PRs fit one page,
  so no pager drew; its logic is covered by the §14d automated test instead.

- **T08 fixes re-confirmed — DONE 2026-09-05** (FINDINGS). Live: the mouse wheel over the dashboard
  no longer fires a stray click, and switching tabs lands on page 1. Nothing outstanding on T08.

- **Reopen hand-check — DONE 2026-09-05** (FINDINGS ✅). Against the real cribl Bearer access
  token: `getUser` returned a uuid (identity resolves — the DESIGN §2.6 risk is closed),
  `listOpenPRs` 739, `listPRComments` #47424 → 11. Auth, listing and the comment fetch all work
  live. Nothing outstanding here.

- **T09 live spawn hand-check — OPEN, blocks ✅.** In a live cockpit at the fleet list, on the
  To-review tab, click **Review** on a real PR (and, on the Mine tab, **Address** on one of yours).
  Expect: a new agent starts (not just text filling the box), is named after that repo, and is
  working in that repo on that PR — its shell/edits in the clone, the PR URL and directive intact.
  Tell me: did it spawn and start? Right repo? Directive + URL arrived whole? (Only a live click
  can do this — the stub can't model claude creating a session, DESIGN 5.1.)

- Earlier hand-verifications done: T00 spawn 2026-09-04, T02 auth 2026-09-04, T03 field shapes
  2026-09-05, T07 look 2026-09-05, Bearer reopen 2026-09-05 (all in FINDINGS).
