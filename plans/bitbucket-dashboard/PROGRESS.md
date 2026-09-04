# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-04 — 2 fixed, 3 decided with the user

**Status:** Building. T00 and T01 done; T01 reviewed clean. The direction mock is approved and
parked at `prototype/` (it word-wraps titles; the review changed titles to single-line ellipsis
— DESIGN §2.2). The BitBucket API shape is confirmed against the public API (see FINDINGS). Next
is T02 (the client), whose read-only token auth is the one remaining live unknown and needs a
hand-check with the user.
**Last updated:** 2026-09-04
**Next `pir-work` will:** implement T02.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spawn spike: running agent in a repo's context | — | ✅ | Verified live 2026-09-04: `@{slug} {prompt}` + Enter in the fleet box spawns a running agent in `{projectsRoot}/{slug}`. Feeds T09's spawnAgent. See FINDINGS. |
| T01 | `config` settings + `bitbucket-test` suite | — | ✅ | Reviewed clean 2026-09-04, no fix. All 8 checklist items covered; readApiKey/maskedStatus kept as wrappers, still defended by auto-name-test. Probed: unknown name returns null not throw; mask never leaks short values; set-echo masks secrets; throwaway COCKPIT_DIR never touches the real dir. ALL PASS/FAILURES sentinel endorsed over §5's example. |
| T02 | BitBucket HTTPS client | T01 | ⬜ | getUser + listOpenPRs. Read-only token hand-check with user. |
| T03 | Pure model: normalize, classify, sort, paginate | T02 | ⬜ | Classify rules settled in a brainstorm first — see Blocked on the user. |
| T04 | Store: config reads, cache + view-state files | T01 | ⬜ | Single-writer files, atomic rename, no lock. |
| T05 | Daemon `refreshPRs` (tick, return, start) | T02, T03, T04 | ⬜ | Mirrors refreshAgenda. Cache fills; no UI. |
| T06 | Pure renderer + hit-zones | T03 | ⬜ | All states: populated, empty, unconfigured, offline, expired. |
| T07 | Rewire welcome pane to 75/25 | T05, T06 | ⬜ | Touches the diff-slot pane; keep the park/swap invariant. Hand-verify look. |
| T08 | Clicks: mouse, verbs, dispatch (tabs, paging, Open) | T07 | ⬜ | Open uses BITBUCKET_BROWSER seam. |
| T09 | Review/Address auto-spawn | T00, T08 | ⬜ | Uses the T00 primitive. Hand-verified. |
| T10 | install.sh, docs, CLAUDE.md | T09 | ⬜ | New settings, new suite in the test command, the 30-row table if a truth emerges. |

**Review queue:** empty

## Blocked on the user

- **T03 classify rules (§2.3).** Before T03 is implemented, the session must stop and brainstorm
  which PRs each tab shows, using real PRs fetched by T02's client. Provisional rules are in
  DESIGN §2.3; the user has ideas to test (drafts, already-approved, staleness). Nothing before
  T03 is blocked by this.
- Everything else marked "hand-verified" (T02 token check, T07 look, T09 spawn) needs the
  user at the live cockpit when that task is reached; each task doc carries the exact command.
  (T00 done: verified 2026-09-04.)
