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
- The real-machine check is not a task. It needs the merged code and pir's service installed, so
  it is the checklist in § After the merge; T06 builds its script and proves it on the stand-in.

No spike: the machine claim the design rests on (`fetch`'s timeout and refusal behaviour) was
probed at plan time and is in FINDINGS. No rig and no drill: no surface is built or changed.

```
Phase 1  ▸  T01, T02        the rule and the reader     no daemon involved
Phase 2  ▸  T03, T04, T05   daemon, installer, docs     stand-in service only
Phase 3  ▸  T06             the live-check script       stand-in service only
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

## Phase 3 — The live-check script

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-live-check-script.md) | live-check-script | T02, T03 |

At the end: `bash spikes/usage-test/live-check.sh` gives a verdict against a stand-in service.

## After the merge

Not a task (person, 2026-09-30, plan review): a pir build merges only when every task is done,
and the check needs the merged code in the main checkout. It waits on this plan merged to `main`
and on pir's `plans/api-service` built, merged and `./install.sh` run in
`~/src/plan-implement-review`. A session runs it with the person; bins are DESIGN §5.3.

1. `pir service` prints `running at`. `bash spikes/usage-test/live-check.sh` prints `agree`. On
   `no reading`, start a pir run on the subscription and repeat.
2. Person: close and reopen the cockpit window (this closes every agent terminal and revdiff),
   with a pir run working. Glance at the bar, bottom right: numbers in colour, no `as of`.
3. `bash spikes/usage-test/live-check.sh follow`, with the pir run still working: `agree` and
   `moved` at least 2.
4. With the person's yes: `grep -c 'usage: pir service' ~/.claude/cockpit/daemon.log`, `pir
   service off`, wait 70 s, the count rose by 1; `pir service on`, wait 35 s, the count rose by
   1 again and the last line ends in `ok`. Run `pir service on` even if a check failed, and
   finish on `pir service` printing `running at`.
5. FINDINGS gets a ✅ row dated with the person's answer to step 2, the machine result stated
   separately, and the outstanding line leaves PROGRESS.

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

T04 runs beside T03. T06 follows T03 and runs beside T05.

Leaves: T05 and T06. T05 is terminal because documents are consumed by later sessions, not by a
task. T06 is terminal because its script is consumed by § After the merge, not by a task.

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

None. The contract is copied from pir's plan as reviewed (3e2f4bd). If pir's build changes its
DESIGN §2.1, DESIGN §2.1 here and T01/T02 change with it.
