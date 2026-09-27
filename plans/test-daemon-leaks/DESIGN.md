---
setup: none
test:
  - [ ! -e spikes/daemon-leak-test/run.sh ] || bash spikes/daemon-leak-test/run.sh
  - bash spikes/cockpit-test/run.sh
  - bash spikes/agenda-test/run.sh
  - bash spikes/notes-test/run.sh
  - bash spikes/bitbucket-test/run.sh
  - bash spikes/browse-test/run.sh
  - bash spikes/usage-test/run.sh
  - bash spikes/auto-name-test/run.sh
  - bash spikes/stop-notify-test/run.sh
  - [ ! -e spikes/pir-pane-test/run.sh ] || bash spikes/pir-pane-test/run.sh
---

# Test suites that leave no daemon behind — Design

## 1. Purpose

`spikes/cockpit-test/run.sh` starts up to six `bin/cockpitd.mjs` daemons against scratch state
folders, and some of its stops kill only a bash wrapper, so node survives, reparented to launchd,
polling for ever. On 2026-09-27 22 of them had accumulated from the pir-pane parallel run (two per
suite run, all from the `agenda2/` and `agenda3/` sections, some over ten hours old) and pushed the
load average from ~4.4 to ~7, slowing every later run. This plan stops the leak, gives the daemon a
backstop so a future leak cannot run for ever, and makes a leak fail the suite the day it is
written.

### Success criteria

