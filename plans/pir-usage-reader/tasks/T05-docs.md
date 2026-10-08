# T05 — docs

**Phase:** 2 · **Depends on:** T03, T04 · **Weight:** light

## Goal

Bring the project's own documents up to date with what T01 to T04 built, so the next session
finds the second writer of `usage-cache.json` without reading the daemon.

## Design sections this implements

DESIGN §2.2, §2.3, §2.5, §2.7, §5.2, as built.

## Files

- `CLAUDE.md`
- `docs/cockpit.md`

## Interface

`CLAUDE.md`:

- The file table: a row for `bin/cockpit-usage-pir.mjs`; the `cockpit-usage-model.mjs` row
  gains the pir decision; `spikes/usage-test/` gets a row with its count (it has none today);
  the `spikes/cockpit-test/` count and median are re-measured.
- "Running it": the installer's `pir-api` line, beside the sentence on the optional `pir` check.
- The state paragraph: `usage-cache.json` has two writers, the tap and the daemon's pir poll,
  newest `writtenAt` wins; the poll reads `${PIR_HOME ?? HOME}/.pir/api.json` and keeps no state
  of its own.
- The measured-claims table is not extended. Reason: it is capped at thirty rows and nothing
  here was found by getting it wrong.

`docs/cockpit.md`: a short section on the pir usage feed: the contract's source, the states and
their one-line-per-change log, the loopback-only rule, the future-reading rule, and the
`PIR_HOME` fence in the suites.

## Tests

- [ ] Every file path, function name, env variable and log string named in the two documents
      exists in the code as written (`grep` each).
- [ ] The counts quoted for `usage-test` and `cockpit-test` equal what the suites print.

## Done when

- [ ] The three suites of the test command are green (no code changed, so unchanged counts).
- [ ] `git diff --stat` touches only `CLAUDE.md`, `docs/cockpit.md` and this plan's tracker files.
