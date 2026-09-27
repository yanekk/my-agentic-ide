# T05 — docs

**Phase:** 3 · **Depends on:** T04 · **Weight:** light

## Goal

Make the project's own documents describe the second program, so a session that has not read
this plan knows the fleet slot can hold pir and that `panes.fleet` is no longer the landmark.

## Design sections this implements

DESIGN §2 as a whole; §2.10 for the CLAUDE.md row.

## Files

- `CLAUDE.md` (the overview paragraph, the file list, the state-file list with
  `pir-dashboard.json` and `terminals.json`'s `fleet` block; the "measured" table only if T00
  produced a row that meets its bar, retiring one to stay at thirty)
- `docs/cockpit.md` (a section on the pir pane: swap, contract, following, what stays
  claude-only)
- `bin/install.sh` (report `pir` as optional when absent; never fail on it)
- `spikes/pir-pane-test/run.sh` (the installer check below)

## Tests

- [ ] In `spikes/pir-pane-test/run.sh`, asserted on the real lines of `bin/install.sh` the way
      `spikes/auto-name-test/run.sh:109` does (the installer has no dry run): the `pir` check
      prints an optional note and has no `die`/`exit` on its branch.

## Done when

- [ ] CLAUDE.md names `cockpit-pir-model.mjs`, `cockpit-pir.sh`, `pir-dashboard.json` and the
      `spikes/pir-pane-test/` suite with its count.
- [ ] `docs/cockpit.md` explains the swap and the contract, pointing at `plans/pir-pane/`.
- [ ] Test suites still pass.
