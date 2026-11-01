# T02 — job-decisions

**Phase:** 1 · **Depends on:** T00 · **Weight:** heavy

## Goal

All the rules of what an entry means and what happens to it, as a pure module, so that every case is tested in milliseconds with no real agent anywhere near.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4, §2.5, §2.6, §3.1, §3.3.

## Files

`bin/cockpit-jobs-model.mjs`, `spikes/calendar-jobs-test/run.sh`, `spikes/calendar-jobs-test/model.test.mjs`.

## Interface

```js
plainText(html) -> string
parseJob(event) -> { project, instructions } | { refuse: "bad-project"|"empty"|"all-day"|"not-yours" }
decideJobs({
  calendars,      // [{ slug, jobs, jobsSince, account }]
  cache,          // agenda-cache shape
  ledger,         // DESIGN §3.5
  now, projectsRoot, zone,
  projectExists,  // (name) => boolean, injected so the model reads no disk
}) -> {
  start: [{ key, project, cwd, args, end }],
  notes: [{ key, text }],
  ledgerChanges: [{ key, state, reason? }],
}
buildPreamble({ end, zone }) -> string
buildClaudeArgs({ event, project, instructions, zone }) -> string[]
noteText(kind, detail) -> string
```

The name and worktree use the event's start in the machine zone passed as `zone`; `id4` is four hex characters of a hash of the event id (`node:crypto` is allowed by the purity grep; DESIGN §2.4).

## Tests

- [ ] Starts at `now === start`; not at `start - 1`; starts late inside the entry; at `now === end` is `missed`.
- [ ] A decided key never appears in `start` again, in every state.
- [ ] Recurring instances with distinct ids each start; a moved, already-decided entry does not.
- [ ] An event without `creatorOwn` on a fresh fetch: no decision, not a refusal (DESIGN §2.3).
- [ ] Stale fetch (over 5 minutes), or `error` set: no decision at all, not even `missed`.
- [ ] Non-jobs calendar is ignored; an entry that ended before `jobsSince` is ignored silently.
- [ ] A faulty entry before its start: no note, no ledger change; corrected in time, it starts. Ended and faulty: `missed`.
- [ ] Refusals: all-day, empty after `plainText`, not the owner's, unknown project; titles `..`, `a/b`, `../x`, with spaces, empty.
- [ ] An entry that started before `ledger.notBefore` is ignored silently.
- [ ] Overlapping entries all start.
- [ ] `plainText`: `<br>`, `<p>`, links, `&amp;`, already-plain text, a literal `<` in code.
- [ ] Args: instructions beginning with `-`, quotes or newlines remain one array element; the prompt element never begins with `-`; name and worktree are unique for two entries in one minute, including recurring instances `abc_20261101T200000Z` and `def_20261101T200000Z`.
- [ ] Preamble states the deadline, never-ask, worktree-only, no push or merge, and T00's confirmed wording.
- [ ] A DST day: name and deadline use the zone passed.
- [ ] Purity grep of DESIGN §3.1 fails on a planted `Date.now`.

## Done when

- [ ] `bash spikes/calendar-jobs-test/run.sh` passes with one summary line, and the purity grep is in it.
- [ ] Every rule in DESIGN §2.2 and §2.3 has a named test.
- [ ] `buildClaudeArgs` output matches DESIGN §2.4 flag for flag.
