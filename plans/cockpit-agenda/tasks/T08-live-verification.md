# T08 — For real, with the user; docs

**Phase:** 5 · **Depends on:** T06, T07 · **Weight:** light

## Goal

Everything before this is green against fixtures, stubs and a fake state directory. **None of
it has been seen working.** No test in this project can sign in to Google, look at the screen,
tell whether two colours are distinguishable, or wait five minutes. This task closes that gap
with the user's own hands, writes the answers down in FINDINGS.md — the only record that
anything was ever seen working for real — and documents the feature for whoever comes next.

The deliverable is verification and documentation, not code. Any code written here is a fix for
something the hands-on pass found, and each one gets its own line in FINDINGS.md.

## Design sections this implements

`DESIGN.md` §5.1 (every row in the table gets an answer), §5.2 (the seatbelts every command
below runs under), §6 (the recovery instructions are checked, not just written).

## Files

- `plans/cockpit-agenda/FINDINGS.md` — the actual deliverable
- `docs/cockpit.md` — a section on the agenda, matching how notes are documented
- `CLAUDE.md` — the layout sketch gains the agenda; the file table gains the four new scripts;
  the state-directory paragraph gains the three new files; **"Things that are true because they
  were measured" gains a row for anything this build discovered the hard way**
- `README.md` — if it describes the fleet view's panes

## Interface

None. This task adds no interface.

## Tests

Automated tests cannot establish any of this task's goal. What they can do is guard it:

- [ ] the full three-suite test command still passes after every documentation change
- [ ] every command quoted in `docs/cockpit.md` and `CLAUDE.md` is real — run each one
- [ ] the recovery steps in `DESIGN.md` §6 are executed against a **temp** `COCKPIT_DIR` and do
      what they claim
- [ ] `grep -rn` finds no client secret, refresh token or calendar id anywhere in the repository
- [ ] `git status` is clean of state files — nothing the feature writes lands in the working tree

## Done when

- [ ] every row of `DESIGN.md` §5.1 has a dated ✅ or 🐞 line in FINDINGS.md
- [ ] `docs/cockpit.md` and `CLAUDE.md` describe the agenda as they describe notes, and every
      command in them has been run
- [ ] nothing secret is in the repository and nothing the feature writes shows in `git status`

## Needs a person

**This is the task.** Raise each block as you reach it and wait for the answer; do not batch
them into a final report.

**1. Both calendars, for real:**

> **Amended 2026-08-29, the user's decision.** The **work account cannot be used on this
> machine**, so `agenda add work` — and with it the company half of this block — **moves to the
> end of the plan**. It is not dropped and it is not assumed. `home` was already attached before
> T08 began. In its place this block adds a **second calendar from the account already signed
> in**, which delivers what the later blocks actually need (two colour-coded calendars, so block
> 5 can show one breaking without the other) and additionally exercises DESIGN §2.1's
> "reuses the stored sign-in and opens no browser", which no session had ever seen run.
> FINDINGS 2026-08-29 🔄.

```
agenda add home
agenda add work
agenda
```

Expect: a browser per account, a numbered list of that account's calendars, then bare `agenda`
printing today with both calendars' events colour-coded.
Tell me: did both connect, and are the events the right ones?

**2. The column, on screen** — close the WezTerm window and reopen it.

Expect: the fleet view's top-right shows NOTES above a rule above AGENDA.
Tell me: (1) does the divider line up down the whole pane, (2) are the two colours
distinguishable on your theme, and (3) is the `NOW` row right for the actual time?

**3. The refresh** — leave the cockpit open, enter an agent, come back a few minutes later.

Expect: the column is current without you doing anything.
Tell me: did it update, and did anything flicker or redraw oddly when you came back?

**4. Offline** — turn wifi off, wait for a tick, look at the column.

Expect: the events stay, and one dim line appears saying how old they are.
Tell me: exactly what that line said. Then turn wifi back on and tell me whether it cleared on
its own.

**5. A revoked sign-in** — the seatbelt here is that it is reversible in one command. Revoke the
cockpit's access to the **personal** account only, at
`https://myaccount.google.com/connections`:

Expect: within a tick, `home  sign-in expired · agenda add home` replaces that calendar's rows,
and the **work** calendar keeps showing its events.
Tell me: (1) exactly what the line said, and (2) did work stay unaffected. Then run
`agenda add home` again to restore it.

**Do not ask the user to revoke the company account** — re-granting it may need an
administrator, and one revocation proves the behaviour.
