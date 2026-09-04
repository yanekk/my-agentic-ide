# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-04 — 2 fixed, 3 decided with the user

**Status:** Building. T04 (store) built and 🔍, user chose it over the still-blocked T03. Full
suite green (bitbucket store 42/42, client 24/24, config 54/54; agenda/notes/cockpit unchanged).
T03's classify brainstorm (§2.3) still stops on the user — needs a workspace with real PRs and
the test repo is empty.
**Last updated:** 2026-09-04
**Next `pir-work` will:** review T04 (lowest 🔍).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spawn spike: running agent in a repo's context | — | ✅ | Verified live 2026-09-04: `@{slug} {prompt}`+Enter in the fleet box spawns a running agent in `{projectsRoot}/{slug}`. Feeds T09 spawnAgent. See FINDINGS. |
| T01 | `config` settings + `bitbucket-test` suite | — | ✅ | Reviewed clean 2026-09-04 (a570b7b). All 8 items; readApiKey/maskedStatus kept as wrappers; ALL PASS/FAILURES sentinel endorsed over §5's example. |
| T02 | BitBucket HTTPS client | T01 | ✅ | Reviewed clean 2026-09-04, no fix. All 9 test items + both automated Done-when green; auth hand-check in FINDINGS. Endorsed no-client-split auth (base64 whole key, server splits; test covers colon-in-token). Probed: `%2C` fields accepted live, MAX_PAGES bound, next/values type guards, timeout aborts body-read → transient. |
| T03 | Pure model: normalize, classify, sort, paginate | T02 | ⬜ | Classify rules settled in a brainstorm first — see Blocked on the user. |
| T04 | Store: config reads, cache + view-state files | T01 | 🔍 | Built. readConfig/isConfigured (via readSetting — one read path), readCache/writeCache, readView/writeView. Atomic temp-then-rename, 0600, no lock. Corrupt/absent → empty/default, file left untouched (no quarantine, unlike agenda state). 42 assertions. Deviations: empty-cache meUuid is `null` not `""`; a bad page falls to 1. |
| T05 | Daemon `refreshPRs` (tick, return, start) | T02, T03, T04 | ⬜ | Mirrors refreshAgenda. Cache fills; no UI. |
| T06 | Pure renderer + hit-zones | T03 | ⬜ | All states: populated, empty, unconfigured, offline, expired. |
| T07 | Rewire welcome pane to 75/25 | T05, T06 | ⬜ | Touches the diff-slot pane; keep the park/swap invariant. Hand-verify look. |
| T08 | Clicks: mouse, verbs, dispatch (tabs, paging, Open) | T07 | ⬜ | Open uses BITBUCKET_BROWSER seam. |
| T09 | Review/Address auto-spawn | T00, T08 | ⬜ | Uses the T00 primitive. Hand-verified. |
| T10 | install.sh, docs, CLAUDE.md | T09 | ⬜ | New settings, new suite in the test command, the 30-row table if a truth emerges. |

**Review queue:** T04

## Blocked on the user

- **T03 classify rules (§2.3).** Before T03 is implemented, the session must stop and brainstorm
  which PRs each tab shows, using real PRs fetched by T02's client. Provisional rules are in
  DESIGN §2.3; the user has ideas to test (drafts, already-approved, staleness). Nothing before
  T03 is blocked by this.
- Everything else marked "hand-verified" (T02 token check, T07 look, T09 spawn) needs the
  user at the live cockpit when that task is reached; each task doc carries the exact command.
  (T00 done: verified 2026-09-04.)
