# fleet-picker-status T00 — Claude status spike

Claude Code 2.1.295, 2026-10-09. Probe code deleted; this file is the record.

Test agent `6ad675f8`, dispatched from the T00 worktree (a `/tmp` cwd is refused: "Workspace
not trusted") with `claude --bg "Use AskUserQuestion to ask me whether to continue, with options
yes and no. Do nothing else."`, left unanswered, then `claude stop 6ad675f8`.

## 1. Waiting on the person

`claude agents --json --all` row, sampled every 2s for 35s while the question was open:

    {"pid":17743,"kind":"background","status":"waiting","waitingFor":"input needed","state":"blocked", ...}

`state: "blocked"` throughout, as DESIGN §2.2 expected. `status`/`waitingFor` are extra, live-only.
`state.json` does **not** carry the list's state: it read `state: "working"`, `detail: "starting…"`,
`tempo: "blocked"`, plus `needs: "answer: Continue? (yes · no)"` and the question in `block`. Read
the list's `state`, never `state.json`'s.

## 2. `lastTerminalAt` moves on later finishes

From the plan-review evidence, not live (person, 2026-10-09): later than `firstTerminalAt` in six
of nine `state.json` files. Re-read today, seven files (two jobs since removed): later in six
(`0e8d9d49`, `2436d87a`, `6c275ac0`, `8c478d1a`, `dfb5e5e1`, `f906234f`), equal in `09487577`.
ISO 8601 strings in every file.

## 3. Stopped and exited agents

- Stopped (`6ad675f8` after `claude stop`): row `{"id","cwd","kind":"background","startedAt",
  "sessionId","name","state":"stopped"}`, no `pid`, no `status`. It stays in `--all` (so in the
  picker as class bad until `claude rm`). `state.json` remains: `state: "stopped"`, `tempo: "idle"`,
  `firstTerminalAt` = `lastTerminalAt` = the stop time.
- Exited after finishing (seven existing jobs): `state: "done"`, no `pid`, no `status`; each has a
  `state.json` with both terminal times. Two job folders (`413d07f2`, `64c1cf60`) hold only `tmp/`
  and have no row in the list.
- `startedAt` differs between the live row (1791551714206) and the stopped one (1791551713798, the
  job's `createdAt`): ~0.4s, irrelevant to ordering.
- No `failed` or `crashed` agent was available to observe.

## 4. Torn `state.json`

Tight-loop `readFileSync` + `JSON.parse`: 830 136 reads over 35s while blocked (no rewrite in that
window) and 401 049 over 15s spanning the stop (the file was rewritten from `working` to
`stopped`). Zero parse failures, zero missing. Claude appears to write it temp-then-rename; a hidden
done item from a torn read should be rare. DESIGN §3.5 still holds as the fallback.

## 5. Timing

`claude agents --json --all`, 14 entries, five runs: 0.18, 0.19, 0.16, 0.18, 0.19s real. Well
inside the 3s limit; DESIGN §2.5's ~0.25s is conservative.
