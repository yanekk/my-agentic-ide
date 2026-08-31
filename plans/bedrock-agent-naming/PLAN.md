# Implementation plan

3 tasks in 2 phases. Each has a file in [tasks/](tasks/) with its goal, the files it
touches, the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

This extends the finished `smart-agent-names` feature; it touches one code file,
`bin/cockpit-auto-name.mjs`, plus docs.

---

## Shape of the build

- **Everything testable is built and proven before the one hands-on check.** T01 and T02
  are covered end to end by the existing suite with an injected `fetch`, so by the end of
  Phase 1 both routes and the route decision are proven without a network or a key. Phase 2
  is docs plus the single live check the suite cannot reach.
- **The transport before the policy that selects it.** T01 gives `fetchTopic` a working
  Bedrock transport; T02 adds the environment-driven choice of which transport to use. The
  policy is meaningless until the transport it selects exists, and splitting them keeps two
  independently testable units — the request shape, and the route matrix.
- **No spike.** The one load-bearing unknown — whether the gateway answers without
  credentials — was settled live during planning (FINDINGS), so there is no T00.

```
Phase 1  ▸  T01 T02    the two routes and the choice, headless   fully tested
Phase 2  ▸  T03        docs + the one live check                 hands-on
```

---

## Phase 1 — Both routes, chosen from the environment

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-bedrock-transport.md) | Bedrock transport in `fetchTopic` | — |
| [T02](tasks/T02-route-selection.md) | Route decision in `candidateTopic` (Bedrock wins) | T01 |

At the end of Phase 1 the namer can call Haiku through the gateway, and it picks the gateway
over the key inside a Bedrock session and never reads the key there — all proven by the
suite.

## Phase 2 — Docs and the live check

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-docs-and-verify.md) | CLAUDE.md, and verify a real agent is named via the gateway | T01, T02 |

At the end of Phase 2 the naming paragraph and known limits in CLAUDE.md describe the
Bedrock route, and a real agent has been named through the gateway within the ~2s budget on
the company machine, recorded in FINDINGS.

---

## Critical path

```
T01 → T02 → T03
```

Nothing is off the path; it is a short linear chain.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | — |
| **Medium** | T01, T02 |
| **Light** | T03 |

T01 and T02 are medium not for volume — each is a small change to one function — but because
the tests are the substance: T01 must assert the exact Bedrock request, T02 the full route
matrix including that the key is never read on Bedrock. T03 is light: doc edits plus one
hands-on check. The likeliest overrun is T03's live check waiting on the person to be at the
company machine.

## Decisions still open

None blocks the build. The `config` route-visibility question was decided closed (DESIGN §7)
and direct-AWS signing is out of scope (DESIGN §8); either could become a follow-on plan if
the person later wants it, but neither gates a task here.
