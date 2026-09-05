# Findings

**Newest first. Forty words a row, counted — including the second column.** The account is the
commit message; this is the index. Whoever appends compacts the over-budget row they walk past.

**Never dropped, only shortened:** a ✅ hand-verification and its date (the only record something
was seen working for real), and any term someone would grep for — a flag, an error string, a path.

| Date | What the build taught |
|---|---|
| 2026-09-05 | Changed-file and line +/- counts are **not** in the PR list response — BitBucket carries them only on the per-PR `/diffstat` endpoint, so they cost one GET per shown PR (bounded by `concernsMe`, same as comments). Branch → target is free: `source.branch.name`/`destination.branch.name` are already fetched and `normalizePR` already extracts them. User accepted the diffstat cost (2026-09-05); a row separator was added as a line-two underline, not a dedicated `────` line. |
| 2026-09-05 | `created_on` is already fetched on every PR: the client's `fields=+values.participants,+values.reviewers` only *adds* to the defaults, which include `created_on`/`updated_on`. Comment `created_on` also already rides in (fetched for the sort). So the age and all three tags cost no new call — model + pane work only. |
| 2026-09-05 | The dashboard pane enables `?1000h` (press only), not motion; and it is not the focused pane. Hover needs `?1003h` motion delivered to an *unfocused* pane, which is unproven — hence the T00 spike. Press feedback rides the click the pane already gets, so it is unconditional. |
| 2026-09-05 | Direction confirmed with the user via a throwaway mock (`prototype/dashboard-rows-mock.html`): two-line rows, age + NEW/ACTIVE/STALE tags, buttons reacting on hover/press. User set ACTIVE at ≥3 comments/24h, accepted STALE at >14d, and chose to decide hover after the spike. |
