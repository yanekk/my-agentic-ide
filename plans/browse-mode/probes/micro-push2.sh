#!/usr/bin/env bash
set -uo pipefail
T="$(mktemp -d)"
cat > "$T/wezterm.lua" <<LUA
return {
  initial_cols = 100, initial_rows = 24,
  unix_domains = { { name = 'mp2', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
}
LUA
cleanup(){ kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
cli(){ wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }
send(){ cli send-text --pane-id "$1" --no-paste "$2"; sleep "${3:-0.9}"; }
# open <pane> <relpath> [line] -- exactly what broot's Enter verb would run
open_tab(){ send "$1" "$(printf '\x05')" 0.5; send "$1" "tab $2" 0.4; send "$1" "$(printf '\r')" 1.0
  if [ -n "${3:-}" ]; then send "$1" "$(printf '\x05')" 0.4; send "$1" "goto $3" 0.3; send "$1" "$(printf '\r')" 0.8; fi; }
bar(){ cli get-text --pane-id "$1" | head -1; }
stat_line(){ cli get-text --pane-id "$1" | grep -a 'ft:' | tail -1; }

R="$T/r"; mkdir -p "$R"
printf 'const alpha = 1;\n' > "$R/alpha.js"
printf 'const beta = 2;\n'  > "$R/beta.js"
printf '# gamma\n'          > "$R/gamma.md"
for i in $(seq 1 60); do echo "delta line $i"; done > "$R/delta.txt"

wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"
BROOT=$(cli list --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["pane_id"])')
VIEW=$(cli split-pane --right --percent 65 --cwd "$R" --pane-id "$BROOT" -- micro alpha.js)
sleep 2.5
cli activate-pane --pane-id "$BROOT" 2>/dev/null; sleep 0.5   # viewer is NOT focused

echo "start (1 file, tab bar hidden):"; bar "$VIEW"
open_tab "$VIEW" beta.js
echo "after beta.js  :"; bar "$VIEW"
open_tab "$VIEW" gamma.md
echo "after gamma.md :"; bar "$VIEW"
open_tab "$VIEW" delta.txt 42
echo "after delta+42 :"; bar "$VIEW"
echo "  status       :"; stat_line "$VIEW"
open_tab "$VIEW" beta.js
echo "re-open beta   :"; bar "$VIEW"
echo
echo "does the BROWSER pane still have focus (i.e. we never stole it)?"
cli list --format json | python3 -c '
import json,sys
for p in json.load(sys.stdin): print("  pane",p["pane_id"],"active" if p.get("is_active") else "")'
