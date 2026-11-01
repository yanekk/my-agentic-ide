---
setup: none
test:
  - FORCE_COLOR=0 bash spikes/pir-pane-test/run.sh
  - FORCE_COLOR=0 bash spikes/fleet-picker-keys-test/run.sh
  - FORCE_COLOR=0 bash spikes/auto-name-test/run.sh
  - FORCE_COLOR=0 bash spikes/stop-notify-test/run.sh
  - FORCE_COLOR=0 bash spikes/bitbucket-test/run.sh
  - FORCE_COLOR=0 bash spikes/agenda-test/run.sh
  - FORCE_COLOR=0 bash spikes/notes-test/run.sh
  - FORCE_COLOR=0 bash spikes/daemon-leak-test/run.sh
  - FORCE_COLOR=0 bash spikes/fleet-picker-test/run.sh
  - FORCE_COLOR=0 bash spikes/usage-test/run.sh
  - FORCE_COLOR=0 bash spikes/browse-test/run.sh
  - FORCE_COLOR=0 bash spikes/cockpit-test/run.sh
  - FORCE_COLOR=0 bash spikes/calendar-jobs-test/run.sh
---

# Calendar agent wall — Design

## 1. Purpose

Agents started from a jobs calendar (`plans/calendar-agents/`) run unattended with nothing but an instruction keeping them in their worktree. The owner reversed that decision on 2026-11-01: a scheduled agent must be unable to damage the machine, read the listed secrets, reach unapproved sites, push, or use connectors. It must still never stall, and a job must still be able to do its work, so `scheduled-run` tries the job inside the wall before the entry is created.

### Success criteria

- Every calendar start carries the wall. A start that cannot be confined does not run and leaves one note.
- A real run completes a build-and-test job in its worktree, and in the same run writes outside it, secret reads and a push are refused.
- `scheduled-run` shows the owner what a job would hit, before the entry exists.
- Only the owner can add an exception, and no exception opens a listed secret or a push remote.

### Stance

The wall is enforced by the machine and applies to every run, with no per-entry opt-out. Nothing reachable from a calendar entry can loosen it, because the description is untrusted text. It is not a promise against a determined attacker: §2.8 lists what it does not cover, and those limits are published.

---

## 2. Behaviour specification

### 2.1 The mode

Runs use `--permission-mode dontAsk`, not `bypassPermissions` (owner, 2026-11-01). Measured on 2.1.316: under bypass the `sandbox.network.allowedDomains` list does not limit anything, because an unlisted domain is auto-approved (`example.com` returned 200 with only `registry.npmjs.org` listed). Under `dontAsk` an unlisted domain gets 403 from the proxy and nothing stalls. `dontAsk` refuses whatever has no allow rule, so §2.2 carries an allow list. This overrides the brief's "keep bypassPermissions", whose purpose (never stall) is kept.

### 2.2 The settings of a run

`--settings` carries, for that run only:

```
{ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
             autoAllowBashIfSandboxed: true,
             network: { allowedDomains: [...], allowLocalBinding?: true },
             filesystem: { denyRead: [...secrets], denyWrite: [...branch refs], allowWrite?: [...] } },
  permissions: { allow: ["Bash","Read","Write","Edit","NotebookEdit","Glob","Grep", ...T00's list],
                 deny: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.claude/cockpit/**)", "Read(~/.config/gh/**)", "SendMessage"] },
  hooks: { PreToolUse: [ guard on Write|Edit|NotebookEdit ] },
  env?: { cache redirects, §2.6 } }
```

Measured: a `--settings` sandbox block overrides `sandbox.enabled: false` in user settings. `WebFetch` and `WebSearch` have no allow rule, because they run outside the sandbox and a URL can carry data; measured refused. The sandbox covers shell commands only, which is why the file tools need deny rules and the guard. Reads use both `denyRead` (Bash) and `Read()` rules (Read, Grep, Glob). A `Read()` rule must start `~/` or `//`: measured, `Read(/abs/path)` silently matched nothing because one slash means relative to the settings file.

`SendMessage` is denied because user settings allow it and the other sessions it reaches have no wall (owner, 2026-11-01). A `--settings` deny overrides that allow; T00 measures it. Connectors and MCP are off through `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` (measured: no `mcp__` tools, claude.ai connectors included). `--mcp-config` and `--disallowedTools` are variadic, so another flag must follow each or they swallow the prompt; this was measured by getting it wrong, and an agent sat idle with its prompt read as deny rules.

