// The push decision: open vs tab vs tabswitch, the tab label, and the bytes.
//
// `planPush` is a function of its arguments and nothing else (DESIGN 3.1), so
// every case below is a literal in, a literal out -- no viewer, no wezterm, no
// broot, no temp directory. That is the entire reason the boundary exists: what
// would otherwise be "press Enter in broot and look at the tab bar" is checkable
// in milliseconds, exhaustively, including the cases nobody would think to try by
// hand.
//
// Expected payloads are written out BYTE BY BYTE rather than rebuilt with the
// module's own helpers -- a test that derives its expectation from the code it is
// testing proves nothing, and the two bytes that matter here (`\x05` and `\r`)
// are exactly the ones a silent failure turns into something else.

import { section, ok, eq, done } from "./harness.mjs";
import { planPush } from "../../bin/cockpit-open-model.mjs";

const ROOT = "/Users/j/src/proj";
const push = (args) => planPush({ openTabs: [], file: "", line: null, repoRoot: ROOT, ...args });

// Every payload list produced anywhere in this file, collected for the \r/\n
// sweep at the end -- so a case added later is covered by it automatically.
const allPayloads = [];
const record = (r) => { allPayloads.push(r.payloads); return r; };
const P = (args) => record(push(args));

// ---------------------------------------------------------------------------
section("1. the first file replaces micro's empty buffer");

const first = P({ openTabs: [], file: `${ROOT}/src/a.js` });
eq("empty tab list means `open`, not `tab`", first.payloads, ["\x05", "open src/a.js", "\r"]);
eq("...and the list now holds it", first.openTabs, ["src/a.js"]);
eq("...labelled with the repo-relative path", first.rel, "src/a.js");

// ---------------------------------------------------------------------------
section("2. later files are tabs");

const second = P({ openTabs: ["src/a.js"], file: `${ROOT}/src/b.js` });
eq("a second distinct file uses `tab`", second.payloads, ["\x05", "tab src/b.js", "\r"]);
eq("...and the list grows by one, in order", second.openTabs, ["src/a.js", "src/b.js"]);

const third = P({ openTabs: ["src/a.js", "src/b.js"], file: `${ROOT}/README.md` });
eq("a third appends at the end", third.openTabs, ["src/a.js", "src/b.js", "README.md"]);

// ---------------------------------------------------------------------------
section("3. an already-open file switches tabs, and never duplicates one");
// micro cannot be asked what it holds (DESIGN 2.5), so the list we sent is the
// only source of truth -- and its tab numbering is 1-BASED. An off-by-one here is
// silent: it jumps to the wrong file rather than failing.

const TABS = ["src/a.js", "src/b.js", "README.md"];

const again = P({ openTabs: TABS, file: `${ROOT}/src/b.js` });
eq("the middle tab -> tabswitch 2", again.payloads, ["\x05", "tabswitch 2", "\r"]);
eq("...and the list is unchanged", again.openTabs, TABS);

eq("the FIRST tab -> tabswitch 1, not 0",
   P({ openTabs: TABS, file: `${ROOT}/src/a.js` }).payloads, ["\x05", "tabswitch 1", "\r"]);
eq("the LAST tab -> tabswitch <length>",
   P({ openTabs: TABS, file: `${ROOT}/README.md` }).payloads, ["\x05", "tabswitch 3", "\r"]);

// The lone-tab case is the one where `open`, `tab` and `tabswitch` could each
// look plausible: the list is not empty, so it must switch.
eq("re-pushing the only open file switches rather than re-opening",
   P({ openTabs: ["src/a.js"], file: `${ROOT}/src/a.js` }).payloads, ["\x05", "tabswitch 1", "\r"]);

// A relative path and an absolute one to the same file must resolve to the same
// label, or the same file gets two tabs depending on who pushed it.
eq("a relative path finds the tab an absolute one opened",
   P({ openTabs: TABS, file: "src/b.js" }).payloads, ["\x05", "tabswitch 2", "\r"]);

