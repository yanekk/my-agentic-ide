# Watching `claude agents` (FleetView) from an IDE

**Goal:** have the IDE switch to the right folder (usually a git worktree) when you
enter an agent in the `claude agents` view, and switch back when you return to the list.

**Verified against:** Claude Code `2.1.240` (build `d235569e`, 2026-08-22T05:07:39Z), macOS.
Everything below except the hook registry is **undocumented internal behaviour** and can
change between releases. Findings were confirmed by reading the shipped binary's string
table *and* by live observation on 2026-08-22/23.

---

## TL;DR

There is **no hook** for entering/leaving an agent. But the fleet client already logs the
job id on every attach, so:

```sh
claude agents --debug-file ~/.claude/fleet.log      # 1. launch with a debug log
./fleet-focus.py ~/.claude/fleet.log                # 2. tail it
```

emits, per navigation:

```json
{"event":"enter","jobId":"b76b8397","cwd":"/Users/me/src/skaut/.claude/worktrees/show-text-speaker","cwdSource":"session","name":"op_show_text y argument"}
{"event":"exit","attachMs":2020}
```

Switch the IDE folder on `enter` using `cwd`; restore on `exit`.

---

## 1. There is no attach/detach hook

The complete hook-event registry in 2.1.240 is:

```
PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification,
UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure,
SubagentStart, SubagentStop, PreCompact, PostCompact, PermissionRequest,
PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation,
ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded,
CwdChanged, FileChanged, DirectoryAdded, MessageDisplay
```

Every one is a session/agent lifecycle or tool event. There is no view/navigation event at
all, because switching panes in FleetView is a pure TUI attach: it does not start, stop or
resume the underlying agent, so no lifecycle hook has anything to fire on.

Nearest misses, and why they do not substitute:

| Event | Why it does not work |
|---|---|
| `SessionStart` | Fires once when a session begins. Its `source` enum is `startup \| resume \| clear \| compact \| fork` — no fleet/attach value. Only a *cold* attach (which respawns the worker) triggers it. |
| `SessionEnd` | Reasons are `clear \| resume \| logout \| prompt_input_exit \| other`. Returning to the list is not an end. |
| `SubagentStart` / `SubagentStop` | These are for Task-tool subagents *inside* a session, not the agents listed in FleetView. |
| `CwdChanged` | Genuinely useful, but for a different moment — see §5. |

---

## 2. Signal A — the debug log (recommended)

The fleet client calls `logForDebugging` on both edges of an attach:

```js
w(`[FV-attach] respawnJob ${job.id}: ok=${…} alive=${…} err=${…}`)   // enter
w(`[FV-attach] attachJob returned after ${…}ms — remounting list`)    // exit
```

`--debug-file <path>` implicitly enables debug mode and writes to a **file** rather than
stderr, so it does not corrupt the TUI. (Default location without the flag is
`~/.claude/debug/<sessionId>.txt`; `CLAUDE_CODE_DEBUG_LOGS_DIR` overrides the directory.)

Real captured output:

```
2026-08-23T05:50:51.194Z [DEBUG] [FV-attach] respawnJob dcabc40f: ok=false alive=true err=Session dcabc40f is already running
2026-08-23T05:50:51.195Z [DEBUG] [PERF:bg-attach-start]
2026-08-23T05:50:53.214Z [DEBUG] [PERF:bg-attach-end]
2026-08-23T05:50:53.214Z [DEBUG] [FV-attach] attachJob returned after 2020ms — remounting list
2026-08-23T05:50:53.215Z [DEBUG] [PERF:bg-remount-start]
```

### Gotcha: `ok=false` is the normal case

A **warm** attach logs `ok=false alive=true err=Session … is already running`. That is not
an error — the agent was already up, so there was nothing to respawn. **Never gate the
parser on `ok=true`**, or you will miss essentially every attach. Take the job id off
`respawnJob (\S+?):` and ignore the rest of the line.

### Optional precision

`[PERF:bg-attach-start]` fires ~1ms after the `respawnJob` line and `[PERF:bg-remount-start]`
~1ms after the return line, so those bracket the attached window slightly more tightly. Only
`[FV-attach]` carries the job id, so keep it as the trigger.

### Volume

78 lines total for a whole fleet session including one attach. Rotate anyway; the file is
appended across restarts. `-d [filter]` takes a category filter that would likely narrow it
to the FV lines, but the matching rule was not decoded — test before relying on it.

---

## 3. Signal B — the attach beacon (fallback, no identity)

If you cannot control how `claude agents` is launched, there is a flag-free signal:

```
~/.claude/daemon/attach-journal/<gestureId>.json
```

* **file appears** → an agent was opened from the list
* **file disappears** → back in the list

Created at the FleetView open gesture; deleted on the line where `attachJob` returns and
the list remounts. Measured latency from the record's own `startedAtEpochMs` to the file
being visible: **96ms and 44ms** (polling at 150ms, so those are upper bounds).

### What the record contains

Written at gesture start (always present):

