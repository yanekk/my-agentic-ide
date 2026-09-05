# T04 — Pane: press feedback

**Phase C · depends on T03 · medium · built regardless of the spike**

## Goal

When a left button is pressed over a `[Review]`/`[Address]`/`[Open]` (or a tab/pager) button, flash
that button in the press style for a beat, so the click has visible confirmation before the daemon
acts. The pane already receives the press that fires the verb (DESIGN §3), so this is one extra
repaint — no new reporting mode, no dependency on the T00 spike.

## Files

- `bin/cockpit-welcome.mjs` — in the mouse handler, on a left press that hits a zone, set a transient
  emphasis and repaint; clear it after a short timer and repaint again.

## Interface / behaviour

- On the left-press (`M`, the event that already calls `onDashClick`): after appending the verb, look
  up the hit zone; if it is a button zone, set `pressEmphasis = { verb, state: "press" }`, call
  `render()` (which passes `emphasis` to `renderDashboard`), and start a ~120ms timer that clears it
  and re-renders.
- The verb still fires exactly as today — the flash is purely visual and must not change what the
  click does, when, or how many times.
- A press that hits no zone sets no emphasis.
- A fixed short flash, not press-until-release: a Review/Address press spawns an agent and the release
  may not reach this pane cleanly (DESIGN §3).
- Mouse reporting is off when an agent is attached (pane parked), so this only ever runs at the fleet
  list — no new guard.

## Done when

- Pressing a button at the fleet list flashes it in the press style, then it returns to rest.
- The click's existing effect (spawn / open / tab / page) is unchanged.
- The full test command is green (the render-side press state is a T03 unit test; the pane wiring is
  the impure part verified by hand).

## Tests

The flash timing and appearance are live-only (DESIGN §6.1), hand-verified with the user. The press
state's render is a T03 unit test. Keep the pane a thin "read the press, set emphasis, repaint, clear
on a timer" so there is nothing further to unit-test here.

## Hand-off to the user

```
Needs you — I cannot see this from here:

  Rebuild the cockpit window and, at the fleet list, click a PR's [Open] button.

Expect: the button flashes (inverts) for an instant as you click, then returns to normal;
        the PR still opens.
Tell me: does the flash show, and land on the button you clicked?
```

## Notes

Keep the wheel-exclusion filter (`!(b & 64)`) — the press handler must ignore wheel and motion bytes
exactly as `onDashClick` does, or a scroll would flash a button. Reuse the same `verbAt` lookup the
click uses.
