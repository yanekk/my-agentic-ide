# T03 — Pure model: normalize, classify, sort, paginate

**Phase:** 1 · **Depends on:** T02 · **Weight:** medium

> **Rules settled in the brainstorm (2026-09-05).** DESIGN §2.3 now records the agreed classify
> rules — build to those. Two things still need real PRs, which the user provides next round,
> before the comment-counting code is written:
> (1) the exact BitBucket comment-object fields the unresolved sort reads — is a thread resolved
> via a `resolution` object, is an inline thread marked by an `inline` field, is the author under
> `user.uuid`? Verify against a real PR, then map them in `normalizePR`.
> (2) the pick-list matches on **username** — confirm which field carries it on a real `author`.
>
> **The precise sort (DESIGN §2.3, decision A) reopens finished tasks.** "Unresolved" and "mine"
> are not in the cheap list call, so the client (T02), the cache (T04) and the daemon fetch (T05)
> must be extended to fetch and carry each PR's comments through to the pure model. How that is
> slotted is a plan decision the user settles before this task is implemented (see PROGRESS "Plan
> decision needed"). The pure model here only *consumes* comments once they arrive; it never fetches.

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
export function normalizePR(raw, { meUuid }) -> {
  repo, id, title, author,                    // author: { uuid, username }
  updatedOn,                                  // ISO string, the tiebreaker sort key
  approvals,                                  // count of participants with approved === true
  approvedByMe,                               // participants has meUuid with approved === true
  comments,                                   // raw.comment_count — the displayed total
  unresolved,                                 // count of unresolved inline threads (all authors)
  myUnresolved,                               // count of unresolved inline threads authored by meUuid
  reviewers,                                  // requested reviewers (username), for the assigned-to-me rule
  draft,                                      // raw.draft
  htmlUrl,                                    // raw.links.html.href, for the Open button
  sourceBranch, destBranch,
}
// unresolved/myUnresolved are computed from the PR's comments, which the fetch layer attaches to
// raw (decision A, DESIGN §2.9). Exact comment-field names verified against real PRs before this
// is written. A PR with no comments attached yields zero, never throws.

// The one function the brainstorm shaped (DESIGN §2.3). Deduped.
// toReview = (I am a reviewer) + (author.username in team), minus drafts, minus approvedByMe;
//   sorted myUnresolved asc, then updatedOn desc.
// mine = authored by meUuid (drafts included); sorted unresolved desc, then updatedOn desc.
export function classify(prs, { meUuid, team }) -> { toReview: PR[], mine: PR[] }

export function paginate(list, { page, perPage }) -> { rows: PR[], page, pages }
// Rows are a fixed height (titles are single-line, ellipsis-truncated — DESIGN §2.2), so perPage
// is a plain count, not height-aware. An out-of-range page (the list SHRANK since it was
// remembered) falls back to page 1 (DESIGN §2.5). Clamping a next/prev CLICK to [1, pages] is the
// daemon's job (T08), so paginate never has to tell "shrank" from "clicked past the end".
```

## Tests

- [ ] `normalizePR` maps every field, including approvals = count of `approved === true` and `approvedByMe`
- [ ] `normalizePR` computes `unresolved`/`myUnresolved` from attached comments (inline, unresolved; `myUnresolved` filtered to meUuid); no comments attached yields zero, never throws
- [ ] `normalizePR` tolerates a missing `participants`/`reviewers` (treats as zero/empty) without throwing
- [ ] classify: a PR where I am a reviewer lands in toReview; a PR I authored lands in mine
- [ ] classify: a pick-list author's PR I do not review lands in toReview; a non-pick-list author's PR I do not review appears nowhere
- [ ] classify dedup: a pick-list author's PR I also review appears once
- [ ] classify excludes drafts from toReview, but includes my own drafts in mine
- [ ] classify excludes a PR I have already approved from toReview
- [ ] toReview sorts by `myUnresolved` ascending, mine by `unresolved` descending, `updatedOn` desc breaking ties, stably
- [ ] paginate: exactly-full page, one-over (spills to a second page), empty list, page 1 of 1
- [ ] paginate: a remembered page past the end of a shrunk list falls back to page 1
- [ ] the purity grep passes for this file

## Done when

- [ ] `classify` implements the DESIGN §2.3 rules (2026-09-05), one test per rule
- [ ] `normalizePR` and `paginate` pass the cases above
- [ ] `cockpit-bitbucket-model.mjs` passes the purity grep
