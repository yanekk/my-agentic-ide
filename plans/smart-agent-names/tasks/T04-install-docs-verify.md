# T04 — Relink, docs, hands-on verify

**Phase:** 2 · **Depends on:** T03 · **Weight:** light

## Goal

Finish the feature: make sure the `config` symlink is relinked on every rebuild, document the
naming behaviour and the key in CLAUDE.md, and verify with the person the handful of things
the test suite cannot reach. The first verification — that a dispatched agent's hook sees
`COCKPIT_REPO` — is load-bearing for the whole gate, so it comes before the rest.

## Design sections this implements

DESIGN 2.4 (the gate, now verified), 5.1 (the verification table), 8 (the known limit gets
written into CLAUDE.md).

## Files

- `bin/cockpit-layout.sh` — confirm the `config` symlink from T02 is present (relinked on
  rebuild); add it here if T02 left it out.
- `CLAUDE.md` — update the fleet-list naming paragraph to describe the Haiku topic, the
  set-once-then-frozen rule, and the retirement of "follows the work" for the label. Add the
  `config` command and the `anthropic-api-key` file to the state inventory. Add the key's
  known limits (a same-user process can read the file; and `config anthropic-api-key <key>`
  leaves the key in shell history — DESIGN 8) to the appropriate place. Touch the
  "things that are true because they were measured" table only under its own rule: adding a
  row means retiring one, so if a row is added, retire the weakest and move its content to the
  record it points at.
- `plans/smart-agent-names/FINDINGS.md` — record each hands-on answer with the date.

## Tests

There is no new automated test here; the suite from T01–T03 is the automated evidence. This
task's evidence is the verification below, written into FINDINGS with dates.

## Done when

- [ ] the `COCKPIT_REPO` gate is confirmed to fire inside a dispatched agent, or the gate is
      reworked and T03 revisited if it does not
- [ ] CLAUDE.md describes the new naming behaviour, lists `config` and the key file, and
      records the known limit
- [ ] each row in the verification table below has an answer in FINDINGS with its date

## Needs a person

Raised the moment this task starts, one check at a time, seatbelt is the capped key.

**First, the load-bearing gate (DESIGN 2.4):**
```
# Dispatch an agent from the fleet view, send it any first message, then in that agent's shell:
env | grep -i cockpit_repo
```
Expect: `COCKPIT_REPO=…` is set.
Tell me: whether it is set. If it is not, the cockpit-only gate cannot key on it and T03 needs
a different gate — stop and say so.

**Then the key is never exposed as a variable:**
```
# In a dispatched agent's shell, after a key has been set with `config anthropic-api-key`:
env | grep -i anthropic
```
Expect: empty output.
Tell me: whether anything printed.

**Then the live naming and the hold:**
```
# Set the capped key, then dispatch a fresh agent and send an ordinary first message.
config anthropic-api-key sk-ant-…      # the dedicated, spend-capped key
```
Expect: within about two seconds the fleet list shows `<repo> / <a 1-3 word topic>`; the
first message is briefly held, then answers normally.
Tell me: the label it chose, roughly how long the hold felt, and whether it ever felt slow.

**Then the command's confinement:**
```
# In a cockpit terminal:
config
# In a plain (non-cockpit) shell:
config
```
Expect: it runs in the cockpit terminal and is "command not found" in the plain shell.
Tell me: whether that holds.
