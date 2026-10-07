# T05 — docs

**Phase:** 3 · **Depends on:** T01, T03 · **Weight:** light

## Goal

Make the project's standing docs tell the truth about the picker, so a later session does not
reintroduce "click only" or bind ← somewhere else.

## Design sections this implements

DESIGN §2, §3.5, §7.

## Files

- `CLAUDE.md`: the paragraph on the `Claude Agents | PIR` switch (add the ← picker in one or two
  sentences); the file list (`wezterm/fleet-picker.lua`, the three picker files,
  `spikes/fleet-picker-keys-test/`, `spikes/fleet-picker-test/`); the `terminals.json` description (`pickerOpen`, `picker`); the
  `panes.json` note (`picker`).
- `docs/cockpit.md`: the fleet-slot section, how the ← decision is made and why in WezTerm.
- `plans/pir-pane/DESIGN.md`: a dated blockquote at §2.1 and §8 pointing to
  `plans/fleet-picker/DESIGN.md` §7. The body is not rewritten.

## Done when

- [ ] Every new file is in CLAUDE.md's file list and every new `terminals.json` field is described.
- [ ] pir-pane DESIGN §2.1 and §8 carry the pointer.
- [ ] The test command still passes.
