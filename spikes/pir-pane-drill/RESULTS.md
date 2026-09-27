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

A `pkill` shim is on the drill's `PATH`: the layout script's `pkill -f cockpitd.mjs`
would otherwise kill the live cockpit's daemon (and every other worktree's).

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
