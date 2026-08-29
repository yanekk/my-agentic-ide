#!/usr/bin/env bash
# END TO END: broot in one pane, micro in another. Pressing Enter in broot
# pushes the selected file into the running micro as a new tab.
set -uo pipefail
T="$(mktemp -d)"
cat > "$T/wezterm.lua" <<LUA
return {
  initial_cols = 110, initial_rows = 26,
  unix_domains = { { name = 'e2e', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
}
LUA
cleanup(){ kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
cli(){ wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }
send(){ cli send-text --pane-id "$1" --no-paste "$2"; sleep "${3:-0.9}"; }

R="$T/r"; mkdir -p "$R/lib"
printf 'const alpha = 1;\n'                    > "$R/alpha.js"
printf 'const beta = 2;\nlet marker = "HIT";\n'> "$R/beta.js"
printf 'export const gamma = 3;\n'             > "$R/lib/gamma.js"

# the glue script broot will call -- reads the viewer pane id from a file,
# because a wezterm split inherits none of the launcher's environment.
cat > "$T/openit" <<EOF
#!/usr/bin/env bash
export WEZTERM_UNIX_SOCKET="$T/sock"
W(){ wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "\$@"; }
VIEW="\$(cat "$T/viewer")"
FILE="\$(python3 -c 'import os,sys;print(os.path.relpath(sys.argv[1],sys.argv[2]))' "\$1" "$(echo)$R")"
LINE="\${2:-}"
W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\x05')"; sleep 0.3
W send-text --pane-id "\$VIEW" --no-paste "tab \$FILE";        sleep 0.3
W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\r')";   sleep 0.6
if [ -n "\$LINE" ] && [ "\$LINE" != "0" ]; then
  W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\x05')"; sleep 0.3
  W send-text --pane-id "\$VIEW" --no-paste "goto \$LINE";       sleep 0.3
  W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\r')";   sleep 0.4
fi
EOF
chmod +x "$T/openit"

cat > "$T/broot.hjson" <<EOF
{
    verbs: [
        {
            key: enter
            apply_to: text_file
            external: "$T/openit {file:path-from-directory} {line}"
            leave_broot: false
        }
    ]
}
EOF

wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"
BROOT=$(cli list --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["pane_id"])')
VIEW=$(cli split-pane --right --percent 60 --cwd "$R" --pane-id "$BROOT" -- micro -readonly true alpha.js)
echo "$VIEW" > "$T/viewer"
sleep 2
cli activate-pane --pane-id "$BROOT"; sleep 0.4
send "$BROOT" "broot --conf $T/broot.hjson $R"$'\r' 2.5

echo "viewer at start:"; cli get-text --pane-id "$VIEW" | head -1
echo
echo ">>> in broot: filter to beta.js, press Enter"
send "$BROOT" "beta" 1.2
send "$BROOT" "$(printf '\r')" 3.0
echo "viewer tab bar:"; cli get-text --pane-id "$VIEW" | head -1

echo
echo ">>> in broot: clear, content-search for HIT, press Enter (should land on the line)"
send "$BROOT" "$(printf '\x1b')" 0.6
send "$BROOT" "c/HIT" 1.5
send "$BROOT" "$(printf '\r')" 3.0
echo "viewer tab bar:"; cli get-text --pane-id "$VIEW" | head -1
echo "viewer status :"; cli get-text --pane-id "$VIEW" | grep -av '^ *$' | tail -1

echo
echo ">>> in broot: open the nested lib/gamma.js"
send "$BROOT" "$(printf '\x1b')" 0.6
send "$BROOT" "gamma" 1.5
send "$BROOT" "$(printf '\r')" 3.0
echo "viewer tab bar:"; cli get-text --pane-id "$VIEW" | head -1

echo
echo "which pane is focused at the end?"
cli list --format json | python3 -c '
import json,sys
for p in json.load(sys.stdin): print("  pane",p["pane_id"],"ACTIVE" if p.get("is_active") else "")'
echo "broot still alive in its pane?"; cli get-text --pane-id "$BROOT" | tail -2
