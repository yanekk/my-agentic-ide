# Stopping, sweeping and catching the cockpitd daemons a test suite starts.
# Sourced, never run:  . "$ROOT/spikes/lib/test-daemons.sh"
#
# plans/test-daemon-leaks/DESIGN.md §2. The one rule that must never be loosened:
# a test daemon is recognised by the scratch folder in its ENVIRONMENT, never by
# its script name. The real cockpit runs the same `node <checkout>/bin/cockpitd.mjs`
# command line, so any name match (pgrep -f, pkill -f) reaches the real daemon.
#
# macOS only: `ps -E` appends a process's initial environment to its command.
# It shows nothing for Apple's platform binaries (/bin/sleep prints no env), but
# node's is visible, and node is what a cockpitd runs as.

# Liveness that treats a zombie as gone: a killed background job of this shell
# stays a zombie until bash reaps it, and `kill -0` would call that alive.
_daemon_alive() {
  local st
  st=$(ps -o stat= -p "$1" 2>/dev/null) || return 1
  [ -n "$st" ] && [[ $st != Z* ]]
}

# pid and every descendant, collected BEFORE anything is signalled: kill the
# `envfn node … &` wrapper subshell first and node is reparented to pid 1, where
# `pgrep -P` can no longer find it (DESIGN §2.1).
_daemon_tree() {
  local p c
  for p in "$@"; do
    echo "$p"
    for c in $(pgrep -P "$p" 2>/dev/null); do _daemon_tree "$c"; done
  done
}

# daemon_stop <pid>...  SIGTERM each pid and its descendants, wait up to ~2s for
# all to be gone, SIGKILL survivors. Empty, non-numeric or dead pids are a no-op.
# The wait matters: a daemon still dying out-ticks the next one a suite starts.
daemon_stop() {
  local p pids=() tree=() i
  for p in "$@"; do [[ $p =~ ^[0-9]+$ ]] && pids+=("$p"); done
  [ ${#pids[@]} -eq 0 ] && return 0
  tree=($(_daemon_tree "${pids[@]}"))
  kill -TERM "${tree[@]}" 2>/dev/null
  for ((i = 0; i < 20; i++)); do
    local left=()
    for p in "${tree[@]}"; do _daemon_alive "$p" && left+=("$p"); done
    [ ${#left[@]} -eq 0 ] && return 0
    sleep 0.1
  done
  kill -KILL "${left[@]}" 2>/dev/null
  for ((i = 0; i < 10; i++)); do
    local still=0
    for p in "${left[@]}"; do _daemon_alive "$p" && still=1; done
    [ $still -eq 0 ] && break
    sleep 0.1
  done
  return 0
}

# This shell and its ancestors: never a match, whatever their environment says.
_daemon_ancestors() {
  local table p=$$ pp
  table=$(ps -ax -o pid=,ppid= 2>/dev/null)
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    echo "$p"
    pp=$(awk -v p="$p" '$1 == p { print $2; exit }' <<<"$table")
    [ "$pp" = "$p" ] && break
    p=$pp
  done
}

# daemon_pids <T>  one pid per line: every process whose command runs
# cockpitd.mjs and whose environment names a path under <T>/ (DESIGN §2.7).
# The `=<T>/` is literal and the slash is load-bearing: tmp.abc must not match
# tmp.abcd. The filtering is bash string matching over a captured snapshot, not
# awk/grep over a pipe, because a filter given <T> as an argument would itself be
# a process whose line contains `=<T>/`.
daemon_pids() {
  local T=${1%/} plain envd line pid rest anc
  [ -n "$T" ] || return 0
  plain=$(ps -ww -ax -o pid=,command= 2>/dev/null)
  envd=$(ps -E -ww -ax -o pid=,command= 2>/dev/null)
  anc=" $(_daemon_ancestors | tr '\n' ' ') "
  local -A runs=()
  while read -r pid rest; do
    [[ $rest == *cockpitd.mjs* ]] && runs[$pid]=1
  done <<<"$plain"
  while read -r pid rest; do
    [ -n "${runs[$pid]:-}" ] || continue
    [[ $anc == *" $pid "* ]] && continue
    [[ $rest == *"=$T/"* ]] && echo "$pid"
  done <<<"$envd"
  return 0
}

# daemon_sweep <T>  stop every daemon under <T>. Always returns 0: it runs from
# an EXIT trap, and a cleanup that fails must not change the suite's verdict.
daemon_sweep() {
  daemon_stop $(daemon_pids "$1")
  return 0
}

# daemon_tripwire <T>  waits up to ~2s for daemons already told to stop; if any
# are still under <T>, prints one LEAK line each plus a hint and returns 1.
# Never kills: the EXIT sweep does that, so a leak fails the run exactly once
# and still leaves nothing behind (DESIGN §2.5, §6).
daemon_tripwire() {
  local T=${1%/} pids i pid path
  for ((i = 0; i < 20; i++)); do
    pids=$(daemon_pids "$T")
    [ -z "$pids" ] && return 0
    sleep 0.1
  done
  for pid in $pids; do
    path=$(ps -E -ww -p "$pid" -o command= 2>/dev/null | tr ' ' '\n' |
      grep -F -m1 "=$T/" | cut -d= -f2-)
    echo "LEAK cockpitd pid $pid still running, env names ${path:-$T/}"
  done
  echo "LEAK a section started a cockpitd and never stopped it: stop it with daemon_stop <pid>"
  return 1
}
