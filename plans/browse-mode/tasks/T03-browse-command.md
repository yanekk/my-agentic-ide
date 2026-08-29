# T03 — The `browse` command and the cockpit's broot layer

**Phase:** 1 · **Depends on:** T02 · **Weight:** light

## Goal

Publish the browser. `browse` opens broot in the current terminal with the cockpit's own verb
layer, so Enter on a file calls `cockpit-open` instead of handing the file to macOS. Like
`note` and `agenda`, it exists **inside the cockpit and nowhere else**, and the agents inherit
it.

## Before building — raise this with the user

The name `browse`, and publishing it cockpit-only, is an **assumption**. The user was asked
twice during planning and did not answer; it was the recommendation and drew no objection.
**Ask once, plainly, and wait** — it is a user-visible command name and cheap to change now.

## Design sections this implements

DESIGN §2.3 (the browser), §3.2 (modules), §7 (why the cockpit ships its own verb file).

## Files

```
bin/cockpit-browse.sh              new — the launcher
bin/cockpit-browse-verbs.hjson     new — the Enter verb, and nothing else
bin/cockpit-layout.sh              one line: ln -sf … "$COCKPIT_BIN/browse"
spikes/browse-test/run.sh          extended
```

## Interface

```sh
browse [path]     # defaults to the terminal's cwd
```

runs, with `COCKPIT_REPO` and `PATH` named explicitly on the command line:

```sh
broot --conf "$HOME/.config/broot/conf.hjson;$HOME/.config/broot/verbs.hjson;<repo>/bin/cockpit-browse-verbs.hjson" [path]
```

**`--conf` layers, it does not replace** — measured (FINDINGS). The user's own broot config
keeps working and the cockpit never writes into `~/.config/broot/`.

The verb file contains one verb:

```hjson
{
    verbs: [
        {
            key: enter
            apply_to: text_file
            external: "cockpit-open {file} {line}"
            leave_broot: false
        }
    ]
}
```

- `apply_to: text_file` so Enter on a **directory** still descends into it, which is broot's
  normal navigation and must not be broken.
- `leave_broot: false` so you land back in the tree, still searching.
- This **overrides** broot's stock `enter` → `open_stay`, which on macOS hands the file to
  whatever GUI app is associated with it — a window over the terminal, which is the whole
  reason this binding exists.

## Tests

- [ ] `cockpit-browse.sh` builds a `--conf` list in which the cockpit's file is **last**, so it
      wins on a key clash
- [ ] it names `PATH` and `COCKPIT_REPO` explicitly — a wezterm split inherits **no**
      environment (`CLAUDE.md`), so nothing may be assumed to be exported
- [ ] it passes a path argument through, and defaults to cwd when given none
- [ ] it fails with a readable message when `broot` is not on PATH
- [ ] the hjson file **parses** — assert by running `broot --conf … --help`, since an unparseable
      config makes broot print "Bad configuration file" and quit, which is how this was
      discovered during planning
- [ ] `cockpit-layout.sh` symlinks `browse` into `~/.claude/cockpit/bin`, and relinks on a
      rebuild without wiping the directory (`ff`/`fp` and anything else dropped there survive)
- [ ] the verb's `external` resolves `cockpit-open` from the cockpit bin directory, not from a
      hardcoded path — a moved checkout must repair itself on rebuild

## Done when

- [ ] `browse` exists in a cockpit terminal and nowhere else
- [ ] `spikes/browse-test/run.sh` and `spikes/cockpit-test/run.sh` are both green
- [ ] the user has confirmed (or corrected) the command name
