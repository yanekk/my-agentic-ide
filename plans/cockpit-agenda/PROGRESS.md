# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** T06 is implemented and **awaiting review** — the agenda is now on screen, under
NOTES in the fleet view's right column, and the pane follows the cache without a restart. T07
(the daemon's refresh) is the only thing between the feature and a column that fills itself in:
today it draws whatever `agenda` last cached. Measured this session: agenda-test **579**,
notes-test **39 → 88**, cockpit-test **134**, 801 assertions, three ALL PASS.
**One half of T06 is unverified and only the user can close it** — see *Blocked on the user*:
nothing here can see the screen, so whether the divider lines up and whether the two calendars'
colours are distinguishable on their theme are both open.
**Last updated:** 2026-08-29
**Next `pir-work` will:** **review T06**. Read its Notes cell for the eight deviations, and the
top two FINDINGS rows: the frame harness gained a frozen clock and a `TZ`, and the resting pane
can now quarantine a corrupt `agenda.json` — the one write this display pane makes.

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
| T06 | Right column: NOTES over AGENDA | T03, T05 | 🔍 | Built: the content-driven row budget, the rule, the bottom-anchored agenda, `agenda.json`/`agenda-cache.json` on the pane's directory watch. notes-test 39 → **88**, all 39 originals kept. Eight deviations, accounted for in the commit: model helpers imported; `tz` passed; scope line per DESIGN §2.3, not the doc's mock-up; §8's frame 16 → 24 rows; harness gained a frozen clock, a `TZ` and a `;` in its escape strip; agenda anchored to the foot; `agendaBlock` catches everything; two guard sections (§10, §11) the doc did not list. **Hands-on half unverified.** |
| T07 | Daemon refresh: 60s tick + on-return | T04, T05 | ⬜ | Touches `cockpitd.mjs`; `cockpit-test` must stay green. |
| T08 | Live verification with the user; docs | T06, T07 | ⬜ | Deliverable is FINDINGS rows and docs, not code. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** **T06** — the only entry.

## Blocked on the user

**T06's hands-on half is open.** The three suites prove the string; nothing here can see the
pane. Close the WezTerm window and reopen it (the supported rebuild), then look at the fleet
view's top pane and answer two things: does the divider between the greeting and the right
column line up down the whole pane, and are the two calendars' colours actually distinguishable
on your terminal theme? Neither can be automated, and the answer goes in `FINDINGS.md` with the
date. **Until it is answered, T06's screen half is unverified**: a review can confirm the
string the tests assert, never the pixels.

*(T00's hand-verification is recorded in FINDINGS 2026-08-27, T05's in FINDINGS 2026-08-28.)*

The user's `~/.claude/cockpit/bin/agenda` symlink was created by hand for that check; every
cockpit rebuild relinks it anyway, so there is nothing to undo.

Left for the user's own machine, on their own schedule, not blocking anything: the probe's
`~/.claude/cockpit/probe-client.json` can stay (T04 reuses the same registration) or be
removed. Whether *Testing*'s refresh token still works in a week is the one open question, and
DESIGN §2.9 already handles either answer.
