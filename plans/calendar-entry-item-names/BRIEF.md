# calendar-entry-item-names — Brief

**Brief reviewed:** not yet

## The change

A jobs calendar entry's title is a project folder today, so several jobs for one project look identical in the calendar. The title becomes `{project} / {item name}`, for example `superfrog-re / run nightly tests`. The project part picks the folder, and the item name tells entries apart in the calendar, the agents list and the notes. Parsing is `parseJob` in `bin/cockpit-jobs-model.mjs`; the description stays the instructions.

## Decisions

- 2026-11-01: No backward compatibility. The person has not used the feature, so a project-only title is refused with no special handling.
- 2026-11-01: Agent name is `{project} / {item} {MM-DD HH:MM} {id4}`. Date and id stay because a recurring entry repeats its title and the fleet list needs unique names (`cockpitd.mjs` leaves the panes alone on an ambiguous name). The person chose this over keeping `cal`.
- 2026-11-01: The item is clipped to 30 characters in the agent name only, because a truncated fleet header stops the daemon following the agent (`docs/cockpit.md`, known limits). Control characters are stripped from it, since a title is untrusted.
- 2026-11-01: Split at the first `/`, trim both sides. Spaces around the slash are optional and the item may contain further slashes.
- 2026-11-01: A title with no slash or an empty item is refused with a new reason, whose note says the title must read `project / item name`.
- 2026-11-01: Every note about an entry quotes its whole title, including `failed` and `unknown`, which pass `job.project` today. Carry the title on the started job and in its ledger row (`cockpit-jobs.mjs`) so `recoverStarting` can quote it. The `bad-project` note names the project part.

## Not changing

The agenda column, which already draws the whole title. The `-w` worktree name, which has no need of the item. Instructions, start timing and the ledger's once-only rule. The `test` lines in `.pir/settings.json`: `spikes/calendar-jobs-test/run.sh` is not among them and adding it is out of scope.

## Done when

- `superfrog-re / run nightly tests` starts an agent in `superfrog-re` named `superfrog-re / run nightly tests {MM-DD HH:MM} {id4}`.
- A project-only title or an empty item starts nothing and leaves one note giving the required format.
- `README.md`, `docs/cockpit.md` and `CLAUDE.md` describe the new format, and `spikes/calendar-jobs-test/run.sh`, run by hand by the builder because pir does not run it, passes.

## Tests

In `spikes/calendar-jobs-test/`, updating existing fixtures to the new title form:

- Parsing: `p / item`, `p/item`, surrounding spaces, `p / a/b` (item `a/b`).
- Refused with the new reason: `p`, `p /`, an empty title.
- Refused as `bad-project`: `/ item` (empty project), `../x / y`, `.. / y`, `. / y`, `my project / y`, an unknown folder; `projectExists` is asked only about the project part, and never about a bad one.
- Agent name: exact argv for the example; a 31-character item clipped to 30; a control character in the item stripped; two instances of a recurring entry get different names.
- Notes: `refused`, `missed`, `failed` and `unknown` each quote the whole title, through `jobsTick` and `recoverStarting` for the last two; a ledger row written before this change, with only `project`, still yields a note rather than throwing.
- A hostile item never reaches a note or the name with an escape character.

## Changed during the build
