# Findings log

What the build taught, newest first, forty words a row. Read the rows touching your task. Whoever appends, compacts past 60 rows or 15 KB. Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-11-01 | 📌 | T07, worker-driven, Claude 2.1.316: `wall-check.sh` ALL AS EXPECTED. 17 tools against 87; notes-test, npm, venv pip, commit passed; superfrog smoke finished, 5 of 117 failing; trial named pass and `example.com` block, cleaned up. Ledger, agenda, mains unchanged; `--clean` run. |
| 2026-11-01 | 🔄 | T07: real attack agent stopped by a safety classifier, then declined; nothing attempted. Owner dropped the attack run. Outside writes, secrets, push and `update-ref` rest on T00 only; DESIGN §1, §2.8 say so. T08 must publish it. |
| 2026-11-01 | 🔄 | T07: `mktemp -d` ignores `TMPDIR` on macOS, refused inside the wall, failing every suite using it. Owner opened `getconf DARWIN_USER_TEMP_DIR` at every start; published in §2.8. Superfrog went from 6 to 5 failures. |
| 2026-11-01 | 📌 | T07: a `-w` session refuses `bash x.sh > log; echo $?` as too complex to verify; plain `bash x.sh` runs, and `tools/smoke.sh > log; echo $?` runs. A calendar description should use the plain form. |
| 2026-11-01 | 📌 | T05 review sweep: `runClaude`, a real start, also inherits `GIT_DIR` and `GIT_WORK_TREE` from the daemon or a hand-run `--once`. Fixed only in the trial; read-only, left open. |
| 2026-11-01 | 📌 | T05: the trial's `git worktree add` runs outside the wall, so a project's committed `post-checkout` hook runs unconfined. Whether a real `-w` does the same is unmeasured. |
| 2026-11-01 | 📌 | T05: a trial whose cleanup fails keeps its exit code and names what is left on stderr. T06's skill must show stderr, as dropped exceptions and an unreadable list also go there. |
| 2026-11-01 | 🐞 | T04 review: fake `claude` unverified against real; T07's `wall-check.sh` is the first real start from this argv. Project folder that is itself a linked worktree: where `-w` lands, and so the guard's root, unmeasured, read-only. |
| 2026-11-01 | 🐞 | T04 review: reftable repo gave `denyWrite` no ref files, so branches stayed movable; symlinked project walked past `GIT_CEILING_DIRECTORIES`. Reproduced by script against real repos, both fixed, tests lock them. |
| 2026-11-01 | 📌 | T04: `remoteHosts` comes from `git remote -v`, so an `~/.ssh/config` alias yields the alias, not the real host. A site exception for the real push host then passes. SSH stays refused at the proxy; HTTPS to it would not. |
| 2026-11-01 | 🐞 | T03 review: `agenda wall alpha allow-write ~/src/other` is accepted and at-start `buildWallSettings` keeps it, opening that project's `.git` hooks. Only the own project's overlap is checked. Left open; no task covers it. |
| 2026-11-01 | 📌 | T03 review: `*.co.uk` and `co.uk` pass `siteProblem`; `*.com` does not. A public-suffix wildcard opens a whole country. T01's rule, left alone. |
| 2026-11-01 | 📌 | T03 doc says bare `agenda` shows help listing the verb. Bare `agenda` draws the day, by design; `agenda help` lists `wall`. Checked against `agenda help`. |
| 2026-11-01 | 📌 | Sweep from T02: `fold` in `bin/cockpit-wall-model.mjs` uses plain `toLowerCase`; APFS opens `ſ` as `s`, so an exception like `~/.ſsh` may pass the secret check. Read-only, person-added only, not fixed. |
| 2026-11-01 | 📌 | Fake unverified against real: the guard's stdin `cwd` field is only in `guard.test.mjs`. If absent, only the root check runs. `wall-check.sh` (T07) could confirm. |
| 2026-11-01 | 🐞 | T02 review fixed: guard passed `.claude/ſettings.json` (APFS folds `ſ` to `s`) and `.claude` or `settings.json` as symlinks. Refusal now applies NFKC folding and judges link names. |
| 2026-11-01 | 📌 | The guard resolves links but not hard links: Bash `ln` of an outside file into the worktree, then Write, is not refused by the guard. Under a `sandbox-exec` deny on the target, `ln` failed (T02 review, stand-in profile); T07 could probe the real wall. |
| 2026-11-01 | 📌 | `git rev-parse --git-common-dir` answers relative `.git` in a main checkout. `buildWallSettings` trusts `commonDir`, so T04 must pass an absolute path (`--path-format=absolute`) or `denyWrite` misses the real refs. |
| 2026-11-01 | 📌 | T01 review, real 2.1.316 init against a dead API: built settings give 17 tools with every denied tool gone; a mistyped field gives 26. Fake `claude` proves no acceptance; T07 repeats this. |
| 2026-11-01 | 🐞 | T00 review: EnterWorktree `path` moved a walled agent into another worktree, where Bash wrote. Denied with ExitWorktree, owner approved; T01 must include both. Daemon restart stays unmeasured, owner accepted. |
| 2026-11-01 | 📌 | T01's doc argv omits `--setting-sources user`, its `SECRET_DIRS` omits the new denies, and its section list omits §7, whose T00 results override it. T01's builder must read §7. |
| 2026-11-01 | 🐞 | Superfrog worktree builds about 5.8 GB and stays until removed; four probes filled the disk to 132 MB free. Job worktrees are kept for review, so nightly runs accumulate. No task covers it. |
| 2026-11-01 | 📌 | A worktree-isolated `--bg` session refuses Bash lines mixing git with other commands, and `git -c`: "too complex to verify". Plain single `git add`, `git commit` work. T04's preamble should say so. |
| 2026-11-01 | 📌 | Guard knows only the worktree, so an `allowWrite` exception folder takes Bash but refuses Write and Edit. T02 and T04 decide nothing here unless raised; agents can use the shell. |
| 2026-11-01 | 🔄 | T00 changed DESIGN §7: more denies, Claude login and keychain closed, `--setting-sources user`. Flagless `claude --bg --resume` and invalid settings lose the wall; both published. |
| 2026-11-01 | 📌 | `claude --help` says settings failing validation are silently ignored non-interactively. Unmeasured for `--settings` under `--bg`; T00 measures it. |
| 2026-11-01 | 📌 | User settings allow `SendMessage`, git and aws commands, and set `allowMachLookup: ["*"]`. Whether they carry into a run is T00's. |
| 2026-11-01 | 📌 | `pip` is absent, only `pip3`; Homebrew Python 3.15 is `EXTERNALLY-MANAGED`, so installs need a venv. |
| 2026-11-01 | 📌 | `claude -p` with `CLAUDECODE=1` is not refused as nested: against a dead API address it kept trying until killed at 25 s. The skill can call `--trial`. |
| 2026-11-01 | 📌 | Measured on 2.1.316: `npm install` in the sandbox fails on `~/.npm`. `gh` hosts file is readable unless denied. Keychain item `Claude Code-credentials` is findable; secret readability unmeasured. |
| 2026-11-01 | 🐞 | `--disallowedTools` as last flag swallowed the whole prompt as deny rules; the agent sat idle reporting `Deny rule … matches no tool`. Same shape for `--mcp-config`. |
| 2026-11-01 | 📌 | Sandbox permits refs and objects in the main `.git`, refuses hooks and config. `denyWrite` on `refs/heads/main` stopped `update-ref` while a commit on the worktree branch succeeded; a `packed-refs.lock` message appeared, harmless. |
| 2026-11-01 | 📌 | `Read(/abs/path)` silently does not match, one slash is relative to the settings file. `Read(//abs)` and `Read(~/x/**)` work and also cover Grep and Glob. |
| 2026-11-01 | 📌 | Full background start measured: `--bg -w` under dontAsk creates the worktree, commits; push (`github.com:22`), `example.com`, `~/.ssh`, cockpit key, outside writes all refused; hook refused Write outside. |
| 2026-11-01 | 🐞 | `sandbox.network.allowedDomains` does not limit anything under `bypassPermissions`: unlisted domains return 200, `allowManagedDomainsOnly` no help. Under `dontAsk` they get 403. A `WebFetch(domain:*)` deny under bypass blocks everything. |
