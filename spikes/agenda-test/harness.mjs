// Assertions for the agenda tests, printing in the same shape as the bash
// harnesses next door (spikes/notes-test, spikes/cockpit-test) so run.sh can
// count "  ok" / "  FAIL" lines across all of them and one eye can read the lot.

let failures = 0;

export function section(title) {
  console.log(`\n== ${title} ==`);
}

export function ok(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
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
  process.exit(failures ? 1 : 0);
}
