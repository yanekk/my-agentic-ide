# T06 — docs

**Phase:** 3 · **Depends on:** T05 · **Weight:** light

## Goal

Describe the picker's status lists where a reader of this repo will look: the README for what the
person gets, `docs/cockpit.md` for how it works and why, and `CLAUDE.md`'s file table and test
counts. Written after the drill so it describes the behaviour as it finally is.

## Design sections this implements

DESIGN §2 (in summary), §3.2, §5.

## Files

- `README.md` (the picker's mention gains the status lists, one or two sentences)
- `docs/cockpit.md` (§ "The picker, and why ← is decided in WezTerm": a paragraph on the lists,
  the snapshot at open, `--all`, `lastTerminalAt`, `/v2/runs` and the pending `endedAt`)
- `CLAUDE.md` (the intro paragraph on the picker, the file table rows for the two new modules,
  the `fleet-picker-test` check count)

## Done when

- [ ] README, `docs/cockpit.md` and `CLAUDE.md` say what the picker shows and link this plan.
- [ ] `CLAUDE.md`'s file table lists `cockpit-fleet-status-model.mjs` and `cockpit-fleet-status.mjs`
      and the suite's current check count.
- [ ] Nothing claims recent pir finishes are shown before pir's `endedAt` exists.
