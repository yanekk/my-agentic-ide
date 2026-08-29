# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** **Every task is built and reviewed. The plan is finished.** Re-measured: agenda-test
**637**, notes-test **90**, cockpit-test **174** — **901**, three ALL PASS. T08's hands-on half
was done live with the user, not deferred: five ✅ rows in FINDINGS. **Six of DESIGN §5.1's seven
rows are closed by a dated ✅**; the seventh (a *Testing* refresh token past a week) is
unverifiable by construction before **2026-09-05**.
**T08's review found three more**, all in the code T08 itself added and all one theme — a message
or a flag that had stopped being true of the path it was on. The repair probed the **token**, so
the second loud line that names `agenda add <slug>` still refused, and refused by pointing at
`agenda rm`, the one command a scope failure forbids. `AGENDA_DRY_RUN=1` — a §5.2 seatbelt —
opened a real browser on an already-connected slug. And the wrong-account refusal offered a menu
that path never shows.
**Two things are outstanding and neither blocks the plan**: `agenda add work` against the company
account (deferred, below), and whether a *Testing* refresh token survives a week (2026-09-05).
**Not reviewed as a plan.** This plan carries no `Plan reviewed:` line — it predates the check.
The user was asked before T08 and chose to carry on, so **the whole plan was built without one**.
**Last updated:** 2026-08-29
**Next `pir-work` will:** **nothing — there is no next task.** Every row is ✅ and the review
queue is empty. What is left is not work a session can pick up: the company-account `agenda add`
needs an account this machine cannot use, and the token-expiry question needs a date to arrive.
A session told to continue should say so rather than invent a task.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Can both Google accounts connect? (spike) | — | ✅ | Reviewed clean, no fix. 3 "Done when" met; probe gone, tree clean, no history traces; tests 39+108 green (untouched). Probed: 7-day expiry correctly left unverified in all 3 places; nested-JSON 🐞 routed to T04. Hand-verification is the dated FINDINGS ✅ row — reviewer can't re-run it. |
| T01 | State files, lock, atomic writes, modes | T00 | ✅ | Reviewed; **one defect fixed**: `withLock` was not reentrant, so a compound write took 5035ms *and* dropped the lock mid-transaction. Harness's real-dir and dependency guards hardened — both read stronger than they were. All four deviations approved. 60 → **65** assertions. Probed: readState never throws on junk, quarantine races, 10-way concurrency. |
| T02 | Normalise Google events; choose what shows | T00 | ✅ | Reviewed; **two defects fixed**: a `responseStatus` naming an Object property returned a *function* as `reply`, and an offset-less `dateTime` was read in the **machine's** zone — a §3.1 leak the grep cannot see. All four deviations approved. 157 → **163**. Probed: junk `now`, reversed and zero-length events, input mutation, +12:45 zones; grep re-armed by hand. |
| T03 | Draw the column | T01, T02 | ✅ | Reviewed; **three defects fixed**, all lines escaping the `rows`/`width` contract: the **header was never clipped** (over-width below 11 cols, and the sweep started at 12); **two rows could both wear `NOW`** (one Google event id spans calendars — now compared by identity); an **event title could write control sequences** into the pane (a newline painted a 7th line out of 6). All seven deviations approved. 288 → **300**. Probed: narrow widths, wrapping loud lines vs `agendaHeight`, escape smuggling. |
| T04 | Google client — OAuth, refresh, REST | T01 | ✅ | Reviewed; **two defects fixed**, both about what the user is *told*: the redirect `state` was checked only on the code branch (a stray local `?error=` ended a sign-in blaming Google for a refusal that never happened), and `describeError` dropped a scope signal `classifyError` read from the body (drawing `sign-in expired` for a consent 403). All deviations approved. 404 → **412**. Probed: browser page delivery, double redirects, junk fetch windows, malformed items, network-denied sandbox. |
| T05 | The `agenda` command | T01–T04 | ✅ | Reviewed; **two defects fixed**, both in lines the model never draws: an untrusted calendar **title escaped into the terminal** (an ESC retitled the window, a newline forged an `ls` row), and **`agenda add __proto__`** attached a calendar whose cache write vanished, then killed bare `agenda`. All eight deviations approved. 562 → **579**. Probed: hostile titles/emails/error text, prototype keys, piped-output flush, corrupt caches. |
| T06 | Right column: NOTES over AGENDA | T03, T05 | ✅ | Reviewed; **one defect fixed**: the resting pane called `readState()`, which **quarantines a corrupt `agenda.json`** — so the 2s repaint always won the race and moved the sign-ins aside with nobody to tell, killing DESIGN §2.7's announcement. Now `rescue: false`. All eight deviations approved; 39 originals kept by name. 801 → **809**. Probed: 640 renders across 1–40 rows × 4 widths (exact height, no over-width line, agenda never above notes, notes never below three), hostile event title, store side effects on import. |
| T07 | Daemon refresh: 60s tick + on-return | T04, T05 | ✅ | Reviewed; **no defect found, no fix commit**. All 16 test-doc cases present and biting; 849 re-measured. All nine deviations approved — the **third call site stays**, the user's call, and the task sheet is amended in place. Probed: mutation sweep re-run with four mutations the build session had not tried (each bit exactly its own assertions), the **live `daemon.log`** (boot refresh, fourteen 60s ticks, no token), backwards clock, `__proto__` slug, retry-for-ever. |
| T08 | Live verification with the user; docs | T06, T07 | ✅ | Reviewed; **three defects fixed**, all in T08's own new code and all the same species as the two it fixed itself: the repair probed the **token**, so `calendar permission not granted · agenda add work` still dead-ended — at `agenda rm`, which that failure forbids; `AGENDA_DRY_RUN=1` opened a **real browser** on an existing slug; the wrong-account escape named a menu that path never shows. 619 → **637**. All six deviations approved. Probed: four mutations, all four probe verdicts, both seatbelts by running them. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** **empty.** Every task is ✅.

