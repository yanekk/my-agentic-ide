# T06 — Install and verify on the live subscription

**Phase:** 3 · **Depends on:** T04, T05 · **Weight:** light · **Hand-verified**

## Goal

Prove the whole path works on the real machine: install the tap, and confirm the true numbers
appear in the footer on a personal session, nothing appears on a company Bedrock session, and the
reading dims after idle. The tests cannot reach any of this (DESIGN §5.1); only the user can.
This task closes only when the user has seen it and the result is in FINDINGS with the date.

## Design sections this implements

DESIGN §5.1 (the whole table), §2.5 (Bedrock shows nothing), §2.4 (staleness), §6 (uninstall).

## Files

- None new. Runs `cockpit-usage-tap.mjs --install` (T04) and rebuilds the cockpit window.

## Tests

Automated: none — the other tasks carry the automated proof. This task is the hand-verification.

## Done when

- [ ] The user confirms the footer shows the real `5h`/`7d` numbers with reset times on a
      personal session, correctly coloured.
- [ ] The user confirms a company Bedrock session shows no usage segment.
- [ ] The user confirms the reading dims with `· as of HH:MM` after ~15 min without a personal
      turn (or this is noted as observed-later if the sitting can't wait).
- [ ] Each confirmation is written to FINDINGS.md as a ✅ row with today's date.

## Needs a person

This is the task. Only a live personal subscription and a real Bedrock session can establish it.

```
# Install (reversible — `cockpit-usage-tap.mjs --uninstall` restores the prior statusline, DESIGN §6):
bin/cockpit-usage-tap.mjs --install
# Rebuild everything by re-opening the WezTerm window (the supported rebuild).
# Then, in a PERSONAL claude session inside the cockpit, send a message and look at the footer.
# Then open/attach a COMPANY Bedrock session and look again.
```

Expect: on the personal session the footer's far right shows `◔ 5h NN% ↺HH:MM  7d NN% ↺Ddd HH:MM`
with plausible numbers; on the Bedrock session, no usage segment at all.
Tell me: the two things you see (personal: the segment and roughly its numbers/colour; Bedrock:
that it is absent), and — if you can leave a personal session idle ~15 min — whether it dims with
an "as of" stamp. This is the live-world step, so it stops here and waits for your answer rather
than being marked done on the strength of the build.
