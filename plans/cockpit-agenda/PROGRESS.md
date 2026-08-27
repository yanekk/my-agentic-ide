# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** T00 done and verified by hand — **both Google accounts connect** (personal and
company each returned their calendars and a refresh token; no admin block). Publishing status
*Testing* works; the ~7-day token-expiry question stays open (needs a week of real time, §2.9,
not a blocker). The spike is deleted. The company-account risk that gated the plan is retired.
**Last updated:** 2026-08-27
**Next `pir-work` will:** review **T00** — a light pass: confirm the four FINDINGS rows
faithfully record what was verified, the tree is clean, and the 7-day expiry is correctly left
unverified. Then T01 (state files) is unblocked.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Can both Google accounts connect? (spike) | — | 🔍 | ✅ by hand: both accounts connected, both got refresh tokens, no admin block; *Testing* status, 7-day expiry still open. Probe (22 checks) built then deleted; 4 FINDINGS rows are the deliverable. Nested Google client-JSON shape found → note for T04. |
| T01 | State files, lock, atomic writes, modes | T00 | ⬜ | |
| T02 | Normalise Google events; choose what shows | T00 | ⬜ | |
| T03 | Draw the column | T01, T02 | ⬜ | Heaviest task. Split it rather than rush it. |
| T04 | Google client — OAuth, refresh, REST | T01 | ⬜ | Tests hit a loopback stub, never Google. |
| T05 | The `agenda` command | T01–T04 | ⬜ | |
| T06 | Right column: NOTES over AGENDA | T03, T05 | ⬜ | Touches `cockpit-welcome.mjs`; `notes-test` must stay green. |
| T07 | Daemon refresh: 60s tick + on-return | T04, T05 | ⬜ | Touches `cockpitd.mjs`; `cockpit-test` must stay green. |
| T08 | Live verification with the user; docs | T06, T07 | ⬜ | Deliverable is FINDINGS rows and docs, not code. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** T00

## Blocked on the user

*(Empty — T00's hand-verification is done, recorded in FINDINGS 2026-08-27. Nothing waiting.)*

Left for the user's own machine, on their own schedule, not blocking anything: the probe's
`~/.claude/cockpit/probe-client.json` can stay (T04 reuses the same registration) or be
removed. Whether *Testing*'s refresh token still works in a week is the one open question, and
DESIGN §2.9 already handles either answer.
