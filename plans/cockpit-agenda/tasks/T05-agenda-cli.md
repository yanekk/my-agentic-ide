# T05 — The `agenda` command

**Phase:** 3 · **Depends on:** T01, T02, T03, T04 · **Weight:** medium

## Goal

The command itself: `agenda add work`, `agenda rm work`, bare `agenda` to see the day. It is
published the way `note` is — a symlink in `~/.claude/cockpit/bin`, a directory only
cockpit-spawned shells have on PATH — so it exists inside the cockpit and nowhere else, with no
install step and no edit to anyone's shell profile.

At the end of this task the feature is fully usable from a terminal with nothing yet drawn in
the pane. That is deliberate: it gives T06 something real to render, and it means the pane work
cannot hide a bug in the command.

## Design sections this implements

`DESIGN.md` §2.1 (a slug is one calendar; sign-in per account), §2.2 (the whole command
surface, the name, exact-match `rm`, the agent refusal), §2.8 (colours), §2.9 (`agenda setup`).

## Files

- `bin/cockpit-agenda.mjs` — new
- `bin/cockpit-layout.sh` — one line: symlink it to `~/.claude/cockpit/bin/agenda`, beside the
  existing `note` symlink, relinked on every rebuild
- `spikes/agenda-test/run.sh` — extended

## Interface

```
agenda                     the day as the column shows it, then per-calendar state
agenda ls                  the configured calendars, one per line
agenda add <slug>          sign in if needed, list the account's calendars, pick one
agenda rm <slug>           detach (exact slug match — no prefixes)
agenda color <slug>        reroll its colour, preferring an unused one
agenda setup               paste clientId/clientSecret; runs implicitly when missing
agenda help

exit 0  success
exit 1  anything the user must fix (no registration, unknown slug, refused, sign-in failed)
```

`agenda add <slug>` in order:

1. refuse if `CLAUDECODE` is set, naming why
2. refuse if the slug already exists, pointing at `agenda rm`
3. no registration → run `setup` first
4. ask which account (offer the ones already signed in by email, plus "a different account")
5. an account already signed in → **no browser**; otherwise `signIn` opens one
6. `listCalendars`, print them numbered, read a number from the TTY
7. `pickColour(taken, crypto.randomInt(…))`, `putCalendar`, print what was added
8. fetch that calendar once immediately, so the column is populated before the daemon's tick

Non-obvious, and why:

- **The refusal when `CLAUDECODE` is set is not a nicety.** An agent running `agenda add` would
  open a browser and ask *you* to sign in, unattended, to a flow it cannot complete.
  `CLAUDECODE` is the same marker `cockpit-note.mjs` already uses to attribute notes.
- **`agenda help` answers even where the command should not work** — no registration, outside a
  cockpit, run by an agent. Copy that from `cockpit-note.mjs`: refusing to explain itself is the
  one unhelpful failure mode.
- **`rm` matches exactly, no prefixes** — unlike `note rm a3f9`. A wrongly removed calendar
  costs the whole browser dance; a slug is a word you chose and can type in full (DESIGN §2.2).
- **The picker reads from `/dev/tty`, not stdin**, so it still works when stdout is piped —
  which is how the tests drive everything else.
- **Non-interactive `add` must fail, not hang.** With no TTY (a script, a CI run) it exits 1
  saying so rather than blocking forever on a read.
- **`agenda` with no calendars prints the same invitation the column shows**, so the two never
  disagree about how to get started.
- **Bare `agenda` renders through `renderAgenda`** at the terminal's width — the same function
  the pane uses, so what you see in a terminal and what you see in the column cannot drift.
- **`agenda setup` never echoes the client secret** as it is typed and stores it `0600`.

## Tests

Drive with `COCKPIT_DIR` at a temp dir, `origin` at the T04 stub, and the browser opener
stubbed. **No test may reach Google or open a browser.**

- [ ] `agenda help` prints usage and exits 0 with no registration and no config
- [ ] `agenda help` prints usage even with `CLAUDECODE` set
- [ ] `agenda` with nothing configured prints the invitation and exits 0
- [ ] `agenda add work` end to end against the stub creates the calendar with a colour
- [ ] a second `agenda add home` on the **same account** does not call `signIn`
- [ ] a second add on a **different** account does call it
- [ ] two calendars get two different colours
- [ ] `agenda add work` when `work` exists refuses, exits 1, and points at `agenda rm`
- [ ] `agenda ls` lists slug, colour, account, calendar title
- [ ] `agenda rm work` removes it and exits 0
- [ ] `agenda rm wor` (a prefix) is refused — exact match only
- [ ] `agenda rm nope` exits 1 with a message naming the slug
- [ ] `agenda rm` also drops that calendar's cache entry
- [ ] `agenda color work` changes the colour and prefers an unused one
- [ ] with `CLAUDECODE` set: `add`, `rm`, `color` and `setup` all refuse and exit 1
- [ ] with `CLAUDECODE` set: bare `agenda` and `agenda ls` still work
- [ ] `agenda add` with no TTY exits 1 promptly rather than hanging
- [ ] a bad picker input (0, a letter, a number out of range) re-prompts rather than crashing
- [ ] a failed sign-in leaves **no** partial calendar and no account behind
- [ ] the client secret never appears in stdout, stderr or any file but `agenda-client.json`
- [ ] `agenda-client.json` is mode 0600 after `setup`
- [ ] the symlink line in `cockpit-layout.sh` produces a working `agenda` on PATH in the test's
      fake state dir, exactly as the notes test does for `note`

## Done when

- [ ] every case above is covered and `spikes/agenda-test/run.sh` prints `ALL PASS`
- [ ] the full three-suite test command passes with no network access
- [ ] `agenda` is symlinked by `bin/cockpit-layout.sh` beside `note`, and `agenda help` works
      in a cockpit terminal while `agenda` is not a command outside one
