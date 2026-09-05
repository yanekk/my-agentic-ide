# T01 — Pure model: age and the activity tags

**Phase B · depends on nothing · medium**

## Goal

Give the pure model everything the second line of a row needs: the PR's creation time and its
comment timestamps carried through `normalizePR`, an `ageLabel` formatter, and an `activityTags`
function returning which of NEW/ACTIVE/STALE apply. All pure functions of a PR and `now`; no clock
read, no I/O. This is the data and the rules; T02 draws them.

## Files

- `bin/cockpit-bitbucket-model.mjs` — extend `normalizePR`; add `ageLabel` and `activityTags`.
- `spikes/bitbucket-test/model.test.mjs` — tests; its fixture helper gains `created_on` and comment
  `created_on`.

## Interface

Extend the normalized PR shape (add to the object `normalizePR` returns):

```js
createdOn:   string   // raw created_on, kept for parity with updatedOn
createdAtMs: number   // Date.parse(created_on), or NaN if absent/unparseable
commentTimesMs: number[]  // each comment's Date.parse(created_on); unparseable dropped
```

`normalizePR` must read `created_on` off the raw PR and each comment's `created_on` off
`raw.comments` (the same array it already reduces for the unresolved counts). Parsing a timestamp
string to a number is not a clock read — purity holds (DESIGN §5).

```js
// Time since a PR was opened, as a glance-able label (DESIGN §2.1).
//   < 60m      -> "Nm"     (0m becomes "0m", never blank)
//   < 24h      -> "Nh"
//   < 7d       -> "Nd"
//   >= 7d      -> "Mon DD" in the machine's locale-independent short form (e.g. "Aug 20")
// createdAtMs NaN or in the future -> "" (drawn as nothing; a clock skew is not an age)
export function ageLabel(createdAtMs, now) -> string

// Which activity tags apply, in draw order (DESIGN §2.2).
//   isNew    : now - createdAtMs < 24h
//   isActive : count of commentTimesMs within [now-24h, now] >= 3
//   isStale  : now - updatedAtMs > 14d
// updatedAtMs is Date.parse(pr.updatedOn). Returns an ordered array of the tag
// strings that apply, e.g. ["NEW","ACTIVE"] or [] — order always NEW, ACTIVE, STALE.
export function activityTags(pr, now) -> string[]
```

Use plain millisecond constants (`24*60*60*1000`, `14*...`) — no date library (zero-dependency
rule). For the `Mon DD` form, format from the parsed date's UTC-independent parts deterministically;
do not depend on the machine's timezone in a way a test cannot pin (pass fixed timestamps, assert
exact strings).

## Done when

- `normalizePR` carries `createdAtMs` and `commentTimesMs`; an absent field yields `NaN`/`[]`, never
  throws.
- `ageLabel` returns the four forms at their boundaries, and `""` for NaN/future.
- `activityTags` returns the right ordered subset for every combination, using `now` as the only
  time source.
- The full test command is green and quiet on pass.

## Tests

- `ageLabel`: 0m, 59m, 60m→"1h", 23h, 24h→"1d", 6d, 7d→a date, a multi-week PR → the exact `Mon DD`;
  NaN → ""; a future `createdAtMs` → "".
- `activityTags`: NEW only; ACTIVE only (exactly 3 recent → active, exactly 2 → not); STALE only;
  NEW+ACTIVE together; none; a comment exactly 24h old at the boundary; STALE never co-occurs with a
  same-`now` NEW/ACTIVE fixture.
- `normalizePR`: parses `created_on` and comment `created_on`; missing → NaN/empty; a comment with a
  garbage timestamp is dropped from `commentTimesMs`, not counted.
- Fixtures: the shared PR/comment fixture helper gains `created_on` (default it so existing tests
  that don't care keep passing).

## Notes

Whether the real API's `created_on` on a PR and on a comment parse as expected is worth a line of
hand-confirmation against a real PR when convenient, but the field is standard BitBucket Cloud and
the parent plan already hand-verified the comment object's other fields — not a blocker.
