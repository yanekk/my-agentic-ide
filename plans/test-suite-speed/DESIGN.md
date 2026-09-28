---
setup: none
test:
  - bash spikes/cockpit-test/run.sh
---

# A fast cockpit test suite — Design

## 1. Purpose

`spikes/cockpit-test/run.sh` is the suite every pir worker runs before handing a task off, and
it is also run by the reviewer. On 2026-09-27 one clean run took 6 min 13 s (§6), and in the
pir-pane parallel run it cost ~24 minutes of each ~30-minute session. It is slow because it
waits, not because it computes: the baseline run used 13% CPU. This plan cuts the wall time
without making the suite flaky, and lets a worker run a few sections while iterating.

## 2. Success criteria

- A full run on a quiet machine takes about 2 minutes, down from 6 min 13 s.
- The check count printed in `ALL PASS (N checks)` never falls below the T01 baseline, and no
  check is weakened. A check that only passes because an earlier section wrote the same line
  (§3.3) may be made stronger, never weaker.
- 10 consecutive full runs pass, and 3 rounds of 4 concurrent full runs pass, with zero failures
  (T09). The numbers are in FINDINGS.md.
- `ONLY=11c,13b bash spikes/cockpit-test/run.sh` runs those sections plus what they need, and
  cannot be mistaken for the test command.

## 3. Behaviour

### 3.1 Waiting for something to happen is a bounded poll

A fixed `sleep N` followed by a check for an effect becomes a poll for that effect, which
returns as soon as the effect appears. The daemon polls every 400 ms at the default speed, so a
poll usually ends in under half a second where the sleep took 2 to 5.

- The poll's limit is generous and not scaled by `COCKPIT_TEST_SPEED`: default 10 s, larger
  where the expected wait is long. A loaded machine (4 suites at once) is slower and must still
  pass; the limit only decides how long a real failure takes to report.
- A poll that runs out prints a FAIL naming what it waited for, then the section carries on,
  exactly like a failed `check`. It must not hang or abort the run.
- The check after the poll stays. The poll replaces the sleep, not the assertion, so the count
  does not change and the failure message stays the one the check prints.

Helpers: `waitfor` and `waitmore` for log lines (they exist), and a new `waituntil` for
anything else, such as a file's contents, a `cq`/`bq` JSON query, the stub's pane table or a
call count (T02).

### 3.2 Proving that something does not happen stays a timed window

A sleep that proves an absence, such as a cooldown, a grace period, "no relaunch within X" or "a
fresh calendar is not re-fetched", cannot be a poll. It becomes `nap N`, and N is the length of
the window it proves plus a stated margin, not the leftover of an old round number. Each window
gets a one-line comment naming the daemon timer it measures.

`nap` scales by `COCKPIT_TEST_SPEED`, so the timer it proves against must scale by the same
factor. Otherwise a lower speed would shorten the window below the timer and the check would
pass vacuously. The agenda and dashboard daemons take their ticks from fixed env values
(`COCKPIT_AGENDA_TICK_MS=400` and so on), so T05 and T06 derive those values from `SPEED` in the
same place the main daemon's `REAP_MS` is derived.

A window check must still be able to fail. Where a section proves "nothing happens inside X,
then it happens after X" (11c''', 11c''''), the "after" half becomes a poll and the "inside"
half stays a `nap`.

### 3.3 Polls on the cumulative logs count, they do not grep

`$T/daemon.log` and `$CALLS` accumulate across sections. `waitfor` on a line an earlier section
already wrote returns at once and proves nothing. The dependency survey found this already true
of existing checks in 5g, 6b, 8, 9d, 11i, 11m, 11n and 11o. So a poll on a line that can already
be present uses `waitmore` against a baseline count taken at the start of the section, or waits
after `$CALLS` has been truncated. A conversion that finds a vacuous check of this kind makes it
count-based (§2) and says so in its commit.

### 3.4 The section filter

Each section heading becomes a call to a `section <id> "<title>"` helper, which decides whether
the section's body runs. `ONLY` is a comma-separated list of section ids exactly as printed in
the heading (`11c'''`, `13b`).

- Sections are grouped into chains (§4.1). Selecting a section runs every section before it in
  the same chain, because a section depends on the state its predecessors leave behind. The
  shared setup always runs. Selecting nothing from a chain skips that chain entirely, including
  starting its daemon or stub.
- The main daemon starts only if a main-chain section is selected, because it costs a second and
  a leak risk for nothing otherwise.
- An id that matches no section exits 2 with `unknown section: <id>` before anything runs, so a
  typo cannot become an empty run that passes.
