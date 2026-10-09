---
setup: none
test:
  - bash spikes/fleet-picker-test/run.sh
  - bash spikes/usage-test/run.sh
---

# Status of each program in the ← picker — Design

## 1. Purpose

The fleet slot's ← picker (`plans/fleet-picker`) offers `Claude Agents` and `PIR` by name only.
Its DESIGN §2.3 left status out because pir then reported nothing richer than its view. Both
programs now expose enough: `claude agents --json --all` reports each background agent's state,
and pir's local service answers `GET /v2/runs` with every run's display state and a
`waitingForYou` flag. This plan lists, under each picker entry, what that program has going, so
the person sees where they are needed before they switch.

### Success criteria

- Pressing ← at the list shows, under each entry, one line per item (status word, then name),
  items waiting for the person first, within the slot at 59×22 and at 39×12.
- The picker still opens as fast as today: the frame is drawn before any status is fetched.
- A program whose status cannot be read shows one dim line and the picker works as before.
- Nothing the picker reads can make it hand back a wrong verb or fail to hand one back.

### Stance

The lists inform and never act: the picker's keys, verbs and the daemon are unchanged, so
everything `plans/fleet-picker/DESIGN.md` settled about switching still holds.

---

## 2. Behaviour specification

### 2.1 What each entry lists

- **Claude Agents** lists only background agents, the ones dispatched from the fleet box
  (`kind: "background"` in `claude agents --json --all`) (person, 2026-10-09). Interactive
  sessions are left out, because pir's own workers are interactive sessions and would otherwise
  appear under both entries.
- **PIR** lists every run in `GET /v2/runs`: builds, planning runs and single runs.
- The name of a Claude item is its `name` field, which the cockpit's namer already makes
  `<repo> / <topic>`. The name of a pir item is `<repo> / <displayName>`, where displayName is
  pir's own rule (`src/core/dashboard.mjs` `displayName`): a planning or single run's `label` in
  quotes while it has one, else its `slug`. Mirroring pir's rule means the picker and pir's
  dashboard name a run identically.

### 2.2 Classes, and the status word

Every item falls in one of four classes, which set its order, glyph and colour:

| Class | Glyph | Colour | Claude (`state`) | pir |
|---|---|---|---|---|
| wait | `●` | yellow | `blocked` (T00 confirms) | `waitingForYou: true` |
| run | `◐` | plain | any other non-terminal state | `state` `running` or `unreachable`, not waiting |
| bad | `✗` | red | `failed`, `stopped`, `crashed` | `state` `stopped` or `crashed` |
| done | `✓` | dim | `done` | `state` `finished` (display `finished`, `merged`, `closed`) |

The status word is short and the program's own where it has one. pir's is `display.state` (e.g.
`asking you`, `testing`, `your go`), with ` {done}/{total}` (`display.done`, `display.total`) appended
for a build (`kind: "work"`) whose `display.total` is above 0, because a build's progress is the one thing its word does not carry. Claude's is
`needs you` for wait, `working` for run, and the state itself for bad. A done item reads
`done 12m` or `finished 40m`: the word plus the age (§2.3). An unknown Claude state is class run
and shows its own word, so a new state reads as something rather than vanishing. T00 settles the
Claude mapping on this machine; the table above is the planner's reading of the 2.1.295 binary.

### 2.3 What is hidden

- A done item is shown for **one hour** after it finished, then hidden (person, 2026-10-09). The
  age is whole minutes, `0m` to `59m`. Done is a finish the person has presumably seen or will
  see in the program; an hour is long enough to catch one that finished while they were away.
- A bad item is shown until it leaves its program's list (the person dismisses it there)
  (person, 2026-10-09). A failure may need looking at, so it does not time out.
- A done item whose finish time is unknown is hidden, because it cannot be shown to be recent,
  and a week-old finish listed as recent is worse than a recent one missing.
  - Claude's finish time is `lastTerminalAt` in `~/.claude/jobs/{id}/state.json`, an ISO 8601
    string (measured 2026-10-09, plan review: every one of nine files), parsed like pir's `endedAt`. A missing or unreadable file
    is an unknown time.
  - pir's finish time is `endedAt` on the RunSummary, which pir does not have yet. It is a
    separate change in the pir project ([pir-ended-at.md](pir-ended-at.md)), started by the
    person (person, 2026-10-09). Until it lands every finished pir run is hidden.
  - Both readers accept an ISO 8601 string or epoch ms and treat anything else as unknown.
- A finish time in the future (a clock that moved) counts as age 0, so the item shows rather
  than being hidden for an hour by a clock change.

### 2.4 Order, and what fits

