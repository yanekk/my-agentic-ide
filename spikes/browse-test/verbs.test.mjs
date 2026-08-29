// The `--conf` chain the daemon launches broot with (T03, DESIGN 2.3 and 7).
//
// The chain is the whole of how the cockpit adds one key binding without touching
// your ~/.config/broot: broot LAYERS the files it is given, so yours come first and
// the cockpit's verb file comes last. Two things about it are easy to get wrong and
// are therefore asserted rather than described:
//
//   * order -- last wins on a key clash, so the cockpit's file must be last;
//   * a missing entry is FATAL to broot (`IO Error : No such file or directory`,
//     measured on 1.59), so a user who has never written a verbs.hjson must get a
//     chain that simply does not name it, rather than a broot that will not start.
//
// That broot accepts the file at all is asserted in run.sh, which has the binary.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { section, ok, eq, done } from "./harness.mjs";
import { browseConfChain, brootConfDir, cockpitVerbsFile } from "../../bin/cockpit-browse-conf.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "browse-verbs-"));
process.on("exit", () => { try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* gone */ } });

const MINE = path.join(ROOT, "bin", "cockpit-browse-verbs.hjson");

/** A fake home with whichever of the user's broot files the case wants. */
function home(...files) {
  const h = fs.mkdtempSync(path.join(WORK, "home-"));
  fs.mkdirSync(path.join(h, ".config", "broot"), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(h, ".config", "broot", f), "{}\n");
  return h;
}

const parts = (chain) => chain.split(";");

// ---------------------------------------------------------------------------
section("20. the --conf chain: order, and what is in it");

const both = home("conf.hjson", "verbs.hjson");
eq("yours first, in broot's own order, then ours",
   parts(browseConfChain(both, ROOT)),
   [path.join(both, ".config/broot/conf.hjson"),
    path.join(both, ".config/broot/verbs.hjson"),
    MINE]);

ok("the cockpit's file is LAST, so it wins a key clash",
   parts(browseConfChain(both, ROOT)).at(-1) === MINE);

ok("`;` is the separator broot expects", browseConfChain(both, ROOT).split(";").length === 3);

ok("every entry is absolute -- the daemon's cwd is not broot's",
   parts(browseConfChain(both, ROOT)).every((p) => path.isAbsolute(p)));

ok("the file it names is the one in this checkout, and it exists",
   cockpitVerbsFile(ROOT) === MINE && fs.existsSync(MINE));

eq("the user's config lives where broot keeps it",
   brootConfDir("/Users/x"), "/Users/x/.config/broot");

// ---------------------------------------------------------------------------
section("21. a chain entry that does not exist is dropped, never named");
// Because broot QUITS on one (measured -- run.sh asserts the quit itself). A fresh
// machine has conf.hjson but no verbs.hjson, so this is the common case, not an
// exotic one: naming it would mean browse mode never opened on a new install.

eq("no verbs.hjson of your own: it is simply absent from the chain",
   parts(browseConfChain(home("conf.hjson"), ROOT)).map((p) => path.basename(p)),
   ["conf.hjson", "cockpit-browse-verbs.hjson"]);

eq("no conf.hjson either: the cockpit's file alone",
   parts(browseConfChain(home(), ROOT)).map((p) => path.basename(p)),
   ["cockpit-browse-verbs.hjson"]);

eq("no ~/.config/broot at all",
   parts(browseConfChain(fs.mkdtempSync(path.join(WORK, "bare-")), ROOT)).map((p) => path.basename(p)),
   ["cockpit-browse-verbs.hjson"]);

// A directory where a file is expected: broot cannot read it either, and `existsSync`
// alone would have said yes.
const dirCase = home("conf.hjson");
fs.mkdirSync(path.join(dirCase, ".config", "broot", "verbs.hjson"));
eq("a DIRECTORY named verbs.hjson is not a config file",
   parts(browseConfChain(dirCase, ROOT)).map((p) => path.basename(p)),
   ["conf.hjson", "cockpit-browse-verbs.hjson"]);

// The cockpit's own file is named unconditionally: if it were dropped when missing,
// a broken checkout would launch a broot whose Enter opens a GUI app over the
// terminal -- the exact failure the verb exists to prevent -- and say nothing.
eq("ours is named even if the checkout is wrong, so broot fails loudly",
   parts(browseConfChain(home(), "/no/such/checkout")),
   ["/no/such/checkout/bin/cockpit-browse-verbs.hjson"]);

// ---------------------------------------------------------------------------
// Building a chain must never create or touch anything of the user's: the cockpit
// ships its own file precisely so it does not edit ~/.config/broot (DESIGN 7).
const watched = home("conf.hjson", "verbs.hjson");
const snapshot = () => fs.readdirSync(path.join(watched, ".config", "broot")).sort()
  .map((n) => {
    const s = fs.statSync(path.join(watched, ".config", "broot", n));
    return `${n} ${s.size} ${s.mtimeMs}`;
  }).join("|");
const before = snapshot();
browseConfChain(watched, ROOT);
browseConfChain(watched, ROOT);
eq("building the chain writes nothing into ~/.config/broot", snapshot(), before);

done();
