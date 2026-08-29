# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** T07 is **implemented, awaiting review** — the daemon now refreshes the cache on a
60s tick and on the return to the fleet list, so the column fills itself in. Measured this
session: agenda-test **585**, notes-test **90**, cockpit-test **134 → 174** — **849** assertions,
three ALL PASS. **T07's hands-on half is NOT closed**: nothing has been seen refreshing in a
live cockpit, and no calendar is connected on this machine to see it with. The user chose to do
that check now rather than leave it to T08 — see *Blocked on the user*.
**Not reviewed as a plan.** This plan carries no `Plan reviewed:` line — it predates the check.
Six tasks have been built and reviewed clean off it; whether to run `/pir-review-plan` now is the
user's call, and no session has decided it for them.
**Last updated:** 2026-08-29
**Next `pir-work` will:** **review T07**. Start from the eight deviations in its Notes cell — the
one that needs a decision rather than a check is the **third call site**, `refreshAgenda("start")`
at boot, which T07's own "Done when" forbids and DESIGN §2.5 requires. Re-measure `cockpit-test`
(**174** now; that number has moved five times) and **re-run the mutation sweep** described in
FINDINGS before trusting a green section 11. Do not chase the §9d flake.

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
| T07 | Daemon refresh: 60s tick + on-return | T04, T05 | 🔍 | `refreshAgenda` + the tick + the `onExit` trigger. 134 → **174**; 849 across three suites. **Eight deviations, all in the commit message.** The one needing a decision: a **third call site** (`refreshAgenda("start")` at boot) — the doc forbids it, DESIGN §2.5 needs it, `onExit` never fires at window-open. Two test-only timing seams added, both guarded. Assertions proved by five mutations. **Hands-on half unverified.** |
| T08 | Live verification with the user; docs | T06, T07 | ⬜ | Deliverable is FINDINGS rows and docs, not code. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** **T07** — and it is the whole of the next session's work.

## Blocked on the user

**T07's hands-on half is open and the user has chosen to do it now** (rather than fold it into
T08). It needs, in order: a Google desktop-client registration, `agenda setup` + `agenda add` in
a cockpit terminal — which an agent may not run, `CLAUDECODE` refuses it — and then a **window
rebuild**, because the running daemon predates this task. The two questions are whether the
column fills itself in with nobody touching it, and whether `daemon.log` ever contains a token or
a meeting title (it must not). The exact commands are in the session report.

The rebuild kills every agent pane, so the session that hands this over does not survive it.
**Whoever gets the answer writes it into FINDINGS as a dated ✅ row** — that row is the entire
record, and the reviewer cannot re-run it.

Hand-verifications so far: T00 in FINDINGS 2026-08-27, T05 in FINDINGS 2026-08-28, T06 in
FINDINGS 2026-08-29.

**The T06 preview fixture is already gone** — `~/.claude/cockpit/` holds no `agenda*.json` at
all, so PROGRESS's old "clear it before T07" instruction is discharged and nothing was deleted.
Nothing is signed in on this machine, which is why the check above starts at the registration.

Left for the user's own machine, on their own schedule, not blocking anything: the probe's
`~/.claude/cockpit/probe-client.json` can stay (T04 reuses the same registration) or be
removed. Whether *Testing*'s refresh token still works in a week is the one open question, and
DESIGN §2.9 already handles either answer.
