#!/usr/bin/env bash
# Tests for the cockpit's session naming: the UserPromptSubmit hook that labels
# every claude session "<repo folder> / <what it is doing>", which is the text
# the fleet list shows.
#
# Nothing here needs WezTerm -- the hook is a plain stdin/stdout filter Claude
# Code runs -- so this runs standalone like spikes/notes-test rather than through
# the mux stub in spikes/cockpit-test.
#
# The seatbelt that matters here is ~/.claude/settings.json. It is the USER's
# file: their model, their plugins, their own hooks, and a settings.json that
# fails to parse silently disables every setting in it. No test may write it, and
# run.sh checks that afterwards rather than trusting it.
#
#   spikes/auto-name-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

REAL_SETTINGS="$HOME/.claude/settings.json"
settings_fingerprint() {
  if [ -f "$REAL_SETTINGS" ]; then shasum -a 256 "$REAL_SETTINGS" | awk '{print $1}'; else echo "(absent)"; fi
}
BEFORE_SETTINGS="$(settings_fingerprint)"

fail=0
pass=0
# Quiet by default: a passing check just bumps the count. VERBOSE=1 restores the
# per-check "ok" listing. Failures always print in full. (The node suites read the
# same VERBOSE inline.)
okline() { pass=$((pass+1)); [ -n "${VERBOSE:-}" ] && echo "  ok   $1"; return 0; }
same() { if [ "$2" = "$3" ]; then okline "$1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

# --- the node suites -------------------------------------------------------
# One fresh state dir each, so a suite can never inherit another's session
# memory -- and so nothing reaches the real ~/.claude/cockpit.
for suite in "$HERE"/*.test.mjs; do
  [ -e "$suite" ] || continue
  d="$T/$(basename "$suite" .test.mjs)"
  mkdir -p "$d"
  COCKPIT_DIR="$d" node "$suite" || fail=1
done

echo
echo "== the user's settings.json is never touched by a test =="
same "the real settings.json is byte-identical" "$(settings_fingerprint)" "$BEFORE_SETTINGS"
# And it cannot become touched by a later test either: no suite may name the real
# path. A test that did would be invisible in a green run right up until the run
# that broke someone's config.
same "no suite names the real settings path" \
     "$(grep -l '\.claude/settings\.json' "$HERE"/*.test.mjs 2>/dev/null | wc -l | tr -d ' ')" "0"

echo
echo "== nothing leaks into the checkout =="
# State written into the repo would appear in `revdiff --untracked HEAD` -- the
# very diff an agent is reviewed on -- so every session name would become a
# change the agent thinks it has to explain.
# Matched on names only THIS feature writes. The repo's own .claude/settings.json
# is checked in and legitimate, so a bare settings*.json would fail here forever;
# the test files are settings<N>.json and belong in a temp dir.
stray="$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/.claude/worktrees" -prune -o \
         \( -name 'auto-names' -o -name 'settings[0-9]*.json' -o -name '*.json.tmp' \) -print 2>/dev/null | wc -l | tr -d ' ')"
same "no naming state anywhere in the checkout" "$stray" "0"

echo
echo "== the hook keeps its side of the boundary =="
# DESIGN 5: this repository has zero dependencies and no package manifest, and
# that must survive being cloned onto a machine with nothing but node and
# wezterm. Same extraction as spikes/agenda-test, comment lines dropped first.
foreign="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$ROOT/bin/cockpit-auto-name.mjs" \
  | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
  | grep -oE "[\"'][^\"']+[\"']" | grep -vcE "^[\"']node:")"
same "the hook imports nothing outside node:*" "$foreign" "0"

# It runs on EVERY prompt of every session, so a crash here is a crash in the
# prompt box. The contract is that it never exits non-zero in hook mode.
for bad in 'not json' '{}' '{"session_id":"x"}' '[]' 'null'; do
  printf '%s' "$bad" | COCKPIT_DIR="$T/robust" node "$ROOT/bin/cockpit-auto-name.mjs" >/dev/null 2>&1
  same "hook mode survives input: $bad" "$?" "0"
done

echo
echo "== the installer registers it =="
# Asserted through the REAL line out of bin/install.sh rather than a copy of it:
# a copy drifts, and the drift would be a feature that quietly stopped being
# installed on a fresh machine.
same "install.sh calls the hook's own --install" \
     "$(grep -cE '\$NAMING" --install' "$ROOT/bin/install.sh")" "1"
same "...and reports it under --check first" \
     "$(grep -cE '\$NAMING" --check' "$ROOT/bin/install.sh")" "1"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass bash checks; node suites counted above)"; else echo "FAILURES"; fi
exit "$fail"