- A partial run ends with `PARTIAL RUN (ONLY=<list>): N checks passed, <k> sections run. Not
  the test command.` on success, and never prints `ALL PASS`, which is the string the test
  command and pir's waiters look for. On failure it prints `FAILURES`, as today, and exits
  non-zero.
- `SECTIONS=1 bash spikes/cockpit-test/run.sh` prints the section ids and titles, one per line,
  and exits 0 without running anything, so a worker can find an id without reading 2900 lines.
- `ONLY` unset or empty is the full run, byte for byte the same output contract as today.

A heading pattern (`ONLY` matching title text) is not supported: ids are unique and listed by
`SECTIONS=1`, and a pattern that matches more than intended would silently run more.

### 3.5 Timings

`TIMINGS=1` prints, after the result line, one line per section run: seconds and id, sorted as
the sections ran, followed by the total. It is off by default because the suite's output is read
in full by every session (§5). T01 uses it for the baseline, and T03–T09 use it for the
before/after table.

### 3.6 Running the independent chains side by side (T08, conditional)

The footer, agenda and dashboard chains share nothing with the main chain except the shared
setup (§4.1). If the full run is still over 2 min 30 s after T03–T07, T08 runs those three
chains as background subshells alongside the main chain. Each chain writes its output and its
pass/fail counts to its own file under `$T`, and the parent prints the outputs in section order
and sums the counts, so the output reads exactly as a serial run's. If the full run is at or
under 2 min 30 s, T08 records the measurement in FINDINGS.md and closes without code, because
concurrency adds interleaving risk that is not worth ~40 s.

### 3.7 Output contract, unchanged

Full run: section headings, `  FAIL …` lines with their detail, then `ALL PASS (N checks)` or
`FAILURES` plus the first 40 lines of `daemon.log`, and exit 0 or 1. No colour. `VERBOSE=1`
still prints every passing check.

## 4. Architecture

This plan changes a bash test script, not the product, so there is no pure core to protect. It
touches no file under `bin/`: the daemon already scales its timers through `COCKPIT_TIME_SCALE`
and takes its agenda and dashboard ticks from env. If a conversion needs a
daemon change to become observable, that is a finding for the person, not a quiet edit to
`bin/cockpitd.mjs`.

### 4.1 Chains

Re-read by T01 on the merged script (pir-pane and test-daemon-leaks in), 2026-09-27. The
table in the script is `CHAIN_OF`, and the script refuses to run if it and the headings differ.

| Chain | Sections, in heading order | Starts | Depends on |
|---|---|---|---|
| main | 1 … 11p, 15a … 15l, 16a … 16p, 15m, 15n, 15o | the main daemon `DPID`; 15m its own `D7PID` | each section on the ones before it (pane ids 31–34, `MOVED*`, `BR`/`VW`, the attached agent). 15m–15o use only the shared setup |
| footer | 12, 12b, 12c | nothing; runs `cockpit-strip.mjs` directly | 12b and 12c on 12's `SD`/`RAW`/`PLAIN`/`STRIP_ANSI` |
| agenda | 13, 13b, 13c | the Google stub, daemons D2, D3 | 13b on 13's stub and `cq`; 13c is static |
| dashboard | 14, 14d, 14b, 14c | the BitBucket stub, daemons D4, D6, D5 | 14d and 14b on 14's stub, `bq`, `bbconf`, `stopbb`; 14c is static |

Section 13 redefines `same()` for every later section. T05 moves that definition, and every
helper a chain defines inside its first section (`cq`, `bq`, `stopbb`, `footer`), to the top of
its chain, so skipping one chain cannot change another's behaviour.

pir-pane put 15a–15l, 16a–16p and 15m–15o between 11p and 12, and 12c after 12b.

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS 26.5.1 (Darwin 25.5.0), 10 cores |
| Runtime | Node.js v24.2.0, GNU bash 5.3.9 |
| Deliberately absent | No `package.json`, no npm dependencies, no test framework: the suite is bash plus the stubs it writes. |

**The test command.** The `test` line at the top. It prints only section headings and
`ALL PASS (N checks)` on success; `VERBOSE=1` prints every check. `FORCE_COLOR=3` is set in this
machine's session environment, and the suite prints plain text regardless. Keep it that way:
nothing added here may print escape bytes. It took 6 min 13 s on 2026-09-27; after this plan,
10 serial full runs took a median 106.7 s (max 114.9 s) and 3 rounds of 4 concurrent a median
115.7 s, 770 checks, zero failures (T09, 2026-09-28). `ONLY=<ids>` runs a few sections while
iterating (§3.4) and is not the test command; `SECTIONS=1` lists ids, `TIMINGS=1` times sections,
`spikes/cockpit-test/stress.sh` repeats full runs.

