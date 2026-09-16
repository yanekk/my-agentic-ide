# T04 — Register the statusline in settings.json

**Phase:** 1 · **Runs:** auto · **Depends on:** T03 · **Weight:** medium

## Goal

Make the tap actually run, by registering it as the `statusLine` command in
`~/.claude/settings.json`, and make that reversible. The merge must be as careful as the
auto-name hook's: never rewrite the user's file, never drop their other settings or hooks, point
rather than duplicate on a re-run, refuse a file it cannot parse, and restore any prior
statusline on uninstall. Wire `--install` into `bin/install.sh` so a machine setup registers it.

## Design sections this implements

DESIGN §2.6 (registered globally), §2.7 (chain a pre-existing statusline), §6 (recovery).

## Files

- `bin/cockpit-usage-tap.mjs` (extend with `--install`/`--uninstall`).
- `bin/install.sh` (call `cockpit-usage-tap.mjs --install`, right where it calls
  `cockpit-auto-name.mjs --install`). The tap is invoked by absolute path from settings.json like
  the auto-name hook, so it needs no PATH symlink — unlike `note`/`agenda`/`config`, which
  `cockpit-layout.sh` relinks because they must be on a cockpit shell's PATH.
- Possibly a shared settings-merge helper if one is factored out of `cockpit-auto-name.mjs`;
  otherwise mirror its approach. Read that file's merge before writing this.

## Interface

```
cockpit-usage-tap.mjs --install
  // Parse ~/.claude/settings.json (exit non-zero, change nothing, if unparseable).
  // If statusLine is absent            → set it to our command.
  // If statusLine is already ours       → re-point its command path (moved checkout), no dup.
  // If statusLine is a foreign command  → record it (so the tap can chain it, T03 step 4) and
  //                                        replace statusLine with ours. --uninstall restores it.
  // Write atomically (temp + rename), preserving every other key (model, hooks, plugins …).
  // "ours" is matched on the script basename cockpit-usage-tap.mjs, as the hook matches its own.

cockpit-usage-tap.mjs --uninstall
  // Remove our statusLine; if a foreign one was recorded at install, restore it; else drop the key.
```

Where the recorded prior command lives (a small file in `~/.claude/cockpit/`, e.g.
`statusline-prev`) is the implementer's call; it must survive between install and uninstall and
be per-machine, not in the repo.

This task also owns the **runtime** end of chaining — the tap's step 4 (DESIGN §2.7, T03 defers
it here). When `statusline-prev` records a foreign command, the tap runs it with the same stdin
and emits its stdout as the visible statusline, then taps the data on top. With no recorded
command (the case on this machine, §7) the tap stays empty, which is all T03 tests. Keep it
simple: read the recorded command, run it, emit its stdout; any error there falls back to empty
output like every other tap error (T03 step 5). It is tested here with a stub prior command
rather than left unexercised.

## Tests

Mirror `spikes/auto-name-test/`'s settings-merge tests; put them in `spikes/usage-test/` or reuse
that harness.

- [ ] Clean settings.json (no statusLine) → gains our statusLine, every other key intact.
- [ ] The existing UserPromptSubmit auto-name hook and the Stop sound hook survive the merge.
- [ ] A second `--install` points the command path, does not duplicate or nest.
- [ ] A foreign statusLine is recorded and replaced; `--uninstall` restores it exactly.
- [ ] With no foreign statusLine, `--uninstall` removes the key entirely.
- [ ] A malformed settings.json → non-zero exit, file untouched.
- [ ] The write is atomic (temp + rename), mode preserved.
- [ ] Runtime chaining: with a stub command recorded in `statusline-prev`, the tap runs it with
      the piped stdin and emits its stdout as the visible line, and still writes the cache on top;
      a failing stub falls back to empty output (exit 0), not a stack.

## Done when

- [ ] `--install`/`--uninstall` behave as above and are covered by passing tests.
- [ ] `bin/install.sh` registers the tap on setup (by absolute path, beside the auto-name hook).
- [ ] A malformed settings.json is provably never overwritten.
- [ ] CLAUDE.md's install description and file map mention the statusline registration and the
      new bins (this doc edit is in scope for this task).
