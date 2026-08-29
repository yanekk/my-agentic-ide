#!/usr/bin/env bash
# PARKING THE VIEWER. Does a micro with several open tabs survive the cockpit's
# park/restore -- `move-pane-to-new-tab`, then `split-pane --move-pane-id` back --
# with its tabs, its cursor and its read-only flag intact?
#
#   spikes/browse-mode/probe-park.sh          (no arguments; exit 0 == green)
#
# Promoted from plans/browse-mode/probes/park.sh. It is the measurement DESIGN
# §2.6 rests on: browse is a stop in a four-way cycle, so it is passed through
# constantly, and killing micro on the way past would empty the tab bar every
# time -- which is the entire feature. This probe is about ONE pane; that the
# browser+viewer PAIR parks as a unit is probe-pair-slot.sh.
set -uo pipefail
cd "$(dirname "$0")" || exit 2
. ./common.sh

need micro
mux_start browsepark 110 30

R="$T/r"; mkdir -p "$R"
for f in alpha beta gamma; do printf 'const %s = 1;\n' "$f" > "$R/$f.js"; done
seq 1 80 | sed 's/^/delta line /' > "$R/delta.txt"

open_tab() {
  send "$1" "$(printf '\x05')" 0.4; send "$1" "tab $2" 0.3; send "$1" "$(printf '\r')" 0.9
}
bar()    { micro_tabbar "$1"; }
status() { micro_status "$1"; }

FLEET="$ROOT_PANE"
VIEWER=$(cli split-pane --top --percent 42 --cwd "$R" --pane-id "$FLEET" -- micro -readonly true alpha.js)
sleep 2
open_tab "$VIEWER" beta.js
open_tab "$VIEWER" gamma.js
open_tab "$VIEWER" delta.txt
send "$VIEWER" "$(printf '\x05')" 0.4; send "$VIEWER" "goto 55" 0.3; send "$VIEWER" "$(printf '\r')" 0.9

S=$(snapshot)
COCKPIT_TAB=$(p_tab "$S" "$FLEET")
BAR_BEFORE=$(bar "$VIEWER"); ST_BEFORE=$(status "$VIEWER")
GEO_BEFORE="$(p_cols "$S" "$VIEWER")x$(p_rows "$S" "$VIEWER")"
echo "BEFORE parking"
echo "  tabs  : $BAR_BEFORE"
echo "  status: $ST_BEFORE"
show "$S"
has "$ST_BEFORE" "(55," "the cursor is on line 55 before parking"
has "$ST_BEFORE" "ro"   "micro reports the buffer read-only"

# --- park it, exactly as the daemon's parkPane does -------------------------
cli move-pane-to-new-tab --pane-id "$VIEWER" >/dev/null
cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
sleep 1.5
S=$(snapshot)
assert "$([ "$(p_tab "$S" "$VIEWER")" != "$COCKPIT_TAB" ] && echo 0 || echo 1)" \
  "the viewer is parked in a tab of its own, its PTY still alive"
echo "PARKED at $(p_cols "$S" "$VIEWER")x$(p_rows "$S" "$VIEWER") (resized to the full tab)"

# --- bring it back into the slot --------------------------------------------
cli split-pane --top --percent 42 --pane-id "$FLEET" --move-pane-id "$VIEWER" >/dev/null
sleep 1.5
send "$VIEWER" "$(printf '\x1b')" 1.2
S=$(snapshot)
BAR_AFTER=$(bar "$VIEWER"); ST_AFTER=$(status "$VIEWER")
GEO_AFTER="$(p_cols "$S" "$VIEWER")x$(p_rows "$S" "$VIEWER")"
echo "AFTER restore"
echo "  tabs  : $BAR_AFTER"
echo "  status: $ST_AFTER"
show "$S"

eq "$GEO_BEFORE" "$GEO_AFTER" "the pane comes back at identical geometry"
for f in alpha.js beta.js gamma.js delta.txt; do
  has "$BAR_AFTER" "$f" "$f is still a tab after the round trip"
done
has "$ST_AFTER" "(55," "the cursor is still on line 55"
has "$ST_AFTER" "ro"   "the buffer is still read-only"
eq "$(p_tab "$S" "$FLEET")" "$(p_tab "$S" "$VIEWER")" "the viewer is back in the cockpit tab"

finish
