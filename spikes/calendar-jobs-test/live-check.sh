#!/usr/bin/env bash
# The real-machine check for agents started from a calendar (T06, DESIGN 5.3).
# NOT run by run.sh on real data: tick.test.mjs proves it against stand-ins.
#
#   live-check.sh <calendarId> <account>
#
# STARTS A REAL UNATTENDED AGENT from every entry on that calendar now inside its time
# window. Everything else happens in a 0600 scratch COCKPIT_DIR, always deleted: the
# live daemon runs older code and would overwrite the real cache without descriptions,
# and `agenda add` stays refused to agents.
#
# The scratch holds ONLY the test calendar. A jobs calendar kept from the real copy
# would run its entries a second time, against a ledger that has never heard of them.
#
#   LIVE_COCKPIT_DIR  where the real files are; default $HOME/.claude/cockpit
#   LIVE_ROOT         projects root; default `repo` from the real panes.json
#
# Exit 0 all three passes ran, 1 a pass failed, 2 not checkable.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
JOBS="$ROOT/bin/cockpit-jobs.mjs"
REAL="${LIVE_COCKPIT_DIR:-$HOME/.claude/cockpit}"

if [ "$#" -ne 2 ]; then echo "usage: live-check.sh <calendarId> <account>" >&2; exit 2; fi
CAL_ID="$1"
ACCOUNT="$2"

S="$(mktemp -d)" || exit 2
trap 'rm -rf "$S"' EXIT
chmod 700 "$S"

for f in agenda.json agenda-client.json; do
  if ! cp "$REAL/$f" "$S/$f"; then echo "live-check: cannot copy $f from $REAL" >&2; exit 2; fi
  chmod 600 "$S/$f"
done

# Refuses before anything runs. The token is never printed.
if ! PROJECTS="$(LIVE_REAL="$REAL" LIVE_ROOT="${LIVE_ROOT:-}" SCRATCH="$S" CAL_ID="$CAL_ID" ACCOUNT="$ACCOUNT" node --input-type=module -e '
  import fs from "node:fs";
  const { SCRATCH, CAL_ID, ACCOUNT, LIVE_REAL, LIVE_ROOT } = process.env;
  const file = `${SCRATCH}/agenda.json`;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!state.accounts?.[ACCOUNT]?.refreshToken) {
    console.error(`live-check: ${ACCOUNT} has no sign-in here`);
    process.exit(1);
  }
  let root = LIVE_ROOT;
  if (!root) { try { root = JSON.parse(fs.readFileSync(`${LIVE_REAL}/panes.json`, "utf8")).repo; } catch {} }
  if (!root) { console.error("live-check: no projects root; set LIVE_ROOT"); process.exit(1); }
  const now = Date.now();
  state.calendars = [{
    slug: "agents", account: ACCOUNT, calendarId: CAL_ID, title: "agents", colour: null,
    addedAt: now, jobs: true, jobsSince: now,
  }];
  fs.writeFileSync(file, JSON.stringify(state));
  console.log(root);
')"; then exit 2; fi

export COCKPIT_DIR="$S"
rc=0
pass() { # label, then any env settings
  local label="$1"; shift
  echo "=== $label"
  env "$@" node "$JOBS" --once --fetch --root "$PROJECTS" || rc=1
  echo "--- ledger after $label"
  if [ -e "$S/calendar-jobs.json" ]; then node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))' "$S/calendar-jobs.json"; else echo "(none)"; fi
}

pass "dry run" COCKPIT_JOBS_DRY_RUN=1
pass "first real pass" COCKPIT_JOBS_DRY_RUN=0
pass "second real pass, must start nothing" COCKPIT_JOBS_DRY_RUN=0

# Printed because they die with the directory.
echo "=== scratch notes"
PROJECTS="$PROJECTS" NOTES="$ROOT/bin/cockpit-notes.mjs" node --input-type=module -e '
  const { readNotes } = await import(process.env.NOTES);
  const notes = readNotes(process.env.PROJECTS);
  if (notes.length === 0) console.log("(none)");
  for (const n of notes) console.log(`${n.author ?? "you"}: ${n.text}`);
' || rc=1
exit "$rc"
