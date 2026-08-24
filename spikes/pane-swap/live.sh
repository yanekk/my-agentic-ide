#!/usr/bin/env bash
# Drive the REAL daemon against a real (headless) wezterm mux and check the
# geometry the stubbed integration test cannot see: that both slots come back at
# full size on every switch, and that returning to an agent retypes nothing.
#
#   spikes/pane-swap/live.sh
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

# --- two agent worktrees ---------------------------------------------------
mkwt() {
  local R="$1" tag="$2"; mkdir -p "$R"
  ( cd "$R"
    git init -q -b main .; git config user.email t@t; git config user.name t
    for i in 1 2 3; do
      python3 -c "print('\n'.join('$tag line %d' % n for n in range(1, 40)))" > "f$i.txt"
    done
    git add -A; git commit -qm base
    git checkout -qb work
    for i in 1 2 3; do
      python3 -c "print('\n'.join(('$tag CHANGED %d' % n if n%6==0 else '$tag line %d' % n) for n in range(1, 40)))" > "f$i.txt"
    done
    echo new > untracked.txt )
}
mkwt "$T/wtA" ALPHA
mkwt "$T/wtB" BETA

# --- a `claude` that reports them -----------------------------------------
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

# --- the cockpit layout, built the way the layout script builds it ---------
wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"
cli() { wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }

FLEET=$(cli list --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["pane_id"])')
DIFF=$(cli split-pane --top --percent 55 --pane-id "$FLEET" --cwd "$T" -- bash --norc)
SH=$(cli split-pane --right --percent 50 --pane-id "$FLEET" --cwd "$T" -- bash --norc)

mkdir -p "$T/state"
printf '{"diff":%s,"fleet":%s,"shell":%s,"repo":"%s"}\n' "$DIFF" "$FLEET" "$SH" "$T" \
    > "$T/state/panes.json"
: > "$T/state/fleet.log"

# The daemon reads the ATTACHED AGENT'S NAME out of the fleet pane, so a plain
# shell printing the header it would render is a faithful stand-in.
fleet_shows() {
  if [ "$1" = list ]; then
    cli send-text --pane-id "$FLEET" --no-paste $'clear; echo "❯ describe a task for a new session"\n'
  else
    cli send-text --pane-id "$FLEET" --no-paste "clear; echo \"──────────────── $1 ─\""$'\n'
  fi
  sleep 0.6
}
fleet_shows list

WEZTERM_UNIX_SOCKET="$T/sock" COCKPIT_DIR="$T/state" \
    node "$ROOT/bin/cockpitd.mjs" > "$T/daemon.log" 2>&1 &
DPID=$!
sleep 2

fail=0
slot() {  # slot <pane-id> -> "<cols>x<rows>"
  cli list --format json | python3 -c "import json,sys
for p in json.load(sys.stdin):
    if p['pane_id'] == $1: print('%sx%s' % (p['size']['cols'], p['size']['rows']))"
}
visible_diff() { python3 -c "import json; print(json.load(open('$T/state/panes.json'))['diff'])"; }
visible_term() { python3 -c "import json; print(json.load(open('$T/state/panes.json'))['shell'])"; }
want() {  # want <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  ok   $1 ($3)"; else echo "  FAIL $1: want $2, got $3"; fail=1; fi
}
running() {  # running <pane-id>: is revdiff drawing in it?
  cli get-text --pane-id "$1" | grep -ac '^│' || true
}
alive() {    # alive <pane-id>: is the pane still in the mux at all?
  cli list --format json | python3 -c "import json,sys
print('yes' if any(p['pane_id'] == $1 for p in json.load(sys.stdin)) else 'no')"
}

echo "== baseline: the layout the script builds =="
want "diff pane spans the window" 120x22 "$(slot "$DIFF")"

echo
echo "== enter alpha: its own diff pane, full width, revdiff drawing =="
fleet_shows "alpha agent"; sleep 6
DA=$(visible_diff); TA=$(visible_term)
want "alpha's diff pane is a NEW pane" "yes" "$([ "$DA" != "$DIFF" ] && echo yes || echo no)"
want "and it spans the window"    120x22 "$(slot "$DA")"
want "revdiff is drawing in it"   "yes" "$([ "$(running "$DA")" -gt 5 ] && echo yes || echo no)"
want "the repo diff pane is parked, not killed" "yes" "$(alive "$DIFF")"

echo
echo "== switch to beta =="
fleet_shows "beta agent"; sleep 6
DB=$(visible_diff)
want "beta got its own diff pane"  "yes" "$([ "$DB" != "$DA" ] && echo yes || echo no)"
want "still spanning the window"  120x22 "$(slot "$DB")"
want "revdiff drawing for beta"    "yes" "$([ "$(running "$DB")" -gt 5 ] && echo yes || echo no)"
want "alpha's revdiff still alive while parked" "yes" \
     "$([ "$(running "$DA")" -gt 5 ] && echo yes || echo no)"

echo
echo "== switch BACK to alpha: same pane, full size, nothing retyped =="
grep -c 'revdiff --untracked' "$T/daemon.log" >/dev/null 2>&1 || true
BEFORE=$(grep -c 'opened diff pane' "$T/daemon.log")
fleet_shows "alpha agent"; sleep 6
want "the SAME pane came back"     "$DA" "$(visible_diff)"
want "at full width"              120x22 "$(slot "$DA")"
want "no new diff pane was opened" "$BEFORE" "$(grep -c 'opened diff pane' "$T/daemon.log")"
want "daemon logged a restore"     "yes" \
     "$(grep -q "restored diff pane $DA" "$T/daemon.log" && echo yes || echo no)"
want "beta's revdiff survives parking" "yes" \
     "$([ "$(running "$DB")" -gt 5 ] && echo yes || echo no)"

echo
echo "== back to the fleet list: the repo panes return =="
fleet_shows list; sleep 5
want "repo diff pane back in the slot" "$DIFF" "$(visible_diff)"
want "at full width"                  120x22 "$(slot "$DIFF")"
want "repo shell back in the slot"     "$SH" "$(visible_term)"
want "both agents' diffs still alive"  "yes" \
     "$([ "$(running "$DA")" -gt 5 ] && [ "$(running "$DB")" -gt 5 ] && echo yes || echo no)"

echo
if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; sed -n '1,60p' "$T/daemon.log"; fi
exit $fail