### 2.3 Writes

Shell writes are limited by the sandbox. File-tool writes are limited by the guard (§3.3), a PreToolUse hook. Measured: the hook runs under `dontAsk` and exit 2 refuses. Paths are compared after resolving symlinks of the deepest existing parent, because an agent can make a link inside its worktree with Bash. The root is passed on the guard's command line and not read from the hook's `cwd`, because the agent can change directory. The guard fails shut: only an explicit allow exits 0, and the command form must refuse when the script or node is missing (T00 measures the form, since a hook's non-2 exit is otherwise non-blocking).

Inside the worktree, the guard also refuses `.git` and `.claude/settings*`, because those change how git or the session behaves. Measured: `dontAsk` already refuses `.claude/settings.local.json`, and Bash is denied it too; the guard's refusal is the second defence.

### 2.4 Git and branches

A linked worktree must write the main checkout's `.git`. Measured: the sandbox allows `objects` and `refs` there and refuses `hooks` and `config` by itself, so a planted hook or config is already covered. Refs being writable would let an agent move `main`. So `denyWrite` lists, per branch existing at the start, its ref file and `.lock`, plus `packed-refs` and its lock and the main `HEAD` (measured: `git update-ref refs/heads/main` then failed, and a commit on the agent's own branch still succeeded). Creating a new branch stays possible because the superfrog job needs it. Tags and unreachable objects are not protected; §2.8.

### 2.5 Network and push

Default sites: `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org` (owner, 2026-11-01). Measured: `git push` over SSH is refused at the proxy (`github.com:22`), the SSH agent socket is refused, and `gh` cannot reach `api.github.com`. GitHub stays off because the stored login could otherwise push. Claude's own connection to the API is not subject to the proxy.

### 2.6 What a job needs: caches

`npm install` failed in the wall because `~/.npm` is outside the worktree (measured). T00 settles the redirect of package caches to a temporary folder through the settings `env`. Allowing writes to the shared caches is rejected: a poisoned cache would run later outside the wall.

### 2.7 Exceptions

Per project, in `~/.claude/cockpit/jobs-wall.json` (owner, 2026-11-01). Kinds: an extra site, local ports (`allowLocalBinding`), an extra writable folder. Read at each start, so a change applies to the next run.

Only a person adds one, with `agenda wall <project> allow-site|allow-ports|allow-write ...`, guarded by `refuseIfAgent`, the same check that stops an agent marking a jobs calendar. Scheduled agents cannot read or write the file because the cockpit folder is denied. A calendar entry has no way to name one, because anything that can write to the calendar could then open the wall.

Refused at the command, and dropped again at each start in case the file was edited by hand: a wildcard covering everything, `github.com` and its subdomains, the host of any of that project's git remotes (checked at the start only, where the remote is known), a writable folder that is `/`, the home folder, inside a denied secret folder, `~/.claude`, or a project's `.git`. A dropped row writes one note per start. An `allow-*` for a project with no folder under the projects root is refused too, so a typo does not surface as an overnight block (owner, 2026-11-01); `remove` still works on one.

An unreadable list means no exceptions and one note, per start. A wall with fewer holes is the safe direction, and the run still goes ahead. A run that then hits a block reports it.

### 2.8 What it does not cover

Published in README, `docs/cockpit.md` and the skill, because a wall of unknown shape invites false confidence:

- Reads of everything else on the machine (measured: `~/.zshrc`, other repos).
- The keychain: `security find-generic-password` found `Claude Code-credentials` from inside the sandbox. T00 measures whether the secret can be read.
- Commits take effect when merged and run; the wall ends at the merge.
- Temporary folders are writable. An allowed site could receive data.
- Tags and unreachable git objects in the shared store, and any branch created after the run started: the deny list is taken once, at the start.
- Other unconfined sessions run as the owner and can edit `jobs-wall.json`.
- Results are for Claude Code 2.1.316, which updates itself. `wall-check.sh` is the recheck, run by hand.
- Apps already running that accept Apple Events: measured with Terminal not running only (T00).

### 2.9 Unhappy paths

