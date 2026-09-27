# Implementation plan

5 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

**Start condition.** Do not start T02 or T03 while another open run edits
`spikes/cockpit-test/run.sh` (pir-pane was, 2026-09-27). T01 and T04 touch other files and may start.

---

## Shape of the build

The helpers and their proof come first, in a suite of their own, so the matching rule that must
never reach the real daemon is proven against fakes before any real suite depends on it. The known
leak is then fixed in the one suite that has it, and the daemon backstop comes after, because it is
the only layer that changes product code and the only one that covers a force-killed suite. The
final task runs everything and every interrupt path on this machine.

No spike: the load-bearing facts (what `$!` binds to, what each interrupt leaves behind, `ps -E`
matching, `kill(pid, 0)` codes) were measured at plan time and are in DESIGN §2.

```
Phase 1  ▸  T01              helpers + their suite
Phase 2  ▸  T02, T04         adopt: cockpit-test, then the other seven
Phase 3  ▸  T03              the owner backstop in cockpitd
Phase 4  ▸  T05              everything, every interrupt, the real pid
```

## Phase 1 — The helpers

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-test-daemons-lib.md) | test-daemons-lib | — |

At the end, `daemon_stop`, `daemon_sweep` and `daemon_tripwire` exist and are proven; nothing uses them.

## Phase 2 — Adopt

| # | Task | Depends on |
|---|---|---|
| [T02](tasks/T02-cockpit-test-adopt.md) | cockpit-test-adopt | T01 |
| [T04](tasks/T04-other-suites-tripwire.md) | other-suites-tripwire | T01 |

At the end, the known leak is gone and every suite fails on a leftover daemon.

## Phase 3 — Backstop

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-owner-backstop.md) | owner-backstop | T01, T02 |

T02 is a dependency because both edit the launch lines of `cockpit-test/run.sh`. At the end, a
force-killed suite's daemons end themselves.

## Phase 4 — The check

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-leak-free-check.md) | leak-free-check | T03, T04 |

---

## Critical path

```
T01 → T02 → T03 → T05
```

T04 is off it and can run beside T02 or T03.

Leaves: T05 only.

## Parallel width

5 tasks · longest dependency chain 4 · up to 2 could run at once (T02 and T04, or T03 and T04).
Serial by nature.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Medium** | T01, T03 |
| **Light** | T02, T04, T05 |

T03 is where it may overrun: running the real cockpitd outside cockpit-test needs a minimal PATH
stub, and the SIGKILL check depends on the reconcile interval firing under that stub.

## Decisions still open

None.
