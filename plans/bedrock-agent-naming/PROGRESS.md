# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — clean, nothing found

**Status:** T02 implemented, awaiting review. The route decision now lives in
`candidateTopic`; T03 (doc the route in CLAUDE.md, then the one hands-on gateway check) is
the last task and depends on this review passing.
**Last updated:** 2026-08-31
**Next `pir-work` will:** review T02.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Bedrock transport in `fetchTopic` | — | ✅ | Clean, no fix commit. Both request shapes match DESIGN 2.3; `buildRequest` returns null for under-filled/unknown providers so no fetch fires. Reviewed the recorded deviation (call site left anthropic-only until T02). |
| T02 | Route decision in `candidateTopic` | T01 | 🔍 | Route in `candidateTopic`: Bedrock wins and is exclusive (key never read), else the key path, else off (DESIGN 2.1/2.2); model DEFAULT_HAIKU then SMALL_FAST. +25 tests: full route matrix, guards short-circuit before the route, spy proves the key unread on Bedrock. Deviation: key reader made injectable via `opts.readKey` (default `readKeyFile`) so the spy assertion the task lists is possible. |
| T03 | CLAUDE.md + live verify | T01, T02 | ⬜ | Doc the route; hands-on: name a real agent via the gateway within ~2s (DESIGN 5.1). |

**Review queue:** T02

## Blocked on the user

*(Empty for now. T03 will need one hands-on check on the company Bedrock machine; the
seatbelt is the ~2s timeout and the 16-token request. Nothing is blocked before then.)*
