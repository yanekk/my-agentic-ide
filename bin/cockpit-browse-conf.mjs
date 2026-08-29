// The `--conf` chain the cockpit launches broot with (DESIGN 2.3, 7).
//
// broot LAYERS the files named in `--conf a;b;c` rather than replacing one with
// the next, so the cockpit ships its own verb file and never touches your
// ~/.config/broot/. Yours come first, the cockpit's last, so the cockpit wins on a
// key clash -- and only on the keys it names.
//
// The one non-obvious rule is that a chain entry which does not EXIST is fatal:
// broot prints `IO Error : No such file or directory` and quits (measured, broot
// 1.59). A user who has never written a verbs.hjson would therefore be unable to
// browse at all, so a missing file is dropped from the chain rather than named.
//
// Not read from the environment: `wezterm cli split-pane` spawns from the mux
// server and inherits nothing (CLAUDE.md), so a $BROOT_CONFIG_DIR set in your
// shell is invisible to the daemon that builds this chain -- honouring it would
// work in a terminal and silently not in the cockpit, which is worse than not
// honouring it at all.

import fs from "node:fs";
import path from "node:path";

/** Where broot keeps a user's own configuration on this platform. */
export const brootConfDir = (home) => path.join(home, ".config", "broot");

/** The cockpit's verb file, inside this checkout. */
export const cockpitVerbsFile = (repo) => path.join(repo, "bin", "cockpit-browse-verbs.hjson");

/**
 * Build broot's `--conf` argument: the user's own files that exist, then the
 * cockpit's verb file.
 *
 * @param {string} home  the user's home directory
 * @param {string} repo  this checkout
 * @returns {string} a `;`-separated chain, always ending in the cockpit's file
 */
export function browseConfChain(home, repo) {
  const dir = brootConfDir(home);
  const mine = cockpitVerbsFile(repo);
  const theirs = ["conf.hjson", "verbs.hjson"]
    .map((name) => path.join(dir, name))
    .filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false; // absent, or a directory someone made by hand
      }
    });
  return [...theirs, mine].join(";");
}
