# T04 — Pane: press feedback

**Phase C · depends on T03 · medium · built regardless of the spike**

## Goal

When a left press lands on one of the two reacting targets — the primary `[Review]`/`[Address]`
button or the **open zone** (line one but the button) — flash that target in the press style for a
beat, so the click has visible confirmation before the daemon acts. **Only those two react** (user,
plan review 2026-09-06): a press on a tab or a pager arrow still fires its verb but does not flash,
because DESIGN §3 and the renderer (T03) define a press appearance only for the button and the open
zone. The pane already receives the press that fires the verb (DESIGN §3), so this is one extra
repaint — no new reporting mode, no dependency on the T00 spike.

## Files

- `bin/cockpit-welcome.mjs` — in the mouse handler, on a left press that hits a zone, set a transient
  emphasis and repaint; clear it after a short timer and repaint again.

## Interface / behaviour

- On the left-press (`M`, the event that already calls `onDashClick`): after appending the verb, look
  up the hit zone; if the verb is a **primary-button spawn verb (`bb-review`/`bb-address`) or the open
  zone's `bb-open`**, set `pressEmphasis = { verb, state: "press" }`, call `render()` (which passes
  `emphasis` to `renderDashboard`), and start a ~120ms timer that clears it and re-renders.
- The verb still fires exactly as today — the flash is purely visual and must not change what the
  click does, when, or how many times.
- A press that hits no zone, or that hits a **tab/pager** zone, sets no emphasis (the verb still
  fires; only the two reacting targets flash — DESIGN §3, T03).
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

  Rebuild the cockpit window and, at the fleet list, click a PR's title (or number) to open it,
  then separately click its [Review]/[Address] button.

Expect: the clicked target flashes (inverts) for an instant, then returns to normal; the title
        click opens the PR, the button click spawns the agent.
Tell me: (1) does the flash show, and land on what you clicked (line vs button)?
         (2) do the new two-line rows read well and stay aligned — the age, the NEW/ACTIVE/STALE
             tags, the branch → target, the changed-file count and +/- lines, and the dim hairline
             between PRs? (This is DESIGN §6.1's "rows read well" check — T04 is the first rebuild
             where the two-line renderer from T03 is seen live.)
```

## Notes

Keep the wheel-exclusion filter (`!(b & 64)`) — the press handler must ignore wheel and motion bytes
exactly as `onDashClick` does, or a scroll would flash a button. Reuse the same `verbAt` lookup the
click uses.
