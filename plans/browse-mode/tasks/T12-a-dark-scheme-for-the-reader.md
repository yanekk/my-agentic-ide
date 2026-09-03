# T12 — A dark colour scheme for the reader

**Phase:** 3 · **Depends on:** T07 · **Weight:** light

## Goal

The user had three files open in the reader and could not see the tab bar: micro's default
colours draw it **light text on a light strip**. They read three tabs as no tabs at all and
asked what "tabs" even meant. Give the reader a dark scheme so the bar is legible.

Their words, 2026-09-03: *"I just expected hmmm... white tabs over a black background, not white
tabs on a white strip."* They said **yes** to the cockpit setting one.

## What is known

| | |
|---|---|
| How the reader launches | `viewerCommand` in `bin/cockpitd.mjs`: `cd <worktree> && micro -readonly true`. No scheme is passed, so micro uses its default. |
| Does the user have a micro config? | **No.** `~/.config/micro/settings.json` does not exist — verified 2026-09-03. So nothing of theirs is being overridden and nothing of theirs will be. |
| Is there a `tabbar` option to toggle? | **No.** `micro -options` lists `tabhighlight`, `tabmovement`, `tabreverse`, `tabsize`, `tabstospaces`, `hltaberrors` — the bar's *colours* come from the colourscheme's own `tabbar` group, not from an option. |
| Does micro validate the name? | **Yes**, at launch: an unknown one prints `<name> is not a valid colorscheme`. So a typo is a startup failure, not a silent fallback — and the 1 s healer would retry it forever. **Verify the name you choose actually loads.** |

## Why on the launch line, not in their config

The cockpit **never writes into `~/.config/micro/`**, exactly as it never writes into
`~/.config/broot/` (the `⌥o` finding, 2026-09-02: their binding was wrong and it was still
reported rather than fixed). `micro -colorscheme <name>` sets it for the panes the cockpit
spawns and for nothing else — so micro outside the cockpit stays exactly as they have it, and
if they later write a settings file of their own, this does not fight it.

## Files

```
bin/cockpitd.mjs             viewerCommand -- the -colorscheme flag
spikes/cockpit-test/run.sh   the assertion on the launch string
plans/browse-mode/DESIGN.md  §7 gains a line: the reader's scheme, and why on the flag
```

## Interface

```
cd <worktree> && micro -readonly true -colorscheme <name>
```

**Which scheme is the user's to judge, not this session's.** Pick a dark one that micro
actually accepts, then **show it to them and let them say** — this is a "what they see"
decision and the plan's rule sends it to them. Do not settle it by taste alone and do not
guess a name: confirm it loads first.

A probe attempted at T07 could not enumerate the schemes — micro rejects an invalid name but
does not list the valid ones, and driving it under `script(1)` to read the error hung, because
micro will not quit without a genuinely interactive terminal. **Do not repeat that approach.**
The cheap route is the live cockpit: micro is already running in the reader, so open its command
bar (`Ctrl+E`), type `set colorscheme <name>`, and see. Its own completion lists them.

**One scheme, both readers or one?** There is only one reader command, so every agent's reader
gets it. That is right: the point is legibility, and it should not vary per agent.

## Tests

`spikes/cockpit-test/run.sh` — the same shape as the assertions already covering
`micro -readonly true`.

- the reader is launched with `-colorscheme <name>`, in the browse-mode launch and in the
  **heal** path, since a healed viewer must not come back with different colours
- `-readonly true` is still there — the flag is added, not swapped
- the name asserted is the one `viewerCommand` uses, from one place, so a change is one edit

**Prove it fails against the unfixed code**: today's launch string carries no `-colorscheme`.

## Done when

- [ ] the reader launches with a dark scheme, and so does a healed reader
- [ ] the scheme name is one micro accepts — **verified loading, not assumed**
- [ ] `spikes/browse-test/run.sh && spikes/cockpit-test/run.sh` green, twice, at low load
- [ ] DESIGN §7 records the choice and that it rides on the flag, never their config
- [ ] **hands-on with the user:** with three files open, is the tab bar legible now — can you
      tell at a glance which tab is current? And is the scheme one you want to read code in, or
      shall we try another?
