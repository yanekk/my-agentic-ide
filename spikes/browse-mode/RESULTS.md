# Browse mode — what the pane probes measured

Browse mode puts **two** panes in the diff slot: the browser (broot) on the left, the
tabbed read-only viewer (micro) on the right. The slot has held exactly **one** pane per
agent since it was built, and every rule about how it is swapped was written for one pane.
So the whole plan rests on a question the design could only assert until now:

> can the slot hold a pair, park it as a unit, and give it back unchanged?

**It can.** Measured, not argued — see [§1](#1-the-pair-in-the-slot).

Everything here runs against a headless `wezterm-mux-server` with its own socket and pid
file. **No cockpit window is ever touched** (DESIGN §5.2), and each probe refuses to run at
all unless what answers its socket is a mux it just created — see
[the seatbelt](#the-seatbelt).

## Running them

Each script takes no arguments and its **exit status is the verdict**: green is 0.

```
spikes/browse-mode/probe-pair-slot.sh    the pair in the slot            52 checks
spikes/browse-mode/probe-park.sh         one viewer survives parking     11 checks
spikes/browse-mode/probe-push.sh         the push mechanism               8 checks
spikes/browse-mode/probe-e2e.sh          broot Enter -> micro, for real   6 checks
spikes/browse-mode/probe-title.sh        how a micro pane is recognised   3 checks
```

**80 checks in all.** All five, in one line:

```
for p in spikes/browse-mode/probe-*.sh; do "$p" || { echo "RED: $p"; break; }; done
```

`common.sh` is sourced, not run: the mux boot, the seatbelt, the geometry reader and the
assertion counter, once instead of five times.

Measured on macOS 26.5.1 (Apple Silicon), wezterm 20240203-110809-5046fc22,
broot 1.59.0, micro 2.0.15, revdiff v1.12.0, on a 120-column window.

---

## 1. The pair in the slot

`probe-pair-slot.sh`. One agent's diff slot alternates between **revdiff alone** and the
**browser+viewer pair**, then a second agent joins with a pair of its own.

### The geometry is identical, not merely similar

| | slot |
|---|---|
| revdiff alone in the slot | **120x15** |
| the pair in the slot | **120x15** — broot 47 cols, micro 72, one column of divider |
| revdiff back after the pair parked | **120x15** |
| the pair back after revdiff parked | **120x15** |
| the pair back into a slot that was **resized while it was parked** | **120x19**, still 47 / 72 |

micro came back with both its tabs (` f1.txt   [lib/gamma.js]`), broot came back drawing its
tree, and revdiff came back **still revdiff** on the daemon's own two-signal check (12 framed
lines).

### The order is the same rule as before, applied twice

The diff pane spans the window, so **its geometry is the slot**. Park it first and the only
thing left to split is the fleet pane's half-width region. So the incoming occupant is split
*into* the outgoing one and the outgoing one is parked afterwards — already documented in
`CLAUDE.md` for one pane. With a pair the same rule holds; there is just more of it:

```
enter browse (revdiff -> pair)          leave browse (pair -> revdiff)
 1 split BROWSER into revdiff            1 park the BROWSER      (viewer inherits the slot)
 2 park revdiff  (browser inherits)      2 split revdiff into the VIEWER
 3 split VIEWER off the browser, 60%     3 move the VIEWER into the browser's park tab
```

Step 3 on the right is what puts the pair in **one** tab and, in the same call, collapses the
split so revdiff inherits the slot exactly. **The slot is never empty at any point**, which is
the whole reason this order is not a style choice.

Switching between two agents that are *both* in browse is the same shape with one more call:
park the outgoing browser, split the incoming browser into the outgoing viewer, park the
outgoing viewer beside its browser, split the incoming viewer off its browser.

### What the extra park costs

| | per swap | wezterm cli calls |
|---|---|---|
| single-pane swap (the other three modes) | **17–26 ms** | 3 |
| pair swap (browse ↔ browse) | **25–31 ms** | 5 |

Mean of twenty alternating swaps each. **Read the direction, not the figure.** At the six reps
this probe originally used, the two means overlapped — measured single/pair runs of 19/26,
26/25 and 24/27, and on the middle one the *single* swap came out the slower of the two, which
a 5-calls-versus-3 story cannot explain. One `wezterm cli` invocation costs ~6 ms here, so a
six-rep mean is a handful of process spawns and one scheduler hiccup moves it. At twenty reps
the direction is stable (25/31 and 17/28) and the pair costs roughly **6–11 ms** more. So the
pair is the slower of the two, both are a few tens of milliseconds, and **an exact delta quoted
off one run is not something this probe defends** — the earlier "26 against 19" was one sample.

**This is the cost the daemon pays to move the panes, and it is not what the user sees**: a
restored pane takes a SIGWINCH and repaints, and whether that redraw is acceptable rather than
merely correct is a judgement (DESIGN §5.1) — T07's, not a probe's.

### The cases the plan-review probe did not reach

- **Two agents, both in browse.** Three parked panes for each (revdiff, browser, viewer),
  alternating twice. Each agent's pair parks in its own tab, separate from its own revdiff;
  the cockpit tab holds six panes throughout — one pair, never two. Both viewers kept their
  own tabs across the switches.
- **The empty-slot rebuild with a pair to restore.** Both halves killed outright, then
  `rebuildDiffSlot`'s dance (park the terminal and the strip, split full-width off the fleet
  pane, move both back) and the pair restored into the throwaway placeholder. Back at
  120x15, 47 / 72, tabs intact, placeholder disposed of.
