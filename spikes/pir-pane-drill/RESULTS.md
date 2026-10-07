# pir-pane drill — results

`bash spikes/pir-pane-drill/drill.sh` (pir-pane T06), run 2026-09-27 on wezterm
20240203-110809-5046fc22, revdiff v1.12.0, Node v24.2.0. Final run: **DRILL PASS (184
checks)**, 92 per size, teardown confirmed (mux gone by pid file and config path, no
scratch daemon left).

## What is real and what is a stand-in

Real: a private `wezterm-mux-server` (own socket, pid file and config) whose first pane
is `bin/cockpit-layout.sh`, so the layout, `cockpitd.mjs`, the strip, the footer, the
welcome pane, `cockpit-pir.sh` and revdiff all run for real. `HOME`, `COCKPIT_DIR` and
`PIR_HOME` sit in a scratch dir; `PATH` leaves out `~/.local/bin`, so the real `claude`
and `pir` cannot be reached.

Stand-ins: a fake `claude` (a fleet list with the list marker; `a` attaches "alpha agent",
`l` goes back; `agents --json` lists it) and a fake `pir` that writes
`pir-dashboard.json` in the d4f2e7e shape on each line typed into its pane (`list`, `run`,
`worker`, `again`, `quit` removes the file and exits 0, `crash` exits 3 leaving it). A
usage reading is seeded, as the person's personal sessions leave one.

A `pkill` shim is on the drill's `PATH`: the layout script kills `cockpitd.mjs` by name
(`pkill -f`) and would otherwise kill the live cockpit's daemon (and every other worktree's).

Scratch repo: `main`; a run worktree `pir-demo` (branch `pir/demo`, one commit
`planwork.txt`); `main` moves on after the fork (`mainlater.txt`); a worker worktree
`pir-demo-T02` off `pir/demo` with an uncommitted `tasktwo.txt`; an agent worktree
`alpha` with an uncommitted `alphaedit.txt`.

## Geometry

| Size | fleet slot | terminal | strip | diff |
|---|---|---|---|---|
| 120×40 | 59×22 | 47 | 12 | 120×15 |
| 80×24 | 39×12 | 31 | 8 | 80×9 |

Identical at every step below, both sizes, including after the ten fast switches, the
pir crash and the clean quit; the footer pane stayed in the cockpit tab throughout.

## Steps, as seen (both sizes unless noted)

1. **Fleet list, claude shown.** Slot holds the claude pane at its list; top pane is the
   welcome pane (BITBUCKET, and NOTES at 120); terminal at the repo; footer
   `Claude Agents | PIR` leftmost with Claude Agents in bright reverse video.
2. **Agent attached.** revdiff on `alphaedit.txt`, terminal at `alpha`, the shown label
   dim reverse. `fleet-pir` refused (`refusing fleet-pir: claude is not at its list`).
   Back to the list: welcome, bright.
3. **PIR.** The pir pane is spawned into the slot at the slot's exact size, claude parked
   in its own tab; stand-in shows `view: list`; state file written; PIR bright; welcome
   and the repo terminal unchanged.
4. **Run.** revdiff on `planwork.txt` only (not `mainlater.txt`: fork point, not main's
   tip); footer `Custom: <fork sha>`, dim; `reviewable: false`; terminal at `pir-demo`;
   `custom-refs.json` not written; `fleet-claude` refused.
5. **Worker.** revdiff on `tasktwo.txt`, `Uncommitted Changes` active, terminal at
   `pir-demo-T02`, dim.
6. **Worker folder removed, pir writes nothing.** Before the fix: revdiff sat on
   `error loading files: … chdir … no such file` and the terminal on the deleted folder,
   until pir next wrote. After: within ~1s the run is shown (diff and terminal), and the
   same report written again keeps it (DESIGN 2.5 fallback).
7. **Back to the run, then the list.** Run unchanged; list: welcome, repo terminal, PIR
   bright, `reviewable: true`.
8. **Claude Agents.** Claude back in the slot at its list; pir parked, not killed.
9. **Ten alternating verbs 100ms apart.** Exactly one claude pane and one pir pane in the
   whole mux, geometry unchanged. Before the fix only 5–6 of the 10 switched and one run
   ended on pir after a last Claude click; after, all 10 switch and it ends on claude.
10. **pir exits with a run open.** `crash`: the cockpit detaches to the welcome pane,
    `cockpit-pir.sh` relaunches pir in the same pane at its list, a new pid writes the
    file, PIR bright. `quit` (file removed): the same, terminal back at the repo.

## Footer, as drawn

