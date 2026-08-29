#!/usr/bin/env bash
# Does a micro with several open tabs survive the cockpit's park/restore
# (move-pane-to-new-tab, then split back) with tabs and cursor intact?
set -uo pipefail
T="$(mktemp -d)"
cat > "$T/wezterm.lua" <<LUA
return {
  initial_cols = 110, initial_rows = 30,
  unix_domains = { { name = 'park', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
}
LUA
cleanup(){ kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
cli(){ wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }
send(){ cli send-text --pane-id "$1" --no-paste "$2"; sleep "${3:-0.8}"; }
opentab(){ send "$1" "$(printf '\x05')" 0.4; send "$1" "tab $2" 0.3; send "$1" "$(printf '\r')" 0.9; }
bar(){ cli get-text --pane-id "$1" | head -1; }
status(){ cli get-text --pane-id "$1" | grep -a 'ft:' | tail -1; }

R="$T/r"; mkdir -p "$R"
for f in alpha beta gamma; do printf 'const %s = 1;\n' "$f" > "$R/$f.js"; done
for i in $(seq 1 80); do echo "delta line $i"; done > "$R/delta.txt"

wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"
FLEET=$(cli list --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["pane_id"])')
VIEW=$(cli split-pane --top --percent 42 --cwd "$R" --pane-id "$FLEET" -- micro -readonly true alpha.js)
sleep 2
opentab "$VIEW" beta.js; opentab "$VIEW" gamma.js; opentab "$VIEW" delta.txt
send "$VIEW" "$(printf '\x05')" 0.4; send "$VIEW" "goto 55" 0.3; send "$VIEW" "$(printf '\r')" 0.9

echo "BEFORE parking"
echo "  tabs  : $(bar "$VIEW")"
echo "  status: $(status "$VIEW")"
echo "  geometry:"; cli list --format json | python3 -c '
import json,sys
for p in json.load(sys.stdin): print("    pane %s tab %s %sx%s" % (p["pane_id"],p["tab_id"],p["size"]["cols"],p["size"]["rows"]))'

# --- park it, exactly as the daemon does -----------------------------------
cli move-pane-to-new-tab --pane-id "$VIEW" >/dev/null; sleep 1.5
echo
echo "PARKED (moved to its own tab, resized to full window)"
echo "  tabs  : $(bar "$VIEW")"

# --- bring it back into the slot -------------------------------------------
cli split-pane --top --percent 42 --pane-id "$FLEET" --move-pane-id "$VIEW" >/dev/null; sleep 1.5
send "$VIEW" "$(printf '\x1b')" 1.2
echo
echo "AFTER restore (viewport, last 13 rows):"
cli get-text --pane-id "$VIEW" | tail -13 | sed 's/^/    /' 
echo "  status: $(status "$VIEW")"
echo "  geometry:"; cli list --format json | python3 -c '
import json,sys
for p in json.load(sys.stdin): print("    pane %s tab %s %sx%s" % (p["pane_id"],p["tab_id"],p["size"]["cols"],p["size"]["rows"]))'
