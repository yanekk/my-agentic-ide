# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — clean, nothing found

**Status:** T02 reviewed and done. The route decision lives in `candidateTopic`; both code
tasks are ✅. T03 (doc the route in CLAUDE.md, then the one hands-on gateway check) is the
last task and its dependencies are now met.
**Last updated:** 2026-08-31
**Next `pir-work` will:** implement T03.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Bedrock transport in `fetchTopic` | — | ✅ | Clean. Both request shapes match DESIGN 2.3; `buildRequest` returns null for under-filled/unknown providers. |
| T02 | Route decision in `candidateTopic` | T01 | ✅ | Route correct: Bedrock exclusive (key never read, proven by spy), model DEFAULT_HAIKU→SMALL_FAST, under-configured Bedrock is off. Fix commit: the 5 guard-short-circuit tests asserted only `c===null`, which fetchTopic yields for a swallowed throw too — proved weak by gutting the worktree guard, now assert `fetch.calls.length===0`. Injectable `readKey` deviation sound. |
| T03 | CLAUDE.md + live verify | T01, T02 | ⬜ | Doc the route; hands-on: name a real agent via the gateway within ~2s (DESIGN 5.1). |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty for now. T03 will need one hands-on check on the company Bedrock machine; the
seatbelt is the ~2s timeout and the 16-token request. Nothing is blocked before then.)*
