# Prompt for the pir-side plan

Run this in `~/src/plan-implement-review` (for example `pir plan "$(sed -n '/^---8<---$/,/^--->8---$/p' plans/pir-pane/PIR-PROMPT.md | sed '1d;$d')"` from the agentic-ide checkout, or paste the block into `/pir-plan`). It is the contract of agentic-ide `plans/pir-pane/DESIGN.md §2.4`; if that section changes, change this too.

---8<---
Make the `pir` dashboard (bare `pir`) publish what the person has open, so another program can follow it. This is for the agentic-ide cockpit (~/src/agentic-ide), which shows the pir dashboard in a WezTerm pane and points its diff viewer, file browser and terminals at whatever run or worker is open, the way it already does for `claude agents`. Today nothing outside pir's screen can tell what is open, and the headers name no path.

The behaviour is opt-in: when the environment variable `PIR_DASHBOARD_STATE` holds an absolute file path, the dashboard keeps that file current. When it is unset, pir writes nothing and nothing changes. `pir plan` and `pir start` are unaffected.

The file, version 1:

{
  "version": 1,
  "pid": <the dashboard's pid>,
  "view": "list" | "run" | "worker",
  "run": null | { "key": "{repo}__{slug}", "kind": "plan" | "work", "slug": "...", "repo": "...", "repoPath": "/abs", "branch": "pir/...", "cwd": "/abs/path" | null },
  "worker": null | { "id": "<worker uuid>", "task": "T03", "role": "implement" | "review", "cwd": "/abs/path" | null },
  "updatedAt": "<ISO timestamp>"
}

- view is "list" on the runs list, "run" in one run's watch view, "worker" in one worker's conversation view. run is set in "run" and "worker"; worker only in "worker".
- run.cwd is the absolute path of the run's shared worktree: for a build `{main worktree}/.claude/worktrees/pir-{slug}`; for a planning run its planning worktree (`pir-{runId}`, or `pir-{slug}` after the rename). null when that folder does not exist yet.
- worker.cwd is the worktree the worker was spawned in (what workers.json records as its cwd), kept after the worker finishes so a read-only conversation still names its folder. null if unknown.
- Write it on start (view "list"), on every change of view, open run or open worker, and when a path in it changes (a planning worktree renamed). Not on cursor movement within a list: the reader moves terminal panes on every write.
- Write atomically: a temp file in the same directory, then rename. Remove the file on a clean exit; a crash may leave it behind, which is why pid is there.
- A write failure must never disturb the dashboard: log it at most once and carry on.
- The pure part (turning the dashboard's UI state plus run records into this object) belongs on pir's pure side with tests; the write is shell.

Out of scope: any other change to the dashboard's screen, keys or behaviour; a general status command.

Check on the machine: run `PIR_DASHBOARD_STATE=/tmp/x.json pir`, open a run, open a worker, go back, quit, and watch the file change at each step and disappear on quit.
--->8---
