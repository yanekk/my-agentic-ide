# Findings log

What the build taught, newest first, forty words a row. Read the rows touching your task. Whoever appends, compacts past 60 rows or 15 KB. Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
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
