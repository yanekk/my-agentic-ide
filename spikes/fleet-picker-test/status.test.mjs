// The pure status model (bin/cockpit-fleet-status-model.mjs), plans/fleet-picker-status T01,
// DESIGN §2.1–§2.4, §2.7. No fs, no clock. Prints failures in full, then one line
// `CHECKS <pass> <fail>` that run.sh folds into its summary.
import { deepStrictEqual } from "node:assert";
import { claudeItems, pirItems, ageLabel, parseTime } from "../../bin/cockpit-fleet-status-model.mjs";

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

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();

// A background agent row as `claude agents --json --all` lists it (T00 shapes).
let seq = 0;
const bg = (state, extra = {}) => {
  seq++;
  return { id: `job${seq}`, kind: "background", name: `repo / a${seq}`, state, startedAt: 1000 + seq, ...extra };
};

// --- parseTime -------------------------------------------------------------------
check("parseTime: ISO Z", parseTime("2026-10-09T11:48:00.000Z"), NOW - 12 * MIN);
check("parseTime: ISO without ms", parseTime("2026-10-09T11:48:00Z"), NOW - 12 * MIN);
check("parseTime: ISO with offset", parseTime("2026-10-09T13:48:00+02:00"), NOW - 12 * MIN);
check("parseTime: epoch ms", parseTime(NOW - 5 * MIN), NOW - 5 * MIN);
check("parseTime: offset-less wall clock is unknown", parseTime("2026-10-09T11:48:00"), undefined);
check("parseTime: date only is unknown", parseTime("2026-10-09"), undefined);
check("parseTime: garbage", parseTime("yesterday"), undefined);
check("parseTime: impossible date", parseTime("2026-13-45T99:99:00Z"), undefined);
check("parseTime: numeric string", parseTime("1791551714206"), undefined);
check("parseTime: null", parseTime(null), undefined);
check("parseTime: undefined", parseTime(undefined), undefined);
check("parseTime: NaN", parseTime(NaN), undefined);
check("parseTime: Infinity", parseTime(Infinity), undefined);
check("parseTime: object", parseTime({}), undefined);
check("parseTime: boolean", parseTime(true), undefined);

// --- ageLabel ----------------------------------------------------------------------
check("ageLabel: just now", ageLabel(NOW, NOW), "0m");
check("ageLabel: 59s is 0m", ageLabel(NOW - 59000, NOW), "0m");
check("ageLabel: 12m", ageLabel(NOW - 12 * MIN - 30000, NOW), "12m");
check("ageLabel: 59m59s is 59m", ageLabel(NOW - 60 * MIN + 1000, NOW), "59m");
check("ageLabel: 60m hidden", ageLabel(NOW - 60 * MIN, NOW), null);
check("ageLabel: a week hidden", ageLabel(NOW - 7 * 24 * 60 * MIN, NOW), null);
check("ageLabel: future is 0m", ageLabel(NOW + 30 * MIN, NOW), "0m");
check("ageLabel: unknown", ageLabel(undefined, NOW), null);
check("ageLabel: NaN", ageLabel(NaN, NOW), null);
check("ageLabel: a string is not ms", ageLabel(iso(NOW), NOW), null);

// --- claudeItems: which agents ------------------------------------------------------
check("claude: not an array", claudeItems({}, {}, NOW), "unavailable");
check("claude: null", claudeItems(null, {}, NOW), "unavailable");
check("claude: a string", claudeItems("[]", {}, NOW), "unavailable");
check("claude: empty", claudeItems([], {}, NOW), []);
check(
  "claude: interactive dropped, background kept",
  claudeItems(
    [
      { id: "i1", kind: "interactive", name: "repo / pir worker", state: "working", startedAt: 5 },
      { id: "b1", kind: "background", name: "repo / mine", state: "working", startedAt: 4 },
      { id: "x1", name: "repo / no kind", state: "working", startedAt: 3 },
    ],
    {},
    NOW,
  ),
  [{ cls: "run", word: "working", name: "repo / mine" }],
);

