# T03 — Pure model: normalize, classify, sort, paginate

**Phase:** 1 · **Depends on:** T02 · **Weight:** medium

> **Do not start until the classify brainstorm has happened.** DESIGN §2.3 records only
> *provisional* rules for which PRs each tab shows. The user has ideas to test against real
> data (drafts, already-approved, staleness). The session that reaches this task stops, raises
> the brainstorm with the user (using T02's client on real PRs), settles the rules, and only
> then implements `classify`. See PROGRESS "Blocked on the user".

## Goal

Turn raw BitBucket PRs into the shapes the dashboard draws, and decide which tab each belongs
on. Pure: `now` and `width` are parameters, nothing here reads a clock, the filesystem, the
network or the environment. This is the module the purity grep guards, and the one place the
"which PRs show" judgement lives, so it stays one swappable function.

## Design sections this implements

DESIGN §2.2 (columns, sort), §2.3 (classify — as agreed in the brainstorm), §2.4 (approval and
comment counts), §2.5 (pagination), §3.1 (the boundary), §3.3 (the decision functions).

## Files

- `bin/cockpit-bitbucket-model.mjs` — new (render lives here too, filled by T06).
- `spikes/bitbucket-test/model.test.mjs` — new.
- `spikes/bitbucket-test/run.sh` — add the purity grep for this file.

## Interface

```
export function normalizePR(raw) -> {
  repo, id, title, author,                    // author: { uuid, nickname }
  updatedOn,                                  // ISO string, used for the sort key
  approvals,                                  // count of participants with approved === true
  comments,                                   // raw.comment_count
  draft,                                      // raw.draft
  htmlUrl,                                    // raw.links.html.href, for the Open button
  sourceBranch, destBranch,
}

// The one function the brainstorm shapes. Deduped; each list sorted updatedOn desc.
export function classify(prs, { meUuid, team }) -> { toReview: PR[], mine: PR[] }

export function paginate(list, { page, perPage }) -> { rows: PR[], page, pages }
// page clamps into range; an out-of-range page from a shrunk list falls back to the last page
```

## Tests

- [ ] `normalizePR` maps every field, including approvals = count of `approved === true`
- [ ] `normalizePR` tolerates a missing `participants`/`reviewers` (treats as zero) without throwing
- [ ] classify: a PR where I review lands in toReview; a PR I authored lands in mine
- [ ] classify: a teammate-authored PR lands in toReview (per the agreed rule)
- [ ] classify dedup: a teammate PR I also review appears once
- [ ] classify: whatever exclusion the brainstorm agreed (e.g. drafts) is applied, with a test per rule
- [ ] both lists come back sorted updatedOn descending, stably
- [ ] paginate: exactly-full page, one-over (spills to a second page), empty list, page 1 of 1
- [ ] paginate: a page number past the end clamps to the last page
- [ ] the purity grep passes for this file

## Done when

- [ ] `classify` implements the rules agreed in the brainstorm, one test per rule
- [ ] `normalizePR` and `paginate` pass the cases above
- [ ] `cockpit-bitbucket-model.mjs` passes the purity grep
