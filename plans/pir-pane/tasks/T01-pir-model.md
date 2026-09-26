# T01 — pir-model

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure half of following pir: turn the contents of `pir-dashboard.json` and a few facts the
daemon supplies into the one decision the daemon acts on — show the list, or attach this key at
this folder in this starting mode. Everything about the contract's edge cases (missing, corrupt,
stale, folders gone) is settled here, where it can be tested in milliseconds, so T04 is only
plumbing.

## Design sections this implements

DESIGN §2.4 (reading defensively), §2.5 (the table), §2.6 (starting mode), §2.9 (reap), §3.1,
§3.3.

## Files

- `bin/cockpit-pir-model.mjs` (new)
- `spikes/pir-pane-test/run.sh` (new suite; prints `pir-pane-test: ALL PASS (N checks)` or the
  failures, no colour)

## Interface

```js
export const PIR_KEY_PREFIX = "pir.";

// raw: string | null (file text, null when absent); isAlive(pid) → bool
export function readPirState(raw, { isAlive }) →
  { view: "list" }
| { view: "run",    run: Run }
| { view: "worker", run: Run, worker: Worker }
// Run    = { key, kind, slug, repo, repoPath, branch, cwd }
// Worker = { id, task, role, cwd }
// Anything missing, unparseable, version !== 1, dead pid, or a view whose required
// object is missing → { view: "list" }.

export function pirKey(run, worker?) → "pir.{run.key}" | "pir.{run.key}.{worker.id}"
export function isPirKey(key) → bool

export function decidePir(state, { exists, isGitRepo }) →
  { mode: "list", reason? }
| { mode: "follow", key, cwd, label, isRun, runKey }
// label: run → "{slug}", worker → "{slug} / {task}"

// storedRef: the custom-refs.json entry for key, or undefined; resolves(ref) → bool
export function startingMode({ isRun, storedRef, resolves }) →
  { mode: "custom", ref } | { mode: "uncommitted", reason? }

export function shouldReapPirKey(key, { shownKey, exists, cwdOfKey }) → bool
```

## Tests

- [ ] `readPirState`: null, empty, invalid JSON, JSON array, version 2, missing pid, dead pid,
      `view:"run"` with `run:null`, `view:"worker"` with `worker:null`, unknown view → list.
- [ ] `readPirState`: valid list, run, worker round-trip their fields.
- [ ] `decidePir`: every row of DESIGN §2.5, including worker cwd null, worker cwd gone with
      run cwd present, both gone, run cwd not a git repo, worker cwd not a git repo.
- [ ] `pirKey`/`isPirKey`: prefix, worker suffix, an agent job id is not a pir key.
- [ ] `startingMode`: run with no stored ref → custom main; run with stored ref → that ref; ref
      that does not resolve → uncommitted with reason; worker → uncommitted.
- [ ] `shouldReapPirKey`: folder gone and not shown → true; shown → false; folder present →
      false; non-pir key → false.
- [ ] Purity grep over the module (the pattern of `spikes/usage-test/run.sh:64`) finds nothing.

## Done when

- [ ] `bash spikes/pir-pane-test/run.sh` passes and prints one summary line.
- [ ] The module imports nothing and the purity grep is part of the suite.
- [ ] Every row of DESIGN §2.5 has a named check.
