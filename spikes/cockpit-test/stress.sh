#!/usr/bin/env bash
# Repeat the full cockpit suite to prove it stable, not just fast
# (plans/test-suite-speed, T09; DESIGN §2, §5.2).
#
#   bash spikes/cockpit-test/stress.sh [--serial N]            N copies, one after another
#   bash spikes/cockpit-test/stress.sh --parallel K --rounds R  R rounds of K copies at once
#
# Each copy runs with TMPDIR=<scratch>/<copy>, so every `mktemp -d` it makes, and
# therefore every cockpitd it starts, carries a path under <scratch> in its
# environment. Output goes to <scratch>/<copy>.out. One line per copy:
#   <copy> PASS <s>s <N> checks
#   <copy> FAIL <s>s <k> failed · <scratch>/<copy>.out
# then  stress: <passed>/<total> passed, median <s>s, max <s>s, load <1m avg>
# Exit 1 on any failure.
#
# Cleanup (EXIT trap, Ctrl-C included): stop every copy still running as a tree,
# then `daemon_sweep <scratch>` from spikes/lib/test-daemons.sh -- the environment
# match, never a name match, because the real cockpit's daemon runs the same
# cockpitd.mjs command line. Never pkill, never a matcher of our own. Then the
# scratch folder goes, except the .out file of a copy that failed: that is kept,
# with the folder around it, so the failure can be read.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/spikes/lib/test-daemons.sh"

SERIAL=""; PARALLEL=""; ROUNDS=""
while [ $# -gt 0 ]; do
  case $1 in
    --serial) SERIAL=${2:-}; shift 2 ;;
    --parallel) PARALLEL=${2:-}; shift 2 ;;
    --rounds) ROUNDS=${2:-}; shift 2 ;;
    *) echo "usage: stress.sh [--serial N] [--parallel K --rounds R]" >&2; exit 2 ;;
  esac
done
num() { [[ ${1:-} =~ ^[1-9][0-9]*$ ]]; }
if [ -n "$PARALLEL$ROUNDS" ]; then
  if [ -n "$SERIAL" ] || ! num "$PARALLEL" || ! num "$ROUNDS"; then
    echo "stress.sh: --parallel K needs --rounds R, and neither goes with --serial" >&2; exit 2
  fi
else
  SERIAL=${SERIAL:-1}
  num "$SERIAL" || { echo "stress.sh: --serial takes a positive count" >&2; exit 2; }
fi

# A stress run is a proof of the FULL run: a stray ONLY would make every copy a
# partial run, which never prints ALL PASS and so would read as N failures.
unset ONLY
# The suite each copy runs. Overridable only so the harness itself can be tested
# against a suite that fails on purpose.
SUITE=${STRESS_SUITE:-$ROOT/spikes/cockpit-test/run.sh}

BASE=${TMPDIR:-/tmp}
S=$(mktemp -d "${BASE%/}/cockpit-stress.XXXXXX")
RUNNING=()      # pids of copies in flight
FAILED_OUT=()   # .out files to keep
DURS=()         # seconds per finished copy
passed=0; total=0

cleanup() {
  trap - EXIT INT TERM
  # A Ctrl-C reaches our foreground group, but the copies are `&` jobs of a
  # non-interactive shell and ignore SIGINT: they must be stopped by hand, as a
  # tree, so their script(1) clickers and stubs go too.
  [ ${#RUNNING[@]} -gt 0 ] && daemon_stop "${RUNNING[@]}"
  wait 2>/dev/null
  daemon_sweep "$S"
  local left
  left=$(daemon_pids "$S")
  [ -n "$left" ] && echo "stress: LEAK cockpitd still running after the sweep: $left"
  if [ ${#FAILED_OUT[@]} -gt 0 ]; then
    # Keep only the failures' output; the copies' temp trees are no use now.
    local f keep=" ${FAILED_OUT[*]} "
    for f in "$S"/* "$S"/.[!.]*; do
      [ -e "$f" ] || continue
      [[ $keep == *" $f "* ]] || rm -rf "$f"
    done
    echo "stress: kept failed output under $S"
  else
    rm -rf "$S"
  fi
}
trap cleanup EXIT
trap 'echo; echo "stress: interrupted"; exit 130' INT TERM

now() { echo "${EPOCHREALTIME/,/.}"; }

# start <copy>: launch one full suite in the background; sets STARTED_PID.
declare -A T0
start() {
  local c=$1
  mkdir -p "$S/$c"
  T0[$c]=$(now)
  # The copy stamps its own end: in a round the copies are waited for in order,
  # so the time `finish` reaches one is not when it ended.
  { TMPDIR="$S/$c" bash "$SUITE" >"$S/$c.out" 2>&1; rc=$?; now >"$S/$c.end"; exit $rc; } &
  STARTED_PID=$!
}

# finish <copy> <pid>: wait for it and print its line.
finish() {
  local c=$1 pid=$2 rc secs n
  wait "$pid"; rc=$?
  secs=$(awk -v a="${T0[$c]}" -v b="$(cat "$S/$c.end" 2>/dev/null || now)" 'BEGIN{ printf "%.1f", b - a }')
  DURS+=("$secs"); total=$((total + 1))
  n=$(sed -n 's/^ALL PASS (\([0-9]*\) checks)$/\1/p' "$S/$c.out" | tail -1)
  if [ "$rc" -eq 0 ] && [ -n "$n" ]; then
    passed=$((passed + 1))
    echo "$c PASS ${secs}s $n checks"
  else
    FAILED_OUT+=("$S/$c.out")
    echo "$c FAIL ${secs}s $(grep -c '^  FAIL' "$S/$c.out") failed · $S/$c.out"
  fi
}

if [ -n "$SERIAL" ]; then
  for ((i = 1; i <= SERIAL; i++)); do
    c=$(printf 's%02d' "$i")
    start "$c"; RUNNING=("$STARTED_PID")
    finish "$c" "$STARTED_PID"; RUNNING=()
  done
else
  for ((r = 1; r <= ROUNDS; r++)); do
    names=(); RUNNING=()
    for ((k = 1; k <= PARALLEL; k++)); do
      c="r${r}c${k}"; start "$c"; names+=("$c"); RUNNING+=("$STARTED_PID")
    done
    for ((k = 0; k < PARALLEL; k++)); do finish "${names[$k]}" "${RUNNING[$k]}"; done
    RUNNING=()
  done
fi

stats=$(printf '%s\n' "${DURS[@]}" | sort -n | awk '
  { v[NR] = $1 }
  END { m = (NR % 2) ? v[(NR + 1) / 2] : (v[NR / 2] + v[NR / 2 + 1]) / 2
        printf "median %.1fs, max %.1fs", m, v[NR] }')
load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{ print $2 }')
echo "stress: $passed/$total passed, $stats, load ${load:-?}"
[ "$passed" -eq "$total" ]
