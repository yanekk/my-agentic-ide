# Usage limits in the footer — Design

## 1. Purpose

The cockpit's bottom footer always shows the key legend. This plan adds one more segment to
it: how much of the personal Claude subscription's session (5-hour) and weekly (7-day) limit
has been used, with each window's reset time. It exists so the person can see, without
running anything, whether they are about to hit a cap — the moment that decides whether to
keep working or wait for a reset.

It shows only on a personal Anthropic subscription. The company works on Bedrock, which has
no such session/weekly caps, so those numbers are meaningless there and must never appear.

### Success criteria

- On a personal-subscription session, the footer shows `◔ 5h NN% ↺HH:MM  7d NN% ↺Ddd HH:MM`
  with the real numbers, refreshed as the person works.
- On a company Bedrock session, the footer is exactly what it is today — no usage segment.
- The numbers are never fetched over the network by this project and never handle a token:
  they arrive from Claude Code itself.
- A reading that has gone stale is visibly marked, not silently wrong.

### Stance

Take the numbers the officially-supported way (the statusline `rate_limits` object Claude
Code hands a script) and nothing more. Do not call Anthropic's private usage endpoint, do
not read the OAuth token, do not scrape `/usage`. The cost of that choice is staleness while
no personal session runs (§2.4); the design accepts it rather than take on a fragile,
undocumented dependency. If that staleness ever becomes intolerable the live poll is a known,
deliberately-deferred option (§8), and the footer is built so it can be added without change.

---

## 2. Behaviour specification

### 2.1 Where the numbers come from

Claude Code v2.1.251+ passes a configured statusline command a JSON object on stdin after
each turn, and (only for a Pro/Max subscription session, only after the first API response of
the session) that object carries `rate_limits`. We register a statusline command whose only
job is to copy those numbers into a cache file the footer reads. This is the single supported
way to read a subscription's real session/weekly limits from outside Claude Code; there is no
file it writes and no non-interactive command that prints them (T00, FINDINGS).

The machine here is 2.1.273, past the cutoff (checked 2026-09-16).

### 2.2 What shows, and the exact format

`◔ 5h NN% ↺HH:MM  7d NN% ↺Ddd HH:MM`, on the far right of the footer, after the diff-mode
segment. `◔` marks it as the usage readout. `5h` is the session window, `7d` the weekly one.
`↺` prefixes each window's reset time: a reset later the same local day shows `HH:MM`, a
reset on another day shows `Ddd HH:MM` (weekday plus time), because the day matters once it is
not today. Percentages are whole numbers.

Chosen over a bare percentage because the reset time is the number that decides whether to
wait (§7). The other formats mocked (percent-only, mini gauge, worded) were rejected by the
user on 2026-09-16 against `plans/usage-limits/prototype/`.

**When the line is too narrow to hold everything, the usage readout wins.** The footer is a
single row and must never wrap (wrapping breaks the measured one-row invariant `pinHeight`
defends). With the usage segment on the far right it would otherwise be the first thing clipped,
so the feature would vanish on any window that is not very wide — the footer already runs ~150+
columns before usage is added. So the drop order, tightest-space last, is: the **key-legend hints
go first** (the dim secondary ones — move, zoom, drag — before the primary ⌥t/⌥[/⌥]/⌥w/O), then
the agent name, and the usage readout and the diff-mode labels are kept longest. The full,
untrimmed footer still shows whenever the window is wide enough to hold it. Chosen by the user
2026-09-16 ("drop the shortcuts"): the reset numbers were the point of the feature, the gesture
hints are the most expendable, and the approved prototype already trimmed move/zoom to make room.

### 2.3 Colour by how much is left

Each window is coloured independently: green under 70% used, amber from 70 to 89, red at 90
and above. The thresholds are on *used* percentage, so red means little headroom. They catch
the eye before a cap is a surprise without crying wolf early. Values are user-tunable
constants, not scattered literals (§3.3).

### 2.4 Staleness

The cache carries the wall-clock time it was written. When the footer draws a reading older
than 15 minutes it dims the whole segment and appends `· as of HH:MM` (the write time, local).
The reset times themselves stay accurate while stale, because a reset time is an absolute
instant, not a countdown.

Staleness is expected, not an error. The reading only refreshes when a personal session takes
a turn; during a long stretch of company work no personal session runs, so the reading
freezes. It stays *correct* through that freeze — usage only climbs when the subscription is
used, and using it refreshes the reading — with one exception: if a window resets while the
person is away, the frozen percentage reads high until the next personal turn. The dim + "as
of" stamp is what keeps that one case from being silently wrong.

