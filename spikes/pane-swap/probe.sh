#!/usr/bin/env bash
# Settle how a FULL-WIDTH pane can be swapped without losing its geometry, and
# what revdiff does when it is parked, restored, and typed into.
#
#   spikes/pane-swap/probe.sh
#
# Runs against a headless `wezterm-mux-server` with its own socket and pid file,
# so no cockpit window is disturbed. Findings are written up in RESULTS.md.
set -uo pipefail

command -v wezterm-mux-server >/dev/null || { echo "wezterm-mux-server not on PATH"; exit 1; }
command -v revdiff >/dev/null || { echo "revdiff not on PATH"; exit 1; }

T="$(mktemp -d)"
cat > "$T/wezterm.lua" <<LUA
return {
  initial_cols = 120, initial_rows = 40,
  unix_domains = { { name = 'paneswap', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
}
LUA
cleanup() { kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

cli() { wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }
key() { cli send-text --pane-id "$1" --no-paste "$2"; sleep "${3:-0.5}"; }
geo() { cli list --format json | python3 -c '
import json, sys
for p in sorted(json.load(sys.stdin), key=lambda x: (x["tab_id"], x["pane_id"])):
    print("    pane %-3s tab %-3s %sx%-3s title=%s"
          % (p["pane_id"], p["tab_id"], p["size"]["cols"], p["size"]["rows"], p.get("title")))'; }
footer() { cli get-text --pane-id "$1" | grep -aE '\| L:|\[enter\] save|Annotations will|Reload canceled' | tail -2; }

# --- a worktree with a diff worth parsing ----------------------------------
mkrepo() {
  local R="$1"; mkdir -p "$R"
  ( cd "$R"
    git init -q .; git config user.email t@t; git config user.name t
    for i in 1 2 3 4; do
      python3 -c "print('\n'.join('f$i line %d' % n for n in range(1, 60)))" > "f$i.txt"
    done
    git add -A; git commit -qm base
    for i in 1 2 3 4; do
      python3 -c "print('\n'.join(('F$i CHANGED %d' % n if n%7==0 else 'f$i line %d' % n) for n in range(1, 60)))" > "f$i.txt"
    done
    echo new > untracked.txt
    git rev-parse HEAD )
}
BASE_A=$(mkrepo "$T/wtA")
BASE_B=$(mkrepo "$T/wtB")

wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize; sleep 1
export WEZTERM_UNIX_SOCKET="$T/sock"

FLEET=$(cli list --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["pane_id"])')
DIFF=$(cli split-pane --top --percent 55 --pane-id "$FLEET" -- bash --norc)
SH=$(cli split-pane --right --percent 50 --pane-id "$FLEET" -- bash --norc)
echo "cockpit layout: fleet=$FLEET diff=$DIFF shell=$SH"
geo

echo
echo "### 1. the WRONG order: park the full-width pane, then re-split from the fleet pane"
cli move-pane-to-new-tab --pane-id "$DIFF" >/dev/null; sleep 0.6
echo "  slot empty -- the bottom row expanded to the whole window:"; geo
WRONG=$(cli split-pane --top --percent 55 --pane-id "$FLEET" -- bash --norc); sleep 0.6
echo "  rebuilt pane $WRONG -- HALF WIDTH, because it split the fleet pane's own region:"; geo
cli kill-pane --pane-id "$WRONG" >/dev/null; sleep 0.5

echo
echo "### 2. rebuilding an empty slot full width: park the terminal first"
cli move-pane-to-new-tab --pane-id "$SH" >/dev/null; sleep 0.6
echo "  fleet pane alone in the tab:"; geo
RIGHT=$(cli split-pane --top --percent 55 --pane-id "$FLEET" -- bash --norc); sleep 0.6
echo "  new top pane $RIGHT spans the window:"; geo
cli split-pane --right --percent 50 --pane-id "$FLEET" --move-pane-id "$SH" >/dev/null; sleep 0.8
echo "  terminal moved back:"; geo
cli split-pane --top --percent 50 --pane-id "$RIGHT" --move-pane-id "$DIFF" >/dev/null; sleep 0.6
cli kill-pane --pane-id "$RIGHT" >/dev/null; sleep 0.6
echo "  original diff pane restored into the slot:"; geo

echo
echo "### 3. revdiff up on agent A, with an annotation left UNFLUSHED"
key "$DIFF" "cd $T/wtA && revdiff --untracked --line-numbers -o $T/revA.md $BASE_A"$'\n' 3
echo "  pane title while revdiff runs (this is how the daemon knows):"; geo | grep " $DIFF "
key "$DIFF" 'jj' 0.6; key "$DIFF" $'\r' 0.8      # select the 3rd file
key "$DIFF" 'l' 0.4; key "$DIFF" 'jjjjjjjjjj' 0.8
key "$DIFF" 'a' 0.6; key "$DIFF" 'comment on A' 0.3
echo "  annotation editor open:"; footer "$DIFF"
echo "  --- R while the editor is open is typed INTO the comment: ---"
key "$DIFF" 'R' 0.8
cli get-text --pane-id "$DIFF" | grep -a '💬' | head -1
key "$DIFF" $'\x08\r' 0.8                        # backspace the stray R, then save

echo
echo "### 4. R with a SAVED annotation: revdiff asks first, and a second R cancels"
key "$DIFF" 'R' 1.2; footer "$DIFF"
key "$DIFF" 'R' 1.2; footer "$DIFF"
echo "  annotation still there?"; cli get-text --pane-id "$DIFF" | grep -a '💬' | head -1

echo
echo "### 5. the RIGHT order: split the incoming pane INTO the slot, then park the outgoing one"
DIFFB=$(cli split-pane --top --percent 50 --pane-id "$DIFF" --cwd "$T/wtB" -- bash --norc)
key "$DIFFB" "revdiff --untracked -o $T/revB.md $BASE_B"$'\n' 0.2
cli move-pane-to-new-tab --pane-id "$DIFF" >/dev/null
cli activate-tab --pane-id "$FLEET" >/dev/null 2>&1
sleep 3
echo "  agent B visible, full width; A parked in a tab of its own:"; geo

echo
echo "### 6. switch back to A: does it come back intact, at full size?"
BACK=$(cli split-pane --top --percent 50 --pane-id "$DIFFB" --move-pane-id "$DIFF")
echo "  split-pane --move-pane-id returned $BACK (expected the MOVED pane, $DIFF)"
cli move-pane-to-new-tab --pane-id "$DIFFB" >/dev/null
cli activate-tab --pane-id "$FLEET" >/dev/null 2>&1
sleep 1.5
geo
echo "  A's footer (file, line and annotation count survive?):"; footer "$DIFF"
echo "  flushing the restored pane with O:"
key "$DIFF" 'O' 1.2
echo "  --- review file written by the RESTORED pane: ---"
sed -e 's/^/    /' "$T/revA.md" 2>/dev/null | head -6