// --- claudeItems: class and word -----------------------------------------------------
const one = (row, ends = {}) => claudeItems([row], ends, NOW);
check("claude: blocked → wait needs you", one(bg("blocked", { name: "n" })), [{ cls: "wait", word: "needs you", name: "n" }]);
check("claude: working → run working", one(bg("working", { name: "n" })), [{ cls: "run", word: "working", name: "n" }]);
check("claude: unknown state → run, its own word", one(bg("pondering", { name: "n" })), [{ cls: "run", word: "pondering", name: "n" }]);
for (const s of ["stopped", "failed", "crashed"]) {
  check(`claude: ${s} → bad ${s}`, one(bg(s, { name: "n" })), [{ cls: "bad", word: s, name: "n" }]);
}
check(
  "claude: bad shows however old it is",
  one(bg("stopped", { name: "n", startedAt: NOW - 30 * 24 * 60 * MIN }), {}),
  [{ cls: "bad", word: "stopped", name: "n" }],
);

// --- claudeItems: done and the hour ----------------------------------------------------
const doneAt = (end) => one({ id: "d", kind: "background", name: "n", state: "done", startedAt: 1 }, { d: end });
check("claude: done 0m", doneAt(iso(NOW)), [{ cls: "done", word: "done 0m", name: "n" }]);
check("claude: done 59m", doneAt(iso(NOW - 59 * MIN)), [{ cls: "done", word: "done 59m", name: "n" }]);
check("claude: done 60m hidden", doneAt(iso(NOW - 60 * MIN)), []);
check("claude: done a day ago hidden", doneAt(iso(NOW - 24 * 60 * MIN)), []);
check("claude: ISO lastTerminalAt 12m old → done 12m", doneAt("2026-10-09T11:48:00.000Z"), [{ cls: "done", word: "done 12m", name: "n" }]);
check("claude: epoch-ms finish accepted", doneAt(NOW - 3 * MIN), [{ cls: "done", word: "done 3m", name: "n" }]);
check("claude: future finish → done 0m", doneAt(iso(NOW + 10 * MIN)), [{ cls: "done", word: "done 0m", name: "n" }]);
check("claude: unparseable finish hidden", doneAt("garbage"), []);
check("claude: unknown finish hidden", one({ id: "d", kind: "background", name: "n", state: "done" }, {}), []);
check("claude: finishedAt not an object → unknown", claudeItems([{ id: "d", kind: "background", name: "n", state: "done" }], null, NOW), []);
check(
  "claude: finish looked up by id, not by position",
  claudeItems([{ id: "d1", kind: "background", name: "n", state: "done" }], { d2: iso(NOW) }, NOW),
  [],
);
check(
  "claude: no id → unknown finish, hidden",
  claudeItems([{ kind: "background", name: "n", state: "done" }], { undefined: iso(NOW) }, NOW),
  [],
);

// --- claudeItems: malformed rows ---------------------------------------------------
check(
  "claude: rows missing name or state skipped",
  claudeItems(
    [
      { id: "a", kind: "background", state: "working", startedAt: 1 },
      { id: "b", kind: "background", name: "", state: "working", startedAt: 1 },
      { id: "c", kind: "background", name: "repo / no state", startedAt: 1 },
      { id: "d", kind: "background", name: 42, state: "working", startedAt: 1 },
      null,
      "row",
      [],
      { id: "e", kind: "background", name: "repo / ok", state: "working", startedAt: 1 },
    ],
    {},
    NOW,
  ),
  [{ cls: "run", word: "working", name: "repo / ok" }],
);

// --- claudeItems: order -----------------------------------------------------------------
{
  const rows = [
    { id: "r-old", kind: "background", name: "run old", state: "working", startedAt: 100 },
    { id: "d-old", kind: "background", name: "done old", state: "done", startedAt: 900 },
    { id: "b-new", kind: "background", name: "bad new", state: "stopped", startedAt: 800 },
    { id: "w-old", kind: "background", name: "wait old", state: "blocked", startedAt: 200 },
    { id: "r-new", kind: "background", name: "run new", state: "working", startedAt: 700 },
    { id: "d-new", kind: "background", name: "done new", state: "done", startedAt: 100 },
    { id: "b-old", kind: "background", name: "bad old", state: "failed", startedAt: 300 },
    { id: "w-new", kind: "background", name: "wait new", state: "blocked", startedAt: 600 },
    { id: "r-nost", kind: "background", name: "run no start", state: "working" },
  ];
  const ends = { "d-old": iso(NOW - 40 * MIN), "d-new": iso(NOW - 2 * MIN) };
  check(
    "claude: wait, run, bad, done; newest start first; done most recent finish first",
    claudeItems(rows, ends, NOW).map((i) => i.name),
    ["wait new", "wait old", "run new", "run old", "run no start", "bad new", "bad old", "done new", "done old"],
  );
}

