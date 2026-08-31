# T02 — Route decision in `candidateTopic` (Bedrock wins)

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

Decide, per call and from the session's own environment, which transport the namer uses:
the Bedrock gateway when the session is on Bedrock, the existing Anthropic key otherwise,
and nothing when neither is available. Bedrock is checked first and is exclusive — a session
on Bedrock must never read the key or reach the public API, because that would route a work
prompt off-policy. This task builds the `provider` T01 consumes; it changes no request
shapes.

## Design sections this implements

DESIGN 2.1 (the route order and Bedrock's exclusivity), 2.2 (what counts as "on Bedrock"
and where the model id comes from), 2.4 (off when under-configured or keyless).

## Files

- `bin/cockpit-auto-name.mjs` — `candidateTopic` only, and its use of `readKeyFile`. Do not
  touch `fetchTopic` (T01), `decide`, or `runHook`. The COCKPIT_REPO / session-id /
  frozen / person-rename / slug / worktree guards at the top of `candidateTopic` are
  unchanged and still run first — the route decision replaces only the `readKeyFile` +
  `fetchTopic` tail.
- `spikes/auto-name-test/run.sh` — extend the `candidateTopic` tests with the route matrix.

## Interface

Inside `candidateTopic(input, state, env = {}, opts = {})`, after the existing guards pass,
choose the provider:

```
onBedrock(env)  = truthy(env.CLAUDE_CODE_USE_BEDROCK)
                  && nonEmpty(env.ANTHROPIC_BEDROCK_BASE_URL)
                  && (env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_SMALL_FAST_MODEL)

truthy(v) = v is present, non-empty, and not "0" or "false"

if truthy(env.CLAUDE_CODE_USE_BEDROCK):
    if base URL and a model id are both present:
        provider = { kind: "bedrock", baseUrl, model }   # model: DEFAULT_HAIKU first, then SMALL_FAST
    else:
        return null                                       # on Bedrock but under-configured: OFF, do not read the key
else:
    apiKey = readKeyFile(dir)
    if !apiKey: return null
    provider = { kind: "anthropic", apiKey }

return fetchTopic(input.prompt, provider, { fetch, timeoutMs })
```

The critical rule is the `if truthy(env.CLAUDE_CODE_USE_BEDROCK)` branch never falls through
to `readKeyFile`: on Bedrock the key is neither read nor used. `baseUrl` is
`env.ANTHROPIC_BEDROCK_BASE_URL`; the model id is `env.ANTHROPIC_DEFAULT_HAIKU_MODEL` if set
else `env.ANTHROPIC_SMALL_FAST_MODEL`.

## Tests

- [ ] on Bedrock (flag + base URL + `ANTHROPIC_DEFAULT_HAIKU_MODEL`): builds a bedrock
      provider with that base URL and model, and calls `fetchTopic` with it
- [ ] on Bedrock, only `ANTHROPIC_SMALL_FAST_MODEL` set (no `ANTHROPIC_DEFAULT_HAIKU_MODEL`):
      uses the small-fast model
- [ ] on Bedrock, `ANTHROPIC_DEFAULT_HAIKU_MODEL` present: it wins over
      `ANTHROPIC_SMALL_FAST_MODEL`
- [ ] Bedrock flag on but no base URL: returns null (off) and — asserted — never calls
      `readKeyFile` even when a key file exists
- [ ] Bedrock flag on but no model id in either var: returns null (off), key not read
- [ ] `CLAUDE_CODE_USE_BEDROCK` set to `0` / `false` / empty: treated as NOT on Bedrock, so
      the key path is taken when a key exists
- [ ] not on Bedrock, key present: builds an anthropic provider (existing behaviour)
- [ ] not on Bedrock, no key: returns null (off)
- [ ] the existing upstream guards still short-circuit before any route choice: no
      COCKPIT_REPO, a foreign session id, a frozen/backedOff state, a person-renamed title,
      a slug prompt, or a worktree cwd each return null without selecting a provider
- [ ] on Bedrock, a key file is present on disk: prove via a spy/injected reader that the key
      is never read and the anthropic route is never taken

## Done when

- [ ] `candidateTopic` selects bedrock / anthropic / off exactly per DESIGN 2.1–2.2, with
      Bedrock exclusive
- [ ] a session on Bedrock never reads or uses the key, proven by a test
- [ ] the model-id precedence (DEFAULT_HAIKU then SMALL_FAST) holds, and `run.sh` is ALL PASS
