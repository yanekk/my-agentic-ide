#!/usr/bin/env bash
# Tests for the selective Stop-hook notification sound: cockpit-stop-notify.mjs,
# which dings on every session stop EXCEPT a PIR worker that finished its task,
# while still dinging on a worker parked waiting for the person.
#
# Nothing here needs WezTerm or a real machine -- the hook is a plain
# stdin/stdout filter Claude Code runs, and every disk read is injected in the
# node suite -- so this runs standalone like spikes/notes-test.
#
# The seatbelt that matters is ~/.claude/settings.json: it is the USER's file,
# and a settings.json that fails to parse silently disables every setting in it.
# No test may write it, and run.sh checks that afterwards rather than trusting it.
#
#   spikes/stop-notify-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HOOK="$ROOT/bin/cockpit-stop-notify.mjs"

REAL_SETTINGS="$HOME/.claude/settings.json"
settings_fingerprint() {
  if [ -f "$REAL_SETTINGS" ]; then shasum -a 256 "$REAL_SETTINGS" | awk '{print $1}'; else echo "(absent)"; fi
}
BEFORE_SETTINGS="$(settings_fingerprint)"

fail=0
pass=0
okline() { pass=$((pass+1)); [ -n "${VERBOSE:-}" ] && echo "  ok   $1"; return 0; }
same() { if [ "$2" = "$3" ]; then okline "$1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

# --- the node suite ---------------------------------------------------------
node "$HERE"/decide.test.mjs || fail=1

echo
echo "== the hook never crashes on bad stdin (it runs on every stop) =="
# A Stop hook that exits non-zero or throws is a fault on every idle. The
# contract is: whatever the input, exit 0 and make no noise on stderr. A no-op
# afplay is shimmed onto the front of PATH so a stray ding cannot fire during the
# test while node itself stays reachable.
SHIM="$(mktemp -d)"
trap 'rm -rf "$SHIM"' EXIT
printf '#!/bin/sh\nexit 0\n' > "$SHIM/afplay"
chmod +x "$SHIM/afplay"
for bad in 'not json' '{}' '{"cwd":123}' '[]' 'null' ''; do
  printf '%s' "$bad" | PATH="$SHIM:$PATH" node "$HOOK" >/dev/null 2>&1
  same "hook survives input: [$bad]" "$?" "0"
done

echo
echo "== the user's settings.json is never touched by a test =="
same "the real settings.json is byte-identical" "$(settings_fingerprint)" "$BEFORE_SETTINGS"
same "no suite names the real settings path" \
     "$(grep -l '\.claude/settings\.json' "$HERE"/*.test.mjs 2>/dev/null | wc -l | tr -d ' ')" "0"

echo
echo "== the hook keeps its side of the boundary =="
# The repo has zero dependencies and no package manifest, and that must survive
# being cloned onto a machine with nothing but node and wezterm.
foreign="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$HOOK" \
  | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
  | grep -oE "[\"'][^\"']+[\"']" | grep -vcE "^[\"']node:")"
same "the hook imports nothing outside node:*" "$foreign" "0"

same "the hook is executable (else zsh: permission denied)" \
     "$([ -x "$HOOK" ] && echo yes || echo no)" "yes"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass bash checks; node suite counted above)"; else echo "FAILURES"; fi
exit "$fail"