// --- pirItems ------------------------------------------------------------------------
const run = (extra = {}) => ({
  key: "k",
  kind: "work",
  slug: "fleet",
  label: null,
  repo: "my-agentic-ide",
  state: "running",
  display: { state: "building", tone: "plain", glyph: "◐", progress: "0/0", done: 0, total: 0, workers: 1 },
  waitingForYou: false,
  ...extra,
});
const disp = (state, extra = {}) => ({ state, done: 0, total: 0, ...extra });
const pone = (r) => pirItems({ version: 2, runs: [r] }, NOW);

check("pir: null", pirItems(null, NOW), "unavailable");
check("pir: an array", pirItems([], NOW), "unavailable");
check("pir: no runs", pirItems({ version: 2 }, NOW), "unavailable");
check("pir: runs not an array", pirItems({ runs: {} }, NOW), "unavailable");
check("pir: empty runs", pirItems({ runs: [] }, NOW), []);

check(
  "pir: waitingForYou → wait whatever state is (running)",
  pone(run({ waitingForYou: true, display: disp("asking you") })),
  [{ cls: "wait", word: "asking you", name: "my-agentic-ide / fleet" }],
);
check(
  "pir: waitingForYou → wait whatever state is (finished)",
  pone(run({ state: "finished", waitingForYou: true, display: disp("your go") })),
  [{ cls: "wait", word: "your go", name: "my-agentic-ide / fleet" }],
);
check(
  "pir: waitingForYou → wait whatever state is (crashed)",
  pone(run({ state: "crashed", waitingForYou: true, display: disp("asking you") }))[0].cls,
  "wait",
);
check("pir: running → run", pone(run({ display: disp("testing") })), [{ cls: "run", word: "testing", name: "my-agentic-ide / fleet" }]);
check("pir: unreachable → run", pone(run({ state: "unreachable", display: disp("unreachable") }))[0].cls, "run");
check("pir: unknown state → run, its word", pone(run({ state: "paused", display: disp("paused") })), [{ cls: "run", word: "paused", name: "my-agentic-ide / fleet" }]);
check("pir: waitingForYou must be true, not truthy", pone(run({ waitingForYou: "yes" }))[0].cls, "run");
check("pir: stopped → bad", pone(run({ state: "stopped", display: disp("stopped") })), [{ cls: "bad", word: "stopped", name: "my-agentic-ide / fleet" }]);
check("pir: crashed → bad", pone(run({ state: "crashed", display: disp("crashed") })), [{ cls: "bad", word: "crashed", name: "my-agentic-ide / fleet" }]);
check("pir: no display.state falls back to state", pone(run({ display: null }))[0].word, "running");

// done
check(
  "pir: finished, endedAt 12m (ISO) → done finished 12m",
  pone(run({ kind: "plan", state: "finished", display: disp("finished"), endedAt: iso(NOW - 12 * MIN) })),
  [{ cls: "done", word: "finished 12m", name: "my-agentic-ide / fleet" }],
);
check("pir: finished shows its display word (merged)", pone(run({ kind: "single", state: "finished", display: disp("merged"), endedAt: NOW - MIN }))[0].word, "merged 1m");
check("pir: finished shows its display word (closed)", pone(run({ kind: "single", state: "finished", display: disp("closed"), endedAt: NOW }))[0].word, "closed 0m");
check("pir: finished 59m shown", pone(run({ kind: "plan", state: "finished", display: disp("finished"), endedAt: iso(NOW - 59 * MIN) }))[0].word, "finished 59m");
check("pir: finished 60m hidden", pone(run({ state: "finished", display: disp("finished"), endedAt: iso(NOW - 60 * MIN) })), []);
check("pir: finished without endedAt hidden", pone(run({ state: "finished", display: disp("finished") })), []);
check("pir: finished, endedAt null hidden", pone(run({ state: "finished", display: disp("finished"), endedAt: null })), []);
check("pir: finished, endedAt garbage hidden", pone(run({ state: "finished", display: disp("finished"), endedAt: "soon" })), []);
check("pir: finished in the future → 0m", pone(run({ kind: "plan", state: "finished", display: disp("finished"), endedAt: iso(NOW + 5 * MIN) }))[0].word, "finished 0m");
check(
  "pir: bad shows however old it is",
  pone(run({ state: "crashed", display: disp("crashed"), endedAt: iso(NOW - 30 * 24 * 60 * MIN) })),
  [{ cls: "bad", word: "crashed", name: "my-agentic-ide / fleet" }],
);

