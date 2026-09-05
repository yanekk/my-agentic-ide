# T00 — Spike: mouse motion to the unfocused dashboard pane

**Phase A · depends on nothing · throwaway · gates T05**

## Goal

Answer one question before hover is designed: does WezTerm deliver mouse **motion** events to the
dashboard pane while that pane is **not focused**, and is a repaint-on-hover smooth enough to use?
The dashboard pane sits in the fleet list with focus usually elsewhere, and today it only asks for
press reports (`?1000h`). Hover needs any-motion reports (`?1003h`). Clicks reach an unfocused pane;
whether motion does is unproven (DESIGN §4). This spike settles it. All code here is deleted after.

## What to build

A tiny throwaway probe (a `.mjs` under `spikes/`, or a scratch pane script) that:

1. Enables `?1003h` + `?1006h` (SGR) on its stdout, raw mode on stdin.
2. Logs every SGR mouse report it receives — button byte, `x`, `y`, `M`/`m` — to a file or the
   pane, distinguishing motion (bit 32) from press/release.
3. Optionally, on each motion whose target *cell* changed, repaints a small framed box so flicker
   can be judged by eye.

Run it in a **real cockpit-shaped pane** in the fleet list, leave focus on another pane, and move
the pointer over the probe pane without clicking.

## Done when

- It is recorded in FINDINGS whether motion events arrive at the unfocused pane, with the observed
  button bytes, and whether a repaint-on-motion is smooth or flickers.
- A recommendation for T05 is written: build hover (and if so, the throttle — repaint only when the
  hovered zone changes), or drop it (press feedback stands).
- The probe code is deleted; nothing under `bin/` references it.

## Tests

None automated — this is exactly the question the suite cannot reach (DESIGN §6.1). It is a
hands-on check verified with the user in a live pane. The seatbelt is that the probe is read-only:
it enables a reporting mode and logs; it mutates nothing and spawns nothing (DESIGN §6.2).

## Hand-off to the user

```
Needs you — I cannot see this from here:

  node <probe path>     # in a scratch cockpit pane in the fleet list

Move the mouse over that pane WITHOUT clicking it, and without focusing it
(keep focus on another pane).

Expect: lines logging mouse reports as the pointer moves.
Tell me: (1) do move lines appear at all while the pane is unfocused?
         (2) if a box repaints under the pointer, does it look smooth or flicker?
```

## Notes

`?1003h` reports every pointer move; `?1002h` reports motion only while a button is held, which is
not hover. If motion arrives but floods, the T05 throttle (repaint only on a hovered-zone change) is
the mitigation, not a reason to drop hover — say which case was observed.