Within each entry: wait, then run, then bad, then done. Within wait, run and bad, newest first
by start time (Claude `startedAt`; pir in the order its service returns, which is repo then slug,
since a RunSummary carries no start time). Within done, most recently finished first. Waiting
items go first because they are the reason this feature exists.

The two entries share the rows left after the frame. Each entry gets half (the first entry the
odd row); an entry that needs fewer gives the rest to the other. An entry with more items than
its rows shows the first `rows - 1` and a dim `+N more` line. Every line fits the width: a name
too long is cut with `…`, and the status word column is as wide as that entry's longest word.

At 18 rows and more the frame keeps its title and rule (`SWITCH PROGRAM`, the line under it);
below that they go first, so at 39×12 the slot holds the two entry lines, their lists, one
spacer and the hint. The hint line always stays, at the bottom.

### 2.5 When it is read

The status is read **once**, when the picker starts, and never refreshed while it is open
(person, 2026-10-09). The picker draws its frame at once with one dim `…` under each entry, then
fetches both programs side by side and redraws when both have answered (or failed). Measured on
this machine, 2026-10-09: `claude agents --json --all` takes about 0.25s and `GET /v2/runs` 0.05s,
so the lists fill in a quarter of a second after the frame. Drawing first keeps ← exactly as fast
as today; the fetch must never delay the frame or a key.

A key pressed before the status arrives is handled as today. Choosing a program before the
lists have filled in is normal and loses nothing.

### 2.6 The lists are read-only

The keys of `plans/fleet-picker/DESIGN.md` §2.4 are unchanged: ↑↓ moves between the two
programs, Enter or → opens one, Esc backs out (person, 2026-10-09). No item is selectable, and
choosing a program does not open any particular item in it.

### 2.7 The unhappy paths

