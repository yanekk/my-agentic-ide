# T05 — The footer usage segment

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** light

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
// else → append: ◔ <win>  <win>   dimmed when u.stale, with " · as of "+u.asOf appended.
//   each win: `${key} ${pct}% ↺${reset}` coloured by role (ok/warn/crit → green/amber/red ANSI).
// add "usage-cache.json" to the directory-watch filter alongside terminals.json, so a new
// reading repaints immediately; the existing 2s interval also moves a reading across the
// staleness line without a write.
```

The segment is not clickable, so no hit-zone is registered (unlike the diff-mode labels). Keep
the far-right placement identical whether attached to an agent or on the fleet list (DESIGN §2.2).

## Tests

Extend `spikes/cockpit-test/run.sh` (the strip/footer suite, wezterm stubbed).

- [ ] A seeded fresh cache renders `◔ 5h NN% ↺… 7d NN% ↺…` on the footer with the right values.
- [ ] Colour reflects the role: a ≥90% window carries the crit colour, a 70–89% one amber.
- [ ] A seeded cache older than the staleness window renders dimmed with `· as of HH:MM`.
- [ ] An absent cache renders the footer with no usage segment (unchanged from today).
- [ ] A cache with one window null renders only the other window.

## Done when

- [ ] The footer shows the usage segment from the cache, coloured and (when stale) dimmed.
- [ ] `usage-cache.json` is in the strip's watch filter.
- [ ] With no cache the footer is byte-for-byte today's footer; the suite asserts it.
- [ ] The strip still does no I/O beyond reading the cache and no command-running (pure display).
