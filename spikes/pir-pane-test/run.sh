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

# --- the installer reports pir as optional (T05) --------------------------------
# Asserted on the REAL lines of bin/install.sh, the way spikes/auto-name-test does: the
# installer has no dry run, and a copy of its lines would drift. The pir branch is the block
# from `PIR_PATH="$(resolve pir)"` to its closing `fi`; it must say "optional", must never
# die/exit, and must never count pir as MISSING (which makes the install refuse to write).
INSTALL="$ROOT/bin/install.sh"
check() { # $1 name, $2 0/1 ok
  if [ "$2" -eq 1 ]; then pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && echo "  ok   $1"
  else echo "  FAIL $1"; fail=$((fail + 1)); fi
}
block="$(awk '/PIR_PATH="\$\(resolve pir\)"/{on=1} on{print} on&&/^fi$/{exit}' "$INSTALL")"
check "install.sh resolves pir through the login-shell resolver" "$([ -n "$block" ] && echo 1 || echo 0)"
check "the pir check is not a required check_tool" \
      "$(grep -qE '^[[:space:]]*check_tool[[:space:]]+pir' "$INSTALL" && echo 0 || echo 1)"
check "the missing-pir branch prints an optional note" \
      "$(printf '%s\n' "$block" | grep -q 'warn .*optional' && echo 1 || echo 0)"
check "the pir branch has no die or exit" \
      "$(printf '%s\n' "$block" | grep -qE '\b(die|exit)\b' && echo 0 || echo 1)"
check "the pir branch never counts toward MISSING" \
      "$(printf '%s\n' "$block" | grep -q 'MISSING' && echo 0 || echo 1)"
# And run the branch itself, both ways, with a stubbed resolver: it must exit 0 each time.
for present in 1 0; do
  out="$( (
    set +e
    ok()   { echo "ok $*"; }
    warn() { echo "warn $*"; }
    die()  { echo "DIED"; }
    resolve() { [ "$present" -eq 1 ] && echo /opt/pir; }
    MISSING=0
    eval "$block"
    echo "MISSING=$MISSING"
  ) 2>&1 )"
  st=$?
  if [ "$present" -eq 1 ]; then
    check "pir present: reported ok with its path" "$(printf '%s' "$out" | grep -q '^ok pir *\/opt\/pir' && echo 1 || echo 0)"
  else
    check "pir absent: reported as optional" "$(printf '%s' "$out" | grep -q '^warn pir .*optional' && echo 1 || echo 0)"
  fi
  check "pir $([ "$present" -eq 1 ] && echo present || echo absent): exits 0, MISSING stays 0" \
        "$([ "$st" -eq 0 ] && printf '%s' "$out" | grep -q '^MISSING=0$' && ! printf '%s' "$out" | grep -q DIED && echo 1 || echo 0)"
done

if [ "$fail" -eq 0 ]; then
  echo "pir-pane-test: ALL PASS ($pass checks)"
  exit 0
fi
echo "pir-pane-test: FAILURES ($fail failed, $pass passed)"
exit 1
