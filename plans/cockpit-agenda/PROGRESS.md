# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions — a
stale tracker costs the next session more time than keeping it current ever saves.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding
there**; when a note wants a paragraph, the paragraph belongs in the commit message.

**Status:** Planned, nothing built. The plan was settled with the user on 2026-08-26; every
behavioural question is answered and recorded in DESIGN §7. The one live risk is whether the
user's company Google account is allowed to connect at all, which T00 exists to answer before
anything is built on top of it.
**Last updated:** 2026-08-26
**Next `pir-work` will:** implement **T00** — the throwaway spike that finds out whether both
Google accounts can sign in. It is first because every task after it assumes they can, and it
needs the user's own hands.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Can both Google accounts connect? (spike) | — | ⬜ | Throwaway. Needs the user's hands; **stop and ask** if the company account is blocked. |
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

**Review queue:** *(empty)*

## Blocked on the user

*(Empty, and that is the right state — nothing is waiting on anyone yet.)*

T00 will put something here the moment it starts: it cannot be completed without the user
clicking through Google's console and two sign-in screens.
