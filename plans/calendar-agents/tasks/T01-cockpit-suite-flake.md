# T01 — cockpit-suite-flake

**Phase:** 0 · **Depends on:** — · **Weight:** light

## Goal

Make `spikes/cockpit-test` pass reliably. Section 15's end-to-end footer check failed 2 of 4 fresh-copy runs at plan review, on code already on `main`. The suite is a test line of this plan, so a false failure stops good work.

## Design sections this implements

DESIGN §5, the test command.

## Files

`spikes/cockpit-test/run.sh`; `bin/cockpit-strip.mjs` or the usage modules only if the cause is in the product, not the test. No other change.

## Interface

None. The failing checks are `the footer draws the pir reading's 5h` and `...and its 7d`, right after `ustrip 200`. Not yet ruled out: the footer's read racing the daemon's poll, and `bedrockConfigured()` reading the real `~/.claude/settings.json`, because `ustrip` does not set `HOME`. The paint-before-mouse order was read and is not the cause.

## Tests

- [ ] The cause is named in the commit message, with the evidence, and the fix addresses it: no longer wait or retry that merely hides it. If the cause is a product defect, its fix has a check that fails without it.

## Done when

- [ ] `ONLY=15 bash spikes/cockpit-test/stress.sh` or equivalent repeats section 15 at least 20 times with no failure, the count recorded in `FINDINGS.md`.
- [ ] Two consecutive full `bash spikes/cockpit-test/run.sh` runs print `ALL PASS`.
