#!/usr/bin/env bash
# fleet-picker T00, the headless half: the numbers DESIGN 2.2, 2.9 and 3.4 depend on.
#
#   bash spikes/fleet-picker-spike/probe.sh          # ~2 minutes; results in RESULTS.md
#   PROBE_FAIL=1 bash spikes/fleet-picker-spike/probe.sh   # fails after bring-up: proves teardown
#
# Two private wezterm-mux-servers, one per fleet-slot size (59x22 and 39x12), each with
# its own config, socket and pid file, so the live cockpit is never touched. In them:
# real `claude agents` (the person's own HOME, since it needs their login -- typed into
# but never sent \r or \n, so nothing is dispatched), real pir with a scratch PIR_HOME,
# and pir again in front of a pretend run from pir's own conversation rig. probe.mjs
# does the measuring; stub-daemon.mjs and stub-picker.mjs stand in for T03's swap.
#
# Teardown on every exit (trap EXIT): the rig, both muxes by pid file and config path,
# and a check that none of them is left, which fails the run if one is.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RIG=~/.claude/pir-engine/src/shell/conversation-rig.mjs
for t in wezterm wezterm-mux-server node claude pir; do
  command -v "$t" >/dev/null || { echo "probe: $t not on PATH"; exit 2; }
done

T="$(mktemp -d /tmp/fpp.XXXX)" || exit 2
T="$(cd "$T" && pwd -P)" || exit 2
case "$T" in /private/tmp/fpp.*) ;; *) echo "probe: odd scratch dir $T"; exit 2;; esac
MAIN="$(cd "$(git -C "$HERE" rev-parse --git-common-dir)/.." && pwd -P)"
SERVICE=~/.claude/pir-engine/src/shell/api-service.mjs
RIGPID=""; BACKPIDS=""
SIZES=(59x22 39x12)
teardown() {
  local rc=$? left=0 s i
  if [ -n "$RIGPID" ]; then
    kill -TERM "$RIGPID" 2>/dev/null
    for i in $(seq 1 40); do kill -0 "$RIGPID" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$RIGPID" 2>/dev/null && { echo "teardown: rig still running"; left=1; }
  fi
  for i in $BACKPIDS; do kill -TERM "$i" 2>/dev/null; done
  for s in "${SIZES[@]}"; do
    kill "$(cat "$T/pid-$s" 2>/dev/null)" 2>/dev/null
    pkill -f "$T/wezterm-$s.lua" 2>/dev/null
  done
  pkill -f "stub-daemon.mjs.*$T" 2>/dev/null
  for i in $(seq 1 20); do pgrep -f "$T/" >/dev/null || break; sleep 0.25; done
  if pgrep -f "$T/" >/dev/null; then
    echo "teardown: still running:"; pgrep -fl "$T/"; left=1
  else
    echo "teardown: muxes, rig and stubs gone (pgrep -f $T/ finds nothing)"
  fi
  if [ -n "${PROBE_KEEP:-}" ]; then echo "kept $T"; else rm -rf "/private/tmp/${T#/private/tmp/}"; fi
  [ "$left" = 0 ] || exit 1
  exit "$rc"
}
trap teardown EXIT
trap 'exit 130' INT TERM

for s in "${SIZES[@]}"; do
  cols=${s%x*}; rows=${s#*x}
  cat > "$T/wezterm-$s.lua" <<LUA
return {
  initial_cols = $cols, initial_rows = $rows,
  unix_domains = { { name = 'fpp$s', socket_path = '$T/sock-$s' } },
  daemon_options = { pid_file = '$T/pid-$s', stdout = '$T/out-$s', stderr = '$T/err-$s' },
  default_prog = { '/bin/bash', '--norc', '-c', 'exec cat >/dev/null' },
  default_cwd = '$T',
}
LUA
  # env -i: nothing from this Claude session (CLAUDECODE, its socket, a stale
  # WEZTERM_UNIX_SOCKET) reaches the programs under test.
  env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" TERM=xterm-256color SHELL=/bin/zsh \
      LANG=en_US.UTF-8 TMPDIR="$T/" PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
      WEZTERM_UNIX_SOCKET="$T/sock-$s" \
      wezterm-mux-server --config-file "$T/wezterm-$s.lua" --daemonize
done
for s in "${SIZES[@]}"; do
  for i in $(seq 1 40); do [ -S "$T/sock-$s" ] && break; sleep 0.25; done
  [ -S "$T/sock-$s" ] || { echo "probe: mux $s never came up"; exit 1; }
done
echo "probe: muxes up in $T"
[ -z "${PROBE_FAIL:-}" ] || { echo "probe: PROBE_FAIL set, failing on purpose"; exit 1; }

# A pir screen needs a backend on its home; on a scratch home nothing runs one, so start
# pir's own service there, as its conversation rig's scratchBackend() does.
backend() {
  ( cd "$(dirname "$SERVICE")" && PIR_HOME="$1" exec node --input-type=module \
      -e "import('file://$SERVICE').then((m) => m.main({ lan: false }))" ) > "$1.backend.log" 2>&1 &
  BACKPIDS="$BACKPIDS $!"
  for i in $(seq 1 80); do [ -s "$1/.pir/api.json" ] && return 0; sleep 0.25; done
  echo "probe: no backend on $1:"; tail -3 "$1.backend.log"
}
PIRHOME="$T/pirhome"; mkdir -p "$PIRHOME"; backend "$PIRHOME"

# pir's conversation rig: a pretend run, listed `running` by a pir pointed at its PIR_HOME.
RIGHOME="$T/righome"; mkdir -p "$RIGHOME"; backend "$RIGHOME"
PIR_HOME="$RIGHOME" node "$RIG" --into "$T/rigrepo" > "$T/rig.log" 2>&1 &
RIGPID=$!
for i in $(seq 1 60); do grep -q "rig running" "$T/rig.log" && break; sleep 0.25; done
if grep -q "rig running" "$T/rig.log"; then echo "probe: rig up"; else
  echo "probe: rig did not start, measuring without it:"; tail -5 "$T/rig.log"; RIGHOME=""; fi

# claude agents runs in the main checkout: anywhere untrusted it opens on a trust prompt.
node "$HERE/probe.mjs" "$T" "$T/wezterm-59x22.lua" "$T/wezterm-39x12.lua" "$MAIN" "$PIRHOME" "$RIGHOME"
rc=$?
[ -f "$T/results.json" ] && cp "$T/results.json" "$HERE/results.json"
exit "$rc"
