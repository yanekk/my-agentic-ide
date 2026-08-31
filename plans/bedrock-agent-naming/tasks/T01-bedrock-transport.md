# T01 — Bedrock transport in `fetchTopic`

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Give the namer's Haiku call a second transport so it can reach Haiku through the company
Bedrock gateway as well as the public Anthropic API. Today `fetchTopic` hard-codes the
Anthropic request; this task turns the transport into a parameter and adds the Bedrock
InvokeModel request shape, keeping the one call site's "never throw, never hang, validate
the label" contract intact. It does not decide when to use which transport — that is T02;
this task only makes both callable.

## Design sections this implements

DESIGN 2.3 (the Bedrock request), 3.3 (the `provider` shape), 2.4 (the unhappy paths, which
must hold identically on the new transport).

## Files

- `bin/cockpit-auto-name.mjs` — `fetchTopic` only. Do not touch `candidateTopic` (T02),
  `decide`, `runHook`, or `readKeyFile`.
- `spikes/auto-name-test/run.sh` — extend the `fetchTopic` tests with the Bedrock cases.

## Interface

`fetchTopic` takes a `provider` in place of the bare `apiKey`:

```
fetchTopic(text, provider, opts = {}) -> Promise<string | null>

provider =
  { kind: "anthropic", apiKey, model = "claude-haiku-4-5" }
  { kind: "bedrock",   baseUrl, model }

opts = { fetch = globalThis.fetch, timeoutMs = 2000 }
```

- `anthropic` builds the existing request exactly as today: POST
  `https://api.anthropic.com/v1/messages`, headers `x-api-key` + `anthropic-version:
  2023-06-01` + content-type, body with `model`, `max_tokens: 16`, `system`, `messages`.
- `bedrock` builds: POST `{baseUrl}/model/{model}/invoke` with a single `content-type`
  header and no auth; body `{ anthropic_version: "bedrock-2023-05-31", max_tokens: 16,
  system, messages }` with no `model` field. A trailing slash on `baseUrl` is stripped;
  `model` goes into the path verbatim (not URL-encoded) — the live probe proved the raw
  value works and encoding risks the gateway's routing.
- Both parse the reply as `data.content[0].text` and run it through the existing `asLabel`
  guard; the response shape is the same on both routes (FINDINGS).
- Any non-2xx, network error, abort/timeout, malformed body, or non-label answer returns
  null on both routes. `fetchTopic` never throws to its caller.

Keep the model default (`claude-haiku-4-5`) for the anthropic provider so existing callers
that omit it are unchanged.

## Tests

- [ ] anthropic provider: request goes to `api.anthropic.com`, carries `x-api-key` and
      `anthropic-version`, body includes `model` — asserted via the injected fetch (the
      existing test, adapted to the new `provider` argument)
- [ ] bedrock provider: URL is `{baseUrl}/model/{model}/invoke`, headers are content-type
      ONLY (no `x-api-key`, no auth), body has `anthropic_version: "bedrock-2023-05-31"` and
      NO `model` field
- [ ] bedrock provider: a `baseUrl` with a trailing slash still produces a single-slash path
- [ ] bedrock provider: the model id is in the path verbatim (a value with a `:` is not
      percent-encoded)
- [ ] both providers: a valid `content[0].text` label is returned through `asLabel`; a
      non-kebab answer (a clarifying sentence) returns null
- [ ] both providers: non-2xx returns null; a fetch that rejects returns null; an abort past
      `timeoutMs` returns null — none throw
- [ ] the label extraction is identical for a bedrock and an anthropic response body of the
      same shape

## Done when

- [ ] `fetchTopic` accepts the `provider` shape and builds the correct request for each kind
- [ ] the Bedrock request matches DESIGN 2.3 exactly (path, headers, body), asserted by the
      suite via the injected fetch
- [ ] every failure path returns null on both routes, and `run.sh` is ALL PASS
