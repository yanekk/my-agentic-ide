#!/usr/bin/env bash
# Proves spikes/lib/test-daemons.sh -- daemon_stop, daemon_pids, daemon_sweep,
# daemon_tripwire -- against FAKE daemons: a node script at $T/bin/cockpitd.mjs,
# so the name matches without running the real thing. And the owner backstop
# (COCKPIT_OWNER_PID) against the REAL bin/cockpitd.mjs with stubbed wezterm and
# claude. plans/test-daemon-leaks.
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
# A shell whose own command names cockpitd.mjs and whose environment names $T/
# (a mini-suite, below) must never find itself: sweeping from its own trap would
# SIGTERM the shell running the trap.
is "the calling shell and its ancestors are never matched" \
  "$(COCKPIT_DIR="$T/state" bash -c '. "$1"; daemon_pids "$2"' _ "$LIB" "$T" cockpitd.mjs)" "$A"
# macOS's own /bin/bash is 3.2; a suite started from a PATH without Homebrew runs
# the helpers there, where `local -A` does not exist.
is "daemon_pids works, silently, under /bin/bash 3.2" \
  "$(/bin/bash -c '. "$1"; daemon_pids "$2"' _ "$LIB" "$T" 2>&1)" "$A"

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

echo "-- owner backstop (the real bin/cockpitd.mjs)"

# The real daemon against scratch state: a PATH whose wezterm and claude print
# nothing, so every poll reads "no pane" and nothing is retargeted; origins at a
# port nothing listens on; HOME and COCKPIT_DIR under $T/, so the EXIT sweep
# finds these daemons exactly as it finds the fakes. POLL_MS is 800 * scale.
mkdir -p "$T/stub"
for c in wezterm claude; do printf '#!/bin/sh\nexit 0\n' > "$T/stub/$c"; chmod +x "$T/stub/$c"; done
SCALE=0.1          # POLL_MS 80ms
TICKS=0.8          # ten ticks: "still running after several ticks"
# Start the real daemon in its own scratch folder <dir>; any further arguments
# are extra VAR=value settings (the owner seam). Sets RP to node's pid.
real_daemon() {
  local d="$1"; shift
  mkdir -p "$d/state" "$d/home"
  echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$d"'"}' > "$d/state/panes.json"
  : > "$d/state/fleet.log"
  env HOME="$d/home" COCKPIT_DIR="$d/state" COCKPIT_TIME_SCALE="$SCALE" \
    PATH="$T/stub:$PATH" AGENDA_ORIGIN="http://127.0.0.1:9" BITBUCKET_ORIGIN="http://127.0.0.1:9" \
    "$@" node "$ROOT/bin/cockpitd.mjs" > "$d/daemon.log" 2>&1 &
  RP=$!
  local i
  for ((i = 0; i < 50; i++)); do grep -q "cockpitd up" "$d/daemon.log" 2>/dev/null && return 0; sleep 0.1; done
  return 1
}
# Bound for the owner check to notice: two misses at 80ms plus node's exit. The
# DESIGN says "about two ticks"; 2s is generous for a loaded machine and still
# far short of "for ever".
gone_within() {
  local i
  for ((i = 0; i < 20; i++)); do alive "$1" || return 0; sleep 0.1; done
  return 1
}

sleep 30 & OWN=$!
real_daemon "$T/own" COCKPIT_OWNER_PID="$OWN"
sleep "$TICKS"
is "owner alive: the daemon keeps running" "$(yn "$RP")" yes
kill "$OWN"; wait "$OWN" 2>/dev/null
is "owner killed: the daemon exits within the bound" "$(gone_within "$RP" && echo yes)" yes
is "...and logs 'owner <pid> gone, exiting'" \
  "$(grep -c "owner $OWN gone, exiting" "$T/own/daemon.log")" 1
wait "$RP" 2>/dev/null
is "...exiting through shutdown(), status 0" "$?" 0

sleep 30 & UNREL=$!
real_daemon "$T/noown"
kill "$UNREL"; wait "$UNREL" 2>/dev/null
sleep "$TICKS"
is "no COCKPIT_OWNER_PID: still running after an unrelated process dies" "$(yn "$RP")" yes
is "...and says nothing about an owner" "$(grep -c -i owner "$T/noown/daemon.log")" 0
daemon_stop "$RP"

for v in abc 0; do
  real_daemon "$T/bad$v" COCKPIT_OWNER_PID="$v"
  sleep "$TICKS"
  is "COCKPIT_OWNER_PID=$v: still running after several ticks" "$(yn "$RP")" yes
  is "COCKPIT_OWNER_PID=$v: exactly one log line about it" \
    "$(grep -c COCKPIT_OWNER_PID "$T/bad$v/daemon.log")" 1
  daemon_stop "$RP"
done

