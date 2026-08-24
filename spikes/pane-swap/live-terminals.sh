#!/usr/bin/env bash
# Drive the REAL daemon against a real (headless) wezterm mux to check the
# multiple-terminals feature end to end: the strip renders the list, ALT+t/[/]/w
# gestures (delivered through the command channel) add/switch/close terminals, and
# every terminal survives a switch to another agent and back. The stubbed test
# cannot see any of this -- it has no geometry and no live strip renderer.
#
#   spikes/pane-swap/live-terminals.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

T="$(mktemp -d)"
cat > "$T/wezterm.lua" <<LUA
return {
  initial_cols = 120, initial_rows = 40,
  unix_domains = { { name = 'live', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
}
LUA
cleanup() {
  kill "${DPID:-}" 2>/dev/null
  kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

mkwt() {
  local R="$1"; mkdir -p "$R"
  ( cd "$R"
    git init -q -b main .; git config user.email t@t; git config user.name t
    echo base > f.txt; git add -A; git commit -qm base
    git checkout -qb work; echo changed >> f.txt; echo new > untracked.txt )
}
mkwt "$T/wtA"; mkwt "$T/wtB"

mkdir -p "$T/bin"
cat > "$T/bin/claude" <<CLAUDE
#!/usr/bin/env bash
[ "\$1" = agents ] && cat <<JSON
[{"pid":1,"id":"aaa11111","cwd":"$T/wtA","kind":"background","sessionId":"s1",
  "name":"alpha agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":2,"id":"bbb22222","cwd":"$T/wtB","kind":"background","sessionId":"s2",
  "name":"beta agent","startedAt":0,"status":"idle","state":"done"}]
JSON
CLAUDE
chmod +x "$T/bin/claude"
export PATH="$T/bin:$PATH"

wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"
cli() { wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }

# Build the layout the way bin/cockpit-layout.sh does, strip included.
FLEET=$(cli list --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["pane_id"])')
DIFF=$(cli split-pane --top --percent 55 --pane-id "$FLEET" --cwd "$T" -- bash --norc)
SH=$(cli split-pane --right --percent 50 --pane-id "$FLEET" --cwd "$T" -- bash --norc)
STRIP=$(cli split-pane --right --percent 20 --pane-id "$SH" \
        -- bash -lc "COCKPIT_DIR='$T/state' exec node '$ROOT/bin/cockpit-strip.mjs'")

mkdir -p "$T/state"
printf '{"diff":%s,"fleet":%s,"shell":%s,"strip":%s,"repo":"%s"}\n' \
    "$DIFF" "$FLEET" "$SH" "$STRIP" "$T" > "$T/state/panes.json"
: > "$T/state/fleet.log"; : > "$T/state/cmd"

fleet_shows() {
  if [ "$1" = list ]; then
    cli send-text --pane-id "$FLEET" --no-paste $'clear; echo "❯ describe a task for a new session"\n'
  else
    cli send-text --pane-id "$FLEET" --no-paste "clear; echo \"──────────────── $1 ─\""$'\n'
  fi
  sleep 0.8
}
fleet_shows list

WEZTERM_UNIX_SOCKET="$T/sock" COCKPIT_DIR="$T/state" \
    node "$ROOT/bin/cockpitd.mjs" > "$T/daemon.log" 2>&1 &
DPID=$!
sleep 4      # daemon up AND the strip's node renderer has drawn its first frame

fail=0
want() { if [ "$2" = "$3" ]; then echo "  ok   $1 ($3)"; else echo "  FAIL $1: want $2, got $3"; fail=1; fi; }
gt()   { if [ "$3" -gt "$2" ]; then echo "  ok   $1 ($3 > $2)"; else echo "  FAIL $1: $3 not > $2"; fail=1; fi; }

cols()  { cli list --format json | python3 -c "import json,sys
for p in json.load(sys.stdin):
  if p['pane_id']==$1: print(p['size']['cols'])"; }
tabof() { cli list --format json | python3 -c "import json,sys
for p in json.load(sys.stdin):
  if p['pane_id']==$1: print(p['tab_id'])"; }
alive() { cli list --format json | python3 -c "import json,sys
print('yes' if any(p['pane_id']==$1 for p in json.load(sys.stdin)) else 'no')"; }
vterm() { python3 -c "import json;print(json.load(open('$T/state/panes.json'))['shell'])"; }
nterms(){ python3 -c "import json;print(len(json.load(open('$T/state/terminals.json'))['terminals']))" 2>/dev/null || echo 0; }
cmd()   { printf '%s\n' "$1" >> "$T/state/cmd"; sleep 2.5; }
# Poll: the strip's node renderer can be a beat behind the daemon on a cold start.
strip_has() {
  for _ in $(seq 1 20); do
    cli get-text --pane-id "$STRIP" | grep -qF "$1" && { echo yes; return; }
    sleep 0.5
  done
  echo no
}
FLEET_COLS=$(cols "$FLEET")

echo "== baseline: strip sits on the right edge, narrow, and renders =="
want "strip is a live pane"        "yes" "$(alive "$STRIP")"
gt   "fleet is the wide left pane" 40   "$(cols "$FLEET")"
want "strip is narrower than the shell" "yes" \
     "$([ "$(cols "$STRIP")" -lt "$(cols "$SH")" ] && echo yes || echo no)"
want "strip shows its heading"     "yes" "$(strip_has TERMINALS)"

echo
echo "== enter alpha: one terminal in the slot, strip intact =="
fleet_shows "alpha agent"; sleep 5
TA1=$(vterm)
want "alpha's terminal is a new pane" "yes" "$([ "$TA1" != "$SH" ] && echo yes || echo no)"
want "strip still alive on the edge"  "yes" "$(alive "$STRIP")"
want "strip still in the cockpit tab" "$(tabof "$FLEET")" "$(tabof "$STRIP")"
want "the terminal list shows 1"      "1" "$(nterms)"
gt   "the active terminal has width"  0   "$(cols "$TA1")"

echo
echo "== ALT+t: a second terminal, shown, strip still present =="
cmd new
TA2=$(vterm)
want "a different pane is now shown"  "yes" "$([ "$TA2" != "$TA1" ] && echo yes || echo no)"
want "the first terminal is parked, not killed" "yes" "$(alive "$TA1")"
want "first terminal left the cockpit tab"       "yes" \
     "$([ "$(tabof "$TA1")" != "$(tabof "$FLEET")" ] && echo yes || echo no)"
want "the list now shows 2"           "2" "$(nterms)"
want "strip survived the split"       "yes" "$(alive "$STRIP")"
gt   "second terminal has width"      0   "$(cols "$TA2")"

echo
echo "== ALT+[ then ALT+]: cycle back to #1 and forward to #2 =="
cmd prev
want "cycled back to terminal 1"      "$TA1" "$(vterm)"
want "terminal 2 parked but alive"    "yes"  "$(alive "$TA2")"
cmd next
want "cycled forward to terminal 2"   "$TA2" "$(vterm)"

echo
echo "== switch to beta: BOTH alpha terminals park, beta gets its own =="
fleet_shows "beta agent"; sleep 5
TB=$(vterm)
want "beta's terminal differs from alpha's" "yes" \
     "$([ "$TB" != "$TA1" ] && [ "$TB" != "$TA2" ] && echo yes || echo no)"
want "alpha terminal 1 still alive parked" "yes" "$(alive "$TA1")"
want "alpha terminal 2 still alive parked" "yes" "$(alive "$TA2")"
want "beta's list shows 1"            "1" "$(nterms)"

echo
echo "== back to alpha: its CURRENT terminal (#2) returns, #1 still parked =="
fleet_shows "alpha agent"; sleep 5
want "the same current terminal came back" "$TA2" "$(vterm)"
want "terminal 1 survived the round trip"  "yes" "$(alive "$TA1")"
want "alpha's list shows 2 again"     "2" "$(nterms)"

echo
echo "== ALT+w: close the current terminal, drop back to one =="
cmd close
want "back down to a single terminal" "1" "$(nterms)"
want "the shown terminal is the survivor (#1)" "$TA1" "$(vterm)"
want "the closed pane is really gone" "no" "$(alive "$TA2")"
want "refuses to close the last one"  "refusing" \
     "$(cmd close; grep -q 'refusing to close the last terminal' "$T/daemon.log" && echo refusing || echo closed)"

echo
if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; sed -n '1,80p' "$T/daemon.log"; fi
exit $fail
