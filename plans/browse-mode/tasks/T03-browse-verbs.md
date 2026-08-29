# T03 — The cockpit's broot verb layer

**Phase:** 1 · **Depends on:** T02 · **Weight:** light

## Goal

Teach broot that Enter on a file means "push it into the viewer next door" rather than "hand it
to macOS". That is one small hjson file and the `--conf` chain that layers it over the user's own
config without touching it.

**There is no `browse` command.** The daemon launches broot itself when the agent enters browse
mode (T04), so nothing is published on a PATH and nothing is typed. This task owns the *verb
file and the argument shape*; T04 owns the launch.

## Design sections this implements

DESIGN §2.3 (the browser), §3.2 (modules), §7 (why the cockpit ships its own verb file).

## Files

```
bin/cockpit-browse-verbs.hjson     new — the Enter verb, and nothing else
bin/install.sh                     two more rows in the prerequisite table
bin/cockpit-layout.sh              two more command -v guards
CLAUDE.md                          "checks the five tools" is now seven
spikes/browse-test/run.sh          extended
```

## micro and broot are hard prerequisites

Decided with the user at plan review: both are **required**, exactly like `wezterm`, `revdiff`,
`node`, `claude` and `git`. `bin/install.sh` gains two `check_tool` rows and refuses to install
without them; `bin/cockpit-layout.sh` gains two `command -v … || die` guards beside the four it
already has.

*Why required rather than a warning:* the failure with `micro` absent is not a missing feature —
entering browse mode leaves half the top pane at a failed command, which the healer then retries
**once a second for the life of the window**. An optional dependency would mean building and
testing a whole extra refusal path to avoid that. There is no machine this cockpit runs on where
a Homebrew single binary is a real cost.

```sh
check_tool micro "brew install micro"
check_tool broot "brew install broot"
```

## Interface

The verb file, and nothing else in it:

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
- `{file}` is absolute; `planPush` (T01) makes it repo-relative for the tab label. Do not
  pre-relativise it here — the pure side owns that, and the promoted planning probe's
  `{file:path-from-directory}` is a *different* shape kept only for the record (T00).
- `{line}` is empty when no `c/` content search is active. The model already treats a null, zero
  or non-integer line as "no jump" (T01), so a plain Enter needs no special case — **assert
  that, do not assume it.**

The `--conf` chain the daemon builds (T04 uses it; this task defines and tests it):

```
$HOME/.config/broot/conf.hjson;$HOME/.config/broot/verbs.hjson;<repo>/bin/cockpit-browse-verbs.hjson
```

**`--conf` layers, it does not replace** — measured (FINDINGS). The user's own broot config keeps
working, their `⌥p`/`⌥o` preview keys keep working, and the cockpit never writes into
`~/.config/broot/`. The cockpit's file is **last** so it wins on a key clash.

## Tests

- [ ] the hjson file **parses** — assert by running `broot --conf … --help`, since an unparseable
      config makes broot print "Bad configuration file" and quit, which is how this was
      discovered during planning (and again during the plan review)
- [ ] the `--conf` list puts the cockpit's file **last**, so it wins on a key clash
- [ ] the user's own `conf.hjson`/`verbs.hjson` are still in the chain and are never written to
- [ ] a chain entry that does not exist is handled deliberately — broot quits on a bad `--conf`,
      so a user with no `~/.config/broot/verbs.hjson` must not be left unable to browse
- [ ] `install.sh --check` reports `micro` and `broot`, and counts them as missing when they are
- [ ] `cockpit-layout.sh` dies with a readable message when either is absent, before it builds
      any panes — the same shape as the four guards already there

## Done when

- [ ] the verb file parses and the layering is asserted, not assumed
- [ ] a fresh machine without micro or broot is refused at install time, with a `brew` hint
- [ ] `spikes/browse-test/run.sh` and `spikes/cockpit-test/run.sh` are both green
