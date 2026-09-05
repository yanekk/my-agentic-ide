# T06 — Docs: CLAUDE.md, cockpit.md, truths table

**Phase D · depends on T01, T02, T03, T04, T05 · light**

## Goal

Record what shipped so the next session reads an accurate account. No install change — there is no
new tool, config, file, or command; the one new BitBucket call is internal. Just the prose that
describes the dashboard, and a truths-table row if the spike earned one.

## Files

- `CLAUDE.md` — the BitBucket dashboard paragraph and the affected one-liners: a PR row is now two
  lines (line two holds age, NEW/ACTIVE/STALE tags, branch → target, changed-file count and lines
  +/-, with a dim hairline separating rows); the buttons react on press (and hover, if built); the
  client gains `listPRDiffstat` and the daemon fetches a diffstat per shown PR.
- `docs/cockpit.md` — the dashboard section: the two-line row and its drop order, the three tags with
  thresholds (NEW <24h, ACTIVE ≥3 comments/24h, STALE >14d), the branch and diff-size items, the
  diffstat fetch bounded to shown PRs, the row separator, the press feedback, and the hover outcome.
- `CLAUDE.md` truths table — **only if** T00 produced a durable, expensive-to-rediscover fact (e.g.
  "WezTerm does / does not report `?1003h` motion to an unfocused pane"). Thirty rows is the ceiling:
  adding one means retiring one. If the finding already lives in FINDINGS and a code comment, it does
  not also need a truths row.

## Done when

- CLAUDE.md and `docs/cockpit.md` describe the two-line rows, the tags and thresholds, the branch and
  diff size, the separator, the diffstat fetch, and the button reactions as actually built.
- If hover was dropped, the docs say so plainly; if built, the throttle is noted.
- The truths table is either unchanged or a row was added *and* one retired, staying at thirty.
- The full test command is green (any doc-consistency `--check` the repo runs still exits 0).

## Tests

Prose. The only automated gate is the test command staying green and any doc `--check` exiting 0.

## Notes

Keep it flat and short (CLAUDE.md § How to write in these files). The *why* of each threshold and the
diffstat cost already live in this plan's DESIGN §7; the docs state the fact, not the argument.