- **Wall cannot be set up.** Before writing `starting`, the tick runs a preflight: `sandbox-exec` runs a no-op, the guard file exists, the facts of §3.4 could be gathered. A failure writes ledger state `failed` with reason `wall` and one note, no retry. The preflight exists because `--bg` returns before the session has started, so `failIfUnavailable` alone might not reach the tick (T00 measures it). `failIfUnavailable` stays as the second layer.
- **A job hits a block.** It carries on with what it can, commits that and lists the block in its final message (owner, 2026-11-01). The preamble says so, and says not to work around the wall.
- **Resume.** A session respawned or resumed by Claude must keep its wall. T00 measures it through `respawnFlags`. If it does not hold, this is a design stop that goes to the owner.
- **Until this ships.** The calendar stays on and runs stay unconfined until merge plus window reopen (owner, 2026-11-01).

### 2.10 The trial

`scheduled-run` runs the job's setup and short test in the wall before creating an entry. `cockpit-jobs.mjs --trial` makes a throwaway worktree from the project's `HEAD` (where a real `-w` starts here, through `worktree.baseRef: head` in user settings; calendar-agents FINDINGS 2026-10-31), runs `claude -p` on a small model with the settings a real start would get for that project, a time limit (default 10 minutes), and instructions to run the given commands and list what was blocked without fixing anything. It prints the final message and always removes the worktree and its branch. It writes no ledger and no note, and never reads a calendar.

`-p` is used because the skill waits for the answer. It differs from `--bg`: `-p` skips the workspace trust check, so a project `--bg` refuses is not caught by a trial; the skill checks nothing here and the failed-to-start note remains the report.

The skill shows the result and proposes exceptions; the owner can schedule regardless. It hands the exception command because it is refused to agents.

---

## 3. Architecture

### 3.1 The boundary

```
bin/cockpit-wall-model.mjs    pure. Facts as arguments; returns settings and validation.
bin/cockpit-guard-model.mjs   pure. The guard's verdict.
bin/cockpit-jobs-model.mjs    pure. buildClaudeArgs takes the settings; the preamble; note wording.
bin/cockpit-wall-store.mjs    jobs-wall.json.
bin/cockpit-jobs-guard.mjs    the hook: reads stdin, resolves paths, calls the model's verdict.
bin/cockpit-jobs.mjs          gathers facts, preflight, the tick, --once, --trial.
bin/cockpit-agenda.mjs        the `agenda wall` command.
```

The grep in `spikes/calendar-jobs-test/run.sh` covers the new pure files too. If that test fails, the fix is to move the code, never to relax the test. Every rule on the pure side is a millisecond test, and a rule that leaks across needs a real agent to check.

### 3.2 `buildWallSettings`

A function of `{ worktree, home, guardPath, commonDir, branches, remoteHosts, exceptions }`. Returns `{ settings, dropped }`. The description is not an input, which is the proof it cannot affect the wall; a test passes hostile descriptions and compares.

### 3.3 The guard

`guardVerdict({ root, resolvedPath, toolName })` is pure and returns `{ allow, reason }`. `bin/cockpit-jobs-guard.mjs --root R` reads the hook's JSON, resolves the path and exits 0 or 2. Any exception exits 2.

### 3.4 Data flow

`jobsTick` passes `wallFor(project, worktreeName)` into `decideJobs`, alongside `projectExists`, because decideJobs is what builds the argv and must stay pure. `wallFor` is the impure gatherer in `cockpit-jobs.mjs`: `git rev-parse --git-common-dir`, `git for-each-ref refs/heads`, `git remote -v`, the exceptions file. These are `execFileSync` with a short limit, because `decideJobs` is synchronous; only a pass with an entry due pays it. The worktree is `{project}/.claude/worktrees/{name}` (measured). `buildClaudeArgs` is called with the result. `cockpitd.mjs` does not change, since it already calls `jobsTick`.

### 3.5 Storage

`jobs-wall.json`, `0600`, temp-then-rename, under no lock since only the command writes and only readers race it:

```
{ version: 1, projects: { "{project}": { sites: [], localPorts: false, write: [] } } }
```

---

## 4. Testing

`spikes/calendar-jobs-test` holds the pure tests, the guard against real stdin and symlinks, the store, the tick and trial against the fake `claude`. `spikes/agenda-test` holds the command. Neither proves the real sandbox behaves; that is T00 and `wall-check.sh` (T07), which start real agents from the real argv with no calendar.

No screen changes, so there is no end-to-end rig or drill: `agenda wall` is plain command output, tested like the other `agenda` verbs.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS, Darwin 25.5; `sandbox-exec` at `/usr/bin` |
| Runtime | Node 24.2, Bash, zero npm dependencies; `rg` and `socat` present; `pip3` only, and Homebrew Python 3.15 refuses installs outside a venv |
| Claude Code | 2.1.316, self-updating. User settings: `sandbox.enabled: false`, `network.allowMachLookup: ["*"]` |
| **Deliberately absent** | `timeout` (GNU coreutils); `bwrap`. Use `perl -e 'alarm shift; exec @ARGV'` |

