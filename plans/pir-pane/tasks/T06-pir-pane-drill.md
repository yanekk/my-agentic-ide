# T06 — pir-pane-drill

**Phase:** 3 · **Depends on:** T02, T04 · **Weight:** medium

## Goal

Use the whole flow the way the person will, on a real headless wezterm mux rather than the stub:
the real layout script, the real daemon, the real strip, a fake `claude` for the fleet list, and
a stand-in pir that writes `pir-dashboard.json` on command. Judge each screen against DESIGN §2,
fix what has one right answer with a test each, and bring the person only choices with two
defensible answers.

## Design sections this implements

DESIGN §2.1–§2.11.

## Files

- `spikes/pir-pane-drill/drill.sh` and its directory (kept, as `spikes/pane-swap/` was, with a
  `RESULTS.md`)
- fixes anywhere in the files of T02–T04, each with a cockpit-test check

## Environment (the worker owns this)

```
bring-up: wezterm-mux-server with its own socket + pid file (method of spikes/pane-swap/probe.sh),
          HOME/COCKPIT_DIR/PIR_HOME pointed at a scratch dir, cockpit-layout.sh as the first pane
teardown: kill the mux server by its pid file; confirm the socket is gone and no daemon
          from the scratch dir is running
```

## Tests

- [ ] At 120×40 and 80×24: fleet list → PIR → run → worker → worker folder removed → back →
      list → Claude Agents; `get-text` of every pane matches DESIGN at each step.
- [ ] Footer segment dim at run/worker and with an agent attached; bright at both lists.
- [ ] Ten fast alternating switches at the lists leave exactly one claude pane and one pir pane,
      the bottom-row widths unchanged.
- [ ] Stand-in pir exits → relaunched at its list; the cockpit detaches.

## Done when

- [ ] `spikes/pir-pane-drill/RESULTS.md` records each step and size with what was seen.
- [ ] Every fix has a cockpit-test check; the suites pass.
- [ ] Teardown confirmed.