- After any suite finishes, passing or failing, `pgrep -fl bin/cockpitd.mjs` lists only daemons
  that existed before it started (the real cockpit's, and those of other runs still in progress).
- The same holds when the suite is interrupted by Ctrl-C (SIGINT to its process group), stopped
  (SIGTERM to its shell only), or force-killed (SIGKILL to its shell only), the last within a few
  daemon ticks rather than at once.
- A suite section that starts a daemon and forgets to stop it makes that suite fail with a message
  naming the leaked pid and its state folder.
- The real cockpit's daemon keeps the same pid across every suite run and every check above.

### Stance

Test daemons are recognised by the scratch folder in their environment, never by script name,
because the real daemon runs the same script and a name match is how a test kills the real
cockpit's footer (the comment at the footer-click cleanup in cockpit-test already records this).

---

## 2. Behaviour specification

### 2.1 Why the leak happens

Measured 2026-09-27 on bash 5.3.9: `VAR=x node … > log &` binds `$!` to node, because bash execs a
simple command in place in the background subshell. `envfn node … > log &`, where `envfn` is a
shell function, binds `$!` to a bash subshell with node as its child; `kill $!` ends the subshell
and node is reparented to pid 1. The main daemon (`DPID`, line ~335) uses the first shape and is
stopped correctly. D2–D6 use the second. The dashboard sections stop theirs with `stopbb` (kill
`pgrep -P` children, then the pid); the agenda sections (`kill $D2PID`, `kill $D3PID`) and all
three EXIT traps do not.

### 2.2 Stopping a daemon (layer 1)

Every stop of a test daemon goes through one helper, `daemon_stop <pid>`, which signals the pid's
children and the pid itself with SIGTERM and waits (bounded, ~2s) until both are gone, then
SIGKILLs any survivor. It replaces `stopbb` and every plain `kill $DnPID`. One helper for every
launch shape is chosen over fixing the launch shape (for example `exec` inside the env functions)
because the stop is the one place a future launch site cannot forget: the launch is written fresh
each time, the stop is called. Waiting for death matters because the dashboard sections already
found that a daemon still dying out-ticks the next one (`sleep 0.5` after `stopbb`).

### 2.3 The exit sweep (layer 1)

Each suite that starts daemons has exactly one EXIT trap. It stops the pids it knows with
`daemon_stop`, then calls `daemon_sweep "$T"`, which finds every process whose command contains
`cockpitd.mjs` and whose environment names a path under this run's `$T/`, stops it the same way,
and only then removes `$T`. The sweep exists because the trap's pid list is edited by hand in
three places today and a new section can forget to add its pid; matching by `$T` needs no list.
`$T` comes from `mktemp -d` and is unique per run, so a sweep cannot touch another run's daemons or
the real cockpit's, whose environment names the real home. The trap is replaced, never appended to
with a second `trap … EXIT`, because bash keeps only the last one.

### 2.4 The owner backstop (layer 2)

cockpitd reads an optional environment variable, `COCKPIT_OWNER_PID`. When it is a positive
integer, the daemon checks on its existing reconcile interval (`POLL_MS`, no new timer) whether
that process still exists, with `process.kill(pid, 0)`. `ESRCH` counts as a miss; two consecutive
misses log `owner <pid> gone, exiting` and run the normal `shutdown()`. `EPERM` means the process
exists under another user and counts as alive. Any other value of the variable (empty, `0`,
non-numeric) is logged once at start and ignored, so a malformed seam can never stop a daemon.
Unset, nothing changes, which is how the real daemon runs: `bin/cockpit-layout.sh` never sets it.

Every cockpitd a suite starts sets `COCKPIT_OWNER_PID="$$"`, the suite shell's pid (`$$` is the
script's pid inside subshells and functions too). This is the only layer that covers a suite
force-killed with SIGKILL: no trap runs, `$T` is left behind and every daemon survives (measured
2026-09-27). Two misses, not one, because every other liveness rule in this daemon requires two
(a single bad read must not end a process), and the cost is one extra tick.

A reused pid keeps an orphaned daemon alive until that unrelated process exits. That is accepted:
macOS pid reuse within a test run's lifetime is rare, and the sweep and tripwire cover every path
where the suite shell survives long enough to act.

### 2.5 The tripwire (layer 3)

At the end of each suite, after its own stops and before it prints its result line, it calls
`daemon_tripwire "$T"`. It waits briefly (up to ~2s, for daemons already told to stop) and then
lists every process the sweep would match. If any remain it prints, per process,
`LEAK cockpitd pid <pid> still running, env names <path>` plus one line saying a section forgot
`daemon_stop`, counts it as a failure, and the suite prints `FAILURES` and exits non-zero as it
does for any other failed check. It does not kill them; the EXIT sweep does that afterwards, so a
leak fails the run once and still leaves nothing behind. It runs in every `spikes/*-test/run.sh`,
including the suites that start no daemon today, so a daemon added to one of them later is caught
the day it is written.

### 2.6 Where the helpers live

`spikes/lib/test-daemons.sh`, sourced (never run) by each suite, holding `daemon_stop`,
`daemon_sweep` and `daemon_tripwire`. One file, because three copies of a process-matching rule
drift, and the match rule is the one part that must never be loosened.

### 2.7 Matching a process by its environment

`ps -E -ww -ax -o pid=,command=` prints each same-user process's command followed by its initial
environment (macOS; measured 2026-09-27). A process matches when its line contains `cockpitd.mjs`
and `=$T/` (the trailing slash stops `tmp.abc` matching `tmp.abcd`). The suite's own shell and its
ancestors are excluded by pid. `pgrep -f` alone is not enough: the command line of every cockpitd,
test or real, is `node <checkout>/bin/cockpitd.mjs`.

### 2.8 The unhappy paths

- Ctrl-C in a terminal delivers SIGINT to the whole foreground group; every node already dies
  (measured). The trap still runs and the sweep finds nothing.
- SIGTERM to the suite shell only (a timeout, a stopped worker): the trap runs; before this plan
  the wrapped daemons survived it (measured, 2 of 3), after it the sweep stops them.
- SIGKILL to the suite shell only: no trap; the owner backstop ends each daemon within about two
  reconcile ticks. `$T` is left in the temp folder, which the OS cleans; not this plan's concern.
- A daemon that ignores SIGTERM for 2s is SIGKILLed by `daemon_stop`, and the tripwire reports it
  only if it is still alive after that.
- `ps -E` failing or printing nothing makes the sweep a no-op and the tripwire pass, which is the
  safe direction for the real daemon; `daemon-leak-test` asserts that `ps -E` does see a known
  scratch daemon, so a broken `ps` fails that suite instead of silently disarming the others.

---

## 3. Architecture

### 3.1 The boundary

The project's pure side is the `*-model.mjs` modules; this plan adds nothing to it. The backstop is
a few lines of world-touching code in `bin/cockpitd.mjs` (it signals a pid) and is proven by
running the real daemon in `spikes/daemon-leak-test`, not by a unit test. The helpers are shell and
proven the same way.

### 3.2 Modules

- `spikes/lib/test-daemons.sh` (new): `daemon_stop`, `daemon_sweep`, `daemon_tripwire`.
- `spikes/daemon-leak-test/run.sh` (new): proves the helpers and the backstop against fake and real
  daemons, including the three interrupt paths.
- `bin/cockpitd.mjs`: reads `COCKPIT_OWNER_PID`, checks it on the reconcile interval.
- `spikes/cockpit-test/run.sh`: every stop, the one EXIT trap, the tripwire, the owner variable on
  all six launches.
- the other seven `spikes/*-test/run.sh`: source the helpers, trap with the sweep, call the
  tripwire.

---

## 4. Testing

`spikes/daemon-leak-test` is the proof of the mechanism: fake daemons (a node script at
`$T/bin/cockpitd.mjs`, so the name matches without running the real thing) for the helpers, and the
real `bin/cockpitd.mjs` with a stubbed PATH for the backstop. The existing suites prove the adoption
by passing and leaving nothing behind. The end check (T05) runs every suite and every interrupt path
and compares the real daemon's pid before and after.

No test can prove the real cockpit is never matched on every machine; the rule that guarantees it is
the `=$T/` match in §2.7, and `daemon-leak-test` checks a scratch daemon under a different folder
survives every sweep as the stand-in.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5), `ps -E` is BSD `ps` |
| Runtime | node v24.2.0, GNU bash 5.3.9 |
| Dependencies | none: no `package.json`, suites are bash plus plain node |
| Deliberately absent | Linux `/proc/<pid>/environ`; the cockpit is macOS-only, so the match uses `ps -E` |