// ---------------------------------------------------------------------------
section("4. the line jump");
// What makes a `c/` content-search hit land ON the matching line (DESIGN 2.4).

const jumped = P({ openTabs: [], file: `${ROOT}/src/a.js`, line: 42 });
eq("the goto triple is appended AFTER the open triple", jumped.payloads,
   ["\x05", "open src/a.js", "\r", "\x05", "goto 42", "\r"]);

eq("a switch can carry a jump too",
   P({ openTabs: TABS, file: `${ROOT}/src/b.js`, line: 7 }).payloads,
   ["\x05", "tabswitch 2", "\r", "\x05", "goto 7", "\r"]);

eq("line 1 is a real line", P({ openTabs: [], file: "a.js", line: 1 }).payloads.length, 6);

// Anything that is not a positive whole number is not a line. It is DROPPED, not
// thrown on: the file still opens, which is the useful half of the push.
const noJump = (name, line) =>
  eq(`no goto for ${name}`, P({ openTabs: [], file: "a.js", line }).payloads.length, 3);
noJump("null", null);
noJump("undefined", undefined);
noJump("0", 0);
noJump("a negative line", -3);
noJump("a fraction", 1.5);
noJump("NaN", NaN);
noJump("Infinity", Infinity);
// The caller's contract, asserted so it cannot be forgotten in T02: a line read
// off argv arrives as a STRING and is silently ignored. Parse before calling.
noJump("the STRING \"42\" (argv must be parsed by the caller)", "42");

// ---------------------------------------------------------------------------
section("5. `\\r` submits and `\\n` appears nowhere");
// The reverse of the project's usual rule. `\n` inserts a newline into micro's
// command bar and submits nothing, so the push fails in complete silence -- it
// cost a full failed run during planning (DESIGN 2.4).

ok("every payload list ends with a carriage return",
   allPayloads.every((p) => p[p.length - 1] === "\r"));
ok("every command is preceded by Ctrl+E, and only Ctrl+E opens the bar",
   allPayloads.every((p) => p.every((el, i) => (i % 3 === 0 ? el === "\x05" : el !== "\x05"))));
ok("no payload anywhere contains a newline",
   allPayloads.every((p) => p.every((el) => !el.includes("\n"))),
   JSON.stringify(allPayloads.filter((p) => p.some((el) => el.includes("\n")))));
ok("payload lists come in complete triples",
   allPayloads.every((p) => p.length > 0 && p.length % 3 === 0));

// ---------------------------------------------------------------------------
section("6. the tab label");
// Absolute paths fill micro's bar with `/Users/...` and truncate the filename
// away, which is the unreadable tab bar DESIGN 2.2 exists to prevent.

eq("an absolute path under the root is relativised",
   P({ file: `${ROOT}/src/deep/a.js` }).rel, "src/deep/a.js");
eq("a path already relative is left alone", P({ file: "src/a.js" }).rel, "src/a.js");
eq("a file at the root keeps its bare name", P({ file: `${ROOT}/README.md` }).rel, "README.md");
eq("`.` segments are cleaned up", P({ file: `${ROOT}/./src/./a.js` }).rel, "src/a.js");
eq("doubled slashes are cleaned up", P({ file: `${ROOT}//src//a.js` }).rel, "src/a.js");
eq("a trailing slash on the root changes nothing",
   P({ file: `${ROOT}/src/a.js`, repoRoot: `${ROOT}/` }).rel, "src/a.js");

// A `..` chain is worse on a tab than the absolute path it was meant to shorten,
// and micro cannot open it from the viewer's directory either.
const outside = P({ file: "/etc/hosts" });
eq("a path outside the root stays ABSOLUTE", outside.rel, "/etc/hosts");
eq("...and is what gets sent", outside.payloads[1], "open /etc/hosts");
ok("no label anywhere is a `..` chain",
   !P({ file: "/Users/j/src/other/x.js" }).rel.includes("..") &&
   !P({ file: "../other/x.js" }).rel.includes(".."),
   JSON.stringify([P({ file: "/Users/j/src/other/x.js" }).rel, P({ file: "../other/x.js" }).rel]));
