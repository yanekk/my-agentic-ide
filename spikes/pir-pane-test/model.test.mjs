// The pure pir model (bin/cockpit-pir-model.mjs), exhaustively. No wezterm, no fs: every fact
// the daemon would supply is a stub here. Prints failures in full, then one line
// `CHECKS <pass> <fail>` that run.sh folds into its summary.
import { deepStrictEqual } from "node:assert";
import {
  PIR_KEY_PREFIX,
  readPirState,
  pirKey,
  isPirKey,
  decidePir,
  startingMode,
  shouldReapPirKey,
} from "../../bin/cockpit-pir-model.mjs";

let pass = 0;
let fail = 0;
function check(name, got, want) {
  try {
    deepStrictEqual(got, want);
    pass++;
    if (process.env.VERBOSE) console.log(`  ok   ${name}`);
  } catch {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       want ${JSON.stringify(want)}`);
    console.log(`       got  ${JSON.stringify(got)}`);
  }
}

const alive = { isAlive: (pid) => pid === 12345 };
const RUN = {
  key: "agentic-ide__pir-pane",
  kind: "work",
  slug: "pir-pane",
  repo: "agentic-ide",
  repoPath: "/r/agentic-ide",
  branch: "pir/pir-pane",
  cwd: "/r/agentic-ide/.claude/worktrees/pir-pir-pane",
};
const WORKER = { id: "w-T01", task: "T01", role: "implement", cwd: "/r/agentic-ide/.claude/worktrees/pir-pir-pane-T01" };
const doc = (o) => JSON.stringify({ version: 1, pid: 12345, view: "list", run: null, worker: null, updatedAt: "2026-09-26T21:00:00.000Z", ...o });
const LIST = { view: "list" };

// --- readPirState: everything doubtful reads as the list -------------------
check("readPirState: null (file absent) → list", readPirState(null, alive), LIST);
check("readPirState: empty → list", readPirState("", alive), LIST);
check("readPirState: whitespace → list", readPirState("  \n", alive), LIST);
check("readPirState: invalid JSON → list", readPirState("{ \"version\": 1,", alive), LIST);
check("readPirState: JSON array → list", readPirState("[1,2]", alive), LIST);
check("readPirState: JSON null → list", readPirState("null", alive), LIST);
check("readPirState: version 2 → list", readPirState(doc({ version: 2, view: "run", run: RUN }), alive), LIST);
check("readPirState: version missing → list", readPirState(JSON.stringify({ pid: 12345, view: "run", run: RUN }), alive), LIST);
check("readPirState: pid missing → list", readPirState(doc({ pid: undefined, view: "run", run: RUN }), alive), LIST);
check("readPirState: pid a string → list", readPirState(doc({ pid: "12345", view: "run", run: RUN }), alive), LIST);
check("readPirState: pid 0 → list", readPirState(doc({ pid: 0, view: "run", run: RUN }), { isAlive: () => true }), LIST);
check("readPirState: dead pid → list", readPirState(doc({ pid: 999, view: "run", run: RUN }), alive), LIST);
check("readPirState: isAlive throws → list",
  readPirState(doc({ view: "run", run: RUN }), { isAlive: () => { throw new Error("EPERM"); } }), LIST);
check("readPirState: view run with run null → list", readPirState(doc({ view: "run", run: null }), alive), LIST);
check("readPirState: view run with run lacking key → list",
  readPirState(doc({ view: "run", run: { ...RUN, key: "" } }), alive), LIST);
check("readPirState: view worker with worker null → list",
  readPirState(doc({ view: "worker", run: RUN, worker: null }), alive), LIST);
check("readPirState: view worker with run null → list",
  readPirState(doc({ view: "worker", run: null, worker: WORKER }), alive), LIST);
check("readPirState: view worker with worker lacking id → list",
  readPirState(doc({ view: "worker", run: RUN, worker: { ...WORKER, id: undefined } }), alive), LIST);
check("readPirState: unknown view → list", readPirState(doc({ view: "settings", run: RUN }), alive), LIST);
check("readPirState: view missing → list", readPirState(doc({ view: undefined }), alive), LIST);

check("readPirState: valid list round-trips", readPirState(doc({}), alive), LIST);
check("readPirState: valid run round-trips its fields",
  readPirState(doc({ view: "run", run: RUN }), alive), { view: "run", run: RUN });
check("readPirState: valid worker round-trips its fields",
  readPirState(doc({ view: "worker", run: RUN, worker: WORKER }), alive), { view: "worker", run: RUN, worker: WORKER });
check("readPirState: run.cwd null stays null",
  readPirState(doc({ view: "run", run: { ...RUN, cwd: null } }), alive).run.cwd, null);
check("readPirState: a non-string cwd reads as null",
  readPirState(doc({ view: "worker", run: RUN, worker: { ...WORKER, cwd: 42 } }), alive).worker.cwd, null);
check("readPirState: extra fields are dropped",
  Object.keys(readPirState(doc({ view: "run", run: { ...RUN, extra: 1 } }), alive).run).sort(),
  ["branch", "cwd", "key", "kind", "repo", "repoPath", "slug"]);

// --- pirKey / isPirKey ------------------------------------------------------
check("PIR_KEY_PREFIX is pir.", PIR_KEY_PREFIX, "pir.");
check("pirKey: run", pirKey(RUN), "pir.agentic-ide__pir-pane");
check("pirKey: worker suffix", pirKey(RUN, WORKER), "pir.agentic-ide__pir-pane.w-T01");
check("isPirKey: a run key", isPirKey(pirKey(RUN)), true);
check("isPirKey: a worker key", isPirKey(pirKey(RUN, WORKER)), true);
check("isPirKey: an agent job id is not", isPirKey("a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6"), false);
check("isPirKey: the bare prefix is not", isPirKey("pir."), false);
check("isPirKey: pir without the dot is not", isPirKey("pirate"), false);
check("isPirKey: undefined is not", isPirKey(undefined), false);

// --- decidePir: every row of DESIGN §2.5 -----------------------------------
const facts = (present, git = present) => ({
  exists: (p) => present.includes(p),
  isGitRepo: (p) => git.includes(p),
});
const runState = (run = RUN) => ({ view: "run", run });
const workerState = (worker = WORKER, run = RUN) => ({ view: "worker", run, worker });
const RUN_FOLLOW = {
  mode: "follow", key: "pir.agentic-ide__pir-pane", cwd: RUN.cwd, label: "pir-pane",
  isRun: true, runKey: "pir.agentic-ide__pir-pane",
};
const WORKER_FOLLOW = {
  mode: "follow", key: "pir.agentic-ide__pir-pane.w-T01", cwd: WORKER.cwd, label: "pir-pane / T01",
  isRun: false, runKey: "pir.agentic-ide__pir-pane",
};
const mode = (d) => d.mode;
const hasReason = (d) => d.mode === "list" && typeof d.reason === "string" && d.reason.length > 0;

check("§2.5 row list → list", decidePir(LIST, facts([RUN.cwd])), { mode: "list" });
check("§2.5 row run, run.cwd exists → follow the run", decidePir(runState(), facts([RUN.cwd])), RUN_FOLLOW);
check("§2.5 row worker, worker.cwd exists → follow the worker",
  decidePir(workerState(), facts([RUN.cwd, WORKER.cwd])), WORKER_FOLLOW);
check("§2.5 row worker, worker.cwd gone, run.cwd exists → the run",
  decidePir(workerState(), facts([RUN.cwd])), RUN_FOLLOW);
check("§2.5 row worker, worker.cwd null, run.cwd exists → the run",
  decidePir(workerState({ ...WORKER, cwd: null }), facts([RUN.cwd])), RUN_FOLLOW);
check("§2.5 last row: run.cwd gone → list", mode(decidePir(runState(), facts([]))), "list");
check("§2.5 last row: run.cwd gone gives a reason", hasReason(decidePir(runState(), facts([]))), true);
check("§2.5 last row: run.cwd null → list with reason",
  hasReason(decidePir(runState({ ...RUN, cwd: null }), facts([RUN.cwd]))), true);
check("§2.5 last row: worker and run both gone → list with reason",
  hasReason(decidePir(workerState(), facts([]))), true);
check("§2.5 last row: run cwd not a git repo → list with reason",
  hasReason(decidePir(runState(), facts([RUN.cwd], []))), true);
check("§2.5 last row: worker cwd not a git repo → list with reason",
  hasReason(decidePir(workerState(), facts([RUN.cwd, WORKER.cwd], [RUN.cwd]))), true);
check("§2.5 last row: worker gone, run cwd not a git repo → list with reason",
  hasReason(decidePir(workerState(), facts([RUN.cwd], []))), true);
check("decidePir: a run with no slug is labelled by its key",
  decidePir(runState({ ...RUN, slug: null }), facts([RUN.cwd])).label, RUN.key);
check("decidePir: a worker with no task is labelled by its id",
  decidePir(workerState({ ...WORKER, task: null }), facts([RUN.cwd, WORKER.cwd])).label, "pir-pane / w-T01");
check("decidePir: a folder in another repo is followed (§2.11)",
  decidePir(runState({ ...RUN, cwd: "/elsewhere/other" }), facts(["/elsewhere/other"])).cwd, "/elsewhere/other");
check("decidePir: end to end from the file, dead pid → list",
  decidePir(readPirState(doc({ pid: 7, view: "run", run: RUN }), alive), facts([RUN.cwd])), { mode: "list" });

// --- startingMode (§2.6) -----------------------------------------------------
const resolvesOnly = (...ok) => (ref) => ok.includes(ref);
check("startingMode: run, no stored ref → custom at the fork point",
  startingMode({ isRun: true, storedRef: undefined, forkPoint: "4e209ad", resolves: resolvesOnly() }),
  { mode: "custom", ref: "4e209ad" });
check("startingMode: run, stored ref → that ref",
  startingMode({ isRun: true, storedRef: "release/1.2", forkPoint: "4e209ad", resolves: resolvesOnly("release/1.2") }),
  { mode: "custom", ref: "release/1.2" });
const badStored = startingMode({ isRun: true, storedRef: "gone-branch", forkPoint: "4e209ad", resolves: resolvesOnly("4e209ad") });
check("startingMode: stored ref that does not resolve → uncommitted", badStored.mode, "uncommitted");
check("startingMode: stored ref that does not resolve gives a reason", typeof badStored.reason, "string");
const noFork = startingMode({ isRun: true, storedRef: undefined, forkPoint: null, resolves: resolvesOnly() });
check("startingMode: no stored ref and no fork point → uncommitted", noFork.mode, "uncommitted");
check("startingMode: no stored ref and no fork point gives a reason", typeof noFork.reason, "string");
check("startingMode: empty stored ref reads as none",
  startingMode({ isRun: true, storedRef: "", forkPoint: "4e209ad", resolves: resolvesOnly() }),
  { mode: "custom", ref: "4e209ad" });
check("startingMode: worker → uncommitted",
  startingMode({ isRun: false, storedRef: "release/1.2", forkPoint: "4e209ad", resolves: resolvesOnly("release/1.2") }),
  { mode: "uncommitted" });

// --- shouldReapPirKey (§2.9) --------------------------------------------------
const K = "pir.agentic-ide__pir-pane.w-T01";
const reapFacts = (o) => ({ shownKey: null, exists: () => false, cwdOfKey: () => "/gone", ...o });
check("shouldReapPirKey: folder gone and not shown → true", shouldReapPirKey(K, reapFacts({})), true);
check("shouldReapPirKey: folder gone but shown → false", shouldReapPirKey(K, reapFacts({ shownKey: K })), false);
check("shouldReapPirKey: folder present → false", shouldReapPirKey(K, reapFacts({ exists: () => true })), false);
check("shouldReapPirKey: non-pir key → false", shouldReapPirKey("a1b2c3d4-job", reapFacts({})), false);
check("shouldReapPirKey: folder never recorded → false (kept)", shouldReapPirKey(K, reapFacts({ cwdOfKey: () => null })), false);

console.log(`CHECKS ${pass} ${fail}`);
process.exit(fail ? 1 : 0);
