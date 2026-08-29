# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** **T07 is reviewed and done — all seven build tasks are ✅.** The review found **no
defect** and made no fix commit. Re-measured: agenda-test **585**, notes-test **90**, cockpit-test
**174** — **849**, three ALL PASS. Both of T07's halves are evidenced: the tests, and the live
machine. The one open decision is **settled** — the **third call site** (`refreshAgenda("start")`
at boot) **stays**, the user's call, and T07's task sheet is amended in place to say so
(FINDINGS 2026-08-29 🔄). The review also read the *live* `daemon.log` and found the boot refresh
and fourteen 60-second ticks on the current build, with no token in it (FINDINGS 2026-08-29 📌) —
the earlier ✅ row predates the one-minute change and did not cover either.
**Not reviewed as a plan.** This plan carries no `Plan reviewed:` line — it predates the check.
Seven tasks have now been built and reviewed clean off it; whether to run `/pir-review-plan`
before T08 is the user's call, and no session has decided it for them.
**Last updated:** 2026-08-29
**Next `pir-work` will:** **implement T08** — the last task, and the only one whose deliverable is
FINDINGS rows and docs rather than code. Read the four ✅ rows in FINDINGS first: T00, T05, T06 and
T07 are already closed by hand, so **T08 must not re-ask any of them**. What is genuinely unseen is
the **sign-in flow's own ergonomics** (`agenda setup` → `agenda add`, and Google's two console
traps, which FINDINGS 2026-08-28 routed here), plus whether a *Testing* refresh token still works
after a week — a clock that started 2026-08-29.

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
| T08 | Live verification with the user; docs | T06, T07 | 🟡 | **Docs half done, hands-on half open.** Wrote the agenda into `docs/cockpit.md`, `CLAUDE.md` (sketch, file table, state dir, 10 measured rows) and `README.md`; corrected two stale suite counts. Two defects fixed: DESIGN §6's `rm agenda*.json` deleted the registration it says to spare, and the agent refusal told `rm`/`color` a browser was coming. 585 → **589**. Deviation: scope-strict flake logged not fixed. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** *(empty)* — every implemented task has been reviewed. T08 is next, and it is an
implementing session.

## Deferred to the end of the plan

**`agenda add work` — the company account cannot be used on this machine** (the user's call,
2026-08-29, FINDINGS 🔄). It is deferred, not dropped: T00 already proved ✅ that the company
account *connects*, so what is outstanding is the narrower `agenda add` run against it. T08's
task sheet is amended in place. Everything else in T08 proceeds on the personal account, with a
**second calendar added from the sign-in already stored** — which is what gives the later blocks
the two-calendar column they need.

## Blocked on the user

*(Empty. T07's hands-on half was done in the session that built it — the user connected a real
Google calendar and the daemon was watched refreshing it twice, unattended. The review then
re-read the live `daemon.log` and found the boot refresh and fourteen 60-second ticks on the
current build, which is what covers the one-minute change made after that verification.)*

Hand-verifications: T00 in FINDINGS 2026-08-27, T05 in FINDINGS 2026-08-28, T06 and T07 in
FINDINGS 2026-08-29.

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
