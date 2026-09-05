# T04 — Pane: hover highlight

**Phase C · depends on T00, T02 · medium · GATED — may not be built**

## Goal

While the pointer rests over a button, draw that button in the hover style so the target is
unmistakable. **This task is conditional on T00's outcome and the user's call** (DESIGN §4): build
it only if the spike showed WezTerm delivers motion to the unfocused pane and a repaint-on-hover is
acceptable. If not, this task becomes a one-line record in FINDINGS that hover was dropped, the press
feedback (T03) standing as the button reaction, and the plan proceeds to T05.

## Precondition

Do not start until T00 is done and the user has chosen. If the choice is "no hover", write the
FINDINGS line, mark the task done-as-not-built in PROGRESS, and stop.

## Files (if built)

- `bin/cockpit-welcome.mjs` — enable `?1003h` motion reporting alongside the press reporting; track
  the hovered zone; repaint on a hovered-zone change.

## Interface / behaviour (if built)

- Enable `?1003h` (any-motion) in `enableMouse`, added to the existing `?1000h ?1006h`; disable it
  in `bye` alongside the others.
- On a motion report, map `(x, y)` to a zone with `verbAt`. Track the current hovered verb. **Repaint
  only when the hovered verb changes** (including to none), never per pixel — this is the throttle
  the spike's flood finding requires (DESIGN §4). Set `hoverEmphasis = { verb, state:"hover" }` (or
  null) and re-render.
- Press emphasis (T03) wins over hover while a flash is active, so a click still reads as a press.
- Pointer leaving the pane / a null zone clears the hover.
- Parked-pane behaviour unchanged: mouse reporting is off when an agent is attached, so hover only
  runs at the fleet list.

## Done when (if built)

- Moving the pointer over a button highlights it; moving off clears it; no flicker in normal use.
- The dashboard's other reactions (click to spawn/open, tab, page, T03 press) are unchanged.
- The full test command is green (the hover render state is a T02 unit test; the wiring is
  hand-verified).

## Tests

Live-only (DESIGN §6.1), hand-verified with the user. The hover render state is a T02 unit test; the
motion wiring and the no-flicker throttle are the impure part a person checks.

## Hand-off to the user (if built)

```
Needs you — I cannot see this from here:

  Rebuild the cockpit window and, at the fleet list, move the mouse over a PR's buttons
  WITHOUT clicking.

Expect: each button highlights as the pointer is over it, and un-highlights as it leaves,
        with no flicker of the rest of the pane.
Tell me: does the highlight track the pointer cleanly?
```

## Notes

`?1003h` reporting is scoped to this pane's terminal, so it does not disturb text selection or
scrolling elsewhere. If the spike found motion delivered but flickery even with the zone-change
throttle, bring that to the user before building — the floor (press-only) is already accepted.
