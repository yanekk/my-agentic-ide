# Prompt: stop the test suites leaking cockpitd

Run from this checkout: `pir plan "$(sed -n '/^---8<---$/,/^--->8---$/p' docs/pir-prompts/test-daemon-leaks.md | sed '1d;$d')"`, or paste the block into `/pir-plan`. Plan this **before** `test-suite-speed.md`: both edit `spikes/cockpit-test/run.sh`, and a faster suite that still leaks just leaks faster. Do not start building while a pir run that edits `spikes/cockpit-test/run.sh` is still open (pir-pane was, 2026-09-27).

---8<---
Stop the agentic-ide test suites leaving `bin/cockpitd.mjs` processes running after they finish, and make a future leak fail the suite instead of silently accumulating.

What was found (2026-09-27, during the pir-pane parallel run): 22 orphaned cockpitd processes, every one reparented to launchd (ppid 1), with HOME and COCKPIT_DIR under a deleted `mktemp -d` folder. All of them came from `spikes/cockpit-test/run.sh`'s two agenda sections, `agenda2/` and `agenda3/`: two per suite run, some over 10 hours old. Each polls on its own timers (agenda2 at COCKPIT_AGENDA_TICK_MS=400), so with parallel pir workers each running the suite several times, the leak added measurable load (load average ~7 before the cleanup, ~4.4 after) and slowed every later run.

Root cause, already diagnosed in the suite's own comment at the `stopbb()` helper (~line 2420): a daemon launched as `envfn node ... > log &` binds `$!` to the wrapping subshell, not to node, so `kill $D2PID` / `kill $D3PID` (and the EXIT trap's `kill $DPID $D2PID $D3PID $GPID`) kill the subshell and orphan node. The later dashboard sections already use `stopbb` (kill `pgrep -P` children, then the pid); the agenda sections and the EXIT traps never adopted it. The main daemon (`DPID`) may be affected the same way at exit; check every launch site, not just the two known ones.

Wanted, in three layers:
1. Fix every stop and every EXIT trap in `spikes/cockpit-test/run.sh` so it kills node, not only its wrapper. Audit the other suites under `spikes/*-test/` for the same pattern (agenda-test, notes-test, bitbucket-test, pir-pane-test, browse-test).
2. A backstop in the daemon so a future forgotten stop cannot leak for ever. The candidate: cockpitd exits on its own when its COCKPIT_DIR has disappeared (every suite's EXIT trap deletes `$T`), checked on an existing tick, not on a new timer. It must never fire for the real cockpit (`~/.claude/cockpit`, which is never deleted) and must not exit on a transient read error. Weigh alternatives (exit when reparented to pid 1, which would be wrong for the real daemon if its launching layout shell ever exits, or a test-only env flag) and pick one with a stated reason.
3. A tripwire: at the end of each suite, fail with a clear message if any cockpitd whose environment points at that run's `$T` is still alive after the suite's own stops. So a new section that forgets `stopbb` fails the day it is written.

Constraints: the real cockpit's daemon (HOME = the real home, launched by `bin/cockpit-layout.sh`) must be untouched by any cleanup, match or kill; match test daemons by their `$T` path, never by script name alone (the suite already warns that name matching can kill the real footer). The suites must still print `ALL PASS (N checks)` / fail non-zero as today. Record the rule in CLAUDE.md's measured-facts table only if it earns a row.

Check: run `bash spikes/cockpit-test/run.sh` (and each other suite) and afterwards `pgrep -fl bin/cockpitd.mjs` shows only the real cockpit's daemon; also kill a suite mid-run with Ctrl-C and check the same.
--->8---
