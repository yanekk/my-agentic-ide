# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message. Whoever appends compacts once this is over 60 rows or 15 KB. Never drop a ✅ row or its date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
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
