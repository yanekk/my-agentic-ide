# T02 — Pure model: age, activity tags, diff size and branch on the row

**Phase B · depends on T01 · medium**

## Goal

Give the pure model everything the second line needs: the PR's creation time and comment timestamps
carried through `normalizePR`, the diffstat summary and branch names read off the PR, an `ageLabel`
formatter, and an `activityTags` function. All pure functions of a PR and `now`; no clock, no I/O.
This is the data and the rules; T03 draws them.

## Files

- `bin/cockpit-bitbucket-model.mjs` — extend `normalizePR`; add `ageLabel` and `activityTags`.
- `spikes/bitbucket-test/model.test.mjs` — tests; the fixture helper gains `created_on`, comment
  `created_on` and a `diffstatSummary`.

## Interface

Extend the normalized PR shape (`normalizePR` already returns `sourceBranch`/`destBranch` — keep
them; add the rest):

```js
createdOn:      string
createdAtMs:    number       // Date.parse(created_on), NaN if absent
commentTimesMs: number[]     // each comment's Date.parse(created_on); unparseable dropped
diff:           { files, added, removed } | null   // from raw.diffstatSummary (T01); null if not fetched
```

`normalizePR` reads `created_on` off the raw PR, each comment's `created_on` off `raw.comments`, and
`raw.diffstatSummary` off the entry (pass it through as `diff`, or `null` when absent — never a
zeroed object, so a missing fetch stays distinguishable). Parsing timestamps to numbers is not a
clock read — purity holds (DESIGN §5).

```js
// Time since a PR was opened (DESIGN §2.1).
//   <60m -> "Nm"; <24h -> "Nh"; <7d -> "Nd"; >=7d -> "Mon DD"; NaN or future -> ""
export function ageLabel(createdAtMs, now) -> string

// Which activity tags apply, in order NEW, ACTIVE, STALE (DESIGN §2.2).
//   isNew    : now - createdAtMs < 24h
//   isActive : count of commentTimesMs within [now-24h, now] >= 3
//   isStale  : now - Date.parse(pr.updatedOn) > 14d
export function activityTags(pr, now) -> string[]
```

Use plain millisecond constants; no date library. Format `Mon DD` deterministically from the parsed
date so a test asserts an exact string without depending on the machine timezone in a way the test
cannot pin (pass fixed timestamps).

## Done when

- `normalizePR` carries `createdAtMs`, `commentTimesMs` and `diff` (or `null`); absent fields yield
  `NaN`/`[]`/`null`, never a throw.
- `ageLabel` returns the four forms at their boundaries, and `""` for NaN/future.
- `activityTags` returns the right ordered subset for every combination, using `now` as the only time
  source.
- The full test command is green and quiet on pass.

## Tests

- `ageLabel`: 0m, 59m, 60m→"1h", 23h, 24h→"1d", 6d, 7d→a date, a multi-week PR → the exact `Mon DD`;
  NaN → ""; future → "".
- `activityTags`: NEW only; exactly 3 recent comments → ACTIVE, exactly 2 → not; STALE only;
  NEW+ACTIVE together; none; a comment exactly 24h old at the boundary.
- `normalizePR`: parses `created_on` and comment `created_on`; reads `diffstatSummary` into `diff`; a
  missing summary → `diff` is `null` (not `{0,0,0}`); a garbage comment timestamp is dropped from
  `commentTimesMs`; `sourceBranch`/`destBranch` still populated.
- Fixtures: the shared helper defaults `created_on` and accepts an optional `diffstatSummary`, so
  existing tests that don't set them keep passing.

## Notes

Whether the real API's `created_on` on a PR and a comment parse as expected is worth a line of
hand-confirmation against a real PR when convenient (the diffstat hand-check in T01 is the moment),
but the field is standard BitBucket Cloud — not a blocker.