| field | meaning |
|---|---|
| `gestureId` | `/^[A-Za-z0-9-]{1,64}$/`, a UUID in practice; correlates with `tengu_bg_attach_*` telemetry |
| `surface` | `"fleet"` (from `claude agents`) or `"bg_cli"` (attach from the CLI) — filter on this |
| `startedAtEpochMs` | gesture start; parser rejects values >60s in the future |
| `attempt` | starts at `0`, bumped per respawn/retry within the same gesture (observed as `1` on disk) |
| `pid` | the **attaching client's** pid (your `claude agents` process), *not* the agent |
| `procStart` | that pid's start time, used to detect pid reuse |

Filled in as the attach progresses (optional): `via` (`cold \| spare \| adopted`),
`attachCold`, `daemonBooted`, `marksExpected`, `interactiveReached`, `attachMs`,
`msgsLoaded`, `msgsInJsonl`, `msgsRenderedAtFirstPaint`.

Example:

```json
{"gestureId":"d14f007d-8559-4f70-a122-0c4043840301","surface":"fleet",
 "startedAtEpochMs":1787426025543,"attempt":1,"pid":84084,
 "procStart":"Sat Aug 22 07:44:22 2026","marksExpected":false,
 "attachCold":false,"via":"spare"}
```

### Critical limitation

**The beacon records nothing that identifies the target** — no job id, session id, cwd,
agent name or worktree. Confirmed by observation, not just by reading: during a controlled
exit/re-enter experiment `roster.json` never moved, and the only session-file writes lagged
the beacon by 2.6–4.8s and carried the agent's own idle/busy transitions (activity, not
attach). Use the beacon for *edges only*; use §2 when you need to know *which* agent.

Every attach also gets a **fresh `gestureId`**, so consecutive attaches of the same agent
cannot be correlated by id.

### Lifecycle

It is a crash beacon for attach telemetry, not a navigation log. Normal deletion is at
detach; it survives only if the client dies mid-attach. On the next run a reconcile pass
sweeps the directory: a beacon whose pid is dead (or whose `procStart` no longer matches,
i.e. pid reuse) **and** is ≥15 min old is claimed — renamed to `<file>.<pid>.claimed`, then
unlinked — and reported as a synthetic `tengu_bg_attach_outcome` with `journal_recovered:true`.
Unparseable files are removed after 24h. Because `.claimed` files can appear transiently,
glob for `*.json` specifically. File mode `0600`, dir `0700`, read capped at 8192 bytes.

---

## 4. Resolving job id → worktree path

`~/.claude/sessions/<pid>.json` is the source of truth:

```json
{"pid":5084,"sessionId":"b76b8397-…","cwd":"/Users/me/src/skaut/.claude/worktrees/show-text-speaker",
 "jobId":"b76b8397","name":"op_show_text y argument","status":"idle","kind":"bg", …}
```

Three traps, all found the hard way:

1. **Do not use `roster.json` for the path.** It records the *launch* cwd. For the very
   agent above it reports `cwd=/Users/me/src/skaut` — the repo root, not the worktree.
   The session file tracks the agent's *live* cwd and is correct.
2. **`isolation` is not the signal.** That agent shows `dispatch.isolation:"none"` despite
   sitting in a worktree, because it was not *launched* with worktree isolation — it entered
   the worktree mid-session. Do not branch on this field.
3. **Pids are not stable.** Session files are named by pid, and agents respawn (one session
   was observed moving from pid 62645 to 89922 overnight). Match on `jobId` and, if several
   files share one, prefer the highest `updatedAt`.

---

## 5. Complement: `CwdChanged`

Because the recorded cwd is live rather than launch-time, an agent can move into a worktree
*while you are already attached to it*. `CwdChanged` is a real, supported hook that fires
with `{old_cwd, new_cwd}` (plus the standard `session_id`, `cwd`, `agent_id` fields). Use it
to keep the IDE in sync after the initial attach-time lookup.

---

## 6. Dead ends (documented so they are not re-tried)

* **Socket peer matching** — `lsof` on the fleet client resolves only to the daemon
  supervisor; the PTY is proxied, so the worker is not reachable this way.
* **`.fleetview-heartbeat`** — a single global file in `~/.claude/sessions/` meaning "a fleet
  view is open", touched every ~5s. Not per-agent.
* **OSC escape sequences** — no OSC 7 (cwd) emission. A terminal title is set, but is not
  reliably readable from the VS Code extension API.
* **`roster.json` as a focus source** — has no attached/focused flag, and was never rewritten
  during attach in observation.

---

## 7. Wiring it up

1. Launch the fleet view as `claude agents --debug-file ~/.claude/fleet.log`.
2. Have the extension spawn `fleet-focus.py ~/.claude/fleet.log` and read its stdout
   line-by-line as JSON.
3. On `enter`, switch the workspace folder to `cwd` (ignore or flag events where
   `cwdSource` is `roster-launch` — that is the approximate fallback).
4. On `exit`, restore the base folder.
5. Optionally register a `CwdChanged` hook to follow mid-session worktree moves.

Consider filing a feature request upstream for a first-class `AgentAttach`/`AgentDetach`
hook carrying the job id, which would make all of the above unnecessary.
