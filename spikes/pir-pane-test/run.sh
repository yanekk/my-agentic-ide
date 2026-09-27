#!/usr/bin/env bash
# Tests for the pure pir model (plans/pir-pane T01, DESIGN §2.4–§2.6, §2.9, §3).
#
# The model takes every fact as a parameter, so nothing here needs WezTerm, a daemon or a
# state directory: it runs in well under a second. Prints failures in full and then one line,
# `pir-pane-test: ALL PASS (N checks)` or `pir-pane-test: FAILURES (...)`. No colour.
#
#   bash spikes/pir-pane-test/run.sh          VERBOSE=1 lists every check
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MODEL="$ROOT/bin/cockpit-pir-model.mjs"

pass=0
fail=0

# --- the node suite -----------------------------------------------------------
out="$(node "$HERE/model.test.mjs" 2>&1)"
status=$?
counts="$(printf '%s\n' "$out" | sed -n 's/^CHECKS \([0-9]*\) \([0-9]*\)$/\1 \2/p' | tail -1)"
printf '%s\n' "$out" | grep -v '^CHECKS ' || true
if [ -n "$counts" ]; then
  pass=$((pass + ${counts% *}))
  fail=$((fail + ${counts#* }))
fi
if [ "$status" -ne 0 ] && [ "$fail" -eq 0 ]; then
  echo "  FAIL model.test.mjs exited $status without reporting a failed check"
  fail=$((fail + 1))
fi

# --- the pure model keeps its side of the boundary (DESIGN §3.1) ---------------
# The same check spikes/usage-test applies to its model. If it fails, move the code into the
# daemon; never relax the pattern. `new Date(<arg>)` would be allowed, a bare `new Date()`
# is a clock. The module is meant to import nothing at all, so any import is caught too.
if [ -f "$MODEL" ]; then
  impure="$(grep -nE 'node:fs|node:http|node:https|node:child_process|fetch\(|Date\.now\(|new Date\(\)|process\.env' "$MODEL")"
  if [ -z "$impure" ]; then pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && echo "  ok   the model reaches for nothing impure"
  else echo "  FAIL the model reaches for something impure:"; echo "$impure"; fail=$((fail + 1)); fi
  imports="$(grep -nE '^[[:space:]]*import[[:space:]]|import\(|require\(' "$MODEL")"
  if [ -z "$imports" ]; then pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && echo "  ok   the model imports nothing"
  else echo "  FAIL the model imports something:"; echo "$imports"; fail=$((fail + 1)); fi
else
  echo "  FAIL the pure model bin/cockpit-pir-model.mjs is missing"; fail=$((fail + 1))
fi

if [ "$fail" -eq 0 ]; then
  echo "pir-pane-test: ALL PASS ($pass checks)"
  exit 0
fi
echo "pir-pane-test: FAILURES ($fail failed, $pass passed)"
exit 1
