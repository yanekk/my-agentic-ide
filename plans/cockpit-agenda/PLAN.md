# Implementation plan

9 tasks in 5 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **The riskiest unknown goes first, as a spike.** Whether a company Google Workspace will let
  this connect at all is not answerable from here, and every task after T00 assumes it does.
  One short session buys that certainty; discovering it in the middle of T05 would waste four.
- **Everything testable automatically is built and proven before anything draws.** By the end
  of Phase 1 every rule in DESIGN §2.3, §2.4, §2.7 and §2.8 is implemented and covered from
  fixtures with a fixed clock. Phase 3 then wires a surface onto logic already known correct.
- **The pure core before the network, the network before the command.** T02/T03 need nothing
  to exist. T04 needs somewhere to put a token. T05 needs all of it.
- **Nothing touches the live cockpit until the parts it would call are green.** T06 and T07
  edit two files the cockpit boots from, and a broken `cockpitd.mjs` is a window that will not
  come up. They are late, small, and each is fenced by an existing test suite.
- **The dangerous thing runs bounded first.** `agenda add` opens a browser and signs you in;
  `AGENDA_DRY_RUN=1` prints the URL instead, and every test points `COCKPIT_DIR` at a temp dir
  so no test can reach your real sign-ins.

```
Phase 0  ▸  T00                prove the ground              throwaway, needs the user
Phase 1  ▸  T01 T02 T03        state + pure rules + drawing   headless, no network
Phase 2  ▸  T04                Google                         stubbed HTTP, still headless
Phase 3  ▸  T05                the `agenda` command
Phase 4  ▸  T06 T07            the pane and the refresh       touches the live cockpit
Phase 5  ▸  T08                for real, with the user
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-oauth-reachability-spike.md) | Can both Google accounts actually connect? | — |

**T00 gates the entire plan.** It answers four things nothing else can: whether a Google
registration can be created at all, whether the **personal** account signs in, whether the
**company** account signs in or is blocked by its administrator, and which publishing status
(*Testing* vs *In production*) issues a refresh token that does not expire in a week
(DESIGN §2.9 flags that last one as believed-not-verified).

- **Both connect** → build the rest exactly as planned; record the publishing status in
  FINDINGS.md so nobody rediscovers it.
- **Company blocked** → **stop and return to the user** with the fallback options priced. Do
  not invent one. The user declined building the private-link fallback on spec (DESIGN §7) and
  choosing one is theirs.
- **Refresh tokens expire weekly and cannot be made not to** → no redesign follows. DESIGN
  §2.7's loud `sign-in expired · agenda add work` line already handles it; record it in
  FINDINGS.md as a known cost and carry on.

Throwaway code, deleted at the end of the session. Its findings are the deliverable.

## Phase 1 — The headless core

No network, no pane, no browser. At the end of this phase every display rule is implemented
and proven against fixtures at a fixed clock, and there is nowhere for a bug to hide behind
"you would have to see it".

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-store.md) | The state files, the lock, atomic writes, file modes | T00 |
| [T02](tasks/T02-model-select.md) | Normalising Google's event shape, and choosing what shows | T00 |
| [T03](tasks/T03-model-render.md) | Drawing the column: colours, `NOW`, `?`, stale, errors, overflow | T01, T02 |

T02 and T03 are the whole behaviour. T01 is independent of both and could equally be built
after them; it is first because T04 needs somewhere to put a refresh token.

## Phase 2 — Google

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-google-client.md) | Sign-in (PKCE loopback), token refresh, `calendarList`, `events` | T01 |

Still headless: every test runs against a **stub HTTP server on loopback**, never Google. The
one thing it cannot prove — that a real consent screen redirects back correctly — was already
proven by hand in T00.

## Phase 3 — The command

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-agenda-cli.md) | `agenda` — add, rm, ls, color, setup, help; the agent refusal | T01, T02, T03, T04 |

At the end of this phase the feature is fully usable from a terminal with nothing drawn in the
pane yet. That is deliberate: it means T06 has something real to render.

## Phase 4 — The cockpit

Two files the cockpit boots from. Each is fenced by an existing suite that must stay green.

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-welcome-column.md) | Split the right column: NOTES over AGENDA | T03, T05 |
| [T07](tasks/T07-daemon-refresh.md) | The 60s tick, the on-return refresh, the one-in-flight guard | T04, T05 |

## Phase 5 — For real

| # | Task | Depends on |
|---|---|---|
| [T08](tasks/T08-live-verification.md) | End to end on the user's real calendars; docs and `CLAUDE.md` | T06, T07 |

**T08 is mostly the user's hands.** Its deliverable is FINDINGS.md rows and the documentation,
not code.

---

## Critical path

```
T00 → T01 → T04 → T05 → T06 → T08
                          └──→ T07 ──┘
```

**T02 and T03 are off the critical path** in principle — they depend only on T00 — but T05
needs them, so in a strictly serial one-task-per-session build the order is simply T00 … T08.
T03 is the single heaviest task and the one most worth reviewing carefully; if anything is
going to be split, it is that one.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03 (every display state, every size), T04 (OAuth plus four REST paths plus error classification) |
| **Medium** | T01, T02, T05, T06, T07 |
| **Light** | T00 (short, but blocking and needs the user), T08 (mostly verification and docs) |

**Where this will overrun.** T04's error classification — telling "the network is down" apart
from "Google revoked you" apart from "that calendar is gone" (DESIGN §2.7) — is where the
subtlety is, and getting it wrong makes the column shout at a wifi blip or stay silent about a
dead sign-in. T03's row budget arithmetic (DESIGN §2.6: agenda capped at half, gives slack
back, notes never below three) is fiddly and needs testing at many sizes.

## Decisions still open

**One, and it does not block:** what to do if T00 reports the company account is blocked.
DESIGN §7 records that the user deliberately declined to build the private-link fallback on
spec. If T00 comes back blocked, that session **stops and asks** — it does not choose.

Nothing else is open. Every behavioural question raised during planning was answered by the
user on 2026-08-26 and is recorded with its reason in DESIGN §7.
