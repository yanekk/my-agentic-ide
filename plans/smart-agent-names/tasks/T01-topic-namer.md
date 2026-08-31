# T01 — Haiku topic-namer and label guard

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Build the piece that turns a first message into a validated one-to-three-word kebab topic by
asking Claude Haiku 4.5, and the guard that throws away anything that is not a clean label.
It is an exported function in the hook file, with the web call and the timeout injectable, so
the whole of it is exercised by the test suite without ever touching the network or needing a
real key. This is the inference half of the feature; T03 wires it into the hook.

## Design sections this implements

DESIGN 2.5 (the guard), 3.1 (the network stays out of `decide`, and the call needs no
import because `fetch` is a global), 5.2 (the timeout seatbelt).

## Files

- `bin/cockpit-auto-name.mjs` — add the exported `fetchTopic` and the guard helper and its
  system prompt. Do not touch `decide` or `runHook` here; that is T03.
- `spikes/auto-name-test/naming.test.mjs` — add the cases below.

## Interface

```
// Returns a validated kebab topic, or null for any failure, timeout, or non-label answer.
export async function fetchTopic(text, apiKey, opts = {}) → Promise<string|null>
//   opts.fetch     = globalThis.fetch   (injected in tests)
//   opts.timeoutMs = 2000
//   opts.model     = "claude-haiku-4-5"

// The guard, exported for direct testing.
export function asLabel(s) → string|null   // trim, lowercase, accept iff /^[a-z0-9]+(?:-[a-z0-9]+){0,3}$/, else null
```

`fetchTopic` POSTs to `https://api.anthropic.com/v1/messages` with headers `x-api-key`,
`anthropic-version: 2023-06-01`, `content-type: application/json`, and a body of
`{ model, max_tokens: 16, system: <the label prompt>, messages: [{role:"user", content:"First message: "+text}] }`.
It reads `data.content[0].text`, runs it through `asLabel`, and clips to `MAX_RIGHT`. The
timeout is an `AbortController` on `opts.timeoutMs`. Any thrown error, aborted call, non-ok
status, or unexpected shape returns null — a naming call never throws to its caller.

The system prompt is the one the spike settled on: label a coding-agent session, output only
a 1-3 word lowercase kebab topic (the noun subject), no verbs, no filler, no punctuation, no
quotes, with the three worked examples from the spike.

## Tests

- [ ] a normal message returns the label from a fake fetch (`{content:[{text:"oauth-loopback"}]}` → `oauth-loopback`)
- [ ] a sentence answer (the "hey" case) returns null
- [ ] an answer with spaces, capitals, or trailing punctuation returns null via `asLabel`
- [ ] a five-word dashed answer returns null (the regex caps at four)
- [ ] a fetch that rejects (network error) returns null, not a throw
- [ ] a non-2xx response returns null
- [ ] malformed or empty JSON returns null
- [ ] a fetch that never resolves is aborted at `timeoutMs` and returns null
- [ ] `asLabel` trims and lowercases before matching
- [ ] no test makes a real network call — every case injects `opts.fetch`

## Done when

- [ ] `fetchTopic` and `asLabel` are exported from `cockpit-auto-name.mjs` and used by nobody yet
- [ ] `spikes/auto-name-test/run.sh` passes, still importing nothing outside `node:*`
- [ ] the suite runs with no network access and no key present
