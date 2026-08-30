// Assertions for the agenda tests, printing in the same shape as the bash
// harnesses next door (spikes/notes-test, spikes/cockpit-test) so run.sh can
// count "  ok" / "  FAIL" lines across all of them and one eye can read the lot.

let failures = 0;
let checks = 0;

export function section(title) {
  // Section banners are for VERBOSE runs; a quiet run is a one-line summary.
  if (process.env.VERBOSE) console.log(`\n== ${title} ==`);
}

// VERBOSE=1 prints the per-check "ok" line; otherwise a pass is silent (the bash
// run.sh sets the same convention). A failure always prints.
export function ok(name, cond, detail = "") {
  checks++;
  if (cond) { if (process.env.VERBOSE) console.log(`  ok   ${name}`); }
  else {
    console.log(`  FAIL ${name}`);
    if (detail) console.log(`       ${detail}`);
    failures++;
  }
}

export function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `want ${w} got ${g}`);
}

export function done() {
  // One line per suite even when quiet, so the bash run.sh's "counted above" is true.
  const suite = (process.argv[1] || "suite").split("/").pop().replace(/\.test\.mjs$/, "");
  console.log(`  ${suite}: ${checks - failures}/${checks} ok`);
  process.exit(failures ? 1 : 0);
}
