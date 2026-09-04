# T10 — Install, docs, CLAUDE.md

**Phase:** 6 · **Depends on:** T09 · **Weight:** light

## Goal

Make the feature discoverable and the repo's account of itself true. Update the installer if it
needs to know anything new, add the dashboard to the docs, and fold the durable truths into
CLAUDE.md's index and its measured-truths table. This is the task that stops the next session
rediscovering how the thing works.

## Design sections this implements

Not a behaviour task — it records the behaviour built in T01–T09. Touches DESIGN only if a
hand-verification changed a rule.

## Files

- `bin/install.sh` — only if the feature needs setup the installer must do. The `config` symlink
  already exists; the settings are user-entered, so likely no change beyond a mention. Confirm.
- `docs/cockpit.md` — how the dashboard works and why (the daemon fetch, the pure pane, the
  spawn primitive), for the session that later changes it.
- `CLAUDE.md` — the file map (new `bin/cockpit-bitbucket-*.mjs`, the new spike dir), the state
  list (the new files under `~/.claude/cockpit`), and the measured-truths table if a
  hand-verification produced one (e.g. the exact `@`-reference form from T00). Retire a row to
  add one — the table is capped.
- The test command in DESIGN §5 already lists `spikes/bitbucket-test/run.sh` (added in T01);
  confirm it is also wherever else the suite is invoked.

## Tests

- [ ] the full test command (all four suites) passes
- [ ] a fresh `bin/install.sh --check` still succeeds

## Done when

- [ ] `docs/cockpit.md` describes the dashboard, the fetch and the spawn primitive
- [ ] CLAUDE.md's file map, state list and (if warranted) truths table include the feature
- [ ] any durable hand-verified fact (the `@`-reference form, real-token auth) is in FINDINGS,
      and anything that binds every session is a one-line row in CLAUDE.md's table
