# T04 — picker-wiring

**Phase:** 2 · **Depends on:** T01, T02, T03 · **Weight:** heavy

## Goal

Wire the status into the running picker: draw the frame at once with `…`, fetch both programs
once in the background, turn the answers into lists with T01's model, and redraw. Keys keep
working throughout and the verb contract of `plans/fleet-picker/DESIGN.md` §2.7 is untouched. This
is the step that makes the feature reach the person; the daemon and the wrapper do not change,
because the wrapper already starts this process on every ←.

## Design sections this implements

DESIGN §2.5, §2.7 (a fetch that throws, a picker closed first), §3.4, §3.6.

## Files

- `bin/cockpit-fleet-picker.mjs`
- `spikes/fleet-picker-test/process.test.mjs`, `spikes/fleet-picker-test/pty-drive.py` (extend:
  pass an environment to the wrapper, wait for a screen line)
- `spikes/fleet-picker-test/fixtures/` (new, if useful: fake `claude`, jobs folder, runs bodies)

## Interface

```js
// in cockpit-fleet-picker.mjs
let lists = { claude: "loading", pir: "loading" };
// after the first draw:
gatherAll().then(({ claude, pir }) => {
  const now = Date.now();
  lists = {
    claude: claude.ok ? claudeItems(claude.agents, claude.finishedAt, now) : "unavailable",
    pir: pir.ok ? pirItems(pir.body, now)
       : pir.why === "down" ? { unavailable: "status unavailable · pir service not running" } : "unavailable",
  };
  if (!finished) draw();
}, () => { lists = { claude: "unavailable", pir: "unavailable" }; if (!finished) draw(); });
```

A redraw after a verb has been appended is skipped, so the screen never changes behind a choice.

## Tests

- [ ] the frame is on screen before the fake `claude` (sleeping 1s) answers: a snapshot at 0.3s
      shows `…` under both entries
- [ ] after both answer, the lists match a fixture at 59×22 and at 39×12
- [ ] Enter pressed while loading hands back the right verb exactly once, and the wrapper is alive
- [ ] fake `claude` missing from PATH → `status unavailable` under Claude, pir list still drawn
- [ ] no pir `api.json` → `status unavailable · pir service not running` (clipped at 39 columns)
- [ ] a fetch that throws (fake `claude` printing a huge output past `maxBuffer`) → unavailable,
      picker still answers keys
- [ ] every existing process test still passes, run with scratch `HOME`, `PIR_HOME` and a fake
      `claude` on PATH so none reads the real machine
- [ ] nothing drawn past the right edge in any scenario (the driver's overflow check)

## End to end (the worker drives this)

- suite: `spikes/fleet-picker-test` (pty-drive.py) · sizes: 59×22, 39×12
- [ ] ← flow stand-in: start the wrapper with the typical fixture → lists fill in, waiting first
- [ ] ↓ ↑ while loading and after → highlight moves, lists unchanged
- [ ] Esc after the lists fill → `picker-cancel`, once
- [ ] the busy fixture → `+N more` in both entries at 39×12

## Done when

- [ ] Both DESIGN test lines pass.
- [ ] The process suite reads nothing from the real `~/.claude`, `~/.pir` or `claude`.
- [ ] The end-to-end cases above are in the suite.
