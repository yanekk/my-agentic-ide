#!/usr/bin/env bash
# Tests for agents started from a calendar.
#
# Every node suite runs against a throwaway COCKPIT_DIR. T04 adds tick.test.mjs
# beside this script and it is picked up here.
#
#   spikes/calendar-jobs-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
. "$ROOT/spikes/lib/test-daemons.sh"
trap 'daemon_sweep "$T"; rm -rf "$T"' EXIT

fail=0
pass=0
okline() { pass=$((pass+1)); [ -n "${VERBOSE:-}" ] && echo "  ok   $1"; return 0; }
same()   { if [ "$2" = "$3" ]; then okline "$1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

for suite in "$HERE"/*.test.mjs; do
  [ -e "$suite" ] || continue
  d="$T/$(basename "$suite" .test.mjs)"
  mkdir -p "$d"
  COCKPIT_DIR="$d" node "$suite" || fail=1
done

# --- the pure model keeps its side of the boundary (DESIGN 3.1) ------------
# If this fails, the fix is to MOVE THE CODE, never to relax the grep: every rule
# that leaks across this line needs a rig instead of a millisecond test.
impure() {
  grep -nE "Date\.now|new Date\([[:space:]]*\)|process\.|[\"'](node:)?(fs|child_process|https?)(/[a-z]+)?[\"']|fetch\(" "$1" | wc -l | tr -d ' '
}
MODEL="$ROOT/bin/cockpit-jobs-model.mjs"
same "the model reaches for nothing impure" "$(impure "$MODEL")" "0"

# The grep is only worth something if it can fail, so each forbidden thing is
# planted in a copy, one at a time.
i=0
while IFS= read -r plant; do
  i=$((i+1))
  P="$T/planted-$i.mjs"
  cp "$MODEL" "$P"
  printf '%s\n' "$plant" >> "$P"
  same "the grep catches: $plant" "$(impure "$P")" "1"
done <<'PLANTS'
const t = Date.now();
const t = new Date();
const h = process.env.HOME;
import fs from "node:fs";
import fs from "fs";
import cp from "node:child_process";
import h from "node:https";
import h from "https";
PLANTS

daemon_tripwire "$T" || fail=1
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass bash checks; node suites counted above)"; else echo "FAILURES"; fi
exit "$fail"
