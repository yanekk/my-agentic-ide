#!/usr/bin/env bash
# Settle why the one-line key legend at the bottom of the cockpit does not stay
# one line, and what actually puts it back.
#
#   spikes/pane-swap/footer-height.sh
#
# Runs against a headless `wezterm-mux-server` with its own socket and pid file,
# so no cockpit window is disturbed. Three parts:
#
#   1. every pane swap, with the footer's rows recorded after each -- are the
#      swaps the cause?
#   2. `adjust-pane-size --pane-id` vs. focus-then-shrink, on a footer grown to
#      9 rows.
#   3. the real bin/cockpit-strip.mjs running in the pane: inflate it and sample
#      every 100ms until it pins itself back.
#
# Findings are written up in RESULTS.md.
set -uo pipefail

command -v wezterm-mux-server >/dev/null || { echo "wezterm-mux-server not on PATH"; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

T="$(mktemp -d)"
cat > "$T/wezterm.lua" <<LUA
return {
  initial_cols = 120, initial_rows = 40,
  unix_domains = { { name = 'footheight', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
}
LUA
cleanup() { kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

cli() { wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }
geo() { cli list --format json | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("   ", " ".join("%s=%sx%s%s" % (p["pane_id"], p["size"]["cols"], p["size"]["rows"],
                                      "*" if p.get("is_active") else "")
                      for p in d if p["tab_id"] == 0))'; }
foot_rows() { cli list --format json | python3 -c "
import json, sys
print([p['size']['rows'] for p in json.load(sys.stdin) if p['pane_id'] == $1][0])"; }

wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"

# --- 1. is any pane swap what inflates it? ----------------------------------
echo "### 1. the footer's rows through every swap, split with --percent 5"
FLEET=$(cli list --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["pane_id"])')
FOOT=$(cli split-pane --bottom --percent 5 --pane-id "$FLEET" -- bash --norc)
DIFF=$(cli split-pane --top --percent 55 --pane-id "$FLEET" -- bash --norc)
SH=$(cli split-pane --right --percent 50 --pane-id "$FLEET" -- bash --norc)
STRIP=$(cli split-pane --right --percent 20 --pane-id "$SH" -- bash --norc)
echo "  layout fleet=$FLEET foot=$FOOT diff=$DIFF sh=$SH strip=$STRIP"
echo "  after the layout (5% of 40 rows):"; geo

D2=$(cli split-pane --top --percent 50 --pane-id "$DIFF" -- bash --norc); sleep 0.4
cli move-pane-to-new-tab --pane-id "$DIFF" >/dev/null
cli activate-tab --pane-id "$FLEET" >/dev/null 2>&1; sleep 0.6
echo "  after one diff swap:"; geo
cli split-pane --top --percent 50 --pane-id "$D2" --move-pane-id "$DIFF" >/dev/null; sleep 0.4
cli move-pane-to-new-tab --pane-id "$D2" >/dev/null
cli activate-tab --pane-id "$FLEET" >/dev/null 2>&1; sleep 0.6
echo "  after two diff swaps (the original back in the slot):"; geo

S2=$(cli split-pane --right --percent 50 --pane-id "$SH" -- bash --norc); sleep 0.4
cli move-pane-to-new-tab --pane-id "$SH" >/dev/null
cli activate-tab --pane-id "$FLEET" >/dev/null 2>&1; sleep 0.6
echo "  after a terminal swap:"; geo

cli kill-pane --pane-id "$DIFF" >/dev/null; sleep 0.6
cli move-pane-to-new-tab --pane-id "$S2" >/dev/null
cli activate-tab --pane-id "$FLEET" >/dev/null 2>&1; sleep 0.5
cli move-pane-to-new-tab --pane-id "$STRIP" >/dev/null
cli activate-tab --pane-id "$FLEET" >/dev/null 2>&1; sleep 0.5
echo "  mid-rebuild, fleet and footer alone in the tab:"; geo
cli split-pane --top --percent 55 --pane-id "$FLEET" -- bash --norc >/dev/null; sleep 0.5
cli split-pane --right --percent 50 --pane-id "$FLEET" --move-pane-id "$S2" >/dev/null; sleep 0.5
cli split-pane --right --percent 20 --pane-id "$S2" --move-pane-id "$STRIP" >/dev/null; sleep 0.5
echo "  after a full diff-slot rebuild:"; geo
echo "  -> the swaps never move it. The 5% share is the bug."

# --- 2. what actually shrinks it --------------------------------------------
echo
echo "### 2. correcting a footer that has drifted to 9 rows"
cli activate-pane --pane-id "$FOOT" >/dev/null; sleep 0.2
cli adjust-pane-size --amount 8 Up; sleep 0.4
cli activate-pane --pane-id "$FLEET" >/dev/null; sleep 0.3
echo "  drifted, fleet focused:"; geo
cli adjust-pane-size --pane-id "$FOOT" --amount 8 Down; sleep 0.4
echo "  after 'adjust-pane-size --pane-id <foot> Down 8' -- --pane-id is IGNORED,"
echo "  it resized the ACTIVE pane and squashed the bottom row instead:"; geo
cli activate-pane --pane-id "$FOOT" >/dev/null; sleep 0.2
cli adjust-pane-size --amount 8 Down; sleep 0.4
cli activate-pane --pane-id "$FLEET" >/dev/null; sleep 0.3
echo "  after focus-then-shrink-then-hand-focus-back:"; geo
cli activate-pane --pane-id "$FOOT" >/dev/null; sleep 0.2
cli adjust-pane-size --amount 20 Down; sleep 0.4
cli activate-pane --pane-id "$FLEET" >/dev/null; sleep 0.3
echo "  over-shrinking from 1 row is clamped, nothing else moves:"; geo

# --- 3. the real footer script, pinning itself ------------------------------
echo
echo "### 3. bin/cockpit-strip.mjs footer, inflated and left to correct itself"
command -v node >/dev/null || { echo "  node not on PATH; skipped"; exit 0; }
STATE="$T/state"; mkdir -p "$STATE"
echo '{"agent":"probe agent","diffMode":"lastcommit","terminals":[{"n":1,"active":true,"tty":null}]}' \
  > "$STATE/terminals.json"
cli kill-pane --pane-id "$FOOT" >/dev/null; sleep 0.5
FOOT=$(cli split-pane --bottom --cells 1 --pane-id "$FLEET" -- bash --norc -c \
  "export WEZTERM_UNIX_SOCKET='$T/sock' COCKPIT_DIR='$STATE'; exec node '$REPO/bin/cockpit-strip.mjs' footer")
cli activate-pane --pane-id "$FLEET" >/dev/null; sleep 2
# Half width, and expected: this replacement is split off the fleet pane once the
# bottom row is already a horizontal split. The real one is split FIRST, while the
# fleet pane still fills the window. Only its ROWS matter here.
echo "  split with --cells 1 (half width here; see above):"; geo
echo "  legend: $(cli get-text --pane-id "$FOOT" | head -1 | cut -c1-88)"
cli activate-pane --pane-id "$FOOT" >/dev/null; sleep 0.2
cli adjust-pane-size --amount 8 Up
for i in $(seq 1 12); do
  echo "    t=$((i*100))ms foot_rows=$(foot_rows "$FOOT")"
  python3 -c "import time; time.sleep(0.1)"
done
echo "  settled:"; geo
echo "  legend: $(cli get-text --pane-id "$FOOT" | head -1 | cut -c1-88)"
