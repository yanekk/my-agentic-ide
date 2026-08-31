# bedrock-agent-naming — Design

## 1. Purpose

The `smart-agent-names` feature names agents with a Haiku label inferred from the first
message, calling `api.anthropic.com` directly with a key from `config anthropic-api-key`.
The person's company blocks the public Anthropic API and runs Claude Code against AWS
Bedrock through a company gateway. In that environment the namer has no key, so the Haiku
half of the name never fires and every agent falls back to the opening-words placeholder.

This feature adds a second way for the namer to reach Haiku: when the session is itself
configured for Bedrock, name through the same gateway Claude Code already uses, with no key
and no extra setup. The existing key path stays for any session not on Bedrock. It is for
the one person whose environment this is, on both their company machine (Bedrock) and any
personal machine (key or nothing).

### Success criteria

- In a Bedrock session on the company gateway, an ordinary first message yields a 1-3 word
  kebab label in the fleet list within about two seconds, with no key and no config step.
- A session not on Bedrock behaves exactly as it does today: key present means Haiku, key
  absent means the placeholder, no error either way.
- A Bedrock session never sends a prompt to the public Anthropic API, even when a personal
  key happens to be set on the same machine.
- No new dependency is added; the Bedrock call uses the same Node built-in `fetch`.

### Stance

- The route is derived from the session's own environment, not configured by hand. Claude
  Code already decided the session is on Bedrock and where the gateway is; the namer
  follows that decision rather than keeping its own copy of it.
- Bedrock, once detected, is exclusive. A session on Bedrock reaches Haiku only through the
  gateway, never the public API, because quietly routing a work prompt to the public API
  from a company session is a policy breach, not a fallback.
- Zero external dependencies, unchanged from `smart-agent-names`: the gateway call is a
  plain `fetch`, no AWS SDK and no signing library.

---

## 2. Behaviour specification

The numbers here continue the concerns of `smart-agent-names/DESIGN.md`; this feature
touches only how the Haiku call is routed (its §2.4 gate and §2.5 fetch). Everything about
which signal names a session, the freeze, and the person-rename back-off is unchanged.

### 2.1 Two routes, chosen from the environment

The namer's Haiku call has two transports:

- **Bedrock** — a plain POST to the company gateway, used when the session is on Bedrock.
- **Anthropic** — the existing POST to `api.anthropic.com` with the `x-api-key` from
  `config anthropic-api-key`, used when the session is not on Bedrock.

The route is decided per call from the hook's environment, in this order:

1. If the session is on Bedrock (2.2), use the Bedrock route. If it is on Bedrock but the
   gateway is not fully configured, naming is off — the Anthropic route is not consulted.
2. Otherwise, if a key is configured, use the Anthropic route.
3. Otherwise naming is off, exactly as today.

Bedrock is checked first and is exclusive because of the policy point in the Stance: the
key path must never run inside a Bedrock session. The reason step 1 does not fall through
to the key when Bedrock is under-configured is the same one — a Bedrock session that cannot
reach its gateway should produce no name rather than reach the public API behind the
person's back.

### 2.2 What counts as "on Bedrock"

A session is on Bedrock when all three are present in the hook's environment:

- `CLAUDE_CODE_USE_BEDROCK` is set to a truthy value (present, non-empty, not `0` or
  `false`) — this is the flag Claude Code itself reads to route to Bedrock.
- `ANTHROPIC_BEDROCK_BASE_URL` is a non-empty URL — the company gateway. Its absence means
  Claude Code is talking to Amazon's own Bedrock endpoints directly, which need AWS request
  signing this feature does not do (see §8), so without it the Bedrock route is treated as
  not configured.
- A Haiku model id is present, taken from `ANTHROPIC_DEFAULT_HAIKU_MODEL` first, then
  `ANTHROPIC_SMALL_FAST_MODEL`. The first is the explicit Haiku model; the second is Claude
  Code's documented small-fast slot and a reasonable fallback. Bedrock addresses the model
  by id in the request, so with no id there is nothing to call and the route is off.

All three are read from the environment the hook is already handed, so detection stays a
pure function of its inputs and is fully testable (§3.1).

### 2.3 The Bedrock request

