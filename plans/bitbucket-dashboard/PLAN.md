# Implementation plan

11 tasks in 7 phases (0–6). Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Everything testable automatically is built and proven before anything draws in the pane.**
  The client, the pure model and the store are all green before the welcome pane is rewired, so
  the UI phase wires a surface to logic already known to be correct.
- **The riskiest unknown goes first, as a spike.** T00 proves that a prompt typed into the
  fleet's new-session box, followed by a real Enter, spawns a running agent already in the
  target repo's context. Every button that spawns rides on this, so nothing is built on it until
  it is proven in the live cockpit.
- **The client comes before the classify logic**, so the "which PRs show" brainstorm (§2.3) can
  be done against real data rather than guessed.
- **The read-only dashboard is built before the buttons.** Tabs, paging and Open (T08) work
  before Review/Address (T09), so the launchpad exists and is verified before the one gesture
  that starts an agent.

```
Phase 0  ▸  T00                 prove the spawn            throwaway
Phase 1  ▸  T01 T02 T03 T04      config, client, model, store   headless
Phase 2  ▸  T05                 the daemon fetch           cache fills, no UI
Phase 3  ▸  T06 T07             renderer, rewire the pane  dashboard shows, read-only
Phase 4  ▸  T08                 clicks: tabs, paging, Open
Phase 5  ▸  T09                 Review / Address auto-spawn
Phase 6  ▸  T10                 install, docs, CLAUDE.md
```

---

## Phase 0 — Prove the spawn

Nothing that starts an agent is built until the mechanism is proven on this machine.

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-spawn-spike.md) | Spike: spawn a running agent, in a repo's context, from the daemon | — |

**T00 gates T09 and the shape of `spawnAgent`.** It settles the exact `@`-reference form that
lands the agent in `{projectsRoot}/{slug}`, and confirms that a real Enter into the fleet box
spawns a running session (not just fills the box). If the plain-`@{slug}` form does not work,
its answer says what does (an absolute `@`-path, a `cd` in the prompt, or a different mechanism).
Throwaway code, deleted afterwards; the finding is recorded.

## Phase 1 — Headless core

Everything here is proven by the automated suite (T02's client via a loopback stub, T03's model
as pure functions), except the one read-only token check in T02 that only the user can run.

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-config-settings.md) | Extend `config` for the four BitBucket settings; new `bitbucket-test` suite | — |
| [T02](tasks/T02-bitbucket-client.md) | The BitBucket HTTPS client: identify me, list open PRs | T01 |
| [T03](tasks/T03-model-classify-render.md) | Pure model: normalize, classify, sort, paginate | T02 |
| [T04](tasks/T04-store.md) | The store: read config, read/write cache and view-state | T01 |

At the end of Phase 1 every rule about which PRs show and how they are counted and ordered is
implemented and tested, and the client can fetch real PRs.

**The classify brainstorm happens between T02 and T03.** T03 does not start until the user has
settled the inclusion rules (§2.3) with real PRs from T02's client in front of them.

## Phase 2 — The fetch

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-daemon-fetch.md) | `refreshPRs` in the daemon: three triggers, write the cache | T02, T04 |

At the end, `bitbucket-cache.json` fills and refreshes on the agenda's schedule. Nothing is
drawn yet.

**T05 does not depend on T03** (user, 2026-09-04): the fetch loop writes raw PRs to the cache;
classifying and sorting is T03's model, consumed by the renderer (T06), not here. So T05 is
off the critical path and buildable on T02 + T04 alone, without the classify brainstorm.

## Phase 3 — The screen

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-renderer.md) | Pure renderer: table, tabs, counts, paging, empty/offline/unconfigured; hit-zones | T03 |
| [T07](tasks/T07-rewire-pane.md) | Rewire the welcome pane to 75/25; draw the dashboard from the cache | T05, T06 |

At the end, the dashboard shows real PRs, read-only. Tabs and buttons do not react yet.

## Phase 4 — Clicks

| # | Task | Depends on |
|---|---|---|
| [T08](tasks/T08-clicks.md) | Mouse in the pane; cmd verbs for tabs, paging, Open; daemon dispatch | T07 |

At the end, you can switch tabs, page, and open a PR in the browser by clicking.

## Phase 5 — The payoff

| # | Task | Depends on |
|---|---|---|
| [T09](tasks/T09-review-address-spawn.md) | Review/Address auto-spawn via the T00 primitive | T00, T08 |

At the end, clicking Review or Address starts an agent working on the PR. Hand-verified.

## Phase 6 — Ship

| # | Task | Depends on |
|---|---|---|
| [T10](tasks/T10-install-docs.md) | install.sh, docs/cockpit.md, CLAUDE.md | T09 |

---

## Critical path

```
T01 → T02 → (classify brainstorm) → T03 → T06 → T07 → T08 → T09 → T10
```

Off the path, slot in wherever convenient: **T00** (parallel to all of Phase 1; must land before
T09), **T04** (needs only T01; feeds T05) and **T05** (needs T02 + T04; feeds T07 alongside T06).
Only **T03 → T06 → T07** now waits on the classify brainstorm; the fetch chain does not.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T02 (client + real-token check), T07 (rewire the shared pane), T08 (mouse + dispatch) |
| **Medium** | T00 (spike), T03 (model), T05 (fetch loop), T09 (spawn wiring) |
| **Light** | T01 (config + suite skeleton), T04 (store), T06 (renderer), T10 (docs) |

Where it may overrun: **T07**, because it changes `cockpit-welcome.mjs` — a pane the daemon
parks and swaps as the diff slot — and the split-ratio change plus the notes/agenda squeeze has
to not disturb that invariant. And **T00**, if plain `@{slug}` does not land the repo context and
the fallback mechanism is more involved.

## Decisions still open

- **Which PRs each tab shows (§2.3).** Provisional rules are recorded; the final rules are
  settled in a brainstorm with the user between T02 and T03, against real PRs. **This blocks
  T03** and nothing else — the client (T02) and everything before it proceed regardless. The
  session that reaches T03 must stop and raise it.
