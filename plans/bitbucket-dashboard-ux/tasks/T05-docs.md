# T05 — Docs: CLAUDE.md, cockpit.md, truths table

**Phase D · depends on T01, T02, T03, T04 · light**

## Goal

Record what shipped so the next session reads an accurate account. No install change — there is no
new tool, config, file, or command. Just the prose that describes the dashboard, and a truths-table
row if the spike earned one.

## Files

- `CLAUDE.md` — the BitBucket dashboard paragraph and the `bin/cockpit-bitbucket-model.mjs` /
  `cockpit-welcome.mjs` one-liners: a PR row is now two lines (age + NEW/ACTIVE/STALE tags on line
  two), and the buttons react on press (and hover, if built).
- `docs/cockpit.md` — the dashboard section: the two-line row, the three tags with their thresholds
  (NEW <24h, ACTIVE ≥3 comments/24h, STALE >14d), the press feedback, and the hover outcome
  (built with its throttle, or dropped, per T00/T04).
- `CLAUDE.md` truths table — **only if** T00 produced a durable, expensive-to-rediscover fact, e.g.
  "WezTerm does / does not report `?1003h` motion to an unfocused pane". Thirty rows is the ceiling:
  adding one means retiring one (parent rule). If the spike's finding is already captured in
  FINDINGS and the code comment, it does not also need a truths row — add one only if a future
  session would otherwise re-break something.

## Done when

- CLAUDE.md and `docs/cockpit.md` describe the two-line rows, the tags and their thresholds, and the
  button reactions as actually built.
- If hover was dropped, the docs say so plainly (a reader must not expect a highlight that is not
  there); if built, the throttle is noted.
- The truths table is either unchanged or a row was added *and* one retired, staying at thirty.
- The full test command is green (docs are prose; the `--check` the parent T10 used, if present,
  still passes).

## Tests

Prose. The only automated gate is that the test command stays green and any doc-consistency
`--check` the repo runs still exits 0.

## Notes

Keep it flat and short (CLAUDE.md § How to write in these files). The account of *why* each
threshold is what it is already lives in this plan's DESIGN §7; the docs state the fact, not the
argument.
