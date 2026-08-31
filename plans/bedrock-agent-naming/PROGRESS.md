# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — clean, nothing found

**Status:** Reviewed and ready to build. Three tasks in two phases, extending the finished
`smart-agent-names` code in `bin/cockpit-auto-name.mjs`. The gateway was proven reachable
without credentials during planning (see FINDINGS), so there is no spike.
**Last updated:** 2026-08-31
**Next `pir-work` will:** implement T02 (the env route decision in `candidateTopic`).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Bedrock transport in `fetchTopic` | — | ✅ | Clean, no fix commit. Both request shapes match DESIGN 2.3; `buildRequest` returns null for under-filled/unknown providers so no fetch fires; timer set after that guard and cleared in `finally`. Verified the recorded `candidateTopic` deviation preserves behaviour — `model` stays undefined and still defaults to `claude-haiku-4-5`. Probed early-null timer safety, trailing slash, verbatim `:`, null provider. |
| T02 | Route decision in `candidateTopic` | T01 | ⬜ | Bedrock wins, exclusive; key path only off-Bedrock (DESIGN 2.1/2.2). |
| T03 | CLAUDE.md + live verify | T01, T02 | ⬜ | Doc the route; hands-on: name a real agent via the gateway within ~2s (DESIGN 5.1). |

**Review queue:** *(empty)*

## Blocked on the user

*(Empty for now. T03 will need one hands-on check on the company Bedrock machine; the
seatbelt is the ~2s timeout and the 16-token request. Nothing is blocked before then.)*
