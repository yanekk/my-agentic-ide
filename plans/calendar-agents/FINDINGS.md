# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message. Whoever appends compacts once this is over 60 rows or 15 KB. Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-31 | 🐞 | T04 review sweep, not fixed: `bin/cockpitd.mjs:2451` `execFileAsync("claude", ["agents", "--json"])` has a SIGTERM-only limit, so a child ignoring SIGTERM never settles. |
| 2026-10-31 | 🐞 | T04 review sweep, not fixed: `bin/cockpitd.mjs:3780` `execFileAsync("wezterm", get-text)` has the same SIGTERM-only limit. |
| 2026-10-31 | 📌 | T04 review: real start line measured in a session transcript: `backgrounded · cdb302ae · superfrog-re / cal spike`, matching fake-claude. macOS `mktemp -d` with no template ignores `TMPDIR`. |
| 2026-10-31 | 📌 | T04, for T05: `jobsTick` never rejects; it logs `jobs: tick failed`. Plant a failure by making `calendar-jobs.json` a directory. Its dry run prints argv only through a `print` argument, since daemon stdout is `daemon.log`. |
| 2026-10-31 | 📌 | T04: `live-check.sh` keeps only the test calendar in its scratch copy. A real jobs calendar kept there would run its entries twice, against a ledger that has never seen them. |
| 2026-10-31 | 📌 | T02 review, for T04: a NUL byte in a description makes `execFile` throw `ERR_INVALID_ARG_VALUE` synchronously, measured. T04's tick must catch it after writing `starting`, and record `failed`. |
| 2026-10-31 | 📌 | T02 review: in `plainText` a bare `<a>` or `<b>` in plain-text instructions is still dropped; it cannot be told from HTML. `sort <a >b` now survives. |
| 2026-10-31 | 📌 | T02: per DESIGN §2.2 `plainText` drops links, so `<a href="u">text</a>` gives the agent only `text` and loses a URL whose label differs. Google's autolinks are unaffected. Left as designed. |
| 2026-10-31 | 🔄 | `-w` starts at `origin/main` by default: `2140433c`, 2077 commits behind, no suite. Owner chose `worktree.baseRef: head` in `~/.claude/settings.json` for every agent; the rerun started at `63726e85`. Delete the key to undo. |
| 2026-10-31 | 📌 | Nothing writes that setting: `bin/install.sh` does not, and no task covers it. On another machine calendar agents would start at `origin/main`. |
| 2026-10-31 | 📌 | T00: real suite ran to its end, exit 0, 4508s (75m08s) on `63726e85`, setup 6s. Agent reported pass, summary line and duration. Clean worktree. |
| 2026-10-31 | 📌 | T00: foreground Bash hit its 600s limit and moved to the background; the agent ended its turn at 10 minutes, a task notification woke it 65 minutes later, and it reported. |
| 2026-10-31 | 📌 | §2.5 long-command wording confirmed by T00: "Run long commands in the background with the longest time limit allowed and do not end your turn until they have finished." The agent's parked turn did no harm. |
| 2026-10-31 | 📌 | `claude agents --json` showed `busy`/`working` on all 71 polls, parked turn included, then `idle`/`done`, listed without `--all`. An agent reporting it ran nothing ended `idle`/`blocked`, so `blocked` can mean a finished report. |
| 2026-10-31 | 📌 | Guards seen in T00: a worktree session refused a compound git command ("too complex to verify"); the auto-mode classifier refused `start.sh` inside a compound command and allowed it alone. |
| 2026-10-31 | 🐞 | T01 review: two more cockpit-test races. A healthy pir poll past the 2 s limit broke exact `usage: pir service` counts; section 13 cleared `GHITS` after `makestale`. Both reproduced and fixed; two full `ALL PASS`. |
| 2026-10-31 | 🐞 | Section 15 flake was section 12b's Bedrock setting in a run-wide file, plus a poll miscount. After the fix `ONLY=12b,15` passed 22 of 22; two full runs printed `ALL PASS` (934). Before: 6 of 8 failed. |
| 2026-10-31 | 🔄 | Owner decided: a calendar another slug holds as jobs is refused by `add --jobs` and `jobs on`, since the ledger keys on slug. A refused `add --jobs` keeps a new sign-in, despite the T03 doc's "nothing is written". |
| 2026-10-31 | 📌 | `spikes/agenda-test` now has more checks than the `CLAUDE.md` count (637); not changed in T03. |
| 2026-10-31 | 📌 | Plan review session had no Google Calendar tools after the owner authenticated the connector mid-session. Whether a later worker gets them is unmeasured; T06 checks first. |
| 2026-10-31 | 🐞 | `spikes/cockpit-test` section 15 failed 2 of 4 fresh-copy runs at plan review: `5h 97%`, `7d 77%` absent from the footer. Passed twice with 934 checks. Pre-existing on `main`; cause not found. |
| 2026-10-31 | 📌 | `superfrog-re` `HEAD` is `63726e85`, `origin/main` is `2140433c`, and untracked `engine/` sits in the checkout. T00 records which a `-w` worktree starts from. |
| 2026-10-31 | 📌 | `claude rm --help` documents `--discard-unpushed`: removal also stops at unpushed commits, read from help, not yet run. T06 measures it. |
| 2026-10-31 | 📌 | `claude rm` refuses a session whose worktree has uncommitted changes and keeps it; the branch `worktree-{name}` goes with a clean removal. Claude 2.1.316. |
| 2026-10-31 | 📌 | An environment variable set on `claude --bg` read back `<unset>` inside the session. Nothing here may mark an agent by environment; `PIR_RUN`-style silencing would not work. |
| 2026-10-31 | 📌 | `claude --bg` in an untrusted folder exits 1: `Workspace not trusted. Run claude in {dir} once…`. Trust is per folder and a parent's does not carry. `superfrog-re`, `agentic-ide` are trusted. |
| 2026-10-31 | 📌 | Probe: `claude --bg -n … --permission-mode bypassPermissions -w … --disallowedTools AskUserQuestion` from stdin-less shell ran unprompted in its worktree, removed the question tool, ended `status idle, state done`, listed without `--all`. |
| 2026-10-31 | 🔄 | A task silencing the Stop-hook ding for these agents was proposed and removed by the user. They ding like any session. |
| 2026-10-31 | 📌 | `panes.repo` is the projects root (`~/src`), not a repo. It keys the fleet list's notes and is the root project names resolve under. |