- **A resize while the pair is parked.** The pair returned filling the **resized** slot at the
  same 47 / 72 ratio. What is exercised is the *slot* changing size under a parked pair —
  a real OS window drag is not reachable from a headless mux (`wezterm cli` has no
  window-resize verb), so that half belongs to T07.

### The 47 / 72 split is re-imposed on every restore, not preserved

Worth being exact about, because the row above reads as though the ratio *survived* parking and
it does not. Every restore in this probe ends with `split-pane --right --percent 60`, so the
divider is **placed afresh each time** from a constant. That is why it comes back at 47 / 72
after a park, after an agent switch and after a resize — the number is re-derived, not carried.

The consequence is T05's to decide: if the user ever drags the divider between browser and
viewer, this shape snaps it back to 60 % on the next park/restore. Nothing here measures a
dragged divider, so nothing here says whether that is acceptable. It is a real behaviour, not a
probe artefact — the daemon would do exactly the same.

---

## 2. Parking one viewer — `probe-park.sh`

The measurement DESIGN §2.6 rests on. A micro with four tabs and its cursor on line 55 is
parked with `move-pane-to-new-tab` and split back into the slot:

```
before   110x12   alpha.js  beta.js  gamma.js  [delta.txt]   delta.txt [ro] (55,1)
parked   110x30   (its own tab, resized to the full window)
after    110x12   alpha.js  beta.js  gamma.js  [delta.txt]   delta.txt [ro] (55,1)
```

All four tabs, the cursor and the read-only flag survive. Browse is a stop in a four-way
cycle, so it is passed through constantly; killing micro on the way past would empty the tab
bar every time, which is the entire feature.

**A restored pane is a screen micro repainted *into*.** The rows micro does not touch keep
whatever was there before — blank if the pane grew, **stale file content if it shrank**. Both
were seen while writing these probes, and reading the tab bar with `head -1` produced six
spurious failures before it was noticed. `micro_tabbar` in `common.sh` finds the bar by shape
instead. Anything in the daemon that reads a restored pane's screen inherits this problem.

---

## 3. The push — `probe-push.sh`

Ctrl+E, the command, then `\r`, sent with `wezterm cli send-text --no-paste` into a micro
nobody is looking at:

| | |
|---|---|
| tabs accumulate | `alpha.js` → `+beta.js` → `+gamma.md` → `+delta.txt` |
| `goto 42` lands | status line `delta.txt (42,1)` |
| **focus is never taken** | the browser pane was still the active one after four pushes |
| **re-pushing an open file makes a DUPLICATE tab** | `alpha.js beta.js gamma.md delta.txt [beta.js]` |

That last row is why the glue keeps its own ordered list of what it sent and uses
`tabswitch <n>` (DESIGN §2.5): micro cannot be asked what it has open, so what we sent is the
only available truth.

**`\r` submits; `\n` does nothing, silently.** The project's own `\r`→`\n` substitution — the
one that makes an injected review arrive unsent — is exactly backwards here, and getting it
wrong costs a run with no error to show for it.

