# Implementation plan

7 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Prove the ground first.** Everything rides on Claude Code actually handing a statusline
  script the `rate_limits` object, in a shape we assume. T00 captures a real sample from the
  user's live subscription before any parsing code is written against it.
- **Headless core before any pixel.** The store, the pure model and the tap are built and
  proven against that captured sample and synthetic inputs, with no footer involved. By the end
  of Phase 1 the numbers flow into the cache correctly and the registration is safe.
- **Recovery before autostart.** The tap's `--uninstall` (restore the prior statusline) is part
  of the same task as `--install`, so the way back exists before the thing is ever registered.
- **The UI wires to proven logic.** The footer segment (Phase 2) only formats what the model
  already decides and the store already holds.
- **The live-world check is last, with the user.** Only a real subscription proves the numbers
  reach the footer; that is T06, and it is verified by hand.

```
Phase 0  ▸  T00              prove rate_limits arrives, capture the shape   throwaway
Phase 1  ▸  T01 T02 T03 T04  store, pure model, tap, registration           no UI
Phase 2  ▸  T05              the footer usage segment
Phase 3  ▸  T06              install and verify on the live subscription    with the user
```

---

## Phase 0 — Prove the ground

Nothing is designed on top of an assumption that has not been checked on this machine.

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-capture-rate-limits.md) | Capture the real `rate_limits` stdin shape from a live session | — |

**T00 gates the parse.** If `rate_limits` arrives with `five_hour`/`seven_day` and
`used_percentage`/`resets_at` as expected, T02's `normalizeRateLimits` and all the tests are
written against the captured sample. If the field names or nesting differ, the normalize and the
cache shape (§3.5) change to match before anything parses it. If it does not arrive at all on
this version, the whole approach stops here and we reconsider (Method 2, §8). Throwaway; deleted
after the sample is recorded in FINDINGS.

## Phase 1 — Headless core

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-usage-store.md) | `cockpit-usage-store.mjs` — read/write the cache, atomic, 0600 | — |
| [T02](tasks/T02-usage-model.md) | `cockpit-usage-model.mjs` — normalize + `renderUsage`, pure, + purity grep | T00 |
| [T03](tasks/T03-usage-tap.md) | `cockpit-usage-tap.mjs` — the statusline command, gate + write | T00, T01, T02 |
| [T04](tasks/T04-install.md) | Register the statusline in settings.json; `--install`/`--uninstall`; wire into `bin/install.sh` | T03 |

At the end of Phase 1: a personal session's numbers land in `usage-cache.json`, a company
session writes nothing, and the registration is installed and reversible — all provable without
a footer.

## Phase 2 — The footer

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-footer-segment.md) | `cockpit-strip.mjs` draws the usage segment; watches the cache | T01, T02 |

At the end of Phase 2: the footer shows whatever is in the cache, formatted and coloured, dims
when stale, shows nothing when absent — proven in `spikes/cockpit-test/` with seeded caches.

## Phase 3 — Verify on the real subscription

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-verify.md) | Install, and verify the real numbers on a live personal session and a Bedrock session | T04, T05 |

At the end of Phase 3: seen working by hand, recorded in FINDINGS with the date.

---

## Critical path

```
T00 → T02 → T03 → T04 → T06
```

T01 is off the path (needed by T03 and T05 but small and independent). T05 depends only on T01
and T02, so it can be built in parallel with T03/T04; T06 needs both branches done.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | — |
| **Medium** | T02 (all the display logic and its tests), T03 (gating + safety), T04 (settings merge, chaining) |
| **Light** | T00, T01, T05, T06 |

Where it may overrun: T04, if a pre-existing statusline forces the chaining path to be built and
tested properly rather than the empty-output default; and T00, if `rate_limits` turns out to
need a first real response before it appears, making the capture fiddlier than one turn.

## Decisions still open

None blocking. Everything user-facing was settled 2026-09-16 (DESIGN §7). T00's result could
still force the cache shape to change, which is exactly why it runs first.