eq("a relative path that climbs out of the root becomes absolute",
   P({ file: "../other/x.js" }).rel, "/Users/j/src/other/x.js");
// A sibling whose name merely STARTS with the root's is not inside it.
eq("`/Users/j/src/proj-old` is not inside `/Users/j/src/proj`",
   P({ file: "/Users/j/src/proj-old/a.js" }).rel, "/Users/j/src/proj-old/a.js");

// `..` that climbs PAST `/` is clamped there, exactly as the filesystem clamps it.
// Found in review: the surplus `..` used to be carried upward, which is ugly on a
// tab (`/../etc/hosts`) and, against a `repoRoot` of `/`, survives the prefix strip
// and hands back a `..` chain outright -- the single thing this module promises not
// to emit. The invariant is now structural rather than true of the cases tried.
eq("`..` past the root is clamped, not carried",
   P({ file: "/x/../../etc/hosts" }).rel, "/etc/hosts");
eq("...however many of them there are",
   P({ file: "../../../../../../etc/hosts" }).rel, "/etc/hosts");
eq("...and against a root of `/` the label is still not a `..` chain",
   P({ file: "/../etc/hosts", repoRoot: "/" }).rel, "etc/hosts");
eq("a plain path under a root of `/` is relativised as usual",
   P({ file: "/etc/hosts", repoRoot: "/" }).rel, "etc/hosts");
eq("`..` INSIDE the root still resolves normally",
   P({ file: `${ROOT}/src/../lib/a.js` }).rel, "lib/a.js");

// The defect the planning probe found (FINDINGS, spikes/browse-mode RESULTS 4):
// broot resolves symlinks, an agent worktree path usually is not resolved, and
// the two strings then share no prefix. This module cannot fix that -- realpath
// reads the filesystem and this side of the boundary may not (DESIGN 3.1) -- so
// the CALLER resolves both sides. What is asserted here is that the unresolved
// case degrades to an absolute label rather than to `../../../../../private/...`.
const SYM = "/private/var/folders/x/wt";
const UNRESOLVED = "/var/folders/x/wt";
const mismatched = P({ file: `${SYM}/src/a.js`, repoRoot: UNRESOLVED });
ok("a symlink mismatch never yields a `..` chain", !mismatched.rel.includes(".."), mismatched.rel);
eq("...it degrades to the absolute path", mismatched.rel, `${SYM}/src/a.js`);
eq("...and with the caller resolving BOTH sides the label is short",
   P({ file: `${SYM}/src/a.js`, repoRoot: SYM }).rel, "src/a.js");

// ---------------------------------------------------------------------------
section("7. odd but real inputs");

const spaced = P({ file: `${ROOT}/my notes/read me.md` });
eq("a path with spaces is ONE payload, unquoted", spaced.payloads, ["\x05", "open my notes/read me.md", "\r"]);
eq("...and the same string is what goes in the tab list", spaced.openTabs, ["my notes/read me.md"]);

// A push must never take the viewer down over a state file that got mangled --
// the worst a wrong list can cost is a duplicate tab (DESIGN 2.n).
eq("a missing tab list is treated as empty",
   P({ openTabs: undefined, file: "a.js" }).payloads[1], "open a.js");
eq("a non-array tab list is treated as empty",
   P({ openTabs: "src/a.js", file: "a.js" }).payloads[1], "open a.js");

// The caller persists what it gets back; mutating its input would corrupt the
// live list in memory before the write, and silently.
const held = ["src/a.js"];
const frozen = JSON.stringify(held);
const grown = P({ openTabs: held, file: `${ROOT}/src/b.js` });
eq("the caller's array is not mutated in place", JSON.stringify(held), frozen);
ok("...and a fresh array comes back", grown.openTabs !== held);
const switched = planPush({ openTabs: held, file: `${ROOT}/src/a.js`, line: null, repoRoot: ROOT });
eq("...even on the tabswitch path, where the list is unchanged", JSON.stringify(held), frozen);
ok("...which still hands back its own array", switched.openTabs !== held);

done();