**The test command.** The block on top, each line from the repo root. These are the lines in `.pir/settings.json` plus `spikes/calendar-jobs-test`, which that file omits; T01 adds it there, since `pir` runs the file's lines. Measured here in a fresh worktree 2026-11-01: `calendar-jobs-test` passes (379 node checks plus 13) and leaves the tree clean. Plan review ran the whole block in a fresh copy on 2026-11-01. Quiet on pass, no colour (`FORCE_COLOR=0`), failures in full; `VERBOSE=1` on that suite prints each check.

**Dependencies.** None added.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| Adding a real exception with `agenda wall` | Refused to agents by design; the owner's own step after the merge |
| The first real night through the live daemon | The live daemon only has this code after merge and window reopen. Not owned by a task |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `COCKPIT_JOBS_DRY_RUN=1` | off | Prints decisions and argv, writes nothing, starts nothing |
| `COCKPIT_DIR` | `~/.claude/cockpit` | Tests and `wall-check.sh` use a throwaway folder |
| Fake `claude` first on `PATH` | test only | `run.sh` fails if the real binary could be reached |
| `--trial` time limit | 10 min | Kills the trial and removes its worktree |
| `perl alarm` on each probe | required | Bounds a real probe agent |

Never point a test at the real jobs calendar without the dry run. `wall-check.sh` and the trial never read a calendar at all. `wall-check.sh` includes one real trial, the only one the build runs (owner, 2026-11-01). Probe targets outside a worktree are only in a scratch folder the script created; real secrets are only ever tested for refusal, reporting success or failure and never printing content.

### 5.3 Outside the code — who acts

| Bin | Who runs it | Permission rule |
|---|---|---|
| `worker` | The worker, then says so in one line | `allow` |
| `ask` | The worker, after explaining. The permission prompt is the owner's yes | `ask` |
| `person` | The owner | none |

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| T00 probe agents, scratch, `agentic-ide` and `superfrog-re` | `bash spikes/calendar-wall-spike/run.sh` | worker | Confined, small model, own worktrees only. Includes a keychain read counted in bytes and an Apple Events probe that opens a Terminal window | `spikes/calendar-wall-spike/clean.sh` | small usage; superfrog smoke duration unmeasured | `claude agents --json` |
| Remove probe agents and commits | `bash spikes/calendar-wall-spike/clean.sh` | ask | Discards test commits for good | none once discarded; they are throwaway | none | `claude agents --json` |
| Real trial runs | `bash spikes/calendar-jobs-test/wall-check.sh` | worker | Confined, scratch `COCKPIT_DIR`, no calendar | `wall-check.sh --clean` | modest usage; superfrog smoke duration measured in T00 | `claude agents --json` |
| Remove trial agents | `bash spikes/calendar-jobs-test/wall-check.sh --clean` | ask | Discards test commits for good | none once discarded | none | `claude agents --json` |
| Install the skill and links, after the merge | `bin/install.sh` | person | `.pir/rules/on-finish.md` forbids it to the finisher; changes the running cockpit | re-run an older checkout's script | none | none |
| Turn the wall on | reopen the cockpit window | person | Rebuilds every pane | none needed | none | none |
| Add a real exception, such as superfrog's ports | `agenda wall <project> allow-...` | person | Refused to agents, §2.7 | `agenda wall <project> remove ...` | none | none |

Credentials measured 2026-11-01: `~/.ssh` (`id_ed25519`, `id_ender_ecdsa`), `~/.aws` (SSO), `~/.config/gh/hosts.yml`, keychain entry `Claude Code-credentials`; no `~/.netrc` or `~/.npmrc`. Claude is signed in. Neither `gh` nor a push is used here.

---

## 6. Recovery

To stop runs: `agenda jobs <slug> off`, or close the window. To undo the wall entirely, revert the merge and reopen the window. If a job needs something blocked: `agenda wall <project> ...`, then the next run has it. To remove a run: `claude stop {id}`, `claude rm {id}`.

---

## 7. Decisions and rationale

