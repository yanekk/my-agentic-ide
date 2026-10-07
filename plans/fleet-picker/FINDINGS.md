# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-07 | 📌 | T05 review: CLAUDE.md still says `spikes/cockpit-test/` has 812 checks; T03 added sections 17a–17i and 15m checks, so the count is stale. Not fixed; needs a full-suite run to recount. |
| 2026-10-07 | 📌 | T03 review: a `picker-cancel` or `fleet-*` refused as "the panes are busy" (lock held over 2s) leaves the exited picker in the slot, switch dim, ← disarmed; only a BitBucket click or rebuild clears it. Unreproduced. |
| 2026-10-07 | ✅ | T00 GUI probe, person at the keyboard: plain ← through a Lua callback moved zsh's cursor every time, held ← included, no lag, typed line exact. Log: 45 calls, 0 re-entries, callback max 1.87ms. |
| 2026-10-07 | 📌 | T00: picker open is ~212ms median with the 200ms cmd poll, ~100ms with an `fs.watch` on the directory. Claude redraws its box 15–40ms after a key. pir's hint is cut at 39 columns; match its prefix only. |
| 2026-10-07 | 📌 | Fake unverified against real: `spikes/fleet-picker-test/pty-drive.py`'s screen model, notably `\x1b[K` at pending wrap erasing the last column (xterm does). The T02 skip is harmless either way; T04's real-mux drill checks the 39-column `shown now`. |
| 2026-10-07 | 🐞 | Erase-to-end-of-line after a line filling the pane width wipes its last character: the picker at 39 columns drew `shown no`. T02 skips `\x1b[K` on full-width lines; the pty test fails without it. |
| 2026-10-07 | 📌 | `~/.wezterm.lua` symlinks to `main`'s `wezterm/cockpit.lua`, so pointing `config.lua` `repo` at a worktree loads its layout and daemon but not its key bindings. T06 repoints the link too. |
| 2026-10-07 | 🐞 | cockpit-test section 11 fails two `--conf` path checks in a fresh copy under `$TMPDIR` (`/var/folders` is a symlink to `/private/var`); passes in a copy under `.claude/worktrees/`. Pre-existing, not investigated. |
| 2026-10-07 | 🔄 | The person reversed pir-pane's "click only, no key" (2026-09-26): ← opens a picker, the footer click stays (DESIGN §7). |
| 2026-10-07 | 🐞 | cockpit-test section 5f (diff-mode label clicks) failed four checks in one full run on unchanged `main` 6620d81, then passed with `ONLY=5f`. Flaky, not investigated. |
| 2026-10-07 | 📌 | Lua runs here only inside WezTerm: `wezterm --config-file x.lua show-keys` evaluates a config in 45ms, `wezterm.json_parse` works, a `dofile` module loads. No `lua` binary. Reading a small file costs about 44µs. |
| 2026-10-07 | 📌 | `cockpitd` reads `cmd` by a 200ms poll (`tail()`), not a watch, so a verb waits up to 200ms before anything happens. |
| 2026-10-07 | 📌 | pir's runs list now has a box (bare is `@` or empty). Bare: hint `↑↓ move · ↵ open · …` and ← is a no-op. With text: `↵ start planning · …` and ← moves the cursor. The Ctrl+P pairing screen reports `view: list`. |
| 2026-10-07 | 📌 | Claude 2.1.291 `claude agents`: `❯ describe a task for a new session` shows exactly when the box is empty; a leading space is dropped; a lone Ctrl+J hides it. ← changes nothing on the list, row selected or not. |
| 2026-10-07 | 📌 | The pir source is not at `~/src/plan-implement-review` on this machine any more; the installed engine is `~/.claude/pir-engine`. |
