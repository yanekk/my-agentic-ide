# T08 — Judge a half by its foreground process, not its title

**Phase:** 2 · **Depends on:** T07 (which found it) · **Weight:** light

## Goal

Browse mode was unusable on a real machine and no test in this project could have shown it.

`diffPaneStatus` decided whether a browse half was alive by looking at the **pane title** and
matching it against `BROWSE_TITLE` (`broot`/`micro`). On the user's machine the title of a pane
running broot is **`cd`**, so both halves read as quit shells for the whole of their lives. The
1s healer duly "reinstated" them: it typed `cd <worktree> && broot --conf …` into broot's own
filter box roughly every three seconds (1s poll, 3s cooldown), which reset the tree each time and
made the browser impossible to use. The user never got past step 3 of T07.

revdiff never showed the fault because it draws a framed screen, and that is a second, independent
signal. broot and micro draw no frame, so for them the title carried the whole decision.

## Why the original measurement missed it

FINDINGS (T04 review) established, correctly, that **neither micro nor broot emits a title
sequence** — probed through `script(1)`. The conclusion drawn from it was that WezTerm therefore
falls back to naming the pane after its foreground process. That fallback is real, but it only
happens when **nothing else** sets a title — which is true of the headless mux the probes ran
against, and false of any interactive shell with a `preexec` hook. zsh's usual setup writes the
title on every command: the command's first word while it runs, the cwd when idle.

Measured on the live cockpit, 2026-09-02:

```
pane 5   running revdiff   title "cd"                ps -t ttys023  ->  Ss /bin/zsh · S+ revdiff
pane 6   idle shell        title "..e-mode-review"   ps -t ttys035  ->  Ss+ /bin/zsh
pane 3   repo shell        title "~/src"
```

## Design sections this implements

DESIGN §2.n — the healthy-browse-pane row, and the new row beneath it forbidding the title as a
source of truth.

## Files

```
bin/cockpitd.mjs             diffPaneStatus, new foregroundComm, terminalIsIdle folded into it
spikes/cockpit-test/run.sh   per-tty ps stub ($PSFG), new section 11b'
```

## Interface

`foregroundComm(paneId, table) -> string | null` — the command in the pane's foreground process
group, as a bare name (`-zsh` and `/bin/zsh` both reduce to `zsh`), or `null` when it cannot be
told. This is the check `terminalIsIdle` already performed inline; it is extracted and now shared
by both callers rather than written twice.

`diffPaneStatus` keeps its existing order and gains a last resort:

| Signal | Verdict |
|---|---|
| pane missing | `absent` |
| screen holds revdiff's editor footer | `editing` |
| ≥5 framed lines, or title matches `revdiff`/`broot`/`micro` | `running` |
| **foreground process is `broot`, `micro` or `revdiff`** | `running` |
| anything else, including an unknown answer | `shell` |

Two properties this ordering is chosen for:

- **`ps` runs only when the cheap signals have already failed.** A healthy revdiff is decided by
  its frame and costs nothing extra; the OS is asked exactly at the moment the daemon is about to
  conclude "dead shell", which is the one moment it must not be wrong.
- **Unknown stays `shell`.** A pane nobody can identify is one the healer may relaunch. That is
  the recoverable direction: a spurious relaunch of a genuinely dead half is invisible, where
  refusing to heal a dead one leaves half the slot at a bare prompt forever.

The title is still *believed* when it does name the program — it is a valid signal, just not a
sufficient one — so nothing that worked before stops working, including every stub-driven test.

## Tests

- [ ] a healthy pair whose **title lies** (`cd`, as on a real machine) while `ps` reports
      `broot`/`micro` is left alone: nothing typed into either half
- [ ] and specifically, broot's own command is **not** retyped into it
- [ ] asserted as status-log counts that did **not** move, not as `running` appearing — the log
      is written once per change, so a healthy pair writes nothing and a naive `check` would pass
      on an earlier section's line
- [ ] a half whose foreground really is a shell still heals (covered by 11c/11c'/11c'', which run
      with `$PSFG` empty and therefore with `ps` answering `zsh`)
- [ ] the terminal idle check still behaves exactly as before the extraction

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, and section 11b' proven to fail against title-only
      detection
- [ ] DESIGN §2.n carries the rule, and the superseded FINDINGS row is marked as superseded
- [ ] **Not closable by the suite alone**: that browse mode is actually usable is T07's to say,
      on the machine where it failed
