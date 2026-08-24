#!/usr/bin/env node
// cockpit-welcome — the diff pane's resting screen, shown while no agent is
// attached (at the fleet LIST). It replaces the bare login shell that used to
// sit here, whose only content was a one-line echo and a prompt showing the
// repo's directory name -- which read as "the cockpit is just a git prompt".
//
// Like cockpit-strip.mjs this is PURE DISPLAY: it never runs a shell command and
// never moves a pane, so cockpitd can own the pane as the REPO_KEY diff slot,
// parking it on attach and restoring it on return without ever launching revdiff
// into it. Entering an agent parks this pane and swaps in that agent's revdiff;
// exiting brings it back untouched.
//
// It is deliberately near-empty for now -- a place to grow something useful
// (recent agents, worktree status, review queue). Keep it a self-contained
// renderer with no dependencies so that stays cheap.
//
// Started for you by bin/cockpit-layout.sh.

const ESC = "\x1b[";

// A single frame, centred in the pane. Recomputed on every render so it tracks
// resizes (the pane is resized to full-tab and back on every agent switch).
function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  // Bold title, dim subtitle. The colour scheme (Tokyo Night) gives these enough
  // contrast without hardcoding a palette that would clash if it changes.
  const lines = [
    `${ESC}1magentic-ide cockpit${ESC}0m`,
    "",
    `${ESC}2menter an agent in the fleet view below to review its work${ESC}0m`,
    `${ESC}2mits diff opens here; its shell opens to the right${ESC}0m`,
  ];

  // Visible width ignores the escape sequences, so centring lines up on screen.
  const visibleLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const top = Math.max(0, Math.floor((rows - lines.length) / 2));

  let out = `${ESC}2J${ESC}H`;                     // clear, cursor home
  out += "\r\n".repeat(top);
  for (const line of lines) {
    const pad = Math.max(0, Math.floor((cols - visibleLen(line)) / 2));
    out += " ".repeat(pad) + line + `${ESC}K\r\n`;
  }
  process.stdout.write(out);
}

process.stdout.write(`${ESC}?25l`);                // hide the cursor
render();
process.stdout.on("resize", render);
setInterval(render, 2000);                          // repaint if a resize is missed

const bye = () => { process.stdout.write(`${ESC}?25h`); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
