# T00 — wall-measurements

**Phase:** 0 · **Depends on:** — · **Weight:** heavy

## Goal

Answer what the design must not guess, on this machine, with real confined agents on small models. Scripts under `spikes/calendar-wall-spike/` plus a `RESULTS.md`. The probes are kept as the record (like `spikes/pty-inject/`), and nothing in `bin/` changes. Findings it produces that contradict DESIGN are raised with the owner before Phase 1.

## Design sections this implements

§2.2, §2.3, §2.4, §2.6, §2.8, §2.9.

## Files

`spikes/calendar-wall-spike/{run.sh,clean.sh,RESULTS.md}`, `plans/calendar-agent-sandbox/FINDINGS.md`.

## Measure, each with its answer in RESULTS.md

Gate column: what an answer changes.

- [ ] Resume: does `claude respawn {id}` and a daemon-restart resume keep `--settings`, mode, strict MCP? Read `respawnFlags` in `~/.claude/jobs/{id}/state.json`, and re-try an outside write and `example.com` after respawn. Lost wall: stop, owner decision.
- [ ] Sandbox unavailable: how `--bg` and `-p` behave with `failIfUnavailable` when `sandbox-exec` cannot run (a PATH without it, or the closest achievable). Whether `--bg` exits non-zero. Gates the preflight.
- [ ] Hook failing: which command form refuses when the guard is missing or node is not found (`node g.mjs … || exit 2`). Gates §2.3.
- [ ] Hook coverage: a subagent's Write outside; a Write through a symlink inside the worktree; Edit and NotebookEdit outside. The first probe was inconclusive on the subagent.
- [ ] Allow list: the minimum `permissions.allow` under `dontAsk` for Bash in the background (long command, `run_in_background`), Agent, TodoWrite, ToolSearch, Skill, LSP. A 10-minute `sleep` loop must survive.
- [ ] SendMessage: with `allow` in user settings and `deny` in `--settings`, is it refused, and is it available at all in a `--bg` run?
- [ ] Inline `--settings` JSON string works under `--bg`, or a file is needed (the probes used a file). If a file, where it lives so the agent cannot change it.
- [ ] Project settings: does a committed `.claude/settings.json` widen `allowedDomains`, `excludedCommands`, `allow`, or add a hook? If so, add `--setting-sources user` and measure the Stop ding still fires.
- [ ] Invalid settings: `claude --help` says settings failing validation are silently ignored non-interactively. Under `--bg` and `-p`, give `--settings` an unknown or wrongly typed sandbox field: does the run start with no wall, and is anything reported? A silent start goes to the owner. `wall-check.sh` must catch it after an update.
- [ ] User settings: does `sandbox.network.allowMachLookup: ["*"]` carry into a run, and is it what makes the keychain and Apple Events reachable? Do its `permissions.allow` rules (`Bash(git ...)`, `Bash(aws ...)`) carry in? If dropping user settings is the answer, `--setting-sources` also loses `worktree.baseRef: head` and the Stop ding: measure and tell the owner.
- [ ] Keychain: `security find-generic-password -s 'Claude Code-credentials' -w | wc -c` inside the wall. Byte count only, never the content. If readable, propose a block or keep it published; tell the owner.
- [ ] Apple Events with Terminal running: `osascript` `do script` touching a scratch file. Previously measured only with Terminal not running. Close the window it opens.
- [ ] Caches: `env` in settings reaching Bash; `npm_config_cache` and `PIP_CACHE_DIR` pointing at the sandbox's temp folder; `npm install is-odd` and `pip install six` in a fresh venv both complete.
- [ ] Branches: `denyWrite` per ref with 25 branches in `superfrog-re`, with some refs only packed; agent creates and commits on a new branch; fetch or gc does not break it.
- [ ] Superfrog: in a confined `superfrog-re` worktree, its `setup` lines and `tools/smoke.sh`. Record time, and every block, including `allowLocalBinding` and whether it reads disks from the main checkout. An extra site need goes to the owner.
- [ ] Allow-write exception: `sandbox.filesystem.allowWrite` with a scratch folder works alongside the denies.

## Outside actions

- probe agents — `worker`
- remove probe agents — `ask`

## Done when

- [ ] Every item has a measured answer in `RESULTS.md`, with version `claude --version`.
- [ ] Anything contradicting DESIGN is raised with the owner and its decision recorded in DESIGN §7.
- [ ] `clean.sh` has removed every probe agent, worktree and branch; `git worktree list` shows none.
