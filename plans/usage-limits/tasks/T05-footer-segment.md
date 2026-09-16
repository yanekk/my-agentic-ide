# T05 — The footer usage segment

**Phase:** 2 · **Runs:** auto · **Depends on:** T01, T02 · **Weight:** light

## Goal

Draw the usage readout on the far right of the footer. The strip stays pure display: it reads the
cache through the store, asks the model what to show, and turns the model's semantic roles into
ANSI colour. It adds `usage-cache.json` to what it watches so a fresh reading appears at once.

## Design sections this implements

DESIGN §2.2 (placement and format), §2.3 (colour), §2.4 (dim when stale), §3.4 (data flow into
the strip), §2.n (absent/corrupt shows nothing).

## Files

- `bin/cockpit-strip.mjs` (modify `renderFooter()` and the `fs.watch` filter only). The footer
  today is agent name + key legend + `Diff mode:` labels; this appends the usage segment after a
  spacer that pushes it right.

## Interface

```
// in renderFooter():
const cache = readCache();                    // T01
const u = renderUsage(cache, Date.now());     // T02  (clock read here, in the display layer)
// if u is null → draw the footer exactly as today (no segment).
// else → append: ◔ <win>  <win>, each win `${key} ${pct}% ↺${reset}`.
//   NOT stale: each win coloured by its role (ok/warn/crit → green/amber/red ANSI).
//   stale (u.stale): the WHOLE segment — mark, both windows, the as-of stamp — is drawn dim,
//     role colours suppressed (DESIGN §2.4, "dims the whole segment"; the approved prototype
//     overrides the role colour with the stale style). Append " · as of "+u.asOf.
// add "usage-cache.json" to the directory-watch filter alongside terminals.json, so a new
// reading repaints immediately; the existing 2s interval also moves a reading across the
// staleness line without a write.
```

The segment is not clickable, so no hit-zone is registered (unlike the diff-mode labels). Keep
the far-right placement identical whether attached to an agent or on the fleet list (DESIGN §2.2).

**The footer must stay one row and the usage readout must survive a narrow window (DESIGN §2.2).**
The composed line is never allowed to exceed the terminal width (wrapping breaks the `pinHeight`
one-row invariant). When it would, drop parts in this order: the dim secondary key hints (move,
zoom, drag) first, then the primary key hints (⌥t/⌥[/⌥]/⌥w/O), then the agent name — keeping the
usage readout and the diff-mode labels. On a wide-enough window the full footer shows unchanged.
The diff-mode labels' click hit-zones are computed from where they actually land, so any trimming
that shifts them must keep the recorded columns correct.

## Tests

Extend `spikes/cockpit-test/run.sh` (the strip/footer suite, wezterm stubbed).

- [ ] A seeded fresh cache renders `◔ 5h NN% ↺… 7d NN% ↺…` on the footer with the right values.
- [ ] Colour reflects the role on a fresh cache: a ≥90% window carries the crit colour, a
      70–89% one amber.
- [ ] A seeded cache older than the staleness window renders the whole segment dimmed with
      `· as of HH:MM`, and a stale crit window is dim (role colour suppressed, not red).
- [ ] An absent cache renders the footer with no usage segment (unchanged from today).
- [ ] A cache with one window null renders only the other window.
- [ ] On a terminal too narrow for the full footer, the line stays one row (never wraps) and the
      usage segment is still present while key hints are dropped first (assert usage survives and
      the visible line width ≤ the column count).

## Done when

- [ ] The footer shows the usage segment from the cache, coloured and (when stale) dimmed.
- [ ] `usage-cache.json` is in the strip's watch filter.
- [ ] With no cache the footer is byte-for-byte today's footer; the suite asserts it.
- [ ] The footer never wraps past one row: when a usage segment is present and the window is
      narrow, key hints are dropped to keep usage on a single line (DESIGN §2.2).
- [ ] The strip still does no I/O beyond reading the cache and no command-running (pure display).
