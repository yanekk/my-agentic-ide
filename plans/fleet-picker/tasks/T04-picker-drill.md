# T04 — picker-drill

**Phase:** 3 · **Depends on:** T02, T03 · **Weight:** medium

## Goal

Use the picker the way a person would, on a real headless mux running the real layout, daemon,
strip and picker, at both window sizes, and judge it against DESIGN §2.3–§2.6 and variant A of
the mock. Fix what has one right answer, each fix with a check that fails without it; bring the
person only choices with two defensible answers.

## Design sections this implements

DESIGN §2.3–§2.7, §2.9; pir-pane DESIGN §2.3 (nothing restarts).

## Files

- `spikes/pir-pane-drill/drill.sh` (extended with a picker phase), `spikes/pir-pane-drill/RESULTS.md`
- whatever a fix touches, with its test in the suite that owns that file

## End to end (the worker drives this)

- suite: `spikes/pir-pane-drill/drill.sh`, its fake `claude agents` and fake pir · sizes: 120×40, 80×24
- The binding cannot be driven here (`send-text` bypasses the key table), so the drill appends
  `picker` to the scratch cmd file, as the binding would, and sends the picker's keys to its pane.
- [ ] `picker` over claude → the slot shows SWITCH PROGRAM, PIR highlighted, Claude Agents `shown now`; the bottom row geometry is unchanged
- [ ] ↓ ↑ → highlight moves and comes back; ← → nothing changes
- [ ] → on PIR → pir in the slot at the slot's size, footer `PIR` shown; `picker` again → Claude Agents highlighted
- [ ] Enter on Claude Agents → claude back, its list and any text typed into its box before the open intact, same pane id (not restarted)
- [ ] Esc and Ctrl+C → the shown program back, nothing switched
- [ ] picker open, window resized → picker redrawn, no line over the width
- [ ] picker open, footer switch → drawn dim
- [ ] picker open, `bb-review` verb → picker gone, claude shown, the spawn typed into claude
- [ ] picker open, focus moved to the terminal, `⌥t` → new terminal, picker still open
- [ ] `picker` with an agent attached → nothing opens
- [ ] five open/close rounds → one claude pane and one pir pane, no stray panes

## Environment (the worker owns this)

```
bash spikes/pir-pane-drill/drill.sh     # brings up its private mux and tears it down, confirming both gone
```

## Outside actions

- The drill — `worker`

## Done when

- [ ] `drill.sh` ends `DRILL PASS` at both sizes, teardown confirmed.
- [ ] A dated FINDINGS row says what was driven and seen, marked worker-driven.
- [ ] Every fix has a check that fails without it.