**The test command.** The `test` lines at the top of this file, one suite each; the two guarded
lines skip suites that do not exist yet. It is the only evidence a session may produce on its own.
Each suite prints `ALL PASS (N checks)` or `FAILURES` and exits non-zero on failure; a waiter must
look for both sentinels, never for a phrase only a failure prints.

**Quiet, colour and failure.** Output volume is the `test-suite-speed` plan's concern and is left as
it is. `FORCE_COLOR=3` is set in this environment; the suites use no colour library, so it has no
effect, and `daemon-leak-test` prints plain text.

**Dependencies.** None may be added. This is shell and a few lines of node.

**Do not build while another open run edits `spikes/cockpit-test/run.sh`** (pir-pane was on
2026-09-27). Two parallel edits to that 2900-line file conflict on the lines T02 and T03 touch.

### 5.1 What the test command cannot reach

Nothing. Every check, including the interrupt paths and the real daemon's pid, is a machine check a
worker runs.

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Match on `cockpitd.mjs` and `=$T/` together | No sweep, stop or tripwire can reach the real daemon or another run's |
| No `pkill -f cockpitd` anywhere under `spikes/` | A fence check in `daemon-leak-test` greps for it and fails |
| `COCKPIT_OWNER_PID` never in `bin/` launch code or `wezterm/` | A fence check greps `bin/cockpit-layout.sh` and `wezterm/cockpit.lua`; the real daemon cannot get the backstop |
| Record the real daemon's pid before any interrupt check | T05 compares it after; a change fails the task |

Never kill a cockpitd by name to clean up after a check. Use the `$T` match, or the pid you started.

---

## 6. Decisions and rationale

- **Owner pid over a vanished folder or reparenting (user, 2026-09-27).** Once the exit sweep
  exists, the only leak left is a force-killed suite, which leaves `$T` behind, so a
  folder-gone backstop would never fire for it. Exiting when reparented to pid 1 would stop the
  real daemon if the layout shell that launched it ever exited. The owner variable is test-only and
  the real launch never sets it.
- **Extend `stopbb` into `daemon_stop`, not add a second helper.** It already does the right kill;
  it lacks the wait and a home outside one suite.
- **Tripwire in every suite, not only cockpit-test.** Seven suites start no daemon today; one line
  each is cheaper than finding the first leak in one of them by load average.
- **Tripwire reports, the sweep kills.** Killing in the tripwire would make the leak invisible on the
  next run; reporting without the sweep would leave the leak running.
- **No CLAUDE.md measured-facts row by default.** The table is capped at thirty rows and the rule is
  enforced by the tripwire, which is the better record. T05 adds one only if a finding during the
  build shows a session would re-break it despite the tripwire.

---

## 7. Explicitly out of scope

- `bin/cockpit-layout.sh`'s `pkill -f "cockpitd.mjs"` kills every test daemon of every running
  suite and pir worktree when the cockpit is rebuilt. It is the reverse direction (real kills test)
  and only fails a suite in flight; logged in FINDINGS, not fixed here.
- The footer-click cleanup's `pkill -f "$CLICKER"` in cockpit-test matches a scratch path already
  and leaves no daemon; it is not a cockpitd and not in the tripwire.
- Suite speed and output volume: `docs/pir-prompts/test-suite-speed.md`, planned after this one.
- Removing leaked `$T` folders after a SIGKILL: the OS temp cleaner owns them.
