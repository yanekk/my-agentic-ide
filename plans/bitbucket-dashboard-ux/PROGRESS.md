# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-06 — 2 decisions with the user; verification-table task refs and 3
implementer clarifications fixed.

**Status:** complete — T00–T04 ✅, T06 ✅; T05 dropped. Every task reviewed clean.
**Last updated:** 2026-09-06
**Next `pir-work` will:** nothing — the plan is complete. All tasks are ✅ or dropped.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human · ❌ dropped, not built.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Hover-feasibility spike (motion to the unfocused pane) | — | ✅ | Review clean. Hand-verified 2026-09-06: motion reaches only the FOCUSED pane → T05 dropped. Probe deleted, tree clean. |
| T01 | Data: listPRDiffstat + summarizeDiffstat + daemon fetch + cache triple | — | ✅ | Review clean. Client mirrors listPRComments; summarizeDiffstat pure/total; daemon fetches concernsMe only, caches triple, keeps last on transient fail. Live hand-verified 2026-09-06 (60 files +4964 −244). Suite 523. |
| T02 | Pure model: created_on + comment times, diff/branch, ageLabel, activityTags | T01 | ✅ | Review clean. created_on/comment/diffstat traced end-to-end; purity green; NEW age≥0 correct. |
| T03 | Pure renderer: two-line rows, drop order, separator, emphasis states | T02 | ✅ | Review clean; two-line rows + emphasis states traced, render green. Separator later reworked to a dedicated dim line (FINDINGS). |
| T04 | Pane: press-flash feedback | T03 | ✅ | Review clean. Verb fires before the flash; timer self-heals within 120ms. Live hand-verified 2026-09-06. |
| T05 | Pane: hover highlight | T00, T03 | ❌ | DROPPED 2026-09-06 (T00 + user): motion reaches only the focused pane, so the unfocused dashboard pane can never hover. Not built. See FINDINGS. |
| T06 | Docs: CLAUDE.md, docs/cockpit.md, truths table | T01–T04 | ✅ | Review checked every doc claim against the code — thresholds (NEW<24h, ACTIVE≥3/24h, STALE>14d), age scale, separator (fg idx 8), summarizeDiffstat, listPRDiffstat, floor((avail+1)/3), ?1000h mouse — all accurate. Both flagged deviations accepted (no CLAUDE.md dashboard paragraph ever existed; truths row unchanged, fact lives in DESIGN §4/FINDINGS). Fixed one miss: bitbucket suite one-liner still read (312), bumped to 468. Suite green. |

**Review queue:** empty — every task reviewed. Plan complete.

## Open for the plan review / the user

- **T05 is resolved: dropped** (2026-09-06). T00 proved motion never reaches the unfocused pane, and
  the user confirmed the drop. Everything up to T04 is unconditional and unaffected.
- **The diffstat cost is settled — build it** (DESIGN §2.4, §7; FINDINGS 2026-09-05): the user
  accepted the one-GET-per-shown-PR cost, so T01 stays and the file/line counts are built. Plan review
  2026-09-06 confirmed this against the recorded acceptance (the earlier "may still drop" was stale).
