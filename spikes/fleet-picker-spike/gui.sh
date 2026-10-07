#!/usr/bin/env bash
# fleet-picker T00, the GUI key probe -- for the person, at a real keyboard.
#
#   bash spikes/fleet-picker-spike/gui.sh
#
# Opens a small throwaway WezTerm window with its own config file (gui.lua) in its own
# GUI process, so the cockpit window and ~/.wezterm.lua are never involved. Left pane:
# a stand-in fleet list; right pane: zsh. Blocks until the window is closed, then
# kills anything it started, prints what the ← callback logged, and copies the logs
# next to this script as last-gui-run/ for RESULTS.md.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="$(mktemp -d /tmp/fpg.XXXX)" || exit 2
D="$(cd "$D" && pwd -P)" || exit 2
case "$D" in /private/tmp/fpg.*) ;; *) echo "gui: odd scratch dir $D"; exit 2;; esac

cleanup() {
  pkill -f "$HERE/gui.lua" 2>/dev/null
  pkill -f "$HERE/stand-in.mjs $D" 2>/dev/null
  sleep 0.5
  if pgrep -f "$HERE/gui.lua" >/dev/null; then echo "gui: still running:"; pgrep -fl "$HERE/gui.lua"
  else echo "gui: window process gone (pgrep -f gui.lua finds nothing)"; fi
  rm -rf "/private/tmp/${D#/private/tmp/}"
}
trap cleanup EXIT

echo "Opening the probe window. In the RIGHT pane type: echo hello world"
echo "then press ← a few times, hold ← for a second, type more, press Enter."
echo "In the LEFT pane press ← a few times; then type a few letters and press ← again."
echo "Close the window when done."
FPG_DIR="$D" FPG_STANDIN="$HERE/stand-in.mjs" FPG_NODE="$(command -v node)" \
  wezterm --config-file "$HERE/gui.lua" start --always-new-process >"$D/gui.out" 2>&1

echo
echo "== what the ← callback logged =="
if [ -s "$D/presses.log" ]; then
  awk '{print $2, $3}' "$D/presses.log" | sort | uniq -c
  echo "calls: $(wc -l < "$D/presses.log")   re-entered: $(grep -c REENTERED "$D/presses.log")   errors: $(grep -c ERROR "$D/presses.log")"
  awk '{for(i=1;i<=NF;i++) if($i ~ /^total_ms=/){sub("total_ms=","",$i); print $i}}' "$D/presses.log" | sort -n |
    awk '{a[NR]=$1} END {if (NR) printf "callback total ms: median %.3f  max %.3f  (n=%d)\n", a[int((NR+1)/2)], a[NR], NR}'
else
  echo "no presses logged"
fi
echo "stand-in arrow reads: $(grep -cE '1b (5b|4f) 44' "$D/standin.log" 2>/dev/null || echo 0)" \
     " (encodings: $(grep -oE '1b (5b|4f) 44' "$D/standin.log" 2>/dev/null | sort | uniq -c | tr '\n' ' '))"
echo "picker verbs written: $(grep -c picker "$D/picker" 2>/dev/null || echo 0)"
rm -rf "$HERE/last-gui-run"; mkdir -p "$HERE/last-gui-run"
cp "$D"/presses.log "$D"/standin.log "$D"/picker "$D"/terminals.json "$D"/gui.out "$HERE/last-gui-run/" 2>/dev/null
echo "logs copied to $HERE/last-gui-run/"
