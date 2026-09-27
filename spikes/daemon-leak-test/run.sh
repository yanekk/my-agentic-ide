#!/usr/bin/env bash
# Proves spikes/lib/test-daemons.sh -- daemon_stop, daemon_pids, daemon_sweep,
# daemon_tripwire -- against FAKE daemons: a node script at $T/bin/cockpitd.mjs,
# so the name matches without running the real thing. plans/test-daemon-leaks.
#
#   bash spikes/daemon-leak-test/run.sh
#
# Prints `ALL PASS (N checks)` or `FAILURES`, exits non-zero on failure.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LIB="$ROOT/spikes/lib/test-daemons.sh"
. "$LIB"

T="$(mktemp -d)"
# A second scratch folder: the stand-in for the real cockpit and for another
# run, whose daemons nothing aimed at $T may ever touch.
T2="$(mktemp -d)"
cleanup() {
  daemon_sweep "$T"
  daemon_sweep "$T2"
  rm -rf "$T" "$T2"
}
trap cleanup EXIT

pass=0; fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=1; echo "FAIL $1"; }
is()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }

alive() { local st; st=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$st" ] && [[ $st != Z* ]]; }
yn() { if alive "$1"; then echo yes; else echo no; fi; }

# Wait until <T> holds <n> daemons; a fake is only findable once node has
# exec'd, which lags the `&` by a few ms.
wait_count() {
  local i
  for ((i = 0; i < 50; i++)); do
    [ "$(daemon_pids "$1" | grep -c .)" = "$2" ] && return 0
    sleep 0.1
  done
  return 1
}

mkdir -p "$T/bin" "$T2/bin"
cat > "$T/bin/cockpitd.mjs" <<'FAKE'
// A stand-in cockpitd: idles for ever. `stubborn` ignores SIGTERM, so only the
// SIGKILL path of daemon_stop can end it.
if (process.argv[2] === "stubborn") process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
FAKE
cp "$T/bin/cockpitd.mjs" "$T2/bin/cockpitd.mjs"

# The launch shape that leaked (DESIGN §2.1): a shell function in the background
# runs in a subshell, so $! is bash and node is its child.
envfn() { COCKPIT_DIR="$T/state" "$@"; }

echo "-- daemon_stop"

envfn node "$T/bin/cockpitd.mjs" > /dev/null 2>&1 &
W=$!
wait_count "$T" 1
N=$(daemon_pids "$T")
is "env-function launch: \$! is a wrapper, node is its child" \
  "$([ -n "$N" ] && [ "$N" != "$W" ] && [ "$(ps -o ppid= -p "$N" | tr -d ' ')" = "$W" ] && echo yes)" yes
daemon_stop "$W"
is "env-function launch: wrapper gone after daemon_stop" "$(yn "$W")" no
is "env-function launch: node gone too" "$(yn "${N:-0}")" no

COCKPIT_DIR="$T/state" node "$T/bin/cockpitd.mjs" > /dev/null 2>&1 &
P=$!
wait_count "$T" 1
is "plain launch: \$! is node itself" "$(daemon_pids "$T")" "$P"
daemon_stop "$P"
is "plain launch: gone after daemon_stop" "$(yn "$P")" no

COCKPIT_DIR="$T/state" node "$T/bin/cockpitd.mjs" stubborn > /dev/null 2>&1 &
S=$!
disown "$S"   # its SIGKILL would otherwise print a bash "Killed: 9" job notice
wait_count "$T" 1
sleep 0.3   # let node install its SIGTERM handler, or TERM kills it outright
kill -TERM "$S"; sleep 0.3
is "stubborn fake survives a plain SIGTERM" "$(yn "$S")" yes
daemon_stop "$S"
is "stubborn fake gone after daemon_stop (SIGKILL path)" "$(yn "$S")" no

daemon_stop "" 999999 nonsense
is "empty, dead and non-numeric pids are a no-op" "$?" 0

echo "-- daemon_pids / daemon_sweep / daemon_tripwire"

COCKPIT_DIR="$T/state" node "$T/bin/cockpitd.mjs" > /dev/null 2>&1 &
A=$!
COCKPIT_DIR="$T2/state" node "$T2/bin/cockpitd.mjs" > /dev/null 2>&1 &
B=$!
wait_count "$T" 1; wait_count "$T2" 1

# §2.8: a ps that prints no environment would silently disarm every sweep and
# tripwire in every suite; this is the check that fails instead.
is "ps -E sees a known scratch daemon's environment" \
  "$(ps -E -ww -p "$A" -o command= | grep -cF "=$T/")" 1
is "daemon_pids finds the daemon under \$T" "$(daemon_pids "$T")" "$A"
is "daemon_pids prints nothing of \$T2's" "$(daemon_pids "$T" | grep -cx "$B")" 0
is "daemon_pids finds \$T2's under \$T2" "$(daemon_pids "$T2")" "$B"
# The trailing slash: $T with one more character appended is a different run.
is "a folder that merely starts with \$T does not match" \
  "$(daemon_pids "${T%?}")" ""

out=$(daemon_tripwire "$T"); rc=$?
is "tripwire returns 1 on a forgotten daemon" "$rc" 1
is "tripwire names the pid and folder" \
  "$(grep -c "^LEAK cockpitd pid $A still running, env names $T/state$" <<<"$out")" 1
is "tripwire's hint names daemon_stop" "$(grep -c daemon_stop <<<"$out")" 1
is "tripwire never kills" "$(yn "$A")" yes

daemon_sweep "$T"
is "daemon_sweep returns 0" "$?" 0
is "daemon_sweep stops the forgotten daemon" "$(yn "$A")" no
is "daemon_sweep leaves \$T2's running" "$(yn "$B")" yes

out=$(daemon_tripwire "$T"); rc=$?
is "tripwire returns 0 when none is left" "$rc" 0
is "...and prints nothing" "$out" ""
daemon_stop "$B"

echo "-- interrupted runs"

# A mini-suite shaped like a real one: sources the helpers, launches two
# wrapped fakes, one EXIT trap that sweeps. Idles in short sleeps so a signal to
# the shell is acted on within 0.2s rather than after one long foreground sleep.
cat > "$T/mini.sh" <<'MINI'
. "$1"; MT="$2"; FAKE="$3"
trap 'daemon_sweep "$MT"' EXIT
envfn() { COCKPIT_DIR="$MT/state" "$@"; }
envfn node "$FAKE" > /dev/null 2>&1 &
envfn node "$FAKE" > /dev/null 2>&1 &
: > "$MT/ready"
while :; do sleep 0.2; done
MINI

# Start the mini in its own process group, as a terminal would, so a SIGINT can
# go to the whole group. A non-interactive bash starts `&` jobs with SIGINT
# ignored, and an ignored signal survives exec, so perl restores the default
# first or the group SIGINT would test nothing.
start_mini() {
  mkdir -p "$1"
  perl -e '$SIG{INT} = "DEFAULT"; setpgrp(0, 0); exec @ARGV' \
    bash "$T/mini.sh" "$LIB" "$1" "$T/bin/cockpitd.mjs" &
  MINI=$!
  local i
  for ((i = 0; i < 50; i++)); do [ -e "$1/ready" ] && break; sleep 0.1; done
  wait_count "$1" 2
}

start_mini "$T/int"
is "SIGINT: the mini-suite has two daemons running" "$(daemon_pids "$T/int" | grep -c .)" 2
kill -INT -- "-$MINI"; wait "$MINI" 2>/dev/null
is "SIGINT to the group leaves no daemon" "$(daemon_pids "$T/int")" ""

start_mini "$T/term"
is "SIGTERM: the mini-suite has two daemons running" "$(daemon_pids "$T/term" | grep -c .)" 2
kill -TERM "$MINI"; wait "$MINI" 2>/dev/null
is "SIGTERM to its shell only leaves no daemon" "$(daemon_pids "$T/term")" ""

echo "-- fence"

# No cleanup may kill a cockpitd by name: the real cockpit runs the same
# command line (DESIGN §5.2). `p[k]ill` so this line does not match itself;
# the footer-click `pkill -f "$CLICKER"` names a scratch path and does not.
is "no name-match kill of the daemon anywhere under spikes/" \
  "$(grep -rnE 'p[k]ill[[:space:]]+(-[a-zA-Z0-9]+[[:space:]]+)*-f[^#]*cockpitd' "$ROOT/spikes" | grep -c .)" 0

echo "-- nothing of ours left"
daemon_tripwire "$T" > /dev/null; is "tripwire clean for \$T at the end" "$?" 0
daemon_tripwire "$T2" > /dev/null; is "tripwire clean for \$T2 at the end" "$?" 0

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass checks)"; else echo "FAILURES"; fi
exit "$fail"
