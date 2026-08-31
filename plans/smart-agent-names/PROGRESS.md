# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

What the build taught lives next door in [FINDINGS.md](FINDINGS.md).

**Plan reviewed:** 2026-08-31 — 1 fixed, 4 decided with the user.

**Status:** T01 reviewed clean; T02 implemented, awaiting review. Four tasks, two phases.
**Last updated:** 2026-08-31
**Next `pir-work` will:** review T02 (the `config` command and key store). Once it is ✅,
T03 unblocks (needs T01 and T02 both ✅).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | Haiku topic-namer and label guard | — | ✅ | Clean, no fix commit. Every listed test present and defending (+30 checks); boundary/guard/2s-timeout per DESIGN. Model-alias + label quality deferred to T04 (5.1). |
| T02 | `config` command and key store | — | 🔍 | New `cockpit-config.mjs` (node-only): set/read/unset/list, 0600 atomic write, masked read `set · …1234`, mask capped so short keys never leak whole. Symlinked in layout.sh. +25 config, +3 bash checks. Deviation: added a realpath entrypoint guard (not in doc) so importing the exports doesn't run the CLI while the PATH symlink still does. |
| T03 | Wire into the hook: gate, hold, freeze | T01, T02 | ⬜ | |
| T04 | Relink, docs, hands-on verify | T03 | ⬜ | Verifies the `COCKPIT_REPO` gate first (DESIGN 2.4) |

**Review queue:** T02.

## Blocked on the user

*(Empty — nothing is waiting on a person yet. T04 will need hands-on checks; the seatbelt is
the capped key.)*