# pid 1 is launchd, another user's: kill(1, 0) is EPERM, which is alive.
real_daemon "$T/eperm" COCKPIT_OWNER_PID=1
sleep "$TICKS"
is "COCKPIT_OWNER_PID=1 (EPERM): still running" "$(yn "$RP")" yes
is "...and never logs it gone" "$(grep -c "gone, exiting" "$T/eperm/daemon.log")" 0
daemon_stop "$RP"

# The force-kill path (DESIGN 2.8): a mini-suite launching the real daemon the
# way cockpit-test does -- through an env function, owner "$$" -- then SIGKILLed,
# its shell only. No trap can run; the backstop is the only thing left.
cat > "$T/killmini.sh" <<'MINI'
D="$1"; ROOT="$2"; STUB="$3"
mkdir -p "$D/state" "$D/home"
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$D"'"}' > "$D/state/panes.json"
: > "$D/state/fleet.log"
denv() {
  HOME="$D/home" COCKPIT_DIR="$D/state" COCKPIT_TIME_SCALE=0.1 COCKPIT_OWNER_PID="$$" \
  PATH="$STUB:$PATH" AGENDA_ORIGIN="http://127.0.0.1:9" BITBUCKET_ORIGIN="http://127.0.0.1:9" \
  "$@"
}
denv node "$ROOT/bin/cockpitd.mjs" > "$D/daemon.log" 2>&1 &
trap 'echo trap-ran > "$D/trap"' EXIT
while :; do sleep 0.2; done
MINI
bash "$T/killmini.sh" "$T/kill" "$ROOT" "$T/stub" &
KM=$!
disown "$KM"   # its SIGKILL would otherwise print a bash "Killed: 9" job notice
for ((i = 0; i < 50; i++)); do grep -q "cockpitd up" "$T/kill/daemon.log" 2>/dev/null && break; sleep 0.1; done
KD=$(daemon_pids "$T/kill")
is "SIGKILL: the mini-suite's real daemon is running" "$([ -n "$KD" ] && alive "$KD" && echo yes)" yes
sleep "$TICKS"
is "...and stays up while its owner lives" "$(yn "${KD:-0}")" yes
kill -KILL "$KM"
is "SIGKILL to its shell only: the daemon is gone within the bound" \
  "$(gone_within "${KD:-0}" && echo yes)" yes
is "...although no trap ran" "$([ -e "$T/kill/trap" ] && echo ran || echo none)" none
is "...and it logged why" "$(grep -c "owner $KM gone, exiting" "$T/kill/daemon.log")" 1

echo "-- fence"

# Every test daemon a suite starts carries the owner seam (DESIGN 2.4). A launch
# is a line naming bin/cockpitd.mjs that backgrounds it; this suite is excluded,
# its owner-less and malformed launches being the checks themselves.
for f in "$ROOT"/spikes/*-test/run.sh; do
  case "$f" in */daemon-leak-test/run.sh) continue ;; esac
  launches=$(grep -cE 'bin/cockpitd\.mjs"?[^|#]*&[[:space:]]*$' "$f")
  owners=$(grep -c 'COCKPIT_OWNER_PID="\$\$"' "$f")
  is "$(basename "$(dirname "$f")"): $launches daemon launches, each with an owner" "$owners" "$launches"
done
is "cockpit-test has its seven launches (the fence is not counting nothing)" \
  "$(grep -cE 'bin/cockpitd\.mjs"?[^|#]*&[[:space:]]*$' "$ROOT/spikes/cockpit-test/run.sh")" 7
# The real cockpit must be unable to get the backstop at all.
is "COCKPIT_OWNER_PID never in bin/cockpit-layout.sh or wezterm/cockpit.lua" \
  "$(cat "$ROOT/bin/cockpit-layout.sh" "$ROOT/wezterm/cockpit.lua" | grep -c COCKPIT_OWNER_PID)" 0

# No cleanup may kill a cockpitd by name: the real cockpit runs the same
# command line (DESIGN §5.2). `p[k]ill` so this line does not match itself;
# the footer-click `pkill -f "$CLICKER"` names a scratch path and does not.
is "no name-match kill of the daemon anywhere under spikes/" \
  "$(grep -rnE 'p[k]ill[[:space:]]+(-[a-zA-Z0-9]+[[:space:]]+)*-[a-zA-Z]*f[a-zA-Z]*[[:space:]][^#]*cockpitd' "$ROOT/spikes" | grep -c .)" 0

echo "-- nothing of ours left"
daemon_tripwire "$T" > /dev/null; is "tripwire clean for \$T at the end" "$?" 0
daemon_tripwire "$T2" > /dev/null; is "tripwire clean for \$T2 at the end" "$?" 0

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS ($pass checks)"; else echo "FAILURES"; fi
exit "$fail"
