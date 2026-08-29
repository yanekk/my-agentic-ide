#!/usr/bin/env bash
# THE PUSH. Can a running micro be made to open a file as a new tab by sending
# it keystrokes from outside, without taking focus off the pane you are in?
#
#   spikes/browse-mode/probe-push.sh          (no arguments; exit 0 == green)
#
# Promoted from plans/browse-mode/probes/micro-push2.sh, which produced the
# numbers in DESIGN §2.4 (the keystroke table) and §2.5 (already-open files).
# Kept faithful to what it measured; assertions, the live-cockpit seatbelt and
# guaranteed cleanup are what T00 added.
#
# The two traps it fell into first, both worth re-reading before editing it:
#   * submitting with `\n` sends NOTHING. It must be `\r`. It fails silently.
#   * `timeout(1)` does not exist on this machine.
set -uo pipefail
cd "$(dirname "$0")" || exit 2
. ./common.sh

need micro
mux_start browsepush 100 24

R="$T/r"; mkdir -p "$R"
printf 'const alpha = 1;\n' > "$R/alpha.js"
printf 'const beta = 2;\n'  > "$R/beta.js"
printf '# gamma\n'          > "$R/gamma.md"
seq 1 60 | sed 's/^/delta line /' > "$R/delta.txt"

# open_tab <pane> <relpath> [line] -- exactly what broot's Enter verb will run
open_tab() {
  send "$1" "$(printf '\x05')" 0.5          # ctrl-E: micro's command bar
  send "$1" "tab $2" 0.4
  send "$1" "$(printf '\r')" 1.0            # \r submits; \n does nothing
  if [ -n "${3:-}" ]; then
    send "$1" "$(printf '\x05')" 0.4
    send "$1" "goto $3" 0.3
    send "$1" "$(printf '\r')" 0.8
  fi
}
bar()    { micro_tabbar "$1"; }
status() { micro_status "$1"; }

BROWSER="$ROOT_PANE"
VIEWER=$(cli split-pane --right --percent 65 --cwd "$R" --pane-id "$BROWSER" -- micro alpha.js)
sleep 2.5
cli activate-pane --pane-id "$BROWSER" >/dev/null; sleep 0.5   # the viewer is NOT focused

echo "start (one file, micro hides the tab bar): $(bar "$VIEWER")"

open_tab "$VIEWER" beta.js
B1=$(bar "$VIEWER"); echo "after beta.js  : $B1"
has "$B1" "alpha.js" "the first file is still a tab"
has "$B1" "beta.js"  "beta.js was pushed in as a second tab"

open_tab "$VIEWER" gamma.md
B2=$(bar "$VIEWER"); echo "after gamma.md : $B2"
has "$B2" "gamma.md" "tabs accumulate -- gamma.md is a third"

open_tab "$VIEWER" delta.txt 42
B3=$(bar "$VIEWER"); ST=$(status "$VIEWER")
echo "after delta+42 : $B3"
echo "  status       : $ST"
has "$B3" "delta.txt" "delta.txt is a fourth tab"
has "$ST" "(42,"      "goto jumped the cursor to the requested line"

# DESIGN §2.5: micro cannot be asked what it has open, and re-pushing an open
# file opens a SECOND copy. This is the measurement that makes the glue keep its
# own ordered tab list and use `tabswitch <n>` instead.
open_tab "$VIEWER" beta.js
B4=$(bar "$VIEWER"); echo "re-open beta   : $B4"
DUPES=$(printf '%s\n' "$B4" | grep -o 'beta.js' | wc -l | tr -d ' ')
eq 2 "$DUPES" "re-pushing an open file makes a DUPLICATE tab, so the glue must remember"

S=$(snapshot)
show "$S"
eq 1 "$(p_active "$S" "$BROWSER")" "the push never stole focus from the browser pane"
eq 0 "$(p_active "$S" "$VIEWER")"  "...and the viewer never took it"

finish