**Setup.** None. A fresh clone needs nothing installed (measured 2026-09-26 for pir-pane).

**Dependencies.** None may be added.

**End to end.** Nothing here has a surface: the product is test-script output read by sessions.

**When to build.** After two plans that edit `spikes/cockpit-test/run.sh` have both merged to
main: pir-pane (open on 2026-09-27, ~530 lines added to the script on its branches) and then
`plans/test-daemon-leaks/` (§6). Not while any pir run that edits the script is open. Each
measuring task records the load average and checks for orphaned test daemons first (§5.2); with
the leak fix in, finding one is a regression of that plan, recorded in FINDINGS.

### 5.1 What the test command cannot reach

Nothing in this plan needs a person. Stability is established by repeated runs the worker makes
itself (T09).

### 5.2 Seatbelts

- **Leaked test daemons.** The daemon-leak plan lands first and gives every suite its own exit
  cleanup in `spikes/lib/test-daemons.sh` (`daemon_stop`, `daemon_sweep`). This plan reuses it and
  builds no second matcher. `spikes/cockpit-test/stress.sh` (T09) runs each suite copy with its
  own `TMPDIR` under one scratch folder and, when it ends, sources that file and calls
  `daemon_sweep <scratch>`, which matches on the environment, never on the script name, because
  the real cockpit's daemon runs the same script with the real HOME. Measuring tasks that run
  the suite by hand kill only **orphans**: cockpitd whose parent is pid 1 and whose environment
  names a `tmp.*` path under the macOS temp folder, never `pkill -f cockpitd`. A temp-path match
  alone would also kill the daemons of a suite still running, a sibling conversion's or another
  plan's worker's, since T03–T07 run at once (measured 2026-09-27: leaked daemons had parent 1, a
  live pir-pane worker's had its suite as parent).
- **Network.** Unchanged: every side daemon points at loopback stubs, and 13c/14c fence it.

### 5.3 Who acts on the outside world

Nothing. Every action is local to the checkout and a temp folder.

## 6. Decisions and rationale

- **2026-09-27, plan written before the daemon-leak fix and before pir-pane merged.** The
  person chose this over waiting. The numbers in §1 therefore include leak load (2 leaked
  daemons, load average ~4). T01 re-takes the baseline on the merged script on a quiet machine,
  and that baseline is the "before" in the final table.
- **2026-09-27, the daemon-leak plan builds before this one** (person's choice at plan review).
  Both rewrite the script's daemon stops: that plan's `daemon_stop` already waits for a daemon to
  die, which T06 would otherwise build, and its `daemon_sweep` is the cleanup T09 would otherwise
  write a second time. Building it first also takes leak load out of every timing measured here.
- **2026-09-27, the baseline run failed** two checks in section 3b ("first flush injected", "the
  diff is reset (relaunched clean) on send"). The suite is already flaky under load, so T03
  owns diagnosing and fixing that, and T09's zero-failure bar covers it.
- **Filter by prefix of chain, not by splitting the main chain** (person's choice, 2026-09-27).
  Splitting 1–11p into self-contained chapters would let `ONLY=11c` run just the browse
  sections, but it rewrites how ~40 sections start, which is where checks could quietly weaken,
  and roughly doubles the plan. Prefix-of-chain is small and cannot change what a check sees.
- **Extend, do not replace, the existing helpers.** `nap`, `waitfor`, `waitmore`, `grew` and
  `countof` already do most of the job; T02 adds only `waituntil` for non-log conditions. A
  second wait library alongside them would split every future section's choice.
- **Concurrency is conditional (T08).** The prompt allowed it only if the rest leaves the run
  well over two minutes. Estimated after conversion: main chain ~110 s, the other three chains
  ~45 s together. Measured, not assumed, at T08.
- **Poll limits are not scaled by SPEED.** A limit is a failure-reporting bound, not part of the
  scenario. Scaling it would shorten it exactly when the machine is slowest.

## 7. Out of scope

- `spikes/browse-test/run.sh` (110 s). A separate suite that pir workers on current plans do not
  run. Worth its own plan if a future plan's test block names it.
- The daemon-leak fix: `plans/test-daemon-leaks/`, built before this plan (§6). This plan changes
  no daemon stop and no EXIT trap; it only calls that plan's sweep from `stress.sh` (§5.2).
- Splitting the main chain into chapters (§6).
- Lowering the default `COCKPIT_TEST_SPEED` below 0.5. Section 9c is documented to flake below
  0.3, and the waits, not the speed factor, are where the time goes.
