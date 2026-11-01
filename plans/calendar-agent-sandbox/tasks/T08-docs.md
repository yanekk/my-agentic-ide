# T08 — docs

**Phase:** 3 · **Depends on:** T06, T07 · **Weight:** light

## Goal

Say what the wall now is and what it does not cover, in every place that today says "bypass" and "only their instructions". Wording follows what T07 measured, so this comes last.

## Design sections this implements

§2.8, §7. `plans/calendar-agents/DESIGN.md` is sealed and stays as it is.

## Files

`README.md` (the jobs calendar paragraph), `docs/cockpit.md` (§ Agents started from a calendar: the argv, the mode, the wall, exceptions, the trial, limits, post-merge steps), `CLAUDE.md` (the jobs paragraph, the file map entries for the new `bin/` files and `skills/`, state list `jobs-wall.json`, the suite's count, `Known limits`, one row in the measured table for bypass versus allowedDomains, retiring one row to keep thirty).

## Tests

- [ ] `grep -n bypass` over the three files finds no claim that calendar runs use it, other than as history.
- [ ] Every command named exists: `agenda wall`, `--trial`, `wall-check.sh`.

## Done when

- [ ] All of §2.8's limits appear in `README.md` in brief and `docs/cockpit.md` in full, including the version the results apply to.
- [ ] The docs state the order after a merge: `bin/install.sh`, reopen the window, add exceptions.
- [ ] The measured table still has thirty rows at most.