### 2.5 The private-subscription gate

`rate_limits` is present only on a Pro/Max subscription session, so its presence is itself the
signal: if the stdin object carries `rate_limits.five_hour` or `.seven_day`, this is a personal
session and we cache it; if it does not (an API-key session, a session before its first
response), we cache nothing and leave the last reading alone. On top of that, the tap
short-circuits immediately when `CLAUDE_CODE_USE_BEDROCK` is set (the same truthiness reading
Claude Code itself uses: present, non-empty, not `0`/`false`), so a company session never even
inspects the object. Belt and braces, because "never on the company account" is the hard
requirement and a future Claude gateway could in principle attach a `spend_limit` we would not
want to surface.

Only `five_hour` and `seven_day` are read. `spend_limit` and the per-model weekly windows the
raw endpoint exposes are ignored (§8).

### 2.6 Which sessions feed it

The tap is registered globally, for every Claude Code session on the machine, not only cockpit
ones — chosen 2026-09-16. The limit is account-wide, so any personal session reports the same
true number, and feeding from all of them keeps the reading as fresh as possible; a session in
a plain terminal counts as much as one in the cockpit. The tap does nothing on a company
session (§2.5) and its visible output stays empty (§2.7), so being registered everywhere costs
nothing. This differs from the session-namer, which is gated to cockpit sessions because naming
is cockpit-specific; usage is not.

### 2.7 The tap must be invisible and must never disrupt a session

The statusline command runs on every turn and Claude Code waits for its stdout before drawing
its own status line. So the tap must be fast (write one small file, exit), must print nothing
by default (the person asked for the footer, not a line inside every Claude session), and must
never fail loudly: any error — malformed stdin, unwritable cache dir — ends in an empty stdout
and exit 0, so a broken tap degrades to "no fresh reading", never to a disrupted session.

If a statusline command already exists that is not ours, we preserve it by chaining: the tap
runs the recorded previous command with the same stdin and emits its stdout as the visible
line, then taps the data on top (§2.n, T04). On this machine there is none today (checked
2026-09-16), so the default path is empty output.

### 2.n The unhappy paths

- **No reading yet** (fresh install, cache absent or empty): the footer shows no usage segment,
  exactly as today. It appears the first time a personal session takes a turn.
- **Corrupt cache**: the footer reader treats an unparseable cache as absent and shows nothing;
  it never throws and never blanks the rest of the footer. The tap's next write repairs it.
- **Partial data**: a window that is null or missing is simply not drawn; the other still shows.
- **Two sessions writing at once**: the global tap means many concurrent Claude sessions may write
  this cache, so each writer writes its own uniquely-named temp and renames it over the target
  (§3.5). A reader sees either the old file or a new one, never a half-written one, and two writers
  never share a temp to scramble. No lock — a per-writer temp plus atomic replace is enough for a
  last-writer-wins cache.
- **A statusline command already present**: preserved by chaining, never clobbered (§2.7, T04).
- **`resets_at` in the past** (Claude Code drops a window once it resets, but a stale cache may
  still hold one): the reader shows the window; the percentage is governed by the staleness
  rule (§2.4). It does not try to zero it — the next personal turn brings the truth.

---

## 3. Architecture

### 3.1 The boundary

```
pure/    cockpit-usage-model.mjs   — rate_limits shape in + now → what the footer should show.
                                      No clock, no fs, no env, no network.
shell/   cockpit-usage-tap.mjs     — the statusline command: reads stdin, writes the cache.
         cockpit-usage-store.mjs   — reads/writes usage-cache.json (atomic, 0600).
         cockpit-strip.mjs         — draws the footer (existing; gains a usage segment).
         install / settings merge  — registers the statusline command in settings.json.
```

`cockpit-usage-model.mjs` is on the pure side. `spikes/usage-test/run.sh` greps it for Node's
`fs`/`http`/`https`/`child_process`, for `fetch`, for the clock (`Date.now` and a bare
zero-argument `new Date`), and for `process.env`, and fails on a hit — the same guard the
agenda and bitbucket models carry. **If that grep fails the fix is to move the code out of the
model, never to relax the grep.** The reason: everything in the model is tested exhaustively in
milliseconds by passing `now` as a number; every rule that leaked to the tap or the strip would
become a rule only a person on a live subscription could check.

### 3.2 Modules

- `cockpit-usage-model.mjs` (new, pure) — `normalizeRateLimits`, `renderUsage`. Depends on nothing.
- `cockpit-usage-store.mjs` (new) — `readCache`, `writeCache` for `usage-cache.json`. Depends on `fs`.
- `cockpit-usage-tap.mjs` (new) — the statusline command, and its `--install`/`--uninstall`.
  Depends on the model (normalize), the store (write), and the settings-merge helper.
