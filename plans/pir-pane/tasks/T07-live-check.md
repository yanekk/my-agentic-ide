# T07 — live-check

**Phase:** 3 · **Depends on:** T05, T06, and the pir plan of [PIR-PROMPT.md](../PIR-PROMPT.md)
built and installed · **Weight:** light

## Goal

The one check nothing here can make: the real pir, with its state file, in the person's real
cockpit window, switched by a real mouse click. Everything a machine can decide was settled in
T06; this confirms the two halves meet.

## Design sections this implements

DESIGN §5.1.

## Automated checks (the worker runs these)

```
PIR_DASHBOARD_STATE=$SCRATCH/x.json pir   # in a scratch WezTerm pane, driven with send-text:
                                          # open a run, open a worker, back, quit —
                                          # the file matches DESIGN §2.4 at each step
bash spikes/pir-pane-test/run.sh && bash spikes/cockpit-test/run.sh
```

If the installed pir writes no file, stop: the pir plan has not landed, and the task waits.

## Needs a person

```
Close and reopen the cockpit window (this closes every agent terminal and revdiff).
Click PIR in the footer. Open a real run, then one of its workers, then go back twice.
Click Claude Agents.
```

Expect: pir appears in the Claude pane; the diff shows the run against main, then the task's own
changes, then the notes view; `claude agents` comes back as it was.
Tell me: whether each click switched on the first try.
