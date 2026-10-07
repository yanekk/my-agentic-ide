# T06 — live-check

**Phase:** 3 · **Depends on:** T04, T05 · **Weight:** light

## Goal

The one thing no rig reaches: ← pressed on a real keyboard in the live cockpit window, through
WezTerm's key table, opening the picker exactly when DESIGN §2.1 says and passing through
everywhere else.

## Design sections this implements

DESIGN §2.1, §2.2, §5.1.

## Environment (the worker owns this)

The live window runs `main`'s checkout, so a branch is checked by pointing
`~/.claude/cockpit/config.lua`'s `repo` at the task worktree and reopening the window, then
restoring `repo` afterwards (pir-pane FINDINGS 2026-09-27). The worker edits and restores
`config.lua` and confirms the restore; reopening the window is the person's, since it closes every
agent terminal.

## Outside actions

- Point `config.lua` `repo` at the task worktree, and restore it — `worker`
- Rebuilding the live window and trying the key — `person`

## Automated checks (the worker runs these)

```
bash spikes/fleet-picker-keys-test/run.sh && bash spikes/fleet-picker-test/run.sh && bash spikes/pir-pane-test/run.sh && bash spikes/cockpit-test/run.sh
```

## Needs a person

```
reopen WezTerm (after the worker has pointed config.lua at the worktree)
```

Expect: at the fleet list with the Claude box empty, ← shows SWITCH PROGRAM with PIR highlighted;
→ shows pir; ← on pir's empty runs list shows the picker again; Enter on Claude Agents brings
claude back as it was. With text in either box, ← moves the cursor. ← in a terminal, in revdiff,
and inside an agent behaves as always.
Tell me: did each of those happen, and did ← anywhere feel slower than before?

## Done when

- [ ] The person's answer is in FINDINGS.md with the date (✅ only for what they saw).
- [ ] `config.lua` is restored and the restore confirmed.
