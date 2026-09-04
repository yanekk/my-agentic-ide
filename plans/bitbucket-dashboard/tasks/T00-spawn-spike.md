# T00 — Spawn spike: a running agent, in a repo's context

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Prove the one mechanism this feature has no analog for: starting a new `claude agents` session
from the daemon, already working in a chosen repository, by driving the fleet view's own
new-session box. Everything that spawns (T09, and a future feature) rests on this, so it is
settled first, in the live cockpit, as throwaway code. The spike answers exactly what form of
prompt lands the agent in `{projectsRoot}/{slug}` and confirms that a real Enter into the box
launches a running session rather than only filling it.

## Design sections this implements

DESIGN §2.8 (the spawn primitive and the repo-context requirement), §5.1 (why this can only be
verified by a person).

## Files

Throwaway, under `spikes/spawn-probe/` — a small script the daemon-side can call, or a note of
the exact `wezterm cli` commands used. Deleted once the finding is recorded. Touches nothing in
`bin/`.

## Interface

The shape the spike is validating, which T09 will build for real:

```
spawnAgent({ repo, prompt })   // repo = a watched repo slug; prompt = the directive
  1. activate panes.fleet          (must show the new-session box, i.e. at the list)
  2. sendRaw(panes.fleet, `@${repo} ${prompt}`)   // no \r→\n swap
  3. send a real Enter (\r) to panes.fleet
```

The open questions the spike must answer, in order:

- Does `@{slug}` typed into the box resolve to `{projectsRoot}/{slug}` and put the agent in that
  repo's context? If not, what does — an absolute `@{projectsRoot}/{slug}`, a `cd` in the prompt,
  or spawning with an explicit cwd?
- Does a real Enter into the box create a running session, and does the daemon then see it as an
  attachable agent (a header name it can map via `claude agents --json`)?
- Does the auto-namer name it `{slug} / …` as expected, confirming the repo context took?

## Tests

Automated tests cannot spawn a real agent (the WezTerm/claude stub does not model session
creation). The spike's evidence is the hand-verification below. If any pure helper falls out
(e.g. building the `@{repo} {prompt}` string), unit-test that.

- [ ] the prompt-string builder, if one is extracted, is unit-tested

## Done when

- [ ] a documented sequence of `wezterm cli` calls spawns a running agent in a chosen repo's
      context from the daemon side, verified live with the user
- [ ] the exact reference form that achieves repo context is recorded in FINDINGS with the date
- [ ] the spike code is deleted and the answer written up for T09

## Needs a person

This is the whole task — only a live cockpit can run it.

```
# In a running cockpit, at the fleet list, from a cockpit terminal or the daemon:
#   activate the fleet pane, type "@<one-of-your-repos> Review Bitbucket PR <any-open-pr-url>"
#   into the new-session box, then send Enter.
# (Exact wezterm cli commands drafted in the spike; run with the user watching.)
```

Expect: a new agent starts, its shell/edits are in that repo (or its worktree), and the fleet
list names it after that repo.
Tell me: did the agent land in the right repo? Did plain `@{slug}` work, or was another form
needed? Did a single Enter start it, or did it need anything else?
