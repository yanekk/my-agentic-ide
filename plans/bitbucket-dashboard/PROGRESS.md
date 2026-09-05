# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-04 — 2 fixed, 3 decided with the user

**Status:** Building. Folded **T02/T04/T05 reopen built** 2026-09-05: client auth→Bearer, new
`listPRComments`, daemon fetches comments per open PR into `raw.comments`, store passes through.
All four suites green. **Bearer-only confirmed with the user** 2026-09-05 after a live diagnosis
found the then-configured key was a personal `email:api-token` (Basic works, Bearer 401s) — the
wrong key, not a reason to support Basic. **One live check still open:** does `GET /2.0/user`
resolve an identity for the real cribl **Bearer** access token? "Assigned to me / my threads" die
if not — command in "Blocked on the user". This folded code did **not** go through the pir-review
alternation (not a queue task); a fresh-eyes pass is a plan-structure call for the user. Next
ready ⬜ is T07.
**Last updated:** 2026-09-05
**Next `pir-work` will:** implement T07 (the reopen's Bearer-identity check awaits the user).

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
| T07 | Rewire welcome pane to 75/25 | T05, T06 | ⬜ | Touches the diff-slot pane; keep the park/swap invariant. Hand-verify look. |
| T08 | Clicks: mouse, verbs, dispatch (tabs, paging, Open) | T07 | ⬜ | Open uses BITBUCKET_BROWSER seam. |
| T09 | Review/Address auto-spawn | T00, T08 | ⬜ | Uses the T00 primitive. Hand-verified. |
| T10 | install.sh, docs, CLAUDE.md | T09 | ⬜ | New settings, new suite in the test command, the 30-row table if a truth emerges. |

**Review queue:** empty.

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

- **Reopen hand-check (the cribl Bearer token, do before the reopen is done).** The client is
  Bearer-only; the load-bearing unknown is whether `GET /2.0/user` returns a uuid for the real
  cribl **access token** (a personal email:api-token was diagnosed in config on 2026-09-05 and is
  the wrong key — it 401s under Bearer, proving nothing). Read-only (GET only, DESIGN 5.2). Paste
  the cribl Bearer token and a cribl workspace/repo, run in the repo root:

  ```
  BB_KEY="<cribl access token>" BB_WS="<cribl workspace>" BB_REPO="<a cribl repo>" \
    node -e 'import("./bin/cockpit-bitbucket-client.mjs").then(async m => {
      const key = process.env.BB_KEY, ws = process.env.BB_WS, repo = process.env.BB_REPO;
      console.log("getUser:", await m.getUser({ key }));
      const r = await m.listOpenPRs({ key, workspace: ws, repo });
      console.log("listOpenPRs("+repo+"):", r.error || (r.prs.length+" open PRs"));
      if (r.prs && r.prs.length) {
        const c = await m.listPRComments({ key, workspace: ws, repo, prId: r.prs[0].id });
        console.log("listPRComments #"+r.prs[0].id+":", c.error || (c.comments.length+" comments"));
      }
    })'
  ```

  Expect: getUser prints a real uuid (not `{error:...}`), a PR count, and a comment count on a PR.
  Tell me: did getUser return a uuid (Bearer identity works for the access token)? Did the PR list
  and comment fetch both succeed? If getUser 401s while the list works, that is the design risk in
  DESIGN §2.6 — identity needs a different source, a decision for the user.

- Items marked "hand-verified" that remain (T07 look, T09 spawn) need the user at the live cockpit
  when that task is reached; each task doc carries the exact command. (T00 verified 2026-09-04,
  T02 auth 2026-09-04, T03 field shapes 2026-09-05.)
