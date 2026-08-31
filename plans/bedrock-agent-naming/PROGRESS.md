# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — clean, nothing found

**Status:** T03 docs are written and committed; CLAUDE.md now describes both naming routes
and the direct-AWS limit. The task is 🟡, not 🔍 — its last "Done when" is the live gateway
check, which only a person on the company Bedrock machine can answer. Raised and waiting.
**Last updated:** 2026-08-31
**Next `pir-work` will:** finish T03 — record the user's live-gateway answer in FINDINGS and
mark it done (or record why it could not pass).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Bedrock transport in `fetchTopic` | — | ✅ | Clean. Both request shapes match DESIGN 2.3; `buildRequest` returns null for under-filled/unknown providers. |
| T02 | Route decision in `candidateTopic` | T01 | ✅ | Route correct: Bedrock exclusive (key never read, proven by spy), model DEFAULT_HAIKU→SMALL_FAST, under-configured Bedrock is off. Fix commit: the 5 guard-short-circuit tests asserted only `c===null`, which fetchTopic yields for a swallowed throw too — proved weak by gutting the worktree guard, now assert `fetch.calls.length===0`. Injectable `readKey` deviation sound. |
| T03 | CLAUDE.md + live verify | T01, T02 | 🟡 | Docs done: CLAUDE.md naming ¶ now has both routes (Bedrock wins, exclusive) + direct-AWS limit. Measured-facts table deliberately not touched (no row earns displacing one). Only remaining: the live gateway check (DESIGN 5.1), raised to the user, unverified until answered. |

**Review queue:** *(empty)*

## Blocked on the user

**T03 live gateway check — active.** On the company Bedrock machine, inside the cockpit,
dispatch a fresh agent from the fleet view and send it an ordinary first message (e.g. "add a
retry to the upload path"). Expect: within ~2s the fleet list shows `<repo> / <1-3 word
topic>`, named through the gateway with no key configured. Seatbelt: the ~2s timeout and the
16-token request; target is the company's own gateway, no external spend. Report the label it
chose, roughly how long the hold felt, and whether it ever felt slow. The answer goes in
FINDINGS and finishes T03.
