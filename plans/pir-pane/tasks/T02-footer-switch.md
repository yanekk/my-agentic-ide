# T02 — footer-switch

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Draw the `Claude Agents | PIR` segment in the footer and turn a click on it into a verb on the
`cmd` channel, so the person has the switch the daemon will act on. It reads a new `fleet` block
in `terminals.json`; the daemon starts writing that block in T03, and until then the segment is
simply absent.

## Design sections this implements

DESIGN §2.1, §2.2, §2.7 (the hidden `O` hint), §3.5 (`terminals.json` shape).

## Files

- `bin/cockpit-strip.mjs` (`renderFooter`, `onFooterClick`)
- `spikes/cockpit-test/run.sh` (new section after the existing footer sections)

## Interface

```
terminals.json  { …existing…, fleet?: { program: "claude"|"pir", switchable: bool, available: bool } }

footer          <Claude Agents | PIR>  then today's footer unchanged (agent name, key legend,
                diff-mode labels, usage)
                shown program in reverse video (the diff-mode style); whole segment dim when
                !switchable; absent when fleet missing or !available
legend          reviewable === false → PRIMARY without `O send→claude` (DESIGN §2.7); absent → today
click           switchable && zone != shown program → append "fleet-claude\n" | "fleet-pir\n" to cmd
```

The segment is the leftmost one, ahead of the agent name, because the name appears only with an
agent attached and anything after it moves when it does; putting the switch first keeps it
still. Like the diff labels and usage it is never trimmed: it is the only way to switch. The
existing trim levels (secondary keys, primary keys, name) are unchanged and simply count its
width. Its hit zones are computed the same way as the diff labels (`buildDiff`), after trimming,
and are independent of `footerAttached`, which gates only the diff labels.

## Tests

- [ ] No `fleet` block → footer byte-identical to today.
- [ ] `reviewable:false` → no `O send→claude` in the legend; `reviewable:true` or absent → present.
- [ ] `available:false` → no segment.
- [ ] `program:"claude"`, switchable → `Claude Agents` reversed; click on `PIR` appends
      `fleet-pir`; click on `Claude Agents` appends nothing.
- [ ] `program:"pir"`, switchable → click on `Claude Agents` appends `fleet-claude`.
- [ ] `switchable:false` → segment dim, clicks append nothing.
- [ ] Segment present at the fleet list (agent `repo`) and with an agent attached; diff-label
      hit zones still land on their labels with the segment in front.
- [ ] Narrow width (140 cols, the existing narrow-footer check's width) with usage present: one
      row, no wrap, the segment kept, trimming order unchanged for the existing segments. (At 80
      columns today's untrimmable parts alone, diff labels plus usage, are ~115 columns wide.)

## Done when

- [ ] The new cockpit-test section passes and the whole suite stays green.
- [ ] A missing `fleet` block renders exactly today's footer.
- [ ] Clicks produce the two verbs only when switchable and on the other label.

## End to end (the worker drives this)

- suite: `spikes/cockpit-test` (the strip is run for real with a hand-written `terminals.json`
  and SGR mouse input) · sizes: 319 (the live window) and 140 columns
- [ ] left-press on each label in each state → the verb, or nothing, as listed above
