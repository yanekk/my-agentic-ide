# T09 — Review / Address auto-spawn

**Phase:** 5 · **Depends on:** T00, T08 · **Weight:** medium

## Goal

Wire the two spawning buttons to the primitive T00 proved. Clicking Review (To-review tab) or
Address (Mine tab) starts a new cockpit agent already working in that PR's repo, with the short
directive. This is the payoff and the one gesture that starts an agent, so it is built last and
hand-verified.

## Design sections this implements

DESIGN §2.8 (the spawn primitive, the repo-context requirement, the deliberate `\r` inversion,
the minimal prompt, the MCP assumption), §7 (auto-start decision).

## Files

- `bin/cockpitd.mjs` — the `spawnAgent` primitive and the `bb-review:` / `bb-address:` dispatch
  (replacing the T08 no-ops).

## Interface

```
// The general, reusable primitive (built to the form T00 settled). PR-agnostic on purpose —
// a future feature calls it too.
function spawnAgent({ repo, prompt }) {
  activate(panes.fleet);                       // the new-session box at the list
  sendRaw(panes.fleet, `@${repo} ${prompt}`);  // repo context via the fleet's projects-root cwd
  sendEnter(panes.fleet);                       // a REAL Enter (\r) — inverts the injectReview rule
}

// Dispatch, resolving the PR from the cache by slug/id:
bb-review:{slug}/{id}   -> spawnAgent({ repo: slug, prompt: `Review Bitbucket PR ${htmlUrl}` })
bb-address:{slug}/{id}  -> spawnAgent({ repo: slug, prompt: `Address the review comments on Bitbucket PR ${htmlUrl}` })
```

If T00 found plain `@{slug}` insufficient, `spawnAgent` uses the form T00 recorded instead — the
task doc's exact string follows that finding.

## Tests

- [ ] a `bb-review:` verb sends `@{slug} Review Bitbucket PR {url}` to the fleet pane, then an Enter
- [ ] a `bb-address:` verb sends the address directive and an Enter
- [ ] the PR url is resolved from the cache by slug/id; an absent id is a safe no-op
- [ ] `spawnAgent` sends a real Enter (`\r`), not the `\n` the review-injection path uses
- [ ] the integration harness records the sent text and the Enter against the fleet pane

## Done when

- [ ] clicking Review or Address, in the stub harness, sends the right prompt and a real Enter to the fleet pane
- [ ] `spawnAgent` is PR-agnostic and reusable
- [ ] verified by hand that a real click starts a running agent working in the right repo

## Needs a person

Only a live cockpit can spawn a real agent (the stub cannot model claude creating a session).

```
# In a live cockpit at the fleet list, on the To-review tab, click Review on a real PR.
```

Expect: a new agent starts, is named after that repo, and is working on the PR (its shell/edits
in the repo, its MCP reaching the PR).
Tell me: did it spawn and start (not just fill the box)? Is it in the right repo? Did the
directive and PR URL arrive intact?
