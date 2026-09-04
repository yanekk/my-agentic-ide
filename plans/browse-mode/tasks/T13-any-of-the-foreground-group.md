# T13 — A half is running if *any* of its foreground group is

**Phase:** 3 · **Depends on:** T08 (whose fix this completes) · **Weight:** light

## Goal

broot's own launch command appears **in broot's filter box**, intermittently, when the user
presses Enter on a file. Reported and reproduced 2026-09-04, during T11's hands-on half.

It is the 1s healer relaunching a browser that never quit. `diffPaneStatus` asks
`foregroundComm` which program is in front of the browser's tty and gets the answer **`node`**,
because the Enter verb's `cockpit-open` is running at that instant — so a live broot reads as a
quit shell and `healBrowseHalves` types `cd <worktree> && broot --conf … --listen …` into it.
broot draws no frame and titles itself `cd` (T08), so nothing overrules that one signal.

**This pre-dates T11.** Pressing Enter has always spawned `cockpit-open`; T11's focus move adds
one more `wezterm` spawn to the window and so widens it, which is plausibly why it became
noticeable, but the flaw is T08's and the fix belongs beside T08's.

## What was measured

A real broot under `script(1)`, with the Enter verb's external command replaced by a recorder
that asks `ps -t` about its **own** tty — the exact instant in question:

```
SNs+ broot
SN+  /bin/sh
RN+  ps        <- foregroundComm returns this one, and stops
```

All three carry `+`. broot spawns the verb's command **in its own process group** rather than a
new one, so broot and its child are in the foreground group *together*. That is what makes this
different from a shell running a job, where the job gets a new process group and the shell drops
out of the foreground — the case `foregroundComm`'s "last one wins" rule was written for, and is
still right for.

## Why the fix is the predicate, not a suppression window

T08 asked the right question of the OS and then read the answer too narrowly: **which** process
is in front, when what the healer needs to know is **whether any** of them is `broot`, `micro` or
`revdiff`. A pane with broot in its foreground group has broot in it. Nothing else needs to
change, and no new state is introduced.

The alternative — a `pushInFlight` guard like `customPromptOpen`, suppressing the healer while a
push runs — was considered and is **worse**: `cockpit-open` is a separate process the daemon
never hears about, so the guard would need a marker file written and removed around every push,
with a stale-marker rule for a killed pusher. That is three new failure modes to close a window
that the predicate closes exactly, by being true.

## Design sections this implements

DESIGN §2.n — the "healthy browse pane" row and the title row beneath it. Both say the foreground
process is the signal that is always true; neither says which of them to read. The row gains
that: **any of the group**, and why (broot keeps its child in its own process group).

## Files

```
bin/cockpitd.mjs             foregroundComms (new), foregroundComm expressed in terms of it,
                             diffPaneStatus's last-resort test
spikes/cockpit-test/run.sh   new section beside 11b', using the existing $PSFG stub
```

## Interface

```
foregroundComms(paneId, table) -> string[]     every foreground-group command, bare names
foregroundComm (paneId, table) -> string|null  the LAST of them, unchanged
```

One `ps` parser, not two: `foregroundComm` becomes the last element of `foregroundComms` so the
`-zsh` / `/bin/zsh` basename reduction and the "no tty, no `ps`, nothing in front" null are
written once. Its behaviour must not change — `terminalIsIdle` reads it, and there "is the thing
in front the login shell" is the right question: a terminal running a job has the *job* in the
foreground group and the shell out of it, so last-wins and any-of already agree there. **Leave
`terminalIsIdle` on `foregroundComm`** rather than migrating it; changing two callers to fix one
is how the next defect gets built.

`diffPaneStatus`'s last resort becomes:

| Signal | Verdict |
|---|---|
| *(unchanged above this line)* | |
| **any of the foreground group is `broot`, `micro` or `revdiff`** | `running` |
| anything else, including an unknown answer | `shell` |

T08's two properties are preserved and must stay true: `ps` is still consulted only after the
cheap signals fail, and an unknown answer is still `shell`, because a spurious relaunch of a
genuinely dead half is invisible where a refusal to heal a dead one is a bare prompt forever.

## Tests

`spikes/cockpit-test/run.sh`, beside 11b'. The `$PSFG` stub already answers `ps` per tty, so the
case is a stub answer holding **two** foreground lines with the child last — exactly the reading
above.

- [ ] a browse pair mid-push (`ps` answers `broot` **then** `node`, both foreground) is left
      alone: **nothing typed into either half**, and specifically not broot's launch command
- [ ] asserted as status-log counts that did **not** move, not as `running` appearing — the log
      is written once per change, so a healthy pair writes nothing (T08's own warning; a naive
      `check` passes on an earlier section's line)
- [ ] the same for the viewer half: `micro` then a child
- [ ] a half that really is a shell still heals — `ps` answering `zsh` alone, and `zsh` with a
      child, neither of which holds a program name
- [ ] an unknown answer (`ps` fails, no tty) is still `shell` and still heals
- [ ] `terminalIsIdle` is unchanged: a terminal whose foreground is a job is not idle, one whose
      foreground is the login shell is
- [ ] **proven to fail against the current predicate** — the new case must go red on
      `foregroundComm`'s last-wins rule and green on any-of. This is the whole task; a test that
      passes both ways has asserted nothing

## Done when

- [ ] `spikes/cockpit-test/run.sh` and `spikes/browse-test/run.sh` green, twice, at low load
- [ ] DESIGN §2.n says *any of the foreground group*, and why
- [ ] the FINDINGS row of 2026-09-04 is marked fixed, with the section that now defends it
- [ ] **hands-on with the user, because the reproduction was theirs and the race is timing:**
      press Enter on a dozen files in a row. Does broot's command line ever appear in the filter
      box again? The cockpit must be repointed at this worktree first — PROGRESS, top.