The gateway speaks the Bedrock InvokeModel wire format. The request the namer builds, proven
against the live gateway during planning (FINDINGS):

```
POST {ANTHROPIC_BEDROCK_BASE_URL}/model/{modelId}/invoke
headers: { "content-type": "application/json" }        # no auth header
body: {
  "anthropic_version": "bedrock-2023-05-31",           # the Bedrock value, not the API date
  "max_tokens": 16,
  "system": <the existing LABEL_PROMPT>,
  "messages": [{ "role": "user", "content": "First message: " + <tidied prompt> }]
}
```

Three things differ from the Anthropic request and each has a reason:

- No auth header. The gateway authorizes on the company's Tailscale network identity alone;
  a request that reaches it is already trusted. This was confirmed live (a call with only a
  content-type header returned 200).
- No `model` field in the body. Bedrock carries the model in the URL path, not the body.
- The model id goes into the path verbatim, not URL-encoded. The live probe used the raw
  value of `ANTHROPIC_DEFAULT_HAIKU_MODEL` in the path and the gateway accepted it;
  encoding it could break the gateway's own routing. A trailing slash on the base URL is
  stripped so the path is well-formed.

The response body is the Anthropic message shape (`content[0].text`), the same as the
public API returns, so the label extraction is unchanged.

### 2.4 The unhappy paths

All of these collapse to "no name", never an error in the prompt box, unchanged in spirit
from `smart-agent-names/DESIGN.md §2.6`:

- Gateway unreachable, times out, or returns a non-2xx: the call returns null within the
  ~2s timeout and the session keeps its placeholder. The prompt is never held longer than
  the timeout.
- On Bedrock but the base URL or model id is missing: naming is off (2.1), the key is not
  read, nothing is sent anywhere.
- The gateway returns a body that is not a valid label (a clarifying sentence, empty, wrong
  shape): rejected by the same kebab-label guard as the Anthropic route, session keeps its
  placeholder.
- Not on Bedrock and no key: off, exactly as today.

---

## 3. Architecture

### 3.1 The boundary

Unchanged from `smart-agent-names`. `fetchTopic` and `candidateTopic` in
`bin/cockpit-auto-name.mjs` are pure functions of their arguments: they take the
environment, the state directory and the `fetch` implementation as parameters and touch the
world only through the injected `fetch`. The route decision (2.1, 2.2) is added inside
`candidateTopic` and reads only its passed-in `env`, so it is exercised with a plain object
and no network.

What enforces it is the existing `run.sh` check that `cockpit-auto-name.mjs` imports nothing
outside `node:*`. The Bedrock call uses the global `fetch` and adds no import, so the check
holds. If it ever fails, the fix is to move the code back inside the boundary, never to
relax the check.

### 3.2 Modules

- `bin/cockpit-auto-name.mjs` — the only code file this feature touches. `fetchTopic` gains
  a transport parameter; `candidateTopic` gains the route decision. `decide`, `runHook`,
  the freeze model and the naming signals are untouched.
- `bin/cockpit-config.mjs` — not touched. `config` and the key store stay exactly as they
  are (the person chose to leave the route invisible; §7).

### 3.3 The decision function

`fetchTopic(text, provider, opts)` returns a validated kebab label or null. `provider`
describes the transport and carries everything transport-specific:

```
{ kind: "anthropic", apiKey, model }          # model defaults to "claude-haiku-4-5"
{ kind: "bedrock",   baseUrl, model }          # model from the env, baseUrl the gateway
```

`candidateTopic(input, state, env, opts)` builds the provider from `env` by the rules in
2.1/2.2 and returns `fetchTopic(...)` or null. Both are functions of their arguments and
nothing else; `opts` still carries the injectable `fetch` and `timeoutMs`.

### 3.4 Storage

None added. The Bedrock route stores nothing — it reads the environment each call. The
`auto-names/` per-session state and the `anthropic-api-key` file are unchanged.

---

## 4. Testing