- `cockpit-strip.mjs` (modified) — footer reads the cache via the store, formats via the model,
  draws the segment, and watches `usage-cache.json`.
- The settings-merge helper (in the tap's `--install`, or shared with the auto-name installer)
  — registers/points/removes the statusline command in `~/.claude/settings.json`.

### 3.3 The decision function

`renderUsage(cache, nowMs)` is where the behaviour comes together, and it is a function of its
two arguments and nothing else.

```
renderUsage(cache, nowMs) → null | {
  stale:   boolean,                    // nowMs - cache.writtenAt > STALE_MS
  asOf:    "HH:MM" | null,             // local write time, only when stale
  windows: [ { key, pct, role, reset } ]   // key "5h"|"7d"; role "ok"|"warn"|"crit"; reset "HH:MM"|"Ddd HH:MM"
}
```

Returns `null` when there is nothing to show (no cache, both windows absent). Thresholds
(`WARN_PCT=70`, `CRIT_PCT=90`) and `STALE_MS=15*60*1000` are module constants at the top of the
model, the one place they are defined. The strip turns `role` into an ANSI colour; the model
never emits an escape code, so it stays a pure data function.

### 3.4 Data flow

```
Claude Code (personal session, each turn)
  → stdin JSON {rate_limits:{five_hour,seven_day}}
  → cockpit-usage-tap.mjs  (gate §2.5, normalize via model, write via store)
  → ~/.claude/cockpit/usage-cache.json
  → cockpit-strip.mjs footer  (read via store, renderUsage(cache, Date.now()), draw)
```

The strip already repaints every 2s and on a change to its watched directory; adding
`usage-cache.json` to the watch makes a new reading appear at once, and the 2s repaint moves a
reading across the 15-minute staleness line without a write.

### 3.5 Storage

`~/.claude/cockpit/usage-cache.json`, mode `0600` (it holds account usage figures), lockless,
written by temp-then-rename — the same shape as `bitbucket-cache.json`, with one difference that
matters. `bitbucket-cache.json` has a single writer (the daemon), so a fixed `<file>.tmp` is safe;
this cache is written by the statusline tap, which is registered globally (§2.6) and runs in every
Claude session, so **many sessions can write it concurrently**. Two writers sharing one `.tmp`
path would interleave into a torn temp that rename then publishes. So each writer uses a **unique
temp name** (`<file>.<pid>.<rand>.tmp`) and renames its own temp over the target; the rename is
atomic and last-writer-wins, and no two writers ever touch the same temp. No lock is needed — the
per-writer temp plus atomic rename is enough, and the reader tolerates a corrupt file anyway (§2.n)
so even a lost race degrades to one stale draw, repaired by the next turn.

```json
{
  "writtenAt": 1758042000000,
  "fiveHour": { "usedPct": 40, "resetsAt": 1758045600 },
  "sevenDay": { "usedPct": 72, "resetsAt": 1758510000 }
}
```

`writtenAt` is ms since epoch; `resetsAt` is seconds since epoch, as Claude Code's `resets_at`
gives it. A crash mid-write leaves either the old file or the temp file, never a torn cache;
the reader ignores the temp name.

---

## 4. Testing

- **Unit, pure** (`spikes/usage-test/`): `renderUsage` and `normalizeRateLimits` across every
  branch — threshold boundaries (69/70/89/90), the staleness boundary, a null window, reset
  time today vs another day, empty/absent cache. The purity grep. This is the bulk of the proof.
- **Unit, store** (`spikes/usage-test/`): atomic write, 0600, tolerant read of absent/corrupt.
- **Unit, tap** (`spikes/usage-test/`): a sample stdin (captured in T00) produces the right
  cache; Bedrock env writes nothing; stdin without `rate_limits` does not clobber a prior cache;
  malformed stdin exits 0 with empty stdout and no write.
- **Unit, install** (`spikes/usage-test/` or the auto-name harness): a clean settings.json gains
  our statusline; a second install points rather than duplicates; a foreign statusline is
  preserved; a malformed settings.json is refused, not overwritten.
- **Integration** (`spikes/cockpit-test/`): the footer draws the segment from a seeded cache,
  dims a stale one, shows nothing for an absent cache and nothing when the seeded state is a
  Bedrock/no-data case.
- **What none of them prove**: that Claude Code actually delivers `rate_limits` on this
  machine's version and that the real numbers reach the footer on a live subscription. That is
  §5.1, verified with the user (T00, T06).

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5.0) |
| Language / runtime | Node.js (ESM `.mjs`), zsh |
| Toolchain | WezTerm; Claude Code 2.1.273 (statusline `rate_limits` needs ≥ 2.1.251) |
| **Deliberately absent** | No public API for subscription usage; no local file Claude Code writes with it; no non-interactive command that prints it (T00). The statusline object is the only supported source. |

