#!/usr/bin/env bash
# Tests for the BitBucket dashboard.
#
# The dashboard is a region drawn inside the fleet view's welcome pane, not a pane
# of its own, so nothing here needs WezTerm -- this runs standalone, like
# spikes/agenda-test and spikes/notes-test, rather than through the mux stub in
# spikes/cockpit-test.
#
# Every suite runs against a THROWAWAY COCKPIT_DIR. That is the seatbelt that
# matters here (DESIGN 5.2): the real ~/.claude/cockpit holds a live BitBucket
# credential, and no test may ever read or write one. run.sh checks that
# afterwards rather than trusting it.
#
#   spikes/bitbucket-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

REAL_DIR="${HOME}/.claude/cockpit"
# Names for the whole directory, plus name+size+mtime for the files that hold the
# SETTINGS. Names alone would miss a test that rewrote your real bitbucket-key in
# place, which is the one accident this check exists to catch -- but stat'ing the
# WHOLE dir would fail for reasons nothing to do with these tests, because a live
# cockpit rewrites terminals.json every couple of seconds while the window is open.
# Sizes and mtimes, never contents: this must not read a credential to prove it did
# not write one. bitbucket-cache.json is only LISTED, not stat'd, for the same
# reason the agenda cache is: the daemon rewrites it on every tick once configured,
# so a stat'd mtime would fail on any run that straddled a tick. Listing it still
# catches a test that CREATES or DELETES the real cache.
real_snapshot() {
  if [ -d "$REAL_DIR" ]; then
    ls -A "$REAL_DIR" | sort
    find "$REAL_DIR" -maxdepth 1 -name 'bitbucket-*' ! -name 'bitbucket-cache.json' \
      -exec stat -f '%N %z %m' {} \; 2>/dev/null | sort
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
echo "== nothing leaks into the repo, or into your real settings =="
# A state file checked into the repo would appear in `revdiff --untracked HEAD` --
# the very diff an agent is reviewed on -- and would put a credential in git.
stray="$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/.claude/worktrees" -prune -o \
         \( -name 'bitbucket-*.json' -o -name 'bitbucket-key' -o -name 'bitbucket-workspace' \
            -o -name 'bitbucket-repos' -o -name 'bitbucket-team' -o -name '*.json.tmp' \) -print 2>/dev/null | wc -l | tr -d ' ')"
same "no bitbucket state anywhere in the checkout"   "$stray" "0"
same "the real cockpit dir is untouched"             "$(real_snapshot)" "$BEFORE_REAL"

echo
echo "== config keeps its side of the boundary =="
# DESIGN 5: this repository has zero dependencies and no package manifest, and that
# is a property worth keeping. Every quoted module specifier, however written, then
# everything that is not a node: builtin. Comment lines are dropped first, so prose
# that says "from" does not trip it. config is the one module here that is imported
# by tests, so its import boundary is asserted the same way the agenda store's is.
foreign="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$ROOT/bin/cockpit-config.mjs" \
  | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
  | grep -oE "[\"'][^\"']+[\"']" | grep -vcE "^[\"']node:")"
same "cockpit-config.mjs imports nothing outside node:*" "$foreign" "0"

# DESIGN 3.1: the pure model may not touch the world. It arrives with T03 -- until
# then this says so out loud rather than passing silently.
MODEL="$ROOT/bin/cockpit-bitbucket-model.mjs"
if [ -f "$MODEL" ]; then
  impure="$(grep -nE 'node:fs|node:http|node:https|node:child_process|fetch\(|Date\.now\(|new Date\(\)|process\.env' "$MODEL" | wc -l | tr -d ' ')"
  same "the model reaches for nothing impure"     "$impure" "0"
  # If this fails the fix is to MOVE THE CODE, never to relax the check: every rule
  # that leaks across this line becomes a rule only a person can verify.
else
  echo "  --   the pure model does not exist yet (T03 adds it); its boundary check is skipped"
fi

# DESIGN 5.2: the client's loopback seam and the Open button's browser seam. A test
# that quietly aimed at the real api.bitbucket.org would open a real socket and burn
# a real credential; one that named the real opener would launch a browser a test
# cannot take back. Both are asserted the moment those modules and their tests
# arrive (T02, T08); until then there is nothing naming an origin or an opener, so
# the guards find zero and say so.
CLIENT="$ROOT/bin/cockpit-bitbucket-client.mjs"
if [ -f "$CLIENT" ]; then
  offbox="$(grep -oiE "(bitbucket_)?origin: *[^,)}]+" "$HERE"/*.test.mjs 2>/dev/null \
    | grep -viE "origin: *(stub\.origin|\`http://127\.0\.0\.1)" | wc -l | tr -d ' ')"
  same "no test points the client anywhere but loopback" "$offbox" "0"
  # DESIGN 5.2: the client is GET-only, so the dashboard cannot comment, approve or
  # merge a PR even by mistake. A mutating verb anywhere in the source -- code or
  # comment -- fails this, which is why those words are kept out of the file. `\b`
  # word boundaries so "input"/"dispatch"/"requests" do not trip it.
  mutating="$(grep -oiE '\b(POST|PUT|PATCH|DELETE)\b' "$CLIENT" | wc -l | tr -d ' ')"
  same "the client has no mutating HTTP method" "$mutating" "0"
else
  echo "  --   the client does not exist yet (T02 adds it); the origin seam check is skipped"
fi

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass bash checks; node suites counted above)"; else echo "FAILURES"; fi
exit "$fail"