One layer, as today: the `spikes/auto-name-test/run.sh` node suite drives `fetchTopic` and
`candidateTopic` with an injected fake `fetch`, so both routes are tested end to end without
a network or a key. The Bedrock work adds assertions on the request the fake `fetch`
receives (URL, headers, body shape) and on the route the environment selects. The one thing
the suite cannot prove is that the real gateway names a real agent inside the budget; that
is §5.1.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5) |
| Language / runtime | node v24.2.0 — global `fetch`, no HTTP library needed |
| Toolchain | wezterm; claude 2.1.251; git |
| **Deliberately absent** | no package manager, `package.json`, or `node_modules`; no Anthropic SDK; no AWS SDK or `aws`-CLI dependency in the shipped code |

**The test command.**

```
spikes/auto-name-test/run.sh
```

Quiet on pass (a count per suite; `VERBOSE=1` restores per-check lines), no colour, loud and
non-zero on failure. This is the same suite `smart-agent-names` uses and the only automated
evidence for this feature.

**Dependencies.** None may be added, unchanged from `smart-agent-names`. The gateway call
uses the global `fetch`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A real agent in a Bedrock session is named through the gateway within ~2s | needs the company Bedrock environment, the live gateway and real network latency — none present on the machine the suite runs on |

The gateway's reachability without credentials is already established (FINDINGS, planning:
a live call returned 200), so it is not a pending row — only the end-to-end naming of a real
agent and its latency remain for a person.

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| The fetch timeout | ~2000ms | no gateway call can hang the prompt box |
| `max_tokens: 16` on the request | on | the call is tiny; a runaway response cannot accrue cost |
| The call target is the company's own gateway | — | no public metered API is involved, so a leaked or repeated call has no external bill |
| An injected fake fetch in the tests | on in tests | the suite never touches the network or the gateway |

Never ask the person to exercise an unbounded or uncapped path to find something out, and
never do it yourself.

---

## 6. Recovery

Nothing here can lock the person out; the worst case is a missing or poor label, which they
fix by renaming the session by hand (wins forever, as today). Naming turns off by leaving
the Bedrock environment or unsetting the key — there is no new state to clear.

---

## 7. Decisions and rationale

- **Bedrock wins over a personal key (2026-08-31, with the user).** Alternative: the key
  wins when set. Rejected because a personal key left set inside a company Bedrock session
  would silently route a work prompt to the public Anthropic API, a policy breach. So the
  key path runs only when the session is not on Bedrock.
- **A Bedrock session that is under-configured produces no name rather than falling back to
  the key (planning).** Same reason as above: the fallback would reach the public API from
  a Bedrock session.
- **`config` is left unchanged; the active route is not surfaced (2026-08-31, with the
  user).** Alternative considered: a status line showing the route, or an off-switch.
  Rejected on scope — the route is derivable from the environment and the added command
  surface and stored state were judged not worth it now. May be revisited.
- **The route is read from the session's environment, not stored (planning).** Claude Code
  already owns the Bedrock decision and the gateway URL; a second stored copy in the cockpit
  would drift from it. Reading the environment each call keeps one source of truth.
- **One `fetchTopic` with a transport parameter, not two functions (planning).** The two
  routes differ only in URL, headers and body; sharing the timeout, the error discipline
  and the label guard in one call site keeps the "never throw, never hang" contract in one
  place rather than duplicated.
- **The model id is used verbatim in the URL path (planning).** The live probe proved the
  raw env value works; encoding it risks breaking the gateway's routing.

---

## 8. Explicitly out of scope

- **Direct AWS Bedrock with no company gateway.** When `CLAUDE_CODE_USE_BEDROCK` is on but
  there is no `ANTHROPIC_BEDROCK_BASE_URL`, Claude Code is calling Amazon's Bedrock
  endpoints directly, which require AWS SigV4 request signing (or shelling out to the `aws`
  CLI). This feature does not sign requests: the person's environment is a gateway, and
  building a signing path for a setup no one here uses is cost without a user. Recorded so
  it is a deliberate decision to revisit, not an oversight. Such a session gets no Haiku
  name (it keeps the placeholder).
- **A `config` control or view for the route.** See §7 — left out by the person's choice.
- **An off-switch for naming inside a Bedrock session.** The call is 16 tokens against the
  company's own gateway; the cost does not justify a new stored setting the code must honour
  everywhere.
