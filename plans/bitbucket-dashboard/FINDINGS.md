# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the entire record that something was seen
working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-05 | 📌 | T05 review clean, no fix. refreshPRs only fetches/writes `cfg.repos`, so a de-watched repo's cache entry lingers in `bitbucket-cache.json` forever (never pruned). Harmless on disk, but T06's renderer must iterate the config's repos, not `cache.repos` keys, or a removed repo still shows. |
| 2026-09-04 | 📌 | T05: a cockpit-test daemon launched `envfn node … >log &` binds `$!` to the subshell, not node, so `kill $!` orphans cockpitd. Agenda sections hide this via staleness; the dashboard has none, so a leak out-ticks the next daemon. D4/D5 use `stopbb` (kills the node child). Agenda's own D2/D3/main kill still leak. |
| 2026-09-04 | ✅ | T02 hand-verified with the user: `getUser` authenticated against their real workspace (real uuid, not `{error:{kind:"auth"}}`); `listOpenPRs` succeeded returning 0 PRs (an empty test repo). Raw-PR shape already confirmed vs the public API (row below); auth was T02's only live unknown. |
| 2026-09-04 | 📌 | T01 reviewed clean, no fix. `bitbucket-test/run.sh` prints the `ALL PASS`/`FAILURES` sentinel the other four suites use, not DESIGN §5's `bitbucket-test: N ok` example — reviewed and endorsed, so don't "fix" it back to the example. |
| 2026-09-04 | ✅ | T00 verified live. Typing `@{slug} {prompt}` into the fleet new-session box then a **real** Enter launches a running agent in `{projectsRoot}/{slug}`; auto-namer names it `{slug} / …`. Plain slug worked — no `cd`, no absolute path. This is T09's `spawnAgent` (DESIGN §2.8). |
| 2026-09-04 | 📌 | Not-cloned slug (`@not-a-real-repo`): the agent still starts but has no repo and rambles that it can't find the context. Harmless and killable — the accepted DESIGN §2.8 limit, now observed rather than guessed. |
| 2026-09-03 | 📌 | BitBucket list PR call with `fields=%2Bvalues.participants,%2Bvalues.reviewers` returns approvals (`participants[].approved`), reviewers, `comment_count`, `updated_on`, `author`, branches and `links.html` in one call. Confirmed against the public API. So per-repo = one GET; counts and sort are free. |
| 2026-09-03 | 📌 | The default PR list response omits `participants` and `reviewers`; both need the field expansion above. `q=state="OPEN"` filtering works. `pagelen` up to 50, follow `next`. |
| 2026-09-03 | 📌 | The fleet view runs at the projects root (`start_dir` in `~/.claude/cockpit/config.lua`, passed by `wezterm/cockpit.lua`), so a spawned agent's cwd is that root and `@{slug}` resolves to the local clone. T00 must confirm this reference form in the live box. |
| 2026-09-03 | 🔄 | User first chose Review/Address buttons leave the prompt unsent, then changed to auto-start a running agent, wanting the spawn built as a reusable primitive for another feature. Recorded in DESIGN §2.8, §7. |
| 2026-09-03 | ✅ | Direction mock (two tabs, columns, 75/25 split) approved by the user before design. User added the paging-on-overflow requirement (DESIGN §2.5). Mock parked at `prototype/`. |
