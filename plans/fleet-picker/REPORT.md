# fleet-picker — delivery report

## What was delivered

All seven tasks are done and the tests are green.

- **The left arrow now switches programs in the bottom-left pane.** At the fleet list, with that pane focused and its box empty, ← opens a small "SWITCH PROGRAM" menu listing Claude Agents and PIR. The other program starts highlighted.
- **In the menu:** ↑/↓ move the highlight, Enter or → opens the highlighted program, and Esc or Ctrl+C closes the menu with nothing changed. ← inside the menu does nothing.
- **Neither program is restarted.** Each comes back with its scroll, selection and typed text as you left it.
- **Everywhere else ← works as before:** with text in a box, inside an agent or a PIR run, in terminals, in the diff pane and in the file browser.
- **When PIR is not installed, there is no menu.**
- **The footer's Claude Agents | PIR click still works.** It is dimmed while the menu is open, because the menu is doing that job.
- **A BitBucket Review/Address click closes the menu first,** then starts the agent as before.

Not delivered, as agreed: a status line under each program's name, clicking inside the menu, and a footer hint for ←.

## Decisions made for you

None.

## What to check by hand

You already tried this in the rebuilt window on 2026-10-08: ← opened the menu at both lists, switching worked, and there was no lag. What remains:

- **Confirm your WezTerm settings link points back at main.** For the live check it was pointed at a task's copy. The task was meant to put it back, but nothing in the report confirms it did. Run `readlink ~/.wezterm.lua`; it should print `/Users/jankrolikowski/git/my-agentic-ide/wezterm/cockpit.lua`. The cockpit's own config file should also name your main checkout again.
- **After you merge, reopen WezTerm once.** That puts the new behaviour into the window you actually use. Then try ← once at the empty fleet list. Remember that reopening closes every agent terminal.

## Risks and follow-ups

- **The menu depends on wording on screen.** It opens only when it sees Claude's empty-box line ("describe a task for a new session") or PIR's empty-list hint. If a future Claude or PIR update changes that wording, the menu stops opening on that program. Nothing breaks: ← simply goes back to doing nothing there. The footer click still works.
- **Keys pressed very fast after ←** (within about a fifth of a second) go to the program behind the menu, not the menu. You accepted this when planning. A quick ← then Enter could open the highlighted agent.
- **One rare stuck state, found in review but never reproduced:** if the cockpit is busy for over two seconds just as you make your choice, the closed menu can stay in the pane, with the footer switch dimmed and ← off. A BitBucket click or reopening the window clears it.
- **Small follow-ups:**
  - The project notes still give the old number of checks for the main test suite, because this work added more.
  - Two older test problems, not caused by this work, are still open: one check that fails now and then for no clear reason, and one that fails only when the suite runs from a temporary folder.

## Branch

Synced with `main` at `6620d8129eef` on 2026-10-08T06:43:59Z.
Tests: green.
