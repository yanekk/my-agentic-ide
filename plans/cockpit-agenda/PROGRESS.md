# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** T03 implemented, awaiting review. `bin/cockpit-agenda-model.mjs` now holds the
drawing half — `PALETTE`, `pickColour`, `agendaHeight`, `renderAgenda`, and the
`visibleLen`/`pad`/`clip` helpers T06 will import back into the pane. Every display rule in
DESIGN §2.3, §2.4, §2.6, §2.7 and §2.8 is proved through `renderAgenda` from fixtures and a
fixed `now`. **One decision came back from the user**: the scope line reads `TODAY · Wed 26 Aug`
on both scopes (FINDINGS). Measured: agenda-test **288**, notes-test **39**, cockpit-test **117**,
all ALL PASS. Nothing is waiting on the user.
**Last updated:** 2026-08-28
**Next `pir-work` will:** **review T03**. It is the only 🔍 and the review queue is not empty.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Can both Google accounts connect? (spike) | — | ✅ | Reviewed clean, no fix. 3 "Done when" met; probe gone, tree clean, no history traces; tests 39+108 green (untouched). Probed: 7-day expiry correctly left unverified in all 3 places; nested-JSON 🐞 routed to T04. Hand-verification is the dated FINDINGS ✅ row — reviewer can't re-run it. |
| T01 | State files, lock, atomic writes, modes | T00 | ✅ | Reviewed; **one defect fixed**: `withLock` was not reentrant, so a compound write took 5035ms *and* dropped the lock mid-transaction. Harness's real-dir and dependency guards hardened — both read stronger than they were. All four deviations approved. 60 → **65** assertions. Probed: readState never throws on junk, quarantine races, 10-way concurrency. |
| T02 | Normalise Google events; choose what shows | T00 | ✅ | Reviewed; **two defects fixed**: a `responseStatus` naming an Object property returned a *function* as `reply`, and an offset-less `dateTime` was read in the **machine's** zone — a §3.1 leak the grep cannot see. All four deviations approved. 157 → **163**. Probed: junk `now`, reversed and zero-length events, input mutation, +12:45 zones; grep re-armed by hand. |
| T03 | Draw the column | T01, T02 | 🔍 | Header, `TODAY ·`/`TOMORROW ·` scope line, colour bars + slug, `NOW` + `until`, `ALL DAY`, `?`, overflow, stale, loud lines, both empty states, the palette. 163 → **288**. Deviations: `tz` is a parameter (Intl's zone is an environment read); `?` gets its own column so an ALL DAY row can carry one; a loud line wraps rather than clip away its fix command; `unknown` errors render transient; `run.sh` untouched (it globs); `cockpit-welcome.mjs` untouched (T06 owns it). |
| T04 | Google client — OAuth, refresh, REST | T01 | ⬜ | Tests hit a loopback stub, never Google. |
| T05 | The `agenda` command | T01–T04 | ⬜ | |
| T06 | Right column: NOTES over AGENDA | T03, T05 | ⬜ | Touches `cockpit-welcome.mjs`; `notes-test` must stay green. |
| T07 | Daemon refresh: 60s tick + on-return | T04, T05 | ⬜ | Touches `cockpitd.mjs`; `cockpit-test` must stay green. |
| T08 | Live verification with the user; docs | T06, T07 | ⬜ | Deliverable is FINDINGS rows and docs, not code. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** T03.

## Blocked on the user

*(Empty — T00's hand-verification is done, recorded in FINDINGS 2026-08-27. Nothing waiting.)*

Left for the user's own machine, on their own schedule, not blocking anything: the probe's
`~/.claude/cockpit/probe-client.json` can stay (T04 reuses the same registration) or be
removed. Whether *Testing*'s refresh token still works in a week is the one open question, and
DESIGN §2.9 already handles either answer.
