#!/usr/bin/env bash
# Tests for agents started from a calendar.
#
# Every node suite runs against a throwaway COCKPIT_DIR, with a fake `claude` first on
# PATH: the real one would start a real unattended agent, so a suite never runs
# unless the fake is what `claude` resolves to.
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

# --- the seatbelts (DESIGN 5.2) ---------------------------------------------
REAL_LEDGER="$HOME/.claude/cockpit/calendar-jobs.json"
ledger_sig() { if [ -e "$1" ]; then stat -f '%m %z' "$1"; else echo absent; fi; }
is_fake() { [ "$(PATH="$1" claude --i-am-the-fake 2>/dev/null)" = "fake-claude" ]; }

mkdir -p "$T/bin"
ln -s "$HERE/fake-claude" "$T/bin/claude"
chmod +x "$HERE/fake-claude"
export PATH="$T/bin:$PATH"
export FAKE_CLAUDE_LOG="$T/fake-claude.log"
LEDGER_BEFORE="$(ledger_sig "$REAL_LEDGER")"

if is_fake "$PATH"; then
  okline "claude on PATH is the fake"
else
  echo "  FAIL claude on PATH is not the fake; running nothing"
  echo "FAILURES"
  exit 1
fi
# Both checks are only worth something if they can fail.
if is_fake "/usr/bin:/bin"; then echo "  FAIL is_fake believed a PATH without the fake"; fail=1; else okline "is_fake refuses a PATH without the fake"; fi
PLANTED="$T/planted-ledger.json"
SIG="$(ledger_sig "$PLANTED")"; echo x > "$PLANTED"
if [ "$(ledger_sig "$PLANTED")" = "$SIG" ]; then echo "  FAIL ledger_sig missed a new file"; fail=1; else okline "ledger_sig sees a change"; fi

for suite in "$HERE"/*.test.mjs; do
  [ -e "$suite" ] || continue
  d="$T/$(basename "$suite" .test.mjs)"
  mkdir -p "$d"
  COCKPIT_DIR="$d" node "$suite" || fail=1
done

same "the real ledger is untouched" "$(ledger_sig "$REAL_LEDGER")" "$LEDGER_BEFORE"

# --- wall-check.sh --clean, against a claude that cannot answer or keeps an agent -----
clean_case() { # fake-claude-body
  local h="$T/clean-home-$RANDOM" b="$T/clean-bin-$RANDOM"
  mkdir -p "$h/.wall-check-scratch" "$b"
  : > "$h/.wall-check-scratch/made"
  printf '#!/bin/sh\n%s\n' "$1" > "$b/claude"; chmod +x "$b/claude"
  HOME="$h" PATH="$b:$PATH" bash "$HERE/wall-check.sh" --clean >/dev/null 2>&1
  echo "$? $([ -f "$h/.wall-check-scratch/made" ] && echo kept || echo gone)"
}
same "--clean: unreadable agents fail and keep the manifest" "$(clean_case 'exit 1')" "1 kept"
same "--clean: an agent left fails and keeps the manifest" "$(clean_case '[ "$1" = agents ] && echo "[{\"id\":\"a\",\"name\":\"p / wall-check build 1\"}]"; exit 0')" "1 kept"
same "--clean: nothing left removes the scratch" "$(clean_case '[ "$1" = agents ] && echo "[]"; exit 0')" "0 gone"

# --- the pure models keep their side of the boundary (DESIGN 3.1) ----------
# If this fails, the fix is to MOVE THE CODE, never to relax the grep: every rule
# that leaks across this line needs a rig instead of a millisecond test.
impure() {
  grep -nE "Date\.now|new Date\([[:space:]]*\)|process\.|[\"'](node:)?(fs|child_process|https?)(/[a-z]+)?[\"']|fetch\(" "$1" | wc -l | tr -d ' '
}

# The grep is only worth something if it can fail, so each forbidden thing is
# planted in a copy, one at a time.
i=0
for MODEL in "$ROOT/bin/cockpit-jobs-model.mjs" "$ROOT/bin/cockpit-wall-model.mjs" "$ROOT/bin/cockpit-guard-model.mjs"; do
  NAME="$(basename "$MODEL")"
  same "$NAME reaches for nothing impure" "$(impure "$MODEL")" "0"
  while IFS= read -r plant; do
    i=$((i+1))
    P="$T/planted-$i.mjs"
    cp "$MODEL" "$P"
    printf '%s\n' "$plant" >> "$P"
    same "$NAME: the grep catches: $plant" "$(impure "$P")" "1"
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
done

daemon_tripwire "$T" || fail=1
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass bash checks; node suites counted above)"; else echo "FAILURES"; fi
exit "$fail"
