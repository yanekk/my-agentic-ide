# T11 — Enter in the tree takes focus to the reader

**Phase:** 3 · **Depends on:** T07 · **Weight:** light

## Goal

Enter on a file in the tree pushes it into the reader and **leaves the cursor in the tree**.
The user drove browse mode by hand at T07 and asked for the opposite: *"Pressing Enter on broot
changes focus to micro, so I immediately get to the file I opened."*

**This reverses a rule the plan states deliberately** (DESIGN §3.1's focus row, and T07's own
expectation "the cursor **stays in the tree**"). The reversal is the user's decision of
2026-09-03, taken with the cost in front of them: stacking several files into tabs without
reading them now costs a `⌘⌥←` between each Enter.

**A stay-in-the-tree variant was offered and declined for now.** `Alt+Enter` pushing a file
without taking focus was put to the user as option B; they had not yet seen a tab bar when the
question was asked, so judging it was not possible. The recommendation was to build the plain
change and let the want for B appear or not. **Do not build B here.**

## Why the return trip is not this task's problem

`⌘⌥←` / `⌘⌥→` are cockpit-wide directional pane moves and predate browse mode
(`wezterm/cockpit.lua`, the `ActivatePaneDirection` block). From the reader, `⌘⌥←` lands on the
tree — mouse-free, one keystroke. Nothing new is needed and no footer label is added: the footer
is one line and T07 confirmed it only *just* fits with four mode labels.

Leaving browse mode from inside the reader already works too — `⌥[`/`⌥]` cycle the mode from
either half (asserted at §11e). So focus sitting in the reader strands nothing.

## Design sections this implements

New, on the user's decision of 2026-09-03. **DESIGN §3.1's focus row is rewritten, not
extended** — the old rule said the cursor stays in the tree and that is no longer true. DESIGN
§2.n gains a row for the failed-push case below.

**T04's rule is untouched and must stay untouched:** *focus follows the pair, never takes it.*
That governs the **daemon** during a pane swap, a heal, a fence and a worktree migration — none
of which is a person pressing Enter. This task adds focus movement to **one explicit human
gesture** and to nothing else.

## Files

```
bin/cockpit-open.mjs            the focus move, after a successful push
spikes/browse-test/run.sh       the new assertions (node suite: open)
plans/browse-mode/DESIGN.md     §3.1's focus row rewritten; §2.n gains the failed-push row
```

`cockpit-open-model.mjs` is **not** touched. The model is pure — it decides bytes, and a pane
activation is an effect. The boundary grep at §8 of the suite will catch an attempt.

## Interface

`cockpit-open.mjs` already knows the viewer's pane id (`paneId`, from `panes.json`) and already
drives `wezterm cli` directly for `send-text`. Focus is the same shape:

```
wezterm cli activate-pane --pane-id <viewer>
```

**When it fires:**

| Case | Focus moves? |
|---|---|
| First file — `open <rel>` sent | **yes** |
| Later file — `tab <rel>` sent | **yes** |
| File already open — `tabswitch <n>` sent | **yes** — you asked for that file, you want to read it |
| A `send-text` failed part-way | **no** |
| Every payload sent, but `viewer-tabs.json` could not be written | **yes** |
| Enter on a **directory** (broot descends) | n/a — `cockpit-open` is never called |
| Enter on a **non-text** file (broot's own preview panel) | n/a — `cockpit-open` is never called |

The last two rows are why nothing outside `cockpit-open` needs to change: the verb file already
routes only text files through this command (T03, §23).

**Why a failed send must not move focus.** The failure leaves micro's command bar **open** with a
half-typed command in it (FINDINGS, 2026-08-29). Dropping the cursor into that pane hands the
user a live command bar they did not ask for, in a program they may not know, with no file to
show for it. Staying in the tree keeps the damage to one missing file.

**Why a failed tab-record still moves focus.** The opposite call, for the opposite reason: there
the push *landed* and the file **is** on screen. The command still exits 1 with its one line on
stderr — that contract is unchanged — but the cursor follows the file that actually opened.

**Where the activation goes in the flow.** Outside the tabs lock, after it releases. The lock
serialises the read-modify-write against a second pusher; a pane activation is not part of that
transaction and holding the lock across a `wezterm` spawn only widens the window in which the
other pusher waits.

**A failed activation is not a failure of the push.** If `activate-pane` throws — a dead pane, no
`wezterm` on PATH — the file is open and the push succeeded. Swallow it; do not turn a delivered
file into exit 1. Log-free is fine: this command's whole interface is exit 0 or exit 1 plus one
stderr line.

## Tests

`spikes/browse-test/run.sh`, the `open` node suite. The stub `wezterm` already records its argv,
so each row below is an assertion about what was recorded, in order.

- `open` push → `activate-pane --pane-id <viewer>` recorded, and **after** the `send-text` calls
- `tab` push (second file) → the same
- `tabswitch` push (file already open) → the same
- a `send-text` that fails → **no** `activate-pane` recorded at all
- a push whose `viewer-tabs.json` write fails → `activate-pane` **is** recorded, exit is still 1,
  stderr still one line
- `activate-pane` itself failing → exit **0**, nothing on stderr, tab list still updated
- the activation names the **viewer**, never the browser — a hard-coded pane id, so a swapped
  `panes.json` cannot point it at the tree
- §8's boundary grep still passes: `cockpit-open-model.mjs` names no `wezterm` and no
  `activate-pane`

**Prove each new assertion fails against the unfixed code** — the project's standard since T02.
The first three fail trivially (nothing activates today); the failed-send row is the one that
needs care, because "no activation" is also what today's code does. Assert it against a build
that activates unconditionally, not against `main`.

## Done when

- [ ] Enter on a text file lands the cursor in the reader, on the file, in all three push cases
- [ ] a failed push leaves the cursor in the tree
- [ ] a failed activation does not fail the push
- [ ] the model still names nothing from WezTerm (§8 green)
- [ ] `spikes/browse-test/run.sh && spikes/cockpit-test/run.sh` green, twice, at low load
- [ ] DESIGN §3.1's focus row rewritten — the old "stays in the tree" wording **removed**, not
      left to contradict the code
- [ ] **hands-on with the user, because no test here can see a cursor:** Enter on a file, is the
      cursor in the reader? Does `⌘⌥←` get back to the tree, and is the tree where you left it?
      Enter on three files in a row — is stacking tabs now annoying enough to want `Alt+Enter`
      after all?
