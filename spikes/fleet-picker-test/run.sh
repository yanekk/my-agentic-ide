#!/usr/bin/env bash
# Tests for the fleet slot's program picker (plans/fleet-picker T02, DESIGN §2.3, §2.4, §2.7).
#
# Three parts: the pure model exhaustively (milliseconds), its purity grep (DESIGN §3.1), and
# the real picker process with its wrapper driven under a pseudo-terminal by pty-drive.py
# (about 25s: each scenario waits out a settle to prove only one verb is ever appended).
# Prints failures in full and then one line, `fleet-picker-test: ALL PASS (N checks)` or
# `fleet-picker-test: FAILURES (...)`. No colour.
#
#   bash spikes/fleet-picker-test/run.sh          VERBOSE=1 lists every check
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MODEL="$ROOT/bin/cockpit-fleet-picker-model.mjs"

pass=0
fail=0

# Each node suite prints its failures and ends with `CHECKS <pass> <fail>`.
run_suite() { # $1 file
  local out status counts
  out="$(node "$HERE/$1" 2>&1)"
  status=$?
  counts="$(printf '%s\n' "$out" | sed -n 's/^CHECKS \([0-9]*\) \([0-9]*\)$/\1 \2/p' | tail -1)"
  printf '%s\n' "$out" | grep -v '^CHECKS ' || true
  if [ -n "$counts" ]; then
    pass=$((pass + ${counts% *}))
    fail=$((fail + ${counts#* }))
  fi
  if [ "$status" -ne 0 ] && { [ -z "$counts" ] || [ "${counts#* }" -eq 0 ]; }; then
    echo "  FAIL $1 exited $status without reporting a failed check"
    fail=$((fail + 1))
  fi
}

run_suite model.test.mjs

# --- the pure model keeps its side of the boundary (DESIGN §3.1) ---------------
# If it fails, move the code into bin/cockpit-fleet-picker.mjs; never relax the pattern.
if [ -f "$MODEL" ]; then
  impure="$(grep -nE 'node:fs|node:child_process|fetch\(|Date\.now\(|new Date\(\)|process\.' "$MODEL")"
  if [ -z "$impure" ]; then pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && echo "  ok   the model reaches for nothing impure"
  else echo "  FAIL the model reaches for something impure:"; echo "$impure"; fail=$((fail + 1)); fi
  imports="$(grep -nE '^[[:space:]]*import[[:space:]]|import\(|require\(' "$MODEL")"
  if [ -z "$imports" ]; then pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && echo "  ok   the model imports nothing"
  else echo "  FAIL the model imports something:"; echo "$imports"; fail=$((fail + 1)); fi
else
  echo "  FAIL the pure model bin/cockpit-fleet-picker-model.mjs is missing"; fail=$((fail + 1))
fi

run_suite process.test.mjs

if [ "$fail" -eq 0 ]; then
  echo "fleet-picker-test: ALL PASS ($pass checks)"
  exit 0
fi
echo "fleet-picker-test: FAILURES ($fail failed, $pass passed)"
exit 1
