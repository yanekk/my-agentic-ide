# T06 — skill-refactor

**Phase:** 2 · **Depends on:** T03, T05 · **Weight:** light

## Goal

`scheduled-run` makes sure the agent has what it needs before the entry exists, and says truthfully what the wall is. The skill moves into the repo so it can be reviewed. The live copy in `~/.claude/skills/` is not touched by this task: a branch must not change what live sessions run, and `bin/install.sh` puts it in place after the merge.

## Design sections this implements

§2.7, §2.8, §2.10, §7.

## Files

`skills/scheduled-run/SKILL.md` (new, starting from the current live file), `bin/install.sh`, `spikes/usage-test/install.test.mjs` (the installer check).

## What changes in the skill

- New step after gathering details: find the checkout with `readlink ~/.wezterm.lua`, write the job's setup and a short test as commands, and run `--trial` (T05) with a time limit, as a background command because a foreground one is cut off at 10 minutes. Ask for the commands if they are not clear, and say this is a short real run using usage.
- Show what passed and was blocked in plain words. For each block propose either changing the job or an exception, with the exact `agenda wall` line for the person to type, because it refuses agents. Say an extra site could also receive data. Re-run the trial after an exception.
- The owner may schedule despite a block; the confirmation names it.
- Replace "all permissions bypassed" in step 4 with what the wall blocks and does not cover, briefly, and link `docs/cockpit.md`.
- Instructions guidance: dependencies from GitHub, other repos' writes and web fetches will not work.

## Installer

`bin/install.sh` links `~/.claude/skills/scheduled-run` to the repo's folder. An existing real folder identical to the known old text or differing is moved aside as `scheduled-run.bak-{ts}`, because it is the user's file; re-runs change nothing.

## Tests

- [ ] Fresh home: the link is made. Existing folder: moved aside and linked. Second run: no change, no second backup.
- [ ] The skill file names the trial flags and `agenda wall` verbs that exist: a grep against USAGE strings, so wording cannot drift.
- [ ] No "bypass" left in the skill.

## Done when

- [ ] The test suite covering the installer passes.
- [ ] A reviewer following the skill text by hand, using T05's command with the fake `claude` first on `PATH`, against a scratch project under `COCKPIT_DIR`, finds no step that does not exist.
