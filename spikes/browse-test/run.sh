#!/usr/bin/env bash
# Tests for browse mode's glue -- the decision about what to push into the viewer,
# and (from T02) the command that carries it out.
#
# Nothing here needs WezTerm, broot or micro. The whole point of the boundary
# (DESIGN 3.1) is that the decision is a pure function, so this runs standalone
# like spikes/agenda-test and spikes/notes-test rather than through the mux stub
# in spikes/cockpit-test. What only a live pane can show -- that micro actually
# obeys these keystrokes -- is T07's, with a person at the screen.
#
#   spikes/browse-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

fail=0
same() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

# --- the node suites -------------------------------------------------------
# One fresh state dir each, so a suite can never inherit another's files. T02 adds
# <name>.test.mjs beside this script and it is picked up here without editing this.
for suite in "$HERE"/*.test.mjs; do
  [ -e "$suite" ] || continue
  d="$T/$(basename "$suite" .test.mjs)"
  mkdir -p "$d"
  COCKPIT_DIR="$d" node "$suite" || fail=1
done

echo
echo "== 8. the model keeps its side of the boundary =="
# DESIGN 3.1, and the task doc says it twice: if this fails the fix is to MOVE THE
# CODE, never to relax the test. A filesystem read on the pure side is a rule that
# stops being checkable in milliseconds and starts needing a person with a
# terminal -- and `realpath`, which the caller owes this module, is exactly the
# import that would look most reasonable to add here.
#
# Every quoted module specifier however it is written -- `import x from "y"`,
# `export … from 'y'`, `await import('y')` -- with comment lines dropped first,
# because the prose above says "from" and "node:fs" too.
MODEL="$ROOT/bin/cockpit-open-model.mjs"
specs="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$MODEL" \
  | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
  | grep -oE "[\"'][^\"']+[\"']" | tr -d "\"'")"
same "no import of node:fs"            "$(printf '%s\n' "$specs" | grep -cE '^node:fs')" "0"
same "no import of node:child_process" "$(printf '%s\n' "$specs" | grep -cE '^node:child_process')" "0"
same "no import of node:os"            "$(printf '%s\n' "$specs" | grep -cE '^node:os')" "0"
# The three above are what the task requires. This one is stricter and holds today:
# the module needs nothing at all, and a new import is worth a second look even if
# it is pure -- this repo has zero dependencies and no package manifest (DESIGN 5).
same "in fact it imports nothing"      "$(printf '%s' "$specs" | grep -c .)" "0"

# The other half of "pure": not reading the environment either. cwd is the one
# that would bite silently, because the daemon, a cockpit terminal and this test
# all have different ones -- so the same file would get a different tab label
# depending on who pushed it. `path.resolve`/`path.relative` fall back to cwd,
# which is why the paths here are hand-rolled string arithmetic.
body="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$MODEL")"
same "it never reads process.cwd()"    "$(printf '%s' "$body" | grep -c 'process\.cwd')" "0"
same "it never reads process.env"      "$(printf '%s' "$body" | grep -c 'process\.env')" "0"
same "it never reads the clock"        "$(printf '%s' "$body" | grep -cE 'Date\.now|new Date')" "0"

echo
echo "== 9. nothing leaks into the repo =="
# A state file checked in would appear in `revdiff --untracked HEAD` -- the very
# diff an agent is reviewed on -- so a test that wrote one into the checkout would
# hand every agent a change to explain (the same rule that keeps notes.json out).
stray="$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/.claude/worktrees" -prune -o \
         \( -name 'viewer-tabs*.json' -o -name '*.json.tmp' \) -print 2>/dev/null | wc -l | tr -d ' ')"
same "no viewer state anywhere in the checkout" "$stray" "0"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit "$fail"
