# T05 — picker-status-drill

**Phase:** 3 · **Depends on:** T04 · **Weight:** medium

## Goal

Use the finished picker the way the person will, in every situation of the prototype, at both
sizes, and judge it against DESIGN and `prototype/index.html`: wording, alignment, what is cut,
what is hidden, colours, how quickly the lists appear. Fix what has one right answer, each fix
with a test that fails without it; bring the person only the choices with two defensible answers.
Then run it once against this machine's real Claude and pir, read-only, to see real names and
real states.

## Design sections this implements

All of DESIGN §2; `pir-e2e` § The drill.

## Files

- `spikes/fleet-picker-test/` (any new test a fix needs), `bin/cockpit-fleet-picker*.mjs`,
  `bin/cockpit-fleet-status*.mjs` (fixes only)
- `plans/fleet-picker-status/FINDINGS.md` (the drill row)
- screens to the task's scratch folder, never the repo

## End to end (the worker drives this)

- rig: `pty-drive.py` driving `bin/cockpit-fleet-picker.sh` · sizes: 59×22, 39×12, and 30×8 as
  an unusually small slot
- [ ] situations: typical, busy, nothing going, pir down, Claude down, both down, first moment
      (slow fakes), a finished pir run with and without `endedAt`, a done agent at 58m and 61m
- [ ] for each: every key of fleet-picker §2.4, plus resize mid-load and after
- [ ] once with the real environment (the person's `HOME`, real `claude`, real pir service):
      read-only, nothing typed into any program; save the screens

## Outside actions

- Read this machine's Claude agents — `worker`
- Read this machine's pir runs — `worker`

## Done when

- [ ] FINDINGS has a dated, worker-driven row saying what was driven and what was seen.
- [ ] Every fix has a test in the suite; both DESIGN test lines pass.
- [ ] Any two-answer question was put to the person and its answer recorded in DESIGN §7.