- **pir's service is down** (no `api.json`, its pid dead, refused, timed out, a non-200): the PIR
  entry shows one dim line, `status unavailable · pir service not running`. The words name the
  usual cause, because the fix (starting pir's service) is the person's to take.
- **pir's access key is missing or refused** (no `~/.pir/api-key`, a 401): `status unavailable`.
- **`claude agents` fails** (not on PATH, non-zero exit, timed out, output not a JSON array): the
  Claude entry shows `status unavailable`.
- **Nothing to list**: `nothing running`, dim.
- **A slow source**: each fetch has its own limit, 3s for Claude and 2s for pir (the existing
  `PIR_TIMEOUT_MS`), after which that entry is `status unavailable`. The other entry is drawn
  as soon as both have settled; a source never hangs the picker, because its keys are read
  throughout.
- **A malformed item** (a row missing its name or state): skipped, never drawn as a blank line.
- **The picker is closed before the status arrives**: the fetch is abandoned with the process.
  Nothing is written anywhere, so there is nothing to clean up.
- **A fetch throws**: caught in the process; the entry is `status unavailable`. A status failure
  must never take the picker down, because a picker that dies hands back `picker-cancel` and the
  person's ← is lost (fleet-picker §2.7).

---

## 3. Architecture

### 3.1 The boundary

```
bin/cockpit-fleet-status-model.mjs  pure: raw answers + now → ordered items per program
bin/cockpit-fleet-picker-model.mjs  pure: (existing) state, keys, reduce; render now takes the lists
bin/cockpit-fleet-status.mjs        shell: runs `claude agents`, reads jobs/{id}/state.json, asks pir
bin/cockpit-usage-pir.mjs           shell: (existing) pir service discovery, gains the /v2/runs GET
bin/cockpit-fleet-picker.mjs        shell: (existing) the process; draws, fetches once, redraws
```

Both pure modules import nothing and reach for no clock, file, process or network; the current
time arrives as `now`. `spikes/fleet-picker-test/run.sh` already greps the picker model for that
and gains the same grep over the status model. If either grep fails, the fix is to move the code
into a shell module, never to relax the grep. The picker model stays import-free: the process
calls the status model and passes plain item lists to `render`, so the two pure modules never
import each other.

Everything that decides what a person sees (the class, the word, the age, the hour, the order,
the row share, `+N more`) is pure and tested in milliseconds; the shell only carries bytes.

### 3.2 Modules

- `bin/cockpit-fleet-status-model.mjs` (new, T01): `claudeItems`, `pirItems`, `ageLabel`.
- `bin/cockpit-fleet-status.mjs` (new, T02): `gatherClaude`, `gatherPir`, `gatherAll`.
- `bin/cockpit-usage-pir.mjs` (extended, T02): the api.json reading and liveness check of
  `fetchPirUsage` are shared with a new `fetchPirRuns`, so the two GETs cannot disagree about
  whether the service is up. `fetchPirUsage`'s behaviour and results do not change.
- `bin/cockpit-fleet-picker-model.mjs` (extended, T03): `render(state, cols, rows, lists)`.
- `bin/cockpit-fleet-picker.mjs` (extended, T04): one fetch, one redraw.
- `cockpitd.mjs`, `cockpit.lua`, `fleet-picker.lua` and the wrapper are not touched.

### 3.3 The item, and the list

```js
// one line under an entry
Item = { cls: "wait" | "run" | "bad" | "done", word: string, name: string }
// what render receives per program
List = "loading" | "unavailable" | { unavailable: string } | Item[]   // [] = nothing running
```

`{ unavailable: text }` carries the pir-specific wording of §2.7; the plain string is the generic
one. Items arrive already ordered and filtered; `render` only fits them.

### 3.4 Data flow

```
picker starts ─ draw(lists = loading)
      │
      ├─ gatherClaude: claude agents --json --all  ─┐   (3s limit)
      │    + jobs/{id}/state.json per done agent    │
      └─ gatherPir: api.json → GET /v2/runs (Bearer)┤   (2s limit)
                                                    ▼
             claudeItems(raw, now), pirItems(raw, now)  → lists
                                                    ▼
                                       draw(lists); keys as before
```

### 3.5 Storage

None. The status is read into memory and dies with the picker process. The only files read are
other programs': Claude's jobs folder and pir's `api.json` and `api-key`. Neither is written.
Claude may be rewriting `state.json` as it is read; a parse failure is an unknown finish time
(§2.3), which hides that one done item for that one open.

### 3.6 Where the files are

- Claude's jobs folder is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/jobs`. The picker pane is spawned
  through `/usr/bin/env` with the mux server's environment plus `PATH`, so `HOME` is the
  person's.
- pir's folder is `pirHome()` from `cockpit-usage-pir.mjs` (`PIR_HOME`, else `HOME`).
- The tests set `HOME`, `PIR_HOME` and `PATH` (a fake `claude`) to scratch, so no test reads the
  real machine.

---

## 4. Testing

- **Pure** (T01, T03): every class, the hour boundary (59m shown, 60m hidden), unknown and
  future finish times, ordering, pir naming, the row share at both sizes, `+N more`, clipping,
  every line within the width. Milliseconds.
- **Shell against fakes** (T02): a fake `claude` on PATH and a scratch jobs folder; a node:http
  stand-in for pir's service on an OS-chosen port with a scratch `PIR_HOME`, as
  `spikes/usage-test/pir.test.mjs` already does. Every failure of §2.7 is driven.
- **End to end** (T04): the real picker process and wrapper under `pty-drive.py` at 59×22 and
  39×12, real key bytes, with the fakes. Proves the frame comes before the status, the redraw,
  every verb still handed back exactly once, and a key pressed before the status arrives.
- **Drill** (T05): a worker drives the picker in every situation of the prototype and once
  against this machine's real Claude and pir (read-only).
- Not reached by any of these: how the picker looks in the real WezTerm window after merge. The
  picker is spawned from the checkout's `bin/` on every ←, so merged code takes effect on the
  next ← with no rebuild; the drill's pty run is the same program at the same sizes.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.6.0) |
| Language / runtime | Node v26.7.0, bash, python3 (for `pty-drive.py`) |
| Toolchain | none beyond node; zero npm dependencies |
| Claude Code | 2.1.295 |
| WezTerm | 20240203-110809-5046fc22 (not needed by this plan's tests) |
| pir service | `http://127.0.0.1:47717`, `~/.pir/api.json`, key at `~/.pir/api-key` |
| **Deliberately absent** | no npm packages, no Playwright for this (a terminal surface), no node-pty |

**The test command.** The two `test` lines above, each run from the repo root. Measured in a fresh
worktree under `.claude/worktrees/`, 2026-10-09: `fleet-picker-test` ALL PASS (386 checks, 31s),
`usage-test` ALL PASS (36s). Each prints one summary line on green and every failure in full;
`VERBOSE=1` lists every check. No colour is printed by either suite; `COLORTERM=truecolor` is set
here but neither suite emits escapes in its report.

`spikes/cockpit-test/run.sh` is deliberately not in the block: this plan does not touch the
daemon, the layout or the WezTerm config, and that suite never runs the picker process (it
stubs it). It took 177s and failed once in the measurement copy, then passed on a rerun
(926 checks); see FINDINGS.

**Setup.** None.

**Dependencies.** None may be added. The project is zero-dependency, and node's `fetch`,
`child_process` and python3's `pty` already cover everything.

**End to end.** The surface is a terminal program, driven by the existing rig:
`spikes/fleet-picker-test/pty-drive.py` runs `bin/cockpit-fleet-picker.sh` under a real
pseudo-terminal, feeds real key bytes and returns the screen. This plan extends it (environment
for the fakes, a wait for the redraw) rather than adding a second rig. Sizes: 59×22 (a 120×40
window) and 39×12 (an 80×24 window, the smallest). It is in the test block through
`fleet-picker-test`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| The picker in the person's own WezTerm window | Only after merge; the drill runs the same program at the same sizes under a pty, so no person step is planned |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `HOME`, `PIR_HOME`, `PATH` in tests | scratch | no test reads the real jobs folder, pir key or `claude` |
| fetch limits | 3s Claude, 2s pir | a hung source cannot hold the picker |
| T00's test agent | one, stopped at the end | the spike's dispatched agent is stopped and confirmed gone |

### 5.3 Outside the code — who acts

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Read this machine's Claude agents | `claude agents --json --all` | `worker` | read-only, local | none needed | free | none |
| Read this machine's pir runs | `curl -s -m 3 -H "Authorization: Bearer $(cat ~/.pir/api-key)" http://127.0.0.1:47717/v2/runs` | `worker` | read-only, loopback | none needed | free | `curl -s -m 2 http://127.0.0.1:47717/health` |
| Dispatch a test background agent (T00) | `claude --bg "<prompt from T00>"` | `ask` | spends model usage and appears in the person's live fleet list | `claude stop <id>` | one short agent turn | none |
| Stop the test agent (T00) | `claude stop <id>` | `ask` | acts on the person's live fleet; the auto-mode classifier refused it from the planner | none needed | free | none |

No action is wrapped in a project script: the two reads are read-only and the two `ask` rows are
prompted every time, so a script would only add a file.

---

## 7. Decisions and rationale

- **Status in the picker, and nowhere else** (person, 2026-10-09). The footer or the welcome pane
  was not asked for.
- **Names plus status, not counts** (person, 2026-10-09): a count says something is waiting but
  not what.
- **Claude lists only fleet-dispatched agents** (person, 2026-10-09), over "every non-pir session"
  and "everything": the others are pir's own workers or sessions the person is already looking at.
- **Clean finishes for one hour, failures until dismissed** (person, 2026-10-09). First answer was
  "hide clean ends only"; changed the same day to also show clean ends for an hour.
- **Snapshot at open, not live** (person, 2026-10-09). Simpler, and the picker is open for seconds.
- **Read-only lists** (person, 2026-10-09), over jumping to an item: jumping would need the cockpit
  to drive each program to a row.
- **pir's finish time comes from pir** (person, 2026-10-09), over reading pir's internal run record
  (documented as unstable) or the cockpit remembering when it first saw a finish (wrong after a
  rebuild). Cost: no recent pir finishes until the pir change lands.
- **Prototype approved** (person, 2026-10-09): `prototype/index.html`, one line per item, glyph and
  word then name, waiting in yellow first, title dropped at the small size. Non-binding for the
  exact layout.
- **The picker process fetches, not the daemon.** The daemon could keep a cache, but the status is
  a snapshot at open, the fetch takes a quarter second after the frame is already up, and keeping
  the daemon untouched keeps the fleet-picker swap and its tests exactly as they are.
- **Extend `cockpit-usage-pir.mjs`, not a second pir client.** It already finds the service,
  checks its pid and limits the request; a second copy would drift on what "service is up" means.
- **Extend the picker's pty rig, not a new one** (`pty-drive.py`).
- **Read Claude's `jobs/{id}/state.json` for the finish time.** `claude agents --json` carries no
  finish time; `lastTerminalAt` in that file is the only one found. It is undocumented, which is
  why T00 confirms it and why a missing or changed field only hides done items (§2.3).
- **T00 observes, it does not re-prompt** (person, 2026-10-09, plan review): that `lastTerminalAt`
  moves was read from six existing jobs, so no prompt is sent to any agent the person has, which
  would spend usage and set it working in its repo.
- **The §5.3 bins as proposed** (person, 2026-10-09, plan review).
- **`--all`.** Without it `claude agents --json` omits background agents whose process has exited,
  which are exactly the recent finishes (measured 2026-10-09).

---

## 8. Explicitly out of scope

- **Live updating while open**: declined (§7); the picker is a few seconds' screen.
- **Selecting an item** to open it directly: declined (§7).
- **Status outside the picker** (footer, welcome pane, notifications): not asked for.
- **Interactive Claude sessions**: declined (§7), they are mostly pir's workers.
- **The pir change itself**: it is pir's code, built in the pir repo from
  [pir-ended-at.md](pir-ended-at.md); this plan only reads the field when present.
- **Mouse in the picker**: still keyboard-only, as fleet-picker §2.4 decided.
