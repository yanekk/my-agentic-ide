#!/usr/bin/env node
// cockpit-browse-open -- the `open` command broot runs on a DOUBLE-CLICK, rerouted.
//
// broot's Enter is bound to a verb (cockpit-browse-verbs.hjson) that pushes a text
// file into the viewer beside the tree. A double-click is a DIFFERENT route and the
// verb file cannot reach it: broot handles a double-click internally and hardcoded
// (browser_state.rs::on_double_click -> open_selection_stay_in_broot, measured in
// broot 1.59 source), bypassing the verb system entirely, and for a file it calls
// the `opener` crate. On macOS `opener` runs `open <path>` -- Command::new("open"),
// a PATH lookup, exactly one argument (opener/src/macos.rs). Stock, that hands the
// file to whatever GUI app owns the extension: a window OVER the terminal, which is
// the very leak the verb file exists to prevent, now arriving by a door it cannot
// close.
//
// So the cockpit puts THIS script on broot's PATH under the name `open`, ahead of
// /usr/bin/open, and ONLY on broot's PATH -- its own dir (cockpit-layout.sh builds
// it, browserCommand in cockpitd.mjs names it on broot's launch line), never the
// shared cockpit bin: an `open` on every cockpit terminal's and agent's PATH would
// shadow /usr/bin/open everywhere, the `cal` landmine DESIGN 2.2 warns about.
// broot's opener finds this instead, and a double-click then behaves like Enter for
// the case that matters:
//
//   * a text file       -> handed to cockpit-open, exactly as the Enter verb does,
//                          so it opens in the viewer pane;
//   * a non-text file   -> nothing happens (the user's decision, 2026-09-13).
//     (image, binary)      Matching Enter's broot preview here is impossible: that
//                          preview is an internal broot verb no external opener can
//                          trigger, and the only alternative -- intercepting the
//                          mouse itself -- is a path this project's mouse handling
//                          has been burned by twice (wezterm/cockpit.lua) and does
//                          not take;
//   * a directory       -> never reaches here: broot descends into a directory
//                          inside open_selection_stay_in_broot without calling the
//                          opener at all.
//
// It exits 0 on EVERY path, including failure. broot's opener paints an error line
// in the tree for a non-zero exit; the Enter verb (leave_broot:false) is silent on
// the same failure, and a double-click that could not push has simply done nothing
// -- which is also what a non-text double-click does. Staying silent matches both.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { looksBinary } from "./cockpit-open-model.mjs";

const raw = process.argv[2];
// opener always hands over exactly one argument, the path. With none there is
// nothing to open -- and no error to make broot draw.
if (!raw) process.exit(0);

// Pin it absolute while we still share broot's cwd (its worktree): broot passes an
// absolute path today, but cockpit-open resolves from ITS own cwd, so resolving
// here is what keeps the two agreeing whatever broot sends.
const file = path.resolve(raw);

let st;
try {
  st = fs.statSync(file);
} catch {
  // Gone between the click and here, or unreadable. Nothing to do, and not worth a
  // broot error line.
  process.exit(0);
}
// A directory double-click is handled inside broot and should never reach the
// opener; if it somehow does, descending is broot's job, not ours.
if (st.isDirectory()) process.exit(0);

// Read a sample and let the pure model judge it. A read failure is "do nothing",
// the same as a stat failure.
let sample;
try {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(8000);
    const got = fs.readSync(fd, buf, 0, buf.length, 0);
    sample = buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
} catch {
  process.exit(0);
}
if (looksBinary(sample)) process.exit(0);

// A text file: hand it to the same command the Enter verb runs, found by the same
// PATH lookup (cockpit-open lives in the cockpit bin, which is on broot's PATH).
// `0` is the no-jump line the Enter verb also sends for a plain open. cockpit-open
// owns every refusal and all the world-touching; this script only decided WHETHER
// to call it. Its exit status is deliberately dropped (see the header): silence
// matches the Enter verb.
spawnSync("cockpit-open", [file, "0"], { stdio: ["ignore", "ignore", "ignore"] });
process.exit(0);
