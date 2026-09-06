# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-06 — 2 decisions with the user; verification-table task refs and 3
implementer clarifications fixed.

**Status:** in progress — T00 done (spike), awaiting review.
**Last updated:** 2026-09-06
**Next `pir-work` will:** review T00; then implement T01 (no dependencies).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Hover-feasibility spike (motion to the unfocused pane) | — | 🔍 | Hand-verified with user 2026-09-06: motion reaches only the FOCUSED pane; the unfocused dashboard pane gets none. Recommendation: DROP T05 (hover), press feedback stands. Probe built, verified, deleted (no bin refs). See FINDINGS. |
| T01 | Data: listPRDiffstat + summarizeDiffstat + daemon fetch + cache triple | — | ⬜ | One GET per shown PR, bounded by concernsMe. Read-only. Keep last good triple on a transient fail (like comments). Hands-on for the live call. |
| T02 | Pure model: created_on + comment times, diff/branch, ageLabel, activityTags | T01 | ⬜ | NEW <24h, ACTIVE ≥3 comments/24h, STALE >14d. diff=null when unfetched. |
| T03 | Pure renderer: two-line rows, drop order, separator, emphasis states | T02 | ⬜ | Heavy. Open button dropped → line-one open zone (bb-open); line two tags·age·branch; underline separator; reworks layout/pagination/hit-zones. |
| T04 | Pane: press-flash feedback | T03 | ⬜ | Built regardless of the spike. Flash only the open zone + primary button (not tabs/pager). First live rebuild → also hand-check the two-line rows read well. |
| T05 | Pane: hover highlight | T00, T03 | ⬜ | T00 spike says hover CANNOT work (motion never reaches the unfocused pane). Recommendation is to DROP this task; awaiting user's formal call. |
| T06 | Docs: CLAUDE.md, docs/cockpit.md, truths table | T01–T05 | ⬜ | Truths row only if the spike earned one. |

**Review queue:** T00.

## Open for the plan review / the user

- **T05 is conditional** (DESIGN §4). The plan-review need not resolve it — T00 does, at build time,
  with the user. Everything up to T04 is unconditional.
- **The diffstat cost is settled — build it** (DESIGN §2.4, §7; FINDINGS 2026-09-05): the user
  accepted the one-GET-per-shown-PR cost, so T01 stays and the file/line counts are built. Plan review
  2026-09-06 confirmed this against the recorded acceptance (the earlier "may still drop" was stale).
