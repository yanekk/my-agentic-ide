# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md).**

**Sixty words to a Notes cell, counted.** The cell is an index; the account is the commit
message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-06 — 2 decisions with the user; verification-table task refs and 3
implementer clarifications fixed.

**Status:** in progress — T00 ✅; T01 implemented 🔍 (awaiting review); live diffstat call awaiting hand-verification.
**Last updated:** 2026-09-06
**Next `pir-work` will:** review T01.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human · ❌ dropped, not built.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Hover-feasibility spike (motion to the unfocused pane) | — | ✅ | Review clean, no fix. Hand-verified with user 2026-09-06 (FINDINGS + commit): motion reaches only the FOCUSED pane. Probe deleted, no bin refs, tree clean. Primary Q answered NO, so button-bytes/flicker moot. Suite green (one agenda-seam flake, passed on rerun). T05 formally dropped. |
| T01 | Data: listPRDiffstat + summarizeDiffstat + daemon fetch + cache triple | — | 🔍 | Client + pure summarizer + daemon shown-PR loop + tests. Non-concerning PR gets no call/no summary; transient fail keeps last triple via prevDiffstat. Suite green. LIVE CALL still needs the user (verify-diffstat snippet). |
| T02 | Pure model: created_on + comment times, diff/branch, ageLabel, activityTags | T01 | ⬜ | NEW <24h, ACTIVE ≥3 comments/24h, STALE >14d. diff=null when unfetched. |
| T03 | Pure renderer: two-line rows, drop order, separator, emphasis states | T02 | ⬜ | Heavy. Open button dropped → line-one open zone (bb-open); line two tags·age·branch; underline separator; reworks layout/pagination/hit-zones. |
| T04 | Pane: press-flash feedback | T03 | ⬜ | Built regardless of the spike. Flash only the open zone + primary button (not tabs/pager). First live rebuild → also hand-check the two-line rows read well. |
| T05 | Pane: hover highlight | T00, T03 | ❌ | DROPPED 2026-09-06 (T00 + user): motion reaches only the focused pane, so the unfocused dashboard pane can never hover. Not built. See FINDINGS. |
| T06 | Docs: CLAUDE.md, docs/cockpit.md, truths table | T01–T04 | ⬜ | Truths row only if the spike earned one. Note T05 was dropped. |

**Review queue:** T01.

## Open for the plan review / the user

- **T05 is resolved: dropped** (2026-09-06). T00 proved motion never reaches the unfocused pane, and
  the user confirmed the drop. Everything up to T04 is unconditional and unaffected.
- **The diffstat cost is settled — build it** (DESIGN §2.4, §7; FINDINGS 2026-09-05): the user
  accepted the one-GET-per-shown-PR cost, so T01 stays and the file/line counts are built. Plan review
  2026-09-06 confirmed this against the recorded acceptance (the earlier "may still drop" was stale).
