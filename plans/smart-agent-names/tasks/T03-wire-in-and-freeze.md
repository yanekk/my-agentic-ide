# T03 — Wire into the hook: gate, hold, freeze

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

Make the naming hook actually use the topic-namer: on the first prompt of a cockpit session
with an ordinary message and a configured key, hold the prompt while Haiku names it, and set
that name once. Change `decide` so the first real name freezes the session and the machine
never renames it again, which is where "follows the work" is retired for the label. Leave the
human-rename path and the no-key path behaving exactly as they do today.

## Design sections this implements

DESIGN 2.1 (order of authority), 2.2 (named once then frozen; the daemon's worktree
migration is untouched), 2.3 (the hold and its timeout), 2.4 (the `COCKPIT_REPO` gate), 2.6
(no-key degradation), 2.n (silent failures), 3.1/3.3/3.4 (the boundary, the new `decide`
signature, the flow).

## Files

- `bin/cockpit-auto-name.mjs` — extend `decide` to take the candidate and honour a `frozen`
  flag, and extend `runHook` to read the key (via T02's `readApiKey`... but without importing
  the config module — read the same file directly, so the dependency-boundary check stays
  green), gate on `COCKPIT_REPO`, and call `fetchTopic` bounded by the timeout before calling
  `decide`.
- `spikes/auto-name-test/naming.test.mjs` — add the freeze and wiring cases below.

## Design sections this implements — the freeze model in `decide`

Order inside `decide(input, state, env, candidate)`: `backedOff` short-circuit; then the live
human-rename check (unchanged); then, if `state.frozen`, return null; then pick the strongest
name (2.1) and, if it is a real name, set `frozen`, else set the placeholder unfrozen. The
existing RANK ladder is replaced by this: a slug or worktree found on the first prompt is a
real name and freezes; the Haiku candidate is a real name and freezes; the opening-words
placeholder does not. Claude's own summary remains a real name only on the no-key path.

## Interface

```
export function decide(input, state, env = {}, candidate = null) → { title, state?, isNew? }
//   candidate: the guarded Haiku topic (string) or null, produced by runHook
//   state now carries { title, frozen?, backedOff? }  (rank is gone)

// runHook: reads DIR/anthropic-api-key directly; only calls fetchTopic when
//   process.env.COCKPIT_REPO is set AND a key is present AND the session has no name yet
//   AND the first message is ordinary prose (not a /pir-work slug).
```

The hook reads the key file directly rather than importing `cockpit-config.mjs`, so
`cockpit-auto-name.mjs` still imports nothing outside `node:*` and the boundary check holds.

## Tests

- [ ] first ordinary prompt with a candidate sets `<repo> / <candidate>` and marks frozen
- [ ] once frozen, a later prompt whose cwd is now a worktree does NOT rename it
- [ ] once frozen, a later `/pir-work slug` prompt does NOT rename it
- [ ] a human rename after freezing is detected, sets `backedOff`, and wins
- [ ] candidate null with no key: placeholder now, unfrozen; a later prompt takes Claude's summary and freezes (today's behaviour)
- [ ] candidate null from a timeout with a key: placeholder now, unfrozen; a later prompt with a candidate freezes
- [ ] first message is `/pir-work slug`: uses the slug, freezes, and `fetchTopic` is not called
- [ ] `runHook` does not call `fetchTopic` when `COCKPIT_REPO` is absent (mock/env-controlled)
- [ ] `runHook` does not call `fetchTopic` when no key is present
- [ ] every malformed hook input still exits 0 (the existing robustness cases keep passing)

## Done when

- [ ] a fed first prompt (with an injected candidate) produces a frozen `<repo> / <topic>` name
- [ ] the retired "follows the work" is proven by the two "does NOT rename" cases, and the daemon code is untouched
- [ ] `spikes/auto-name-test/run.sh` passes, `cockpit-auto-name.mjs` still imports only `node:*`

## Needs a person

The real hold, the real gate, and the live name are T04 — this task's evidence is the suite
with an injected candidate and a controlled environment, no network and no real key.
