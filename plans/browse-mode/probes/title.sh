set -uo pipefail
T="$(mktemp -d)"
cat > "$T/wezterm.lua" <<LUA
return { initial_cols=100, initial_rows=24,
  unix_domains = { { name='ti', socket_path='$T/sock' } },
  daemon_options = { pid_file='$T/pid', stdout='$T/o', stderr='$T/e' } }
LUA
trap 'kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null; rm -rf "$T"' EXIT
cli(){ wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }
echo 'x' > "$T/f.txt"
wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"
P=$(cli list --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["pane_id"])')
M=$(cli split-pane --pane-id "$P" -- micro -readonly true "$T/f.txt")
for s in 1 2 4 7; do sleep 1
  cli list --format json | python3 -c "
import json,sys
for p in json.load(sys.stdin):
  if p['pane_id']==$M: print('  t=${s}s  title=%r' % p.get('title'))"
done
echo "--- and a shell pane for comparison:"
cli list --format json | python3 -c "
import json,sys
for p in json.load(sys.stdin):
  if p['pane_id']==$P: print('  shell title=%r' % p.get('title'))"