**The test command.** Each suite is a self-contained `spikes/<name>/run.sh`; there is no
aggregate runner. This plan's suites:

```
bash spikes/usage-test/run.sh      # new: store, model (incl. purity grep), tap, install
bash spikes/cockpit-test/run.sh    # extended: the footer usage segment
```

Run both; a suite prints one summary line on success and full detail on failure, exit code
non-zero on failure (matches the existing suites — `ALL PASS (N …)` vs `FAILURES`). No colour
is forced in this repo (checked: nothing sets `FORCE_COLOR`/`CLICOLOR_FORCE`); keep it that way.

**Dependencies.** None added. Node standard library only, as with every other cockpit module.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| That Claude Code delivers `rate_limits` on this machine and the exact field shape | Only a live Pro/Max session populates it; the tests use a captured sample (T00) |
| That the real numbers appear in the footer, correctly formatted and coloured | Needs a real personal subscription running through the installed tap (T06) |
| That a company Bedrock session shows no usage segment | Needs a real Bedrock session (T06) |
| That the reading dims with an "as of" stamp after 15 minutes idle | Needs elapsed real time on a live install (T06) |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| Tap output on any error | empty stdout, exit 0 | A broken tap never disrupts a Claude session |
| `--install` on settings.json | atomic; refuse if unparseable | Never corrupts the user's own settings; reversible by `--uninstall` |
| `COCKPIT_DIR` | `~/.claude/cockpit` | Tests point the cache and settings at a scratch dir |

No capability here can take the machine, the screen, an account or money. The one live-world
change is editing the global `~/.claude/settings.json` (§6).

---

## 6. Recovery

The only persistent change outside `~/.claude/cockpit/` is the statusline registration in
`~/.claude/settings.json`. It is reversible: `cockpit-usage-tap.mjs --uninstall` removes our
entry (matched on the script basename) and restores any previous statusline command it recorded
at install. The edit is atomic and refuses a settings.json it cannot parse, so a failed install
leaves the original untouched. Deleting `usage-cache.json` costs nothing — the next personal
turn rewrites it.

---

## 7. Decisions and rationale

- **2026-09-16 — Method 1 (statusline tap), not Method 2 (the `/api/oauth/usage` endpoint).**
  Method 2 reaches the same numbers by calling Anthropic's undocumented endpoint with the OAuth
  token from the Keychain. It is fragile (undocumented, version-sensitive, 429-prone) and
  handles a credential. Method 1 is officially supported, handles no token, cannot be throttled,
  and self-gates to subscription sessions. Cost accepted: staleness while no personal session
  runs (§2.4). Method 2 deferred, not dropped (§8).
- **2026-09-16 — fed by all personal sessions, registered globally**, not only cockpit sessions.
  The limit is account-wide, so freshness is the only variable and more feeders is fresher; the
  silent, Bedrock-short-circuiting tap costs nothing elsewhere. (§2.6)
- **2026-09-16 — format `% + reset time`**, chosen by the user from the prototype over
  percent-only, a mini gauge, and worded. The reset time is what decides whether to wait. (§2.2)
- **2026-09-16 — thresholds 70/90, staleness 15 min**, user defaults, tunable constants. (§2.3, §2.4)
- **2026-09-16 — a pre-existing statusline is chained, not refused.** Refusing would block the
  feature for anyone with a custom statusline; chaining keeps theirs visible. None exists here
  today, so this is future-proofing, kept simple. (§2.7)

## 8. Explicitly out of scope

- **The live poll (Method 2).** The daemon calling `/api/oauth/usage` itself so the reading is
  fresh even with no personal session running. Deferred for the fragility above; the footer
  reads one cache file, so it can be added later as a second writer without touching the UI.
- **`spend_limit` and per-model weekly windows** (`seven_day_opus`, `seven_day_sonnet`). Not
  asked for, and `spend_limit` only appears behind a gateway this user does not use. Ignored to
  keep the segment short.
- **Showing usage inside Claude Code's own status line.** The tap could emit the same string as
  its visible output, but the person asked for the cockpit footer; the tap stays silent (§2.7).
- **Any Bedrock/company usage readout.** Bedrock has no session/weekly caps; there is nothing to
  show and it must not appear (§2.5).