**T08's deviations from its task doc**, each with the rule that forced it:
- **Block 1's `agenda add work` deferred** — the account is unusable on this machine (user's
  call). Substituted a second calendar from the account already signed in, which also verified
  DESIGN §2.1's never-seen no-browser path. See *Deferred* below.
- **Behaviour changed, with the user, mid-task**: `agenda add <slug>` on an existing calendar
  **repairs** instead of refusing. The task doc says T08 writes code only to fix what the
  hands-on pass finds; this is that, and the *what* was the user's decision. DESIGN §2.7 amended.
- **A second fix on the same theme**: a revoked account offered by the account menu surfaced raw
  `invalid_grant`. Same hands-on pass, different code path.
- **Two fixes outside the "Needs a person" list**, both found executing the task doc's own test
  checklist (§6's recovery steps, and running every documented command): the recovery glob, and
  the agent-refusal wording.
- **One flake logged, not fixed** — `notes-test` §11, load-sensitive, on files T08 never touched.
  Scope: it belongs to whoever owns that suite.
- **One fix inside a *test*, not the product**: `agenda-test`'s real-dir guard. Justified because
  T08's own acceptance criterion is that the three-suite command passes, and the guard had begun
  failing spuriously *because* T08 put live calendars on the machine.

**All six approved in review.** The behaviour change is faithfully implemented and DESIGN §2.7
matches it; the guard fix is correct and its residual is stated in the file. The one addition the
review made to that decision: it was implemented for **one** of the two loud lines that name
`agenda add <slug>`, not both — see T08's cell.

**The review's own hands-on half.** The three fixes are verified against the stub and by
mutation, not on the real screen. Two are worth a minute of a person's time and the commands are
in the session report: `AGENDA_DRY_RUN=1 agenda add home` (must print a URL and open nothing),
and the scope repair, which needs the calendar box deliberately left unticked on one consent
screen and is undone by ticking it on the next. **Neither was run** as of 2026-08-29.

## Deferred to the end of the plan

**`agenda add work` — the company account cannot be used on this machine** (the user's call,
2026-08-29, FINDINGS 🔄). It is deferred, not dropped: T00 already proved ✅ that the company
account *connects*, so what is outstanding is the narrower `agenda add` run against it. T08's
task sheet is amended in place. Everything else in T08 proceeds on the personal account, with a
**second calendar added from the sign-in already stored** — which is what gives the later blocks
the two-calendar column they need.

## Blocked on the user

*(Empty. T08's five hands-on checks were all answered live during the session that built it:
a second calendar attached with no browser, the `NOW` row against the real clock, offline
behaviour, a re-sign-in after a genuine revocation, and the `sign-in expired` line on screen.)*

**One thing is genuinely unverifiable until 2026-09-05**, and it is nobody's fault: whether a
*Testing*-status refresh token still works after about a week. It needs elapsed real time. If it
has expired, **no redesign follows** — DESIGN §2.7's loud line is the right behaviour and is now
verified on the real screen, and `agenda add <slug>` repairs it in one command.

Hand-verifications: T00 in FINDINGS 2026-08-27, T05 in FINDINGS 2026-08-28, T06 and T07 in
FINDINGS 2026-08-29, T08 in five rows dated 2026-08-29.

**One decision was taken during T07's review**, and it is the only thing that moved in the plan:
the daemon's **third refresh trigger — once at start-up — stays**, because `onExit` does not fire
when the window opens and DESIGN §2.5 counts that as a return. T07's task sheet is amended in
place; DESIGN needed no change.

**Now true of this machine**, and worth knowing before T08: a Google desktop client is registered,
one calendar (`home`) is attached, and `~/.claude/cockpit/` holds live `agenda.json`,
`agenda-cache.json` and a real refresh token. The T06 fake-calendar fixture is long gone. So a
session that wants a clean slate must say so rather than assume one — and **whether a *Testing*
refresh token still works after a week is now a clock that has started**, which is the one open
risk DESIGN §2.9 already covers either way.

Left for the user's own machine, on their own schedule, not blocking anything: the probe's
`~/.claude/cockpit/probe-client.json` can stay (T04 reuses the same registration) or be
removed. Whether *Testing*'s refresh token still works in a week is the one open question, and
DESIGN §2.9 already handles either answer.
