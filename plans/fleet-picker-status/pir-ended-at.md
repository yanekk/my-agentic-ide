# Brief for the pir project: `endedAt` on a RunSummary

Not a task of this plan. The person starts it in pir as a single run in the
`plan-implement-review` repo, for example by typing into pir's dashboard box:

```
@plan-implement-review/single Add `endedAt` to the RunSummary of GET /v2/runs — see the brief below
```

and pasting the section below as the prompt.

---

The cockpit's ← picker (my-agentic-ide, `plans/fleet-picker-status`) lists pir's runs with their
status and shows a finished run for one hour after it finished. `GET /v2/runs` gives no finish
time, so the cockpit cannot tell a run that finished ten minutes ago from one that finished last
week, and hides every finished run until it can.

Wanted: one field on the RunSummary (`src/core/resources.mjs` `summaryOf`), and so on every row
of `GET /v2/runs` and on `GET /v2/runs/{key}`'s `run`:

- `endedAt`: when the run reached its final state (`finished`, `stopped` or `crashed`), as an
  ISO 8601 UTC string; `null` while it is running.

An additive field within v2, so it needs no `/v3` (docs/api-service.md: fields may be added
within v2). The run record already carries `finalState` and `updatedAt`; whether `updatedAt` at
the moment `finalState` is written is accurate enough, or the run should record an explicit end
time, is pir's to decide. A crashed run has no final write, so its end time may have to be the
moment the crash was noticed; say so in the docs if that is the rule. Document the field in
`docs/api-service.md` with the other stable fields.

The cockpit accepts an ISO string or epoch milliseconds and treats a missing or unparseable
value as unknown, so the change can land at any time without breaking it.
