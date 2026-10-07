# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-07 | 📌 | `~/.wezterm.lua` symlinks to `main`'s `wezterm/cockpit.lua`, so pointing `config.lua` `repo` at a worktree loads its layout and daemon but not its key bindings. T06 repoints the link too. |
| 2026-10-07 | 🐞 | cockpit-test section 11 fails two `--conf` path checks in a fresh copy under `$TMPDIR` (`/var/folders` is a symlink to `/private/var`); passes in a copy under `.claude/worktrees/`. Pre-existing, not investigated. |
| 2026-10-07 | 🔄 | The person reversed pir-pane's "click only, no key" (2026-09-26): ← opens a picker, the footer click stays (DESIGN §7). |
| 2026-10-07 | 🐞 | cockpit-test section 5f (diff-mode label clicks) failed four checks in one full run on unchanged `main` 6620d81, then passed with `ONLY=5f`. Flaky, not investigated. |
| 2026-10-07 | 📌 | Lua runs here only inside WezTerm: `wezterm --config-file x.lua show-keys` evaluates a config in 45ms, `wezterm.json_parse` works, a `dofile` module loads. No `lua` binary. Reading a small file costs about 44µs. |
| 2026-10-07 | 📌 | `cockpitd` reads `cmd` by a 200ms poll (`tail()`), not a watch, so a verb waits up to 200ms before anything happens. |
| 2026-10-07 | 📌 | pir's runs list now has a box (bare is `@` or empty). Bare: hint `↑↓ move · ↵ open · …` and ← is a no-op. With text: `↵ start planning · …` and ← moves the cursor. The Ctrl+P pairing screen reports `view: list`. |
| 2026-10-07 | 📌 | Claude 2.1.291 `claude agents`: `❯ describe a task for a new session` shows exactly when the box is empty; a leading space is dropped; a lone Ctrl+J hides it. ← changes nothing on the list, row selected or not. |
| 2026-10-07 | 📌 | The pir source is not at `~/src/plan-implement-review` on this machine any more; the installed engine is `~/.claude/pir-engine`. |
