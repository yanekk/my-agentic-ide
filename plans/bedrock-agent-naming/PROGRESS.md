# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — clean, nothing found

**Status:** T03 done. Live gateway check ran on the company Bedrock machine and PASSED
(`add a retry to the upload path` → `my-agentic-ide / upload-retry`, FINDINGS). The verify
exposed a bug: the gateway answers in 5.5–8s, not ~2s, so the 2s hold aborted every call and
sessions fell back to the placeholder — the "doesn't work" report. Fixed: per-route timeout
(2s Anthropic, 15s Bedrock, user's call) + hook kill-timeout raised 10s→20s. Tests green
(115+16), re-verified end-to-end (~9s). settings.json re-installed to timeout:20.
**Last updated:** 2026-09-02
**Next `pir-work` will:** nothing — plan closed. The out-of-loop timeout fix (ef7824d) got a
fresh-eyes review 2026-09-02: correct and verified, two minor non-blocking notes in FINDINGS
(a test-coverage gap on the per-route defaults; settings.json needs an installer re-run per
machine to pick up the 20s kill-timeout).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Bedrock transport in `fetchTopic` | — | ✅ | Clean. Both request shapes match DESIGN 2.3; `buildRequest` returns null for under-filled/unknown providers. |
| T02 | Route decision in `candidateTopic` | T01 | ✅ | Route correct: Bedrock exclusive (key never read, proven by spy), model DEFAULT_HAIKU→SMALL_FAST, under-configured Bedrock is off. Fix commit: the 5 guard-short-circuit tests asserted only `c===null`, which fetchTopic yields for a swallowed throw too — proved weak by gutting the worktree guard, now assert `fetch.calls.length===0`. Injectable `readKey` deviation sound. |
| T03 | CLAUDE.md + live verify | T01, T02 | ✅ | Docs done + live gateway check PASSED (FINDINGS 2026-08-31). Verify found the 2s hold too short for the real 5.5–8s gateway; fixed with a per-route timeout (15s Bedrock) and a 20s hook kill-timeout. Re-verified end-to-end. |

**Review queue:** *(empty)*

## Blocked on the user

*(nothing — the T03 live gateway check is done, verified by hand 2026-08-31.)*
