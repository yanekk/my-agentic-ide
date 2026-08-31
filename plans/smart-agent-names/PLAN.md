# Implementation plan

4 tasks in 2 phases. Each has a file in [tasks/](tasks/) with its goal, the files it
touches, the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

The spike that this plan would otherwise open with is already done — the `claude -p`
versus direct-API measurement and the name-quality check happened live on 2026-08-31, and
the result is in [FINDINGS.md](FINDINGS.md). So there is no T00 spike; T01 is the first
task.

---

## Shape of the build

- **Everything is proven headlessly before anything touches the live cockpit.** T01 and T02
  are pure logic and a file-backed command, both fully covered by the test suite. T03 wires
  them into the hook, still under the suite. Only then, in T04, does anything need the real
  binary and a person's eyes.
- **The two independent pieces come first, in parallel.** The topic-namer (T01) and the key
  store plus command (T02) do not depend on each other, so either can be built first; T03
  needs both.
- **The dangerous edge is verified last, with a seatbelt.** The only thing that spends money
  or exposes the key is the real call, and it is checked in T04 with the capped key and the
  `env` inspection, never before.

```
Phase 1  ▸  T01, T02        pure core + command, headless    suite-covered
Phase 2  ▸  T03, T04        wire in, then verify live         hook + human checks
```

---

## Phase 1 — The two independent pieces

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-topic-namer.md) | The Haiku topic-namer and the label guard, as an exported function driven by an injected fetch | — |
| [T02](tasks/T02-config-command.md) | The `config` command and the key store, symlinked onto the cockpit PATH | — |

At the end of this phase the topic can be inferred from a message and validated, and a key
can be set, read masked, and unset — all under the test suite, with no network and no live
cockpit.

## Phase 2 — Wire it in, then verify

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-wire-in-and-freeze.md) | Wire the namer into the hook: the gate, the hold, the freeze-once-named rule, all the fallbacks | T01, T02 |
| [T04](tasks/T04-install-docs-verify.md) | Relinking on rebuild, the CLAUDE.md docs and measured rows, and the hands-on verification | T03 |

At the end of this phase the feature is live, documented, and its hands-on half has been
seen working with the person.

---

## Critical path

```
(T01 and T02) → T03 → T04
```

T01 and T02 are both off each other's path and can be built in either order. Everything else
is sequential because T03 needs both pieces and T04 verifies T03.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03 — the gate, the bounded call, the freeze model, and every fallback all land here |
| **Medium** | T01, T02 |
| **Light** | T04 |

Where it may overrun: T03, because the freeze-once-named rule changes the shape of `decide`
and has to leave the human-rename and no-key paths exactly as they were. And T04's first
verification (the `COCKPIT_REPO` gate) can send the plan back to T03 if the assumption in
DESIGN 2.4 is wrong.

## Decisions still open

- **The `COCKPIT_REPO` gate (DESIGN 2.4).** The plan assumes a hook fired inside a dispatched
  agent sees `COCKPIT_REPO`. It is verified at the top of T04, and it also wants confirming
  by the review that this is the gate the person wants rather than "key is configured". It
  blocks nothing until T04, where a wrong answer forces a rethink of the gate.

Nothing else is open.
