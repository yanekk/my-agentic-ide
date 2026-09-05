# T07 — Verified by hand, in a real cockpit

**Phase:** 3 · **Depends on:** T03, T06 · **Weight:** light (but the session waits)

## Goal

Nothing built so far is known to *draw* correctly. The test command stubs WezTerm and the
spikes run against a headless mux with no screen: between them they prove the daemon reacts
correctly and the geometry is right, and neither can prove the thing is usable. This task is
the only evidence that browse mode works for a person, and its result goes in FINDINGS with the
date — a ✅ there is the entire record that anything was seen working for real.

## Design sections this implements

DESIGN §5.1 (what the test command cannot reach), the success criteria in §1, and — for
steps 10 and 11 — the three quit rows of §2.n.

## Files

```
plans/browse-mode/FINDINGS.md    the answers, with the date
plans/browse-mode/PROGRESS.md    T07 state
```

No product code. If this task finds a defect, that defect is a **new task** — not a fix
smuggled into the verification.

## Needs a person

**Raise this the moment the task is picked up and wait for the answer.** It is not homework
left at the end of a report. Everything that does not depend on the answer is finished first,
but the session ends when the answer is in.

### First: point the cockpit at this branch, or you will verify the wrong code

This plan is built in a worktree (PROGRESS.md, top). The live cockpit runs whatever
`~/.claude/cockpit/config.lua` records — the **main checkout** — and `~/.wezterm.lua` symlinks
into it. Re-opening the window would therefore run `main`, where browse mode does not exist, and
every answer below would be about the wrong code.

Use the supported mechanism, not a hand-edited config:

```
# from inside the worktree
bin/install.sh --check      # confirm what it plans to relink, before it does anything
bin/install.sh              # rewrites config.lua and repoints ~/.wezterm.lua here
```

`--check` is the seatbelt: it reports the prerequisites and the planned relink and **writes
nothing**, so the repoint is seen before it happens. It will report a *relink* of
`~/.wezterm.lua` from the main checkout to this one; that is expected and is not the
`--force` case, because the symlink is already the cockpit's own.

**Put it back when the check is done**, whatever the outcome:

```
# from the MAIN checkout
bin/install.sh
```

Leaving the user's daily cockpit pointed at a review worktree is a worse outcome than an
unverified task. Say plainly in the report which checkout the cockpit is pointed at when the
session ends.

Then re-open the WezTerm window — that is the supported way to rebuild everything, and it is
the second seatbelt here: nothing in this check runs against a half-migrated cockpit.

```
1. Open a fresh WezTerm window and enter an agent in the fleet list.
2. Focus the diff pane. Press ⌥] until the footer highlights: Browse
3. Type a few letters to find a file. Press Enter.
4. Press Enter on two more files.
5. Type: c/healQuitDiff        then press Enter on a result.
6. With a file selected, press ⌥p and ⌥o.
7. Press ⌥] twice to leave browse and ⌥[ twice to come back.
8. Switch to another agent and back.
9. Click the word "Browse" in the footer, then click "Uncommitted Changes", then "Browse".
10. In the READER (right half), press Ctrl+Q to quit it. Wait, hands off, and watch.
    Then press Enter on a file in the tree.
11. In the TREE (left half), press Ctrl+Q — or type :q and press Enter — to quit it.
    Wait, hands off, and watch.
```

**Steps 10 and 11 are the whole of T06 and they are added deliberately** *(the user's decision,
2026-08-30, at T06's review)*. Everything T06 does rests on the cockpit noticing that a half has
stopped running, and it notices by asking the terminal which program a pane is running. **Nothing
has ever confirmed that a real pane stops reporting `micro` the moment micro exits** — the test
suite stubs that answer. If it does not, no heal ever fires, and no automated test in this
project would know. Do them **last**, after 7 and 8: quitting the reader deliberately throws away
the tabs those steps are checking.

Expect: at 2 the top pane splits — the file tree on the left, an empty editor on the right — and
**you can start typing immediately**, without clicking anything: the tree already has focus. At 3
the file appears in the right half and the cursor **stays in the tree**. At 4 there are three
tabs. At 5 it opens **on the matching line**. At 6 your own preview keys still work. At 7 all
three tabs are still there and the tree is where you left it. At 8 the same, and it is still your
agent's files. At 9 the clicks do exactly what the keys did.

At **10**, within a second or two and with you touching nothing, the right half comes back as an
empty reader — and the tree on the left is **exactly where you left it**, same position, same
filter text. The Enter that follows opens the file as the **first** tab of the new reader: the
list of what was open died with it, so nothing jumps to the wrong file. At **11**, the mirror
image — the tree comes back on its own, at the top of the agent's worktree, and the reader beside
it keeps every tab it had.

Tell me:
- **Could you drive the whole thing without touching the mouse or typing a command?** That is the
  point of the shape you chose, and this is the only check of it.
- Did focus ever jump out of the tree?
- Did the tabs survive steps 7 and 8?
- Did step 5 land on the right line?
- **Did each half you quit come back on its own, without you doing anything?** Roughly how long —
  a blink, a second, several? If one never came back, say which, and that is the answer that
  matters most in this list.
- **Did the half you did NOT quit stay exactly as it was?** The tree at the same position and
  filter when you quit the reader; every tab still open when you quit the tree.
- **Did ⌥p / ⌥o still open and close the preview?** They come from *your* `verbs.hjson`, and the
  cockpit adds its own file to the same `--conf` chain — this is the only check that the
  layering did not shadow your own keys (DESIGN §5.1, and the layering measurement in FINDINGS).
- **Is the tree/viewer split right?** It is 47 columns against 72 on a 120-column window. Too
  narrow a tree, too narrow a reader, or about right?
- Does the redraw when the pair comes back look acceptable, or does it read as a glitch?
- Does the footer still fit on one line with a fourth label, or is the right-hand end clipped?

## Tests

None. This task exists precisely because no test reaches it.

## Done when

- [ ] every question above has an answer from the user, written into FINDINGS with the date
- [ ] any defect found is recorded as a new task, not fixed here
- [ ] PROGRESS says plainly which half of the plan is test-proven and which half is
      person-proven
- [ ] **the cockpit is pointed back at the main checkout**, and the report says so
- [ ] the report says the plan is finished on `worktree-browse-mode-review` and that folding it
      into `main` is the user's call — and does not fold it
