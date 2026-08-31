# T03 — CLAUDE.md, and verify a real agent is named via the gateway

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** light

## Goal

Finish the feature: document the Bedrock route in CLAUDE.md so the next reader knows both
paths exist, and verify with the person the one thing the test suite cannot reach — that a
real agent in a Bedrock session is named through the gateway inside the ~2s budget. The
automated evidence is the T01–T02 suite; this task adds the human-verified half and the
docs.

## Design sections this implements

DESIGN 2.1–2.3 (written into CLAUDE.md's naming paragraph), 5.1 (the live verification row),
8 (the direct-AWS limit recorded as a known limit).

## Files

- `CLAUDE.md` — extend the fleet-list naming paragraph (and/or the paragraph on the Haiku
  call and the key) to say the namer has two routes: the Anthropic key when off Bedrock, and
  the company gateway when the session is on Bedrock (`CLAUDE_CODE_USE_BEDROCK` + a base URL
  + a Haiku model id), Bedrock winning and exclusive. Add the direct-AWS-without-gateway
  limit (no name; needs signing this does not do) to Known limits. Touch the "things that
  are true because they were measured" table only under its own rule: adding a row means
  retiring one, so add a row only if one genuinely earns displacing a current one — the
  gateway-needs-no-auth fact is a candidate, but weigh it against what it would retire.
- `plans/bedrock-agent-naming/FINDINGS.md` — record the live verification with its date.

## Interface

No code interface. The doc change is prose; keep it flat and reason-bearing, matching the
existing CLAUDE.md register.

## Tests

No new automated test; the T01–T02 suite is the automated evidence. This task's evidence is
the hands-on verification below, written into FINDINGS.

## Done when

- [ ] CLAUDE.md's naming paragraph describes both routes, that Bedrock wins and is exclusive,
      and what makes a session "on Bedrock"
- [ ] the direct-AWS-without-gateway limit is in Known limits
- [ ] the live check below has an answer in FINDINGS with its date, or, if it cannot pass,
      the reason is recorded and the task stays unfinished rather than being marked done on
      the tests alone

## Needs a person

Raised the moment this task starts. Seatbelt: the ~2s timeout and the 16-token request
already bound it; the target is the company's own gateway, so there is no external spend.

```
# On the company Bedrock machine, inside the cockpit: dispatch a fresh agent from the fleet
# view and send it an ordinary first message (e.g. "add a retry to the upload path").
```

Expect: within about two seconds the fleet list shows `<repo> / <a 1-3 word topic>`, named
through the gateway with no key configured; the first message is briefly held, then answers
normally.
Tell me: the label it chose, roughly how long the hold felt, and whether it ever felt slow
through the gateway.
