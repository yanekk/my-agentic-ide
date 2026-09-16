#!/usr/bin/env bash
# Tests for the footer usage segment (session/weekly Claude limits).
#
# The segment is drawn inside the footer strip, not a pane of its own, so nothing
# here needs WezTerm -- this runs standalone, like spikes/bitbucket-test and
# spikes/agenda-test, rather than through the mux stub in spikes/cockpit-test.
#
# Every suite runs against a THROWAWAY COCKPIT_DIR. That is the seatbelt that
# matters here (DESIGN 5.2): the real ~/.claude/cockpit holds live account usage
# figures, and no test may ever read or write one. run.sh checks that afterwards
# rather than trusting it.
#
#   spikes/usage-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

REAL_DIR="${HOME}/.claude/cockpit"
# Names for the whole directory, so a test that CREATES or DELETES the real
# usage-cache.json is caught. Contents are never read -- this must not read a usage
# figure to prove it did not write one. The cache is only LISTED, not stat'd,
# because a live cockpit rewrites it on every personal turn, so a stat'd mtime would
# fail on any run that straddled one.
real_snapshot() {
  if [ -d "$REAL_DIR" ]; then
    ls -A "$REAL_DIR" | sort
  else
    echo "(absent)"
  fi
}
BEFORE_REAL="$(real_snapshot)"

fail=0
pass=0
# Quiet by default: a passing check just bumps the count. VERBOSE=1 restores the
# per-check "ok" listing. Failures always print in full. (The node suites read the
# same VERBOSE via harness.mjs.)
okline() { pass=$((pass+1)); [ -n "${VERBOSE:-}" ] && echo "  ok   $1"; return 0; }
same()   { if [ "$2" = "$3" ]; then okline "$1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

# --- the node suites -------------------------------------------------------
# One fresh state dir each, so a suite can never inherit another's files. Later
# tasks add <name>.test.mjs beside this script and it is picked up here.
for suite in "$HERE"/*.test.mjs; do
  [ -e "$suite" ] || continue
  d="$T/$(basename "$suite" .test.mjs)"
  mkdir -p "$d"
  COCKPIT_DIR="$d" node "$suite" || fail=1
done

echo
echo "== the pure model keeps its side of the boundary (DESIGN 3.1) =="
# The model turns a rate_limits object plus `now` into what the footer draws, and
# it must do so with no clock, no fs, no network and no env -- `now` arrives as a
# parameter. If any of these appears the fix is to MOVE THE CODE OUT of the model,
# never to relax this check: every rule that leaks across the line becomes a rule
# only a person on a live subscription could verify. `new Date(<arg>)` is allowed;
# a bare zero-argument `new Date()` is a clock and is not.
MODEL="$ROOT/bin/cockpit-usage-model.mjs"
if [ -f "$MODEL" ]; then
  impure="$(grep -nE 'node:fs|node:http|node:https|node:child_process|fetch\(|Date\.now\(|new Date\(\)|process\.env' "$MODEL" | wc -l | tr -d ' ')"
  same "the model reaches for nothing impure"      "$impure" "0"
else
  echo "  FAIL the pure model bin/cockpit-usage-model.mjs is missing"; fail=1
fi

echo
echo "== nothing leaks into the repo, or into your real cockpit dir =="
# A state file checked into the repo would appear in `revdiff --untracked HEAD` --
# the very diff an agent is reviewed on -- and would put usage figures in git.
stray="$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/.claude/worktrees" -prune -o \
         \( -name 'usage-cache.json' -o -name 'usage-cache.json.*.tmp' \) -print 2>/dev/null | wc -l | tr -d ' ')"
same "no usage state anywhere in the checkout"   "$stray" "0"
same "the real cockpit dir is untouched"         "$(real_snapshot)" "$BEFORE_REAL"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass bash checks; node suites counted above)"; else echo "FAILURES"; fi
exit "$fail"
