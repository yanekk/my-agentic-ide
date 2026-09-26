# T02 — footer-switch

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Draw the `Claude Agents | PIR` segment in the footer and turn a click on it into a verb on the
`cmd` channel, so the person has the switch the daemon will act on. It reads a new `fleet` block
in `terminals.json`; the daemon starts writing that block in T03, and until then the segment is
simply absent.

## Design sections this implements

DESIGN §2.1, §2.2, §3.5 (`terminals.json` shape).

## Files

- `bin/cockpit-strip.mjs` (`renderFooter`, `onFooterClick`)
- `spikes/cockpit-test/run.sh` (new section after the existing footer sections)

## Interface

```
terminals.json  { …existing…, fleet?: { program: "claude"|"pir", switchable: bool, available: bool } }

footer          <Claude Agents | PIR>  then the existing diff-mode segment, then usage
                shown program in reverse video (the diff-mode style); whole segment dim when
                !switchable; absent when fleet missing or !available
click           switchable && zone != shown program → append "fleet-claude\n" | "fleet-pir\n" to cmd
```

The segment is the leftmost one, because it is present whether or not an agent is attached and
the diff-mode segment is not; putting it first keeps it from moving. Its hit zones are computed
the same way as the diff labels (`buildDiff`), after trimming, and are independent of
`footerAttached`, which gates only the diff labels.

## Tests

- [ ] No `fleet` block → footer byte-identical to today.
- [ ] `available:false` → no segment.
- [ ] `program:"claude"`, switchable → `Claude Agents` reversed; click on `PIR` appends
      `fleet-pir`; click on `Claude Agents` appends nothing.
- [ ] `program:"pir"`, switchable → click on `Claude Agents` appends `fleet-claude`.
- [ ] `switchable:false` → segment dim, clicks append nothing.
- [ ] Segment present at the fleet list (agent `repo`) and with an agent attached; diff-label
      hit zones still land on their labels with the segment in front.
- [ ] Narrow width (80 cols) with usage present: one row, no wrap, trimming order unchanged
      for the existing segments.

## Done when

- [ ] The new cockpit-test section passes and the whole suite stays green.
- [ ] A missing `fleet` block renders exactly today's footer.
- [ ] Clicks produce the two verbs only when switchable and on the other label.

## End to end (the worker drives this)

- suite: `spikes/cockpit-test` (the strip is run for real with a hand-written `terminals.json`
  and SGR mouse input) · sizes: 120 and 80 columns
- [ ] left-press on each label in each state → the verb, or nothing, as listed above
