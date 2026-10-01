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
. "$ROOT/spikes/lib/test-daemons.sh"
trap 'daemon_sweep "$T"; rm -rf "$T"' EXIT
# Seatbelt (pir-usage-reader DESIGN 5.2): whatever PIR_HOME the caller exports, no
# reader or daemon started from here may resolve the real ~/.pir/api.json and so
# send a request to the real pir service. Tests pass their own home explicitly too.
export PIR_HOME="$T/pir-home"
mkdir -p "$PIR_HOME"

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
echo "== the pir seatbelt =="
same "a scratch PIR_HOME is exported to children" "$(bash -c 'printf %s "${PIR_HOME:-}"')" "$T/pir-home"

echo
echo "== the installer reports pir's API service (pir-usage-reader T04, DESIGN 2.7) =="
# Asserted on the REAL lines of bin/install.sh, as spikes/pir-pane-test does for the
# `pir` line: the installer has no dry run, and a copy of its lines would drift. The
# block is the `if [ -n "$PIR_PATH" ]; then` ... `fi` that calls the reader; the `pir`
# line's own guard of the same shape is skipped because it does not.
INSTALL="$ROOT/bin/install.sh"
api_block="$(awk 'BEGIN{n=0} /^if \[ -n "\$PIR_PATH" \]; then$/{on=1; blk=""} on{blk=blk $0 "\n"} on&&/^fi$/{on=0; if (blk ~ /cockpit-usage-pir\.mjs/) {printf "%s", blk; exit}}' "$INSTALL")"
yes_no() { if eval "$1"; then echo 1; else echo 0; fi; }
same "the pir-api block exists and asks cockpit-usage-pir.mjs --status" \
     "$(yes_no 'printf "%s" "$api_block" | grep -q "cockpit-usage-pir\.mjs\" --status"')" "1"
same "it sits inside a PIR_PATH non-empty guard" \
     "$(yes_no 'printf "%s" "$api_block" | head -1 | grep -q "^if \[ -n \"\$PIR_PATH\" \]; then$"')" "1"
same "it has no bad, die, exit or MISSING" \
     "$(yes_no 'printf "%s" "$api_block" | grep -qE "\b(bad|die|exit|MISSING)\b"')" "0"
same "it has an ok branch" "$(yes_no 'printf "%s" "$api_block" | grep -qE "^[[:space:]]*ok "')" "1"
same "its warn branch names pir service on" \
     "$(yes_no 'printf "%s" "$api_block" | grep -qE "^[[:space:]]*warn .*\(pir service on\)"')" "1"

# Run the real block with stubbed ok/warn/bad, the real reader, and PIR_HOME at a
# scratch home. `set -e` is on in the subshell so a reader exiting 1 would be seen to
# end it -- the block must survive that and the whole run must exit 0.
run_api_block() { # $1 = PIR_HOME
  ( set -e
    ok()   { echo "ok $*"; }
    warn() { echo "warn $*"; }
    bad()  { echo "BAD $*"; }
    REPO="$ROOT"; PIR_PATH=/opt/pir; MISSING=0
    export PIR_HOME="$1"
    eval "$api_block"
    echo "MISSING=$MISSING" )
}
NOAPI="$T/pir-noapi"; mkdir -p "$NOAPI/.pir"
out="$(run_api_block "$NOAPI")"; st=$?
same "no api.json: exit 0"                     "$st" "0"
same "no api.json: prints the warn line" \
     "$(printf '%s\n' "$out" | head -1)" \
     "warn pir-api  optional -- not running; the usage bar will not refresh during pir runs (pir service on)"
same "no api.json: MISSING untouched"          "$(printf '%s\n' "$out" | tail -1)" "MISSING=0"

# A stand-in service: answers GET /v1/usage with pir's documented "nothing known yet"
# (state empty, which the installer reports as running, DESIGN 2.7) and writes the
# api.json naming itself, with its own pid so the reader believes it alive.
UPHOME="$T/pir-up"; mkdir -p "$UPHOME/.pir"
node -e '
  const http = require("http"), fs = require("fs"), path = require("path");
  const s = http.createServer((q, r) => {
    r.writeHead(200, { "content-type": "application/json" });
    r.end(JSON.stringify({ version: 1, observed_at: null, rate_limits: null }));
  });
  s.listen(0, "127.0.0.1", () => {
    const f = path.join(process.argv[1], ".pir", "api.json");
    fs.writeFileSync(f + ".tmp", JSON.stringify({ version: 1, url: "http://127.0.0.1:" + s.address().port, pid: process.pid }));
    fs.renameSync(f + ".tmp", f);
  });
  setTimeout(() => process.exit(0), 30000).unref();   // a backstop, never the normal end
' "$UPHOME" &
STANDIN=$!
for _ in $(seq 1 100); do [ -f "$UPHOME/.pir/api.json" ] && break; sleep 0.05; done
origin="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).url)' "$UPHOME/.pir/api.json" 2>/dev/null)"
out="$(run_api_block "$UPHOME")"; st=$?
kill "$STANDIN" 2>/dev/null; wait "$STANDIN" 2>/dev/null
same "service up: exit 0"                      "$st" "0"
same "service up: prints the ok line with its origin" \
     "$(printf '%s\n' "$out" | head -1)" "ok pir-api  $origin"
same "service up: the origin is a loopback url" \
     "$(yes_no '[[ "$origin" =~ ^http://127\.0\.0\.1:[0-9]+$ ]]')" "1"

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
daemon_tripwire "$T" || fail=1
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass bash checks; node suites counted above)"; else echo "FAILURES"; fi
exit "$fail"
