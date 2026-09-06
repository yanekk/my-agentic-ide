# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-06 — 2 decisions with the user; verification-table task refs and 3
implementer clarifications fixed.

**Status:** in progress — T00 ✅; T01 ✅; T02 ✅; T03 ✅; T04 ⬜.
**Last updated:** 2026-09-06
**Next `pir-work` will:** implement T04 (press-flash feedback in the pane) — and hand-check the two-line rows live at the first rebuild.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human · ❌ dropped, not built.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Hover-feasibility spike (motion to the unfocused pane) | — | ✅ | Review clean. Hand-verified 2026-09-06: motion reaches only the FOCUSED pane → T05 dropped. Probe deleted, tree clean. |
| T01 | Data: listPRDiffstat + summarizeDiffstat + daemon fetch + cache triple | — | ✅ | Review clean. Client mirrors listPRComments; summarizeDiffstat pure/total; daemon fetches concernsMe only, caches triple, keeps last on transient fail. Live hand-verified 2026-09-06 (60 files +4964 −244). Suite 523. |
| T02 | Pure model: created_on + comment times, diff/branch, ageLabel, activityTags | T01 | ✅ | Review clean. created_on/comment/diffstat traced end-to-end; purity green; NEW age≥0 correct. |
| T03 | Pure renderer: two-line rows, drop order, separator, emphasis states | T02 | ✅ | Review clean, no fix commit. Traced indent vs line-one title column (match), drop-loop terminates + order preserved, right-gap = exactly w (no overflow), underline no bleed, clip keeps escapes, emphasis verbs unique. render 235/235, four-suite green. Deviations OK: #id cyan (DESIGN 2.7); underline SGR-4-only; minus=U+2212 (glyph one-col → T04 live); cockpit-test 7 pages (FINDINGS). |
| T04 | Pane: press-flash feedback | T03 | ⬜ | Built regardless of the spike. Flash only the open zone + primary button (not tabs/pager). First live rebuild → also hand-check the two-line rows read well. |
| T05 | Pane: hover highlight | T00, T03 | ❌ | DROPPED 2026-09-06 (T00 + user): motion reaches only the focused pane, so the unfocused dashboard pane can never hover. Not built. See FINDINGS. |
| T06 | Docs: CLAUDE.md, docs/cockpit.md, truths table | T01–T04 | ⬜ | Truths row only if the spike earned one. Note T05 was dropped. |

**Review queue:** (empty — T04 next to implement).

## Open for the plan review / the user

- **T05 is resolved: dropped** (2026-09-06). T00 proved motion never reaches the unfocused pane, and
  the user confirmed the drop. Everything up to T04 is unconditional and unaffected.
- **The diffstat cost is settled — build it** (DESIGN §2.4, §7; FINDINGS 2026-09-05): the user
  accepted the one-GET-per-shown-PR cost, so T01 stays and the file/line counts are built. Plan review
  2026-09-06 confirmed this against the recorded acceptance (the earlier "may still drop" was stale).
