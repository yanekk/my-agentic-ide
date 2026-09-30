# Implementation plan

6 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- The rule is built and proven before anything touches a socket. T01 is pure and tested with
  plain values; T02 adds the world-touching half against a stand-in server.
- The daemon is wired last among the code tasks, so `cockpitd.mjs` gains a few lines that call
  something already proven.
- The live check is the final task and waits on another repo. Everything before it is provable
  now.

No spike: the two machine claims the design rests on (Node's `Host` header, `fetch` timeout and
refusal behaviour) were probed at plan time and are in FINDINGS. No rig and no drill: no surface
is built or changed.

```
Phase 1  ▸  T01, T02        the rule and the reader     no daemon involved
Phase 2  ▸  T03, T04, T05   daemon, installer, docs     stand-in service only
Phase 3  ▸  T06             live check                  needs pir's service installed
```

---

## Phase 1 — The rule and the reader

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-pir-reading-decision.md) | pir-reading-decision | — |
| [T02](tasks/T02-pir-usage-reader.md) | pir-usage-reader | T01 |

At the end: `node bin/cockpit-usage-pir.mjs --once` turns a stand-in service's answer into a
correct `usage-cache.json`, and every failure state is proven.

## Phase 2 — Daemon, installer, docs

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-daemon-poll.md) | daemon-poll | T01, T02 |
| [T04](tasks/T04-install-report.md) | install-report | T02 |
| [T05](tasks/T05-docs.md) | docs | T03, T04 |

At the end: a cockpit daemon keeps the cache fresh from a stand-in service, the installer reports
the service, and the project's documents say so.

## Phase 3 — Live

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-live-check.md) | live-check | T03, T04 |

T06 also waits on the other repo: pir's `plans/api-service` reviewed, built, merged and
`./install.sh` run in `~/src/plan-implement-review`, after which `pir service` prints
`running at http://127.0.0.1:47717`. Until then T06 is ⛔.

---

## Main path, builder and wirer

| Step | Built by | Wired by |
|---|---|---|
| Find the service (`api.json`, pid) | T01 (parse), T02 (read, pid) | T03 (`cockpitd.mjs` tick) |
| GET with a limit | T02 | T03 |
| Newest-wins decision | T01 | T02 (`pollPirUsage`) |
| Write the cache | existing `writeCache` | T02 |
| Footer redraws | existing strip watch | nothing to wire; T03 tests it |
| Log on change of state | T03 | T03 |
| Installer line | T02 (`--status`) | T04 (`bin/install.sh`) |

## Critical path

```
T01 → T02 → T03 → T05
```

T04 runs beside T03. T06 follows T03 and T04.

Leaves: T06, the final deliverable, and T05. T05 is terminal because documents are consumed by
later sessions, not by a task; T06 does not read them.

## Parallel width

6 tasks · longest dependency chain 4 · up to 2 could run at once.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | — |
| **Medium** | T02, T03 |
| **Light** | T01, T04, T05, T06 |

T03 is where an overrun would come from: the cockpit-test chain needs its own daemon, stand-in
server and timing, and that suite's timing is sensitive under load.

## Decisions still open

- T06's person half needs the new daemon code running in the live cockpit. Under a parallel pir
  run that code reaches the main checkout only at the merge, so the task may have to stay open
  across it. pir-pane T07 had the same shape. The plan review should confirm how the person
  wants that handled. It does not block T01 to T05.
- The §5.3 bins are a proposal until the plan review.
- The contract is copied from a pir plan that is not yet reviewed. If its review changes §2.1
  there, DESIGN §2.1 here and T01/T02 change with it.
