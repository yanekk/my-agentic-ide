# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-06 — 2 decisions with the user; verification-table task refs and 3
implementer clarifications fixed.

**Status:** in progress — T00 ✅; T01 ✅; T02 🔍 (awaiting review).
**Last updated:** 2026-09-06
**Next `pir-work` will:** review T02 (pure model: age + activity tags).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human · ❌ dropped, not built.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Hover-feasibility spike (motion to the unfocused pane) | — | ✅ | Review clean. Hand-verified 2026-09-06: motion reaches only the FOCUSED pane → T05 dropped. Probe deleted, tree clean. |
| T01 | Data: listPRDiffstat + summarizeDiffstat + daemon fetch + cache triple | — | ✅ | Review clean, no fix. Client mirrors listPRComments (paginate, 401/403→auth, GET-only); summarizeDiffstat pure/total (ragged/missing/non-array→zeros); daemon fetches only for concernsMe, caches the triple not the list, prevDiffstat keeps last on transient fail, absent when unfetched. Store round-trips it free. Guards pass. Live call hand-verified 2026-09-06 (60 files +4964 −244). Suite green 523. |
| T02 | Pure model: created_on + comment times, diff/branch, ageLabel, activityTags | T01 | 🔍 | normalizePR carries createdOn/createdAtMs (NaN if absent), commentTimesMs (bad stamps dropped), diff (cached triple, null when unfetched, never {0,0,0}). Pure ageLabel (m/h/d/Mon DD; ''=NaN/future; Mon DD local-zone, TZ-pinned test) and activityTags (NEW<24h, ACTIVE 3+ in inclusive 24h window, STALE >14d off updated_on). Deviation: NEW also requires age≥0, excluding future, per DESIGN §2.2. Model 93 ok. |
| T03 | Pure renderer: two-line rows, drop order, separator, emphasis states | T02 | ⬜ | Heavy. Open button dropped → line-one open zone (bb-open); line two tags·age·branch; underline separator; reworks layout/pagination/hit-zones. |
| T04 | Pane: press-flash feedback | T03 | ⬜ | Built regardless of the spike. Flash only the open zone + primary button (not tabs/pager). First live rebuild → also hand-check the two-line rows read well. |
| T05 | Pane: hover highlight | T00, T03 | ❌ | DROPPED 2026-09-06 (T00 + user): motion reaches only the focused pane, so the unfocused dashboard pane can never hover. Not built. See FINDINGS. |
| T06 | Docs: CLAUDE.md, docs/cockpit.md, truths table | T01–T04 | ⬜ | Truths row only if the spike earned one. Note T05 was dropped. |

**Review queue:** T02.

## Open for the plan review / the user

- **T05 is resolved: dropped** (2026-09-06). T00 proved motion never reaches the unfocused pane, and
  the user confirmed the drop. Everything up to T04 is unconditional and unaffected.
- **The diffstat cost is settled — build it** (DESIGN §2.4, §7; FINDINGS 2026-09-05): the user
  accepted the one-GET-per-shown-PR cost, so T01 stays and the file/line counts are built. Plan review
  2026-09-06 confirmed this against the recorded acceptance (the earlier "may still drop" was stale).