At 120 before the fix the tightest trim level measured 133 columns; the one-row pane
showed only the wrapped tail (`0% ↺Fri 01:23`), so the switch and diff labels were not
visible. After (the person's choice: shorten usage, then cut):

```
120, list:   Claude Agents  | PIR     Uncommitted Changes  | Last Commit | Custom | Browse                 5h 42% / 1d 10% / 7d 30%
120, run:    Claude Agents |  PIR     Uncommitted Changes | Last Commit |  Custom: e89097d  | Browse        5h 42% / 1d 10% / 7d 30%
80, list:    Claude Agents  | PIR     Uncommitted Changes  | Last Commit | Custom | Browse
80, run:     Claude Agents |  PIR     Uncommitted Changes | Last Commit |  Custom: dfe5f77
```

The `O send→claude` hint is trimmed away at both widths by the existing order, so the
drill judges `reviewable` in `terminals.json` rather than the hint.

## Fixes made, each with a cockpit-test section

| Found | Fix | Test |
|---|---|---|
| Footer wraps at 120 and hides the switch | a sixth trim level (usage without reset times), then cut at the edge; switch-only | 12c, the 140/120/80/100 checks |
| Shown worker's folder removed, no pir write: revdiff on a chdir error | the reconcile poll, idle under pir, re-reads pir's report when the attached pir folder is gone | 16i2; 16k rewritten (the shown run now detaches when its folder goes) |
| Two footer verbs read in one tick: the second dropped as "already shown" | `switchFleet` compares against the shown program only under the lock | 15k2 |

## Not covered here

The real mouse click on the footer and the real pir: T07, with the person. Without a
usage reading the footer never trims (usage-limits rule) and wraps below ~190 columns,
hiding the switch; logged in FINDINGS, not changed.

## The rig check (T07)

`bash spikes/pir-pane-drill/rig-check.sh`, run 2026-09-27 against the installed pir
(`~/.local/bin/pir` → `~/.claude/pir-engine`): **RIG CHECK PASS (47 checks)**, teardown
confirmed. The real pir runs in a private headless mux pane with scratch `HOME`/`PIR_HOME`
and `PIR_DASHBOARD_STATE=$SCRATCH/x.json`; the run is pir's conversation rig (fake
`claude`). The rig's repo is `git init`ed and given `.claude/worktrees/pir-rig` so
`run.cwd` resolves to a path, not null.

Keys: Enter opens the run, → its worker, ← twice back, Esc quits. At each step the file
matched DESIGN §2.4: `version 1`, the dashboard's live pid, `run` = `rigrepo__rig`, `work`,
`rig`, `pir/rig`, repoPath and cwd absolute; `worker` = T01, `implement`, cwd the rig repo.
After Esc pir exited 0, the file was gone, no temp file was left, and the pid was dead.

Do not pipe the script into `head`: SIGPIPE kills it before its teardown and strands the
rig and the mux.

## The picker phase (fleet-picker T04)

`bash spikes/pir-pane-drill/drill.sh`, run 2026-10-07 on wezterm 20240203-110809-5046fc22,
Node v26.7.0: **DRILL PASS (364 checks)**, steps 1–10 as above plus steps 11–20 below at
both sizes, teardown confirmed. Two consecutive full passes after the last change.
`DRILL_PICKER_ONLY=1` brings the cockpit up and runs only step 1 and the picker steps.

`send-text` bypasses the GUI's key table, so the drill appends `picker` to the scratch `cmd`
as the ← binding would once `decide()` says open, then types the picker's keys into its real
pty. One cached PR is seeded in `bitbucket-cache.json` (BitBucket unconfigured, so the
daemon never fetches over it) for the `bb-review` step.

Geometry held at every picker step (59×22 / 39×12 slot, terminal and strip untouched) except
step 16, which resizes the slot on purpose and checks it comes back.

11. **`picker` over claude**, with `draft words` typed in claude's box first: the picker
    pane takes the slot at its exact size, claude parked; SWITCH PROGRAM, `▸ PIR`,
    `Claude Agents … shown now` (whole at 39 columns, the T02 erase-at-wrap case on a real
    mux), hint on the last row; footer switch dim; `terminals.json` `switchable: false`,
    `picker: null`.
12. **Keys**: ↓ moves `▸` to Claude Agents, ↑ in SS3 form (`\x1bOA`) back; ←, `x` nothing.
13. **→ on PIR**: pir in the slot at its size, picker pane gone, PIR bright, armed over pir.
    `picker` again: `▸ Claude Agents`, `PIR … shown now`.
14. **Enter on Claude Agents**: the same claude pane id back, at its list, `draft words`
    still in its box.
15. **Esc, Ctrl+C** over claude, Esc over pir: the shown program back, same pane, nothing
    switched, no second verb.
16. **Slot resized under the open picker** (`adjust-pane-size --pane-id <picker>`, the
    picker holding focus): to 41 columns at 120 (rule redrawn at 38), to 45 at 80 (rule 40),
    then back; every line within the width each time. Below 39 columns the hint clips by
    design (DESIGN §2.3's smallest slot is 39).
17. **⌥t with focus on the terminal**: a second terminal opens beside the picker, which stays
    open in the slot; ⌥w closes it, picker still open.
18. **`bb-review` with the picker open**: picker closed onto claude (same pane), the spawn
    typed into claude, and — after the fix below — no verb from the closed picker.
19. **Agent attached**: `picker` disarmed, the verb refused (`refusing picker: alpha111 is
    attached`), nothing opens; armed again back at the list.
20. **Five open/close rounds** (four → and one Esc): one claude pane, one pir pane, no
    picker left anywhere, pane count unchanged, both original pane ids.

### Fix made

| Found | Fix | Test |
|---|---|---|
| `bb-review` with the picker open: `fleet-pir` appeared in `cmd` ~10ms after the spawn. WezTerm closing a pane whose program is still running writes `\n` + Ctrl+D into it (reproduced on a bare mux, only when the pane is not focused); the picker read the `\n` as Enter. Refused in the drill because claude had left its list; a race in general. | `cockpit-fleet-picker.mjs` ignores any read carrying Ctrl+D; SIGHUP follows and the wrapper's `picker-cancel` is logged as ignored | fleet-picker-test `pane-closing bytes` (fails without the fix); drill step 18 |

### Drill-only changes

Waits for checks that read a screen just after a pane move (steps 1, 6, 8, 9 of the pir
phase each failed once in five runs, then passed on the next; the snapshot taken a moment
later always showed the expected state). The stand-in claude's list is redrawn before the
draft is typed: it echoes at its cursor, which a park can leave mid-marker.
