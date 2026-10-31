# T04 — daemon-wiring

**Phase:** 2 · **Depends on:** T02, T03 · **Weight:** medium

## Goal

Make the running cockpit do this: fetch jobs calendars with the extra fields and the wider window, tick the starter, and recover at start. Without this every other task ships inert. Also document the feature.

## Design sections this implements

DESIGN §2.7, §3.4.

## Files

`bin/cockpitd.mjs`, `spikes/cockpit-test/run.sh`, `CLAUDE.md`, `docs/cockpit.md`, `README.md`.

## Interface

In `refreshAgenda`: `timeMin` is `todayStart - 7 days` for a `cal.jobs` calendar, and `normaliseEvent` receives `jobs: !!cal.jobs`.

```js
const JOBS_TICK_MS = Number(process.env.COCKPIT_JOBS_TICK_MS) || 30_000;
recoverStarting(...)            // once at daemon start, before the first tick
setInterval(() => jobsTick({ now: Date.now(), projectsRoot: panes.repo,
  notesRepo: panes.repo, zone: AGENDA_TZ, log }), JOBS_TICK_MS);
```

The tick's promise is never awaited on the reconcile path and any rejection is caught and logged, so a jobs failure cannot take the daemon down or stall the fleet poll.

## Tests

In `spikes/cockpit-test`, with the fake `claude` on `PATH` and a stubbed agenda origin:

- [ ] A due entry on a jobs calendar in the cache starts one agent within a tick, with `claude agents` parked and with an agent attached: no pane is typed into.
- [ ] Restarting the daemon does not start it again.
- [ ] A leftover `starting` becomes a note at daemon start.
- [ ] A non-jobs calendar's fetch keeps its `timeMin` and event shape; no job calendar means no `calendar-jobs.json` written.
- [ ] A throwing tick is logged and the daemon keeps running.

## Done when

- [ ] All lines of the DESIGN test block pass, the cockpit suite still printing `ALL PASS`.
- [ ] `CLAUDE.md`'s file map, state list and intro paragraph, `docs/cockpit.md` and `README.md` describe the feature, including that the window must stay open and that agents run with bypass permissions.
- [ ] `CLAUDE.md`'s measured table gains no row unless one is retired, per its own thirty-row rule.
