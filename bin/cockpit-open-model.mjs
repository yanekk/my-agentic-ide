// cockpit-open-model -- the pure half of a push into the viewer.
//
// One function decides everything about opening a file in micro: whether it is
// already a tab, whether this is the first file the viewer has ever seen, what
// path goes on the tab label, and which bytes get sent. It is a function of its
// arguments and NOTHING else (DESIGN 3.1, 3.3): no filesystem, no wezterm, no
// clock, not even the working directory. `spikes/browse-test/run.sh` greps this
// file to keep it honest, and if that grep fails the fix is to MOVE THE CODE
// OUT, never to relax it.
//
// That boundary is what makes the whole of DESIGN 2.4/2.5 -- every combination of
// first-file, new-file, already-open and jump-to-line -- a millisecond test
// instead of a person with a terminal pressing Enter in broot.
//
// Two contracts the caller owns, because both need the filesystem:
//
//   1. REALPATH BOTH SIDES BEFORE CALLING. broot hands back a symlink-resolved
//      path (`/private/var/...` on macOS) while an agent worktree usually is not
//      resolved (`/var/...`). Relativising one against the other cannot work: the
//      two strings share no prefix. This module refuses to paper over that with a
//      `../../../../../private/var/...` chain -- which is worse on a tab than the
//      absolute path it was meant to shorten -- so it hands back the ABSOLUTE
//      path instead. Short labels therefore depend on the caller resolving both
//      `file` and `repoRoot` first. Measured, and it is what bit the planning
//      probe: spikes/browse-mode/RESULTS.md section 4.
//   2. Check the file still exists. micro would happily open an empty buffer
//      named after a deleted file (DESIGN 2.n).
//
// And one the caller owns because JS will not: `line` must be a NUMBER. A string
// "42" off argv is not an integer and the jump is dropped -- deliberately, since
// dropping the jump still opens the file, whereas throwing loses the push
// entirely. Parse it before calling.

// micro's command bar: Ctrl+E opens it, and only `\r` submits.
//
// `\n` merely inserts a newline and submits NOTHING -- the push then fails in
// total silence. This is the project's `\r`/`\n` rule applied in reverse:
// everywhere else the cockpit substitutes `\n` for `\r` so an injected review
// arrives unsent, but here submitting is the entire point. It cost a full failed
// run during planning (DESIGN 2.4, FINDINGS).
const OPEN_BAR = "\x05";
const SUBMIT = "\r";

// One send-text call per element, which is the shape that was measured to work --
// so they are kept separate rather than concatenated into one string.
const barCommand = (text) => [OPEN_BAR, text, SUBMIT];

/**
 * Decide how to push `file` into the viewer, given what we last sent it.
 *
 * @param {object}        args
 * @param {string[]}      args.openTabs  repo-relative paths, in tab-bar order, AS WE SENT THEM.
 *                                       micro cannot be asked what it holds (DESIGN 2.5), so
 *                                       this list is the only source of truth there is.
 * @param {string}        args.file      absolute or relative path being opened.
 * @param {number|null}   args.line      1-based line to jump to, or null.
 * @param {string}        args.repoRoot  absolute path the tab label is made relative to.
 * @returns {{payloads: string[], openTabs: string[], rel: string}}
 *          `payloads` sent in order, verbatim, one send-text each; `openTabs` the new list for
 *          the caller to persist; `rel` the label that was used.
 */
export function planPush({ openTabs, file, line, repoRoot }) {
  // A corrupt or absent state file must not take the push down with a TypeError:
  // the worst it can cost is a duplicate tab, and DESIGN 2.n already prefers an
  // untidy tab bar to a wrong `tabswitch`.
  const tabs = Array.isArray(openTabs) ? openTabs.slice() : [];
  const rel = relativise(file, repoRoot);

  let payloads;
  let nextTabs;
  if (tabs.length === 0) {
    // micro started with no file leaves an empty `No name` buffer. `open`
    // REPLACES it; `tab` would leave it as a permanent dead first tab (DESIGN 2.2).
    payloads = barCommand(`open ${rel}`);
    nextTabs = [rel];
  } else {
    const i = tabs.indexOf(rel);
    if (i === -1) {
      payloads = barCommand(`tab ${rel}`);
      nextTabs = [...tabs, rel];
    } else {
      // Re-pushing an open file would otherwise create a duplicate tab -- micro
      // has no idea it already holds the file. Its tab numbering is 1-BASED.
      payloads = barCommand(`tabswitch ${i + 1}`);
      nextTabs = tabs;
    }
  }

  // The jump is what makes a `c/` content-search hit land on the matching line
  // rather than at the top of the file -- the entire value of searching across
  // files (DESIGN 2.4). Anything that is not a positive whole number is not a
  // line: it is dropped, and the file still opens.
  if (Number.isInteger(line) && line > 0) {
    payloads = payloads.concat(barCommand(`goto ${line}`));
  }

  return { payloads, openTabs: nextTabs, rel };
}

// --- paths -----------------------------------------------------------------
// Hand-rolled rather than node:path, and not because of the import: `path.resolve`
// and `path.relative` fall back to process.cwd() for a relative argument, which is
// an environment read this module may not make. cwd differs between the daemon,
// a cockpit terminal and a test, so the same inputs would produce different tab
// labels depending on who called. Everything below is string arithmetic.

const isAbsolute = (p) => p.startsWith("/");

// POSIX only, which is the whole of this project's world (macOS, DESIGN 5).
// Collapses `//`, drops `.`, and applies `..` where there is something to apply it to.
//
// An absolute path is CLAMPED at `/`, the way the filesystem itself clamps it:
// `/x/../../etc/hosts` is `/etc/hosts`, not `/../etc/hosts`. Carrying the surplus
// `..` upward would emit the one thing this module promises never to produce -- and
// not only cosmetically: with `repoRoot` of `/` the leftover `..` survives the
// prefix strip below and the label comes back as a `../..` chain outright.
//
// A relative path has no such floor, so a leading `..` is kept. relativise() then
// joins it onto an absolute root and normalises again, which is where it gets
// resolved; the only inputs that stay relative here are ones with no absolute root
// to resolve against, and the caller owes an absolute `repoRoot` (DESIGN 3.4).
function normalise(p) {
  const absolute = isAbsolute(p);
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg !== "..") out.push(seg);
    else if (out.length && out[out.length - 1] !== "..") out.pop();
    else if (!absolute) out.push("..");
  }
  const joined = out.join("/");
  return absolute ? `/${joined}` : joined;
}

function relativise(file, repoRoot) {
  const f = typeof file === "string" ? file : "";
  const root = typeof repoRoot === "string" ? repoRoot : "";
  if (f === "") return f;

  // A relative path is taken as relative to the root, which is the only sensible
  // reading and also how it comes back out unchanged.
  const rootIsAbsolute = isAbsolute(root);
  const abs = isAbsolute(f)
    ? normalise(f)
    : rootIsAbsolute
      ? normalise(`${root}/${f}`)
      : normalise(f);
  if (!isAbsolute(abs) || !rootIsAbsolute) return abs;

  const rootN = normalise(root);
  const prefix = rootN === "/" ? "/" : `${rootN}/`;
  // NOT under the root -- an unresolved symlink (see the header), or genuinely
  // somewhere else. Absolute is ugly on a tab; `../../../../..` is worse, and it
  // also stops being a path micro can open from the viewer's own directory.
  if (!abs.startsWith(prefix)) return abs;
  return abs.slice(prefix.length);
}