---

## 4. End to end — `probe-e2e.sh`

broot in one pane, micro in another, a verb file passed with `--conf`, and a glue script in
between. Pressing Enter on a file in the browser opens it as a tab in the viewer; a `c/`
content search followed by Enter lands **on the matching line** (`beta.js [ro] (2,1)`), which
is the whole value of searching across files. Focus never left the browser.

**Two things this probe is not evidence for, and one it very much is.**

- **The verb here is not the verb the cockpit will ship.** This one passes
  `{file:path-from-directory}`; the shipped verb (T03) passes plain `{file}` and relativises
  on the pure side in `planPush` (T01). Do not make either match the other.
- **`{file:path-from-directory}` does not relativise anything** — measured. Launched on an
  absolute root, broot hands back an **absolute** path. So the probe's glue relativises it a
  second time in python, which looks like redundancy in the planning script and is not: drop
  that step and micro's tab bar fills with `/private/var/...` and truncates the filename away,
  which is precisely the unreadable bar DESIGN §2.2 exists to prevent. **Both the probe and the
  shipped verb relativise outside broot; they differ only in where.**
- **And relativising needs `realpath` on both sides.** broot returns a symlink-resolved path
  (`/private/var/...`) while the root as given is not (`/var/...` on macOS), and
  `os.path.relpath` between the two yields `../../../../../../../private/var/...` — worse than
  the absolute path it was meant to shorten. This bites any agent worktree reached through a
  symlink, so **T01's `planPush` has to resolve both sides**, and its tests should cover it.

broot swallows an external command's output, so the glue keeps its own log; a push that fails
fails invisibly otherwise, which is how the two findings above were found.

---

## 5. Recognising a live viewer — `probe-title.sh`

The daemon heals a diff pane that has dropped to a bare shell on a 1 s tick, and a live micro
must never be mistaken for one — typing a command line into the viewer is what that mistake
looks like.

| | |
|---|---|
| WezTerm's title for a micro pane | **`micro`**, already correct at t=1s and stable at 2, 4 and 7s |
| a bare shell's title, for comparison | `~` |
| framed lines (`^│`) in a live micro | **0** — `diffPaneStatus` needs ≥ 5 |
| framed lines in a live broot | **0** likewise; broot draws no frame either |

So for both halves the **title is the only signal available**, unlike revdiff, which the
daemon can also recognise by its framed screen. revdiff's title lags its launch by ~1 s and
micro's does not — but a probe is not a promise, and **T06 should tolerate a lag rather than
assume none**.

---

## The seatbelt

`WEZTERM_UNIX_SOCKET` beats the config file. A probe run from inside a cockpit terminal
inherits it pointing at the **live** cockpit's mux, and every call these scripts make would
then split, park and kill panes in the user's real window. So `common.sh`:

1. **unsets** `WEZTERM_UNIX_SOCKET` and `WEZTERM_PANE` the moment it is sourced, before any
   `wezterm` call can be made;
2. points it at the probe's own socket; and
3. **refuses to continue** unless what answers is a mux it just created — exactly one pane in
   exactly one tab. Anything else aborts before a single pane is touched.

Every probe removes its mux server, socket, pid file and scratch directory on exit, including
on failure and on interrupt. Verified by pid: a run adds no `wezterm-mux-server` process.

**The raw planning probes in `plans/browse-mode/probes/` did not do this**, and a machine that
ran them may still have orphaned mux servers on it. `pgrep -fl wezterm-mux-server` lists them;
none of them belong to the cockpit window, which runs the WezTerm GUI, not a mux server.

## What is deliberately still in `plans/browse-mode/probes/`

`tui-render.py` — the pyte-based renderer that every layout in this plan was actually
*looked at* through. It runs a TUI in a pty of a chosen size, answers its terminal queries,
sends scripted keys and prints the **rendered** screen. It is a planning tool, not part of the
product, and it needs a Python venv (`pip install pyte`) that this project does not otherwise
have — DESIGN §5 reserves new dependencies to the user, so promoting it is the user's call and
not a session's. To get it back: `python3 -m venv .venv && .venv/bin/pip install pyte`, then
run it from `plans/browse-mode/probes/`.

None of the probes here need it. They assert on `wezterm cli get-text` and `wezterm cli list`,
which is why they can be re-run rather than believed.