- **`dontAsk` over bypass** (owner, 2026-11-01), §2.1. Reverses the 2026-10-31 "bypass in a worktree, not an allow-list" and "an instruction, not a wall" in `plans/calendar-agents/DESIGN.md §2.5, §7`, which stays sealed; `/docs` is updated.
- **Package sites only, no GitHub** (owner, 2026-11-01). Cost: a dependency from GitHub fails.
- **Blocked means carry on and report** (owner, 2026-11-01). Stop-at-first could waste a night; a note would need the cockpit to read reports.
- **Calendar left on until shipped** (owner, 2026-11-01), accepting unconfined nights meanwhile.
- **Trial plus per-project exceptions** (owner, 2026-11-01), over no exceptions, exceptions in the entry (any writer of the calendar could open the wall) or asking only.
- **GitHub login file and existing branches added to the wall** (planner's proposal, owner agreed 2026-11-01): `~/.config/gh/hosts.yml` was readable, and refs were writable.
- **No messages to other sessions** (owner, 2026-11-01): an unconfined session could do what the wall refuses. A job reports through its final message.
- **Whole cockpit folder denied**, not only key files: it holds meeting titles and tokens, and nothing in a run needs it. Consequence: `note` and `agenda` fail inside a run, which agrees with the report being the final message.
- **Skill moves into the repo** at `skills/scheduled-run/`, linked by `install.sh`. It lived only in the home folder, so a change could be neither reviewed nor merged, and a worker editing the live copy would describe a wall that does not exist yet.
- **Survey.** Extended: `buildClaudeArgs`, `decideJobs`, `jobsTick`, `noteText`, `agenda`, `refuseIfAgent`, the fake `claude`, the `live-check.sh` pattern. New: guard, wall model and store, trial, `wall-check.sh`. Not used: `--restricted`, which removes Bash. `--setting-sources` is not used unless T00 shows committed project or user settings widen the wall; measured so far, a project's `settings.local.json` did not.
- No prototype: no screen.
- **T00 results, 2026-11-01** (`spikes/calendar-wall-spike/RESULTS.md`, these override the sections above where they differ):
  - **More denied** (owner). `dontAsk` leaves RemoteTrigger, ListAgents, CronCreate and PushNotification open with no rule, outside the sandbox, contradicting §2.1. `permissions.deny` adds them plus `DesignSync`, `Workflow`, `EnterWorktree`, `ExitWorktree`. Measured: a deny removes the tool.
  - **Worktree tools denied** (owner, from T00 review). EnterWorktree `path` moved a walled `--bg` agent into another worktree of the repo, where Bash then wrote. With the deny, the tool is gone and the write refused.
  - **Claude login and keychain closed** (owner), replacing the keychain row of §2.8. `denyRead` adds `~/Library/Keychains`, `~/.claude/.credentials.json`, `~/.claude.json`; `Read()` denies add the last two. Measured: keychain read 1151 bytes before, 0 after; sign-in still works.
  - **`--setting-sources user` on every start and trial**, as §7's survey anticipated: a committed project hook ran outside the sandbox. It keeps the Stop ding and `worktree.baseRef`; nothing is lost.
  - **Invalid settings stay guarded by `wall-check.sh`** (owner). A wrongly typed field silently drops the whole `--settings`, exit 0, leaving user allow rules unsandboxed. A test pins the shape; `wall-check.sh` must detect it after an update. Published in §2.8.
  - **Bare `claude --bg --resume {id}` loses the wall** (owner: publish, no redesign). Respawn and stop-then-attach keep it. Real daemon restart unmeasured, to spare live agents; accepted as such (owner, T00 review), on `respawnFlags` keeping the wall.
  - **No GPU inside the wall** (owner: accept and report). Superfrog's window tests fail `no GPU adapter`, locked or not; a job lists them as blocked. It also needs `allow-write` for `~/.cache/superfrog-re` and `~/Library/ghidra`, and no extra site or ports. Publish with §2.8.
  - **Inline `--settings`**, no file: measured under `--bg`, kept in `respawnFlags`.
  - **Hook form** `node '{guard}' --root '{root}' || exit 2`. Allow list needs nothing beyond §2.2's seven. Cache redirect `npm_config_cache`, `PIP_CACHE_DIR` under `/tmp/claude/`.

---

## 8. Explicitly out of scope

- Keeping bypass mode: §2.1.
- Loosening the wall during a run, or from an entry: §2.7.
- Watching for Claude updates automatically: nobody asked; `wall-check.sh` is the manual recheck.
- A note when a run reports a block: declined, §7.
- Confining ordinary agents or pir workers: this concerns calendar starts only.
- A full superfrog run in the checks: 70+ minutes; the first real night is the owner's first use.
