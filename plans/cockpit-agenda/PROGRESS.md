# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** T01 implemented, awaiting review. The agenda's state layer exists:
`bin/cockpit-agenda-store.mjs` (three files under `~/.claude/cockpit`, one lock, atomic
writes, `0600`) and `spikes/agenda-test/run.sh`, the plan's test command and the harness
every later task extends. Measured on this commit: agenda-test **60**, notes-test **39**,
cockpit-test **117**, all ALL PASS.
**Last updated:** 2026-08-27
**Next `pir-work` will:** review **T01**.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Can both Google accounts connect? (spike) | — | ✅ | Reviewed clean, no fix. 3 "Done when" met; probe gone, tree clean, no history traces; tests 39+108 green (untouched). Probed: 7-day expiry correctly left unverified in all 3 places; nested-JSON 🐞 routed to T04. Hand-verification is the dated FINDINGS ✅ row — reviewer can't re-run it. |
| T01 | State files, lock, atomic writes, modes | T00 | 🔍 | Store + `spikes/agenda-test/run.sh`, 60 assertions, every listed case. Deviations: `readState()` reports the quarantine as a `corruptedTo` field on its return (doc said "a flag", unnamed); one `agenda.lock` covers all three files; lock wait raised to 5s to match the stale break; harness also checks node-only imports and (skipped, prints why) T02's model boundary. |
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

**Review queue:** T01

## Blocked on the user

*(Empty — T00's hand-verification is done, recorded in FINDINGS 2026-08-27. Nothing waiting.)*

Left for the user's own machine, on their own schedule, not blocking anything: the probe's
`~/.claude/cockpit/probe-client.json` can stay (T04 reuses the same registration) or be
removed. Whether *Testing*'s refresh token still works in a week is the one open question, and
DESIGN §2.9 already handles either answer.
