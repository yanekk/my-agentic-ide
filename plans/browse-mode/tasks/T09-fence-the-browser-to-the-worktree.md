# T09 — Fence the browser to the agent's worktree

**Phase:** 2 · **Depends on:** T08 · **Weight:** light

## Goal

The browser lets you leave the agent's worktree. The user asked for it to be blocked, and asked
first whether broot can block it itself.

**It cannot, and that was checked before anything was built** — see the measurements below. So
the cockpit fences the *result* instead of the route: it asks the running broot where its root
is, and sends it back when that is outside the agent's worktree.

## What was measured, 2026-09-02, broot 1.59.0

| Question | Answer |
|---|---|
| Is there a confine/jail option? | **No.** The only root-related flags are cosmetic: `--trim-root`, `--show-root-fs`, `--max-depth`. |
| Does `:parent` leave the root? | **Yes.** Started at `…/probe/root`, `--cmd ":parent;:print_path"` printed `…/probe`. |
| Can our verb file shadow the built-in `:parent`? | **No.** A verb `{ invocation: "parent", internal: ":focus <root>" }`, first in the `--conf` chain and loaded with no error, did not stop it — the root still moved up. Built-in internals win. |
| Would blocking keys do it? | **No.** `:parent` can simply be typed, and the input accepts paths. |
| Can the cockpit ask where broot is? | **Yes.** `broot --listen <sock>`, then `broot --send <sock> --get-root` → the current root. |
| Can it send broot back? | **Yes.** `--send <sock> --cmd ":focus <path>"` moved it back; the follow-up `--get-root` confirmed. |
| What does that cost? | **23–30 ms** per query, five runs. |
| Against a dead broot? | Fails immediately: `error on the socket: Connection refused`. No hang. |
| Can a socket NAME be reused after broot died? | **Yes** — re-listening on the same name worked, so a cockpit rebuild (same job id) is not wedged by a stale socket. |

**Why fence the result rather than the route.** Every escape has to be enumerated to be blocked,
and the list is open-ended (`:parent`, a typed path, `:focus`, and whatever else exists).
Checking where broot *ended up* closes all of them at once, including the ones nobody found.

## Design sections this implements

New, on the user's decision of 2026-09-02. DESIGN §2.n gains the row.

## Files

```
bin/cockpitd.mjs             browserCommand (--listen), browseSocket, fenceBrowseRoot, brootSend
spikes/cockpit-test/run.sh   stub broot (control side only), section 11b''
```

## Interface

- `browseSocket(jobId)` → `cockpit-<jobId>`, non-alphanumerics flattened. **One socket per
  agent**: two agents can both be in browse mode with both pairs alive (one in the slot, one
  parked), and a shared name would let the fence question the wrong tree.
- `browserCommand(worktree, jobId)` appends `--listen <socket>`, **after** the `--conf` chain so
  the existing exact-chain assertions keep matching.
- `fenceBrowseRoot(jobId, worktree)` — `--get-root`; return if the answer is not an absolute path
  (broot starting, gone, or not listening); return if the root is the worktree or below it;
  otherwise `--cmd ":focus <worktree>"` and log it.
- Called from `healBrowseHalves`, last, and **only when the browser half read as running and is
  past its launch grace**. A broot still starting has not opened its socket yet.

**Both sides are realpathed before comparing.** broot answers with a resolved path
(`/private/var/…` on macOS) while an agent worktree usually is not resolved (`/var/…`). Comparing
raw would read every temp-dir worktree as "outside" and yank the tree once a second — the same
symlink trap `cockpit-open` hit in T02.

**Descending is not wandering.** A root below the worktree is exactly what browsing a
subdirectory looks like; pulling that back would break the tree in the other direction.

## Tests

- [ ] a root outside the worktree is queried, sent back, and logged
- [ ] the stub's root really changes — a fence that keeps *sending* forever is not a fence that
      *worked*, and the two must be distinguishable
- [ ] a root **inside** the worktree (a subdirectory) is left alone: no `:focus` at all
- [ ] the browser is not questioned while it is starting or dead

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, 11b'' proven to fail without the fence
- [ ] **Not closable by the suite**: the stub answers for broot. That the real thing is pulled
      back, and that the jump reads as help rather than as the tree fighting you, is **T07's** to
      say — the user has to see it.
