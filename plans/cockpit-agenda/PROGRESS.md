# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** T05 is implemented and awaiting review. `bin/cockpit-agenda.mjs` is the whole
command — `setup`/`add`/`ls`/`rm`/`color` and the bare day — published beside `note` by a
symlink `bin/cockpit-layout.sh` relinks on every rebuild. **The feature is now usable end to
end from a terminal with nothing yet drawn in the pane**, which is what T06 renders and T07
refreshes. `parseGoogleClient` joined the pure model. Measured this session with outbound
traffic denied: agenda-test **562** (was 412), notes-test **39**, cockpit-test **134**, all
ALL PASS. **One half is unverified:** nothing here has run in a live cockpit window, so
"`agenda` answers in a cockpit terminal and is not a command outside one" is proven only
against a fake state dir — the live check is with the user.
**Last updated:** 2026-08-28
**Next `pir-work` will:** **review T05**. **Read the top three FINDINGS rows first:** the CLI
carries three test-only env seams and each has its own guard in `run.sh`; the first fetch after
an `add` already writes T07's `{ ...describeError(err), since }` cache shape; and the CLI suite
builds its child environment from nothing because an inherited `CLAUDECODE` would silently turn
every `add` into a refusal.

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
| T05 | The `agenda` command | T01–T04 | 🔍 | The CLI, plus `parseGoogleClient` in the pure model. 412 → **562**. Deviations: no cockpit gate (state is not repo-keyed — the PATH symlink *is* the gate); three test-only env seams (`AGENDA_ORIGIN`/`AGENDA_BROWSER`/`AGENDA_TTY`), each fenced by a new `run.sh` guard, all three proven to bite; slugs refuse whitespace and control characters; ANSI stripped off a pipe; the terminal render capped at 80 columns. Full account in the commit. **Live-cockpit half unverified.** |
| T06 | Right column: NOTES over AGENDA | T03, T05 | ⬜ | Touches `cockpit-welcome.mjs`; `notes-test` must stay green. |
| T07 | Daemon refresh: 60s tick + on-return | T04, T05 | ⬜ | Touches `cockpitd.mjs`; `cockpit-test` must stay green. |
| T08 | Live verification with the user; docs | T06, T07 | ⬜ | Deliverable is FINDINGS rows and docs, not code. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** **T05.**

## Blocked on the user

**Waiting: does `agenda` actually answer inside a live cockpit?** Nothing in this session can
see a WezTerm window, so the symlink is proven only against a fake state dir. The check needs
no rebuild and kills no agents — in any cockpit terminal:

```
ln -sf ~/src/agentic-ide/bin/cockpit-agenda.mjs ~/.claude/cockpit/bin/agenda && agenda help && agenda
```

Expect the usage, then `AGENDA / no calendars / agenda add home`. Then in a **non-cockpit**
terminal, `agenda` should be `command not found`. Nothing is written by either command.

*(T00's hand-verification is done, recorded in FINDINGS 2026-08-27.)*

Left for the user's own machine, on their own schedule, not blocking anything: the probe's
`~/.claude/cockpit/probe-client.json` can stay (T04 reuses the same registration) or be
removed. Whether *Testing*'s refresh token still works in a week is the one open question, and
DESIGN §2.9 already handles either answer.
