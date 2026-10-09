# T00 — claude-status-spike

**Phase:** 0 · **Depends on:** — · **Weight:** light

## Goal

The Claude half of the picker's status rests on two undocumented things: the `state` values a
background agent reports in `claude agents --json --all`, and `lastTerminalAt` in
`~/.claude/jobs/{id}/state.json` as its finish time. This throwaway spike observes both on this
machine (Claude Code 2.1.295) so T01 maps real values, not the planner's reading of the binary.
It writes its answers into FINDINGS and, where a mapping differs, a dated note in DESIGN §2.2;
its probe code is deleted.

## Design sections this implements

DESIGN §2.2 (the Claude column), §2.3 (finish time), §7 (`--all`).

## Files

- `spikes/fleet-picker-status-spike/` (scratch; deleted before the task ends, only its
  `RESULTS.md` kept)
- `plans/fleet-picker-status/FINDINGS.md`, and `DESIGN.md` §2.2/§2.3 only if a finding changes
  them (a dated line, not a rewrite)

## Questions, and what each answer means

1. What `state` does a background agent show while it waits on the person (an AskUserQuestion, a
   permission prompt)? Expected `blocked`. Another value: T01 maps that value to class wait.
2. Does `lastTerminalAt` move each time the agent finishes a turn (first finish, then a follow-up
   prompt and a second finish)? If it stays at the first finish, the hour rule reads a stale time
   and the plan goes back to the person.
3. What do a stopped agent and an exited one look like in `--all` (`state`, `pid`, `status`)? Is
   `state.json` still there for them?
4. Is `state.json` ever caught half-written (read it in a tight loop while the agent works for
   ~30s)? Either way DESIGN §3.5 holds; the answer says how often a done item might hide.
5. How long does `claude agents --json --all` take with ~15 entries (five runs)?

## Outside actions

- Dispatch a test background agent — `ask`
- Stop the test agent — `ask`
- Read this machine's Claude agents — `worker`

Dispatch with a prompt that makes the agent ask a question and nothing else, e.g. `claude --bg
"Use AskUserQuestion to ask me whether to continue, with options yes and no. Do nothing else."`
First check `claude --help` for the exact dispatch form; do not pass `--help` or other flags to
`--bg` (FINDINGS 2026-10-09). Answer it through `claude attach <id>` only if a pty driver can do
so; otherwise stop it from the blocked state and use an existing finished agent for question 2
by sending it a follow-up the same way.

## Environment (the worker owns this)

```
bring-up: the dispatch above; note the id it prints
teardown: claude stop <id>; then `claude agents --json --all` shows it stopped or gone
```

## Done when

- [ ] FINDINGS has one row per question, with the observed values.
- [ ] The test agent is stopped and the teardown check shows it.
- [ ] No spike code remains outside `spikes/fleet-picker-status-spike/RESULTS.md`.
