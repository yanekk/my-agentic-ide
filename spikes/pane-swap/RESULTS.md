# Swapping the full-width diff pane

Why: entering an agent used to *start* revdiff, and starting revdiff costs a
couple of seconds of git plus parsing. That was paid on every switch, so the top
of the cockpit visibly flickered — blank, then a diff — each time. Per-agent
terminals already avoid this by parking the outgoing pane instead of killing it
(`spikes/pty-inject/RESULTS.md`), so the question was whether the same trick
works for a pane that spans the window.

Run `spikes/pane-swap/probe.sh`. It drives a headless `wezterm-mux-server` with
its own socket and pid file, so no cockpit window is disturbed. wezterm
20240203-110809-5046fc22, `initial_cols = 120`.

## The order of the swap is not a style choice

The terminal slot is a leaf in the bottom row's horizontal split, so it can be
parked and then re-split from the fleet pane. The diff pane cannot: its geometry
*is* the slot, and once it is parked there is nothing left in the tab but a
horizontal row.

| | |
|---|---|
| Park the diff pane, then `split-pane --top --percent 55 --pane-id <fleet>` | **59x22** — half a 120-column window. It split the fleet pane's own region, because the bottom row is a horizontal split. |
| `split-pane --top --percent 50 --pane-id <outgoing diff> --move-pane-id <incoming>`, **then** park the outgoing pane | **120x22**, and the bottom row is untouched at 59x17 / 60x17. Removing the outgoing pane collapses the split and the incoming pane inherits the whole slot. |

So the diff slot is swapped in the opposite order to the terminal slot: the
incoming pane is split *into* the outgoing one, and the outgoing one is disposed
of afterwards.

`split-pane --move-pane-id` returns the **moved** pane's id, not a new one —
same as for the terminal slot.

### Rebuilding an empty slot

If the diff pane dies outright (someone exits the shell revdiff was running in)
there is nothing to split into, and the naive rebuild gives the 59-column pane
above. Parking the *terminal* first leaves the fleet pane alone in the tab, so
`split-pane --top` spans the window; the terminal is then moved back:

```
move-pane-to-new-tab --pane-id <terminal>
split-pane --top   --percent 55 --pane-id <fleet>                       -> 120x22
split-pane --right --percent 50 --pane-id <fleet> --move-pane-id <terminal>
```

Measured to land at 120x22 on top with 59x17 / 60x17 below — the original layout.

## What revdiff survives

| Question | Answer |
|---|---|
| Does a parked revdiff keep its state? | Yes. Selected file, scroll position, annotation count and **unflushed annotations** all come back. Pressing `O` on the restored pane wrote the annotation made before it was parked. |
| Is the screen pixel-identical after the round trip? | No — the pane is resized to the full tab and back, so revdiff reflows. Nothing is lost, it is redrawn. |
| Does the pane come back the same size? | Yes, 120x22, provided the swap order above is used. |

## Two signals for "is revdiff still running"

Needed because a restored pane must not have the revdiff command retyped into
it — in a running revdiff every character is a keybinding.

| Signal | Behaviour |
|---|---|
| Pane title (`wezterm cli list`) | Becomes `revdiff` — but **lags**. Still `bash` at t+0.5s, `revdiff` from t+1.0s; observed still stale several seconds after a pane had been moved between tabs. Back to `bash` after `q`. |
| Framed lines on screen (`^│`) | Immediate and unambiguous: **19** within half a second of launch, **0** at a shell prompt, still 19 while a transient status message covers the status bar, **0** again after `q`. |

Either one saying "revdiff" is treated as running. The title alone is not
trustworthy; the screen alone would be if revdiff's status bar were always
visible, but transient messages replace it, so the frame is what gets counted.

## Typing into a pane that is being annotated

| | |
|---|---|
| `R` while the **annotation editor is open** | Typed into the comment. The editor footer read `[enter] save  [esc] cancel` and the annotation became `comment on AR`. This is why the editor is checked before any auto-reload — on a visible pane you would see it happen, in a parked one you would not. |
| `R` with a **saved** annotation | revdiff asks: `Annotations will be dropped — press y to confirm, any other key to cancel`. |
| A **second** `R` while that prompt is up | Counts as "any other key": `Reload canceled`, annotation intact. So background reloads cannot pile up prompts in a parked pane. |
| `\n` vs `\r` in the annotation editor | The same distinction as the prompt box: `[enter] save` means `\r`. Sending `\n` inserts a newline and leaves the editor **open**, so everything typed afterwards lands in the comment. |

## The footer's height, and why it would not stay at one line

Run `spikes/pane-swap/footer-height.sh`. It builds the whole layout — fleet,
footer, diff, terminal, strip — in the same headless mux and records every pane's
rows through each swap.

Pane swaps are **not** the cause. Footer rows on a 40-row window, split with
`--percent 5`:

| After | Footer |
|---|---|
| the layout | 2 |
| one diff swap (split into the outgoing pane, park it) | 2 |
| two diff swaps (the original back in the slot) | 2 |
| a terminal swap | 2 |
| a full diff-slot rebuild (park terminal + strip, split off the fleet pane, move both back) | 2 |

What is wrong is the 2. WezTerm has no fixed-size pane: `--percent 5` asks for a
**share** of the window, and the share is re-applied on every window resize and
font-size change, so a one-line legend does not stay one line. `--cells 1` gives
exactly one row at layout time; keeping it there is a separate problem.

### Correcting it: `adjust-pane-size --pane-id` is ignored

wezterm 20240203 resizes whatever pane is **active**, whatever `--pane-id` says.
Measured on a footer grown to 10 rows, with the fleet pane focused:

| | |
|---|---|
| `adjust-pane-size --pane-id <foot> --amount 8 Down` | Footer **unchanged at 10**. The *bottom row* — fleet, terminal and strip — was squashed 8 → **1** instead: it resized the active pane. |
| `activate-pane <foot>`, `adjust-pane-size --amount 8 Down`, `activate-pane <previous>` | Footer **10 → 2**, focus back where it started. |
| the same with `--amount 20` (over-shrink) | Clamped: **2 → 1**, and from 1 row it stays 1 and nothing else moves. So the amount need not be exact. |

Only the footer's own boundary moves either way — the fleet/diff boundary is
untouched — so this does not encroach on the daemon's ownership of pane swaps.
`--pane-id` is passed anyway: ignored today, correct if a later wezterm honours it.

### End to end

With `bin/cockpit-strip.mjs footer` actually running in the pane (same headless
mux, the real script), inflating the footer from 1 row to 9 and sampling every
100ms: still 9 at 100ms and 200ms, back to **1 at 300ms** and steady there, with
the legend repainted. A second
drift to a different height is corrected the same way; a drift to a height
already attempted is not retried, so a correction that cannot work never borrows
focus more than once.