// build progress
check("pir: build word gets done/total", pone(run({ display: disp("building", { done: 3, total: 7 }) }))[0].word, "building 3/7");
check("pir: build with total 0 has no progress", pone(run({ display: disp("building", { done: 0, total: 0 }) }))[0].word, "building");
check("pir: plan run has no progress", pone(run({ kind: "plan", display: disp("planning", { done: 1, total: 4 }) }))[0].word, "planning");
check("pir: single run has no progress", pone(run({ kind: "single", display: disp("testing", { done: 1, total: 4 }) }))[0].word, "testing");
check("pir: build waiting carries progress too", pone(run({ waitingForYou: true, display: disp("asking you", { done: 2, total: 5 }) }))[0].word, "asking you 2/5");
check(
  "pir: finished build: progress, then age",
  pone(run({ state: "finished", display: disp("merged", { done: 5, total: 5 }), endedAt: NOW - 4 * MIN }))[0].word,
  "merged 5/5 4m",
);

// names
check("pir: plan with label → quoted label", pone(run({ kind: "plan", label: "status in picker" }))[0].name, 'my-agentic-ide / "status in picker"');
check("pir: single with label → quoted label", pone(run({ kind: "single", label: "fix it" }))[0].name, 'my-agentic-ide / "fix it"');
check("pir: plan without label → slug", pone(run({ kind: "plan", label: null }))[0].name, "my-agentic-ide / fleet");
check("pir: build with label still uses slug", pone(run({ kind: "work", label: "ignored" }))[0].name, "my-agentic-ide / fleet");
check("pir: empty label → slug", pone(run({ kind: "plan", label: "" }))[0].name, "my-agentic-ide / fleet");

// malformed
check(
  "pir: rows missing name or state skipped",
  pirItems(
    {
      runs: [
        run({ state: undefined }),
        run({ state: "" }),
        run({ slug: null }),
        run({ kind: "plan", slug: null, label: null }),
        run({ repo: null }),
        null,
        "row",
        run({ slug: "ok" }),
        run({ kind: "plan", slug: null, label: "labelled" }),
      ],
    },
    NOW,
  ).map((i) => i.name),
  ["my-agentic-ide / ok", 'my-agentic-ide / "labelled"'],
);

// order
{
  const runs = [
    run({ slug: "a-run" }),
    run({ slug: "b-done-old", state: "finished", display: disp("finished"), endedAt: iso(NOW - 50 * MIN) }),
    run({ slug: "c-bad" }),
    run({ slug: "d-wait", waitingForYou: true }),
    run({ slug: "e-run" }),
    run({ slug: "f-done-new", state: "finished", display: disp("finished"), endedAt: iso(NOW - 1 * MIN) }),
    run({ slug: "g-wait", waitingForYou: true }),
    run({ slug: "h-bad", state: "stopped" }),
  ];
  runs[2].state = "crashed";
  check(
    "pir: wait, run, bad, done; service order kept within a class; done most recent first",
    pirItems({ runs }, NOW).map((i) => i.name.split(" / ")[1]),
    ["d-wait", "g-wait", "a-run", "e-run", "c-bad", "h-bad", "f-done-new", "b-done-old"],
  );
}

// Items carry exactly cls, word, name: render (T03) gets no stray sort keys.
check(
  "items carry exactly cls, word, name",
  [...claudeItems([bg("working")], {}, NOW), ...pirItems({ runs: [run()] }, NOW)].map((i) => Object.keys(i).sort()),
  [["cls", "name", "word"], ["cls", "name", "word"]],
);

console.log(`CHECKS ${pass} ${fail}`);
process.exit(fail ? 1 : 0);
