#!/usr/bin/env bash
# The rig check (pir-pane T07): the REAL installed `pir`, publishing PIR_DASHBOARD_STATE,
# driven by keystrokes in a real terminal pane, against pir's own pretend run.
#
#   bash spikes/pir-pane-drill/rig-check.sh
#
# What is real: the installed `pir` wrapper (~/.local/bin/pir → ~/.claude/pir-engine) and
# its dashboard, running in a pane of a private headless wezterm-mux-server, keys sent
# with `wezterm cli send-text`. What is pretend: the run it shows, stood up by pir's
# conversation rig (~/.claude/pir-engine/src/shell/conversation-rig.mjs) — a scratch repo
# with a one-task plan `rig` and one worker whose `claude` is a fake, so no model is called.
#
# It drives: the runs list → open the rig's run → open its worker → back → back → quit,
# and checks the state file against pir-pane DESIGN §2.4 after every step, and that it is
# gone after the quit.
#
# Seatbelts (DESIGN §5.2, §5.3): HOME and PIR_HOME in a scratch dir, so pir's run index
# holds the rig's run and nothing else — pir never sees the person's real runs, where an
# Enter in a worker's conversation would message a live worker. The mux has its own
# socket, pid file and config, so the live cockpit window is never touched. Teardown
# stops the rig with SIGTERM (its own teardown removes its index record and repo) and
# kills the mux by pid file and config path, and confirms both are gone.
#
# Prints one line per check and ends `RIG CHECK PASS (N checks)` or
# `RIG CHECK FAILURES (k of N)`, exiting non-zero on a failure. If the installed pir
# writes no state file at all it prints `RIG CHECK: pir published nothing` and exits 3:
# the pir side has not landed. RIG_KEEP=1 keeps the scratch dir.
set -uo pipefail

PIR_BIN="$(command -v pir || true)"
ENGINE="$HOME/.claude/pir-engine"
RIG_JS="$ENGINE/src/shell/conversation-rig.mjs"
for t in wezterm wezterm-mux-server node git python3; do
  command -v "$t" >/dev/null || { echo "rig-check: $t not on PATH"; exit 2; }
done
[ -n "$PIR_BIN" ] || { echo "rig-check: pir is not installed (no pir on PATH)"; exit 2; }
[ -f "$RIG_JS" ] || { echo "rig-check: no conversation rig at $RIG_JS"; exit 2; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $*"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $*"; }
check() { local what="$1"; shift; if "$@"; then ok "$what"; else bad "$what"; fi; }

T="$(cd "$(mktemp -d /tmp/pirrc.XXXX)" && pwd -P)"
MUXCFG="$T/wezterm.lua"
H="$T/home"; PH="$T/pirhome"; RIG="$T/rigrepo"; STATE="$T/x.json"
mkdir -p "$H" "$PH"
RIGPID=""; PIRPID=""

teardown() {
  if [ -n "$RIGPID" ] && kill -0 "$RIGPID" 2>/dev/null; then
    kill -TERM "$RIGPID" 2>/dev/null
    local i; for i in $(seq 1 60); do kill -0 "$RIGPID" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$RIGPID" 2>/dev/null && { echo "  TEARDOWN: rig still running"; kill -9 "$RIGPID" 2>/dev/null; }
  fi
  kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null
  pkill -f "$MUXCFG" 2>/dev/null
  local j; for j in $(seq 1 10); do pgrep -f "$MUXCFG" >/dev/null || break; sleep 0.3; done
  # pir's own pid, read from its state file: its command line carries no PIR_HOME (env is
  # not argv), so a pgrep on the scratch path could never see a stranded scratch pir.
  if [ -n "$PIRPID" ] && kill -0 "$PIRPID" 2>/dev/null; then
    kill -TERM "$PIRPID" 2>/dev/null; sleep 0.5
  fi
  if pgrep -f "$MUXCFG" >/dev/null || { [ -n "$PIRPID" ] && kill -0 "$PIRPID" 2>/dev/null; }; then
    echo "  TEARDOWN: mux or scratch pir still running"
  else
    echo "  teardown: rig, mux and scratch pir gone"
  fi
  if [ -n "${RIG_KEEP:-}" ]; then echo "  kept $T"; else rm -rf "$T"; fi
}
trap teardown EXIT

cli()  { WEZTERM_UNIX_SOCKET="$T/sock" wezterm --config-file "$MUXCFG" cli --no-auto-start "$@"; }
send() { cli send-text --pane-id "$PANE" --no-paste "$1"; }
screen() { cli get-text --pane-id "$PANE" 2>/dev/null; }
wait_for() { local n; n=$(python3 -c "print(int($1*4))"); shift
  local i; for ((i=0;i<n;i++)); do "$@" && return 0; sleep 0.25; done; "$@"; }
# st <python expr over d>: evaluates against the current state file, prints the result
st() { python3 - "$STATE" "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("<unreadable: %s>" % e); sys.exit(0)
v = eval(sys.argv[2], {"d": d})
print(v if isinstance(v, str) else json.dumps(v))
PY
}
is() { [ "$(st "$1")" = "$2" ] || { echo "       $1 = $(st "$1"), want $2"; return 1; }; }
view_is() { [ -f "$STATE" ] && [ "$(st 'd["view"]')" = "$1" ]; }

echo "rig-check: pir $(readlink "$PIR_BIN" 2>/dev/null || echo "$PIR_BIN"), engine $ENGINE"
echo "rig-check: scratch $T"

# --- the rig: pir's pretend run, in the scratch PIR_HOME -----------------------------
env HOME="$H" PIR_HOME="$PH" node "$RIG_JS" --into "$RIG" > "$T/rig.out" 2>&1 &
RIGPID=$!
wait_for 20 grep -q 'rig running' "$T/rig.out" || { echo "rig-check: the rig never started"; cat "$T/rig.out"; exit 2; }
# Make the rig's repo a git repo with the run's shared worktree folder, so pir resolves
# `run.cwd` to a real path (`<main>/.claude/worktrees/pir-rig`) rather than null.
git -C "$RIG" init -q
mkdir -p "$RIG/.claude/worktrees/pir-rig"
RUNCWD="$RIG/.claude/worktrees/pir-rig"
check "the scratch index holds the rig's run and nothing else" \
  test "$(ls "$PH/.pir/runs")" = rigrepo__rig.json

# --- a private mux whose pane runs the installed pir ---------------------------------
cat > "$MUXCFG" <<LUA
return {
  initial_cols = 120, initial_rows = 40,
  unix_domains = { { name = 'pirrigcheck', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
  default_prog = { '/bin/bash', '-c', 'pir; echo "PIR EXITED \$?"; exec /bin/bash --norc' },
  default_cwd = '$RIG',
}
LUA
env -i HOME="$H" USER="${USER:-rig}" LOGNAME="${LOGNAME:-rig}" TERM=xterm-256color \
    SHELL=/bin/bash LANG=en_US.UTF-8 TMPDIR="$T/" \
    PATH="$(dirname "$PIR_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    PIR_HOME="$PH" PIR_DASHBOARD_STATE="$STATE" \
    wezterm-mux-server --config-file "$MUXCFG" --daemonize
wait_for 20 test -S "$T/sock" || { echo "rig-check: mux never started"; tail -5 "$T/err" 2>/dev/null; exit 2; }
PANE=""
for _ in $(seq 1 40); do
  PANE=$(cli list --format json 2>/dev/null | python3 -c 'import json,sys
p=json.load(sys.stdin); print(p[0]["pane_id"] if p else "")' 2>/dev/null)
  [ -n "$PANE" ] && break; sleep 0.25
done
[ -n "$PANE" ] || { echo "rig-check: no pane"; exit 2; }

# --- 1. the runs list ----------------------------------------------------------------
echo "step 1: runs list"
if ! wait_for 20 test -f "$STATE"; then
  echo "RIG CHECK: pir published nothing (no $STATE after 20s) — the pir side has not landed"
  screen | tail -15
  exit 3
fi
listed() { screen | grep 'rig' >/dev/null; }
check "the rig's run is listed on pir's screen" wait_for 10 listed
PIRPID=$(st 'd["pid"]')
check "version is 1"                         is 'd["version"]' 1
check "view is list"                         is 'd["view"]' list
check "run and worker are null"              is '[d["run"], d["worker"]]' '[null, null]'
check "pid $PIRPID is alive and is pir's node" bash -c "ps -o command= -p $PIRPID | grep 'pir-engine/src/shell/pir.mjs' >/dev/null"
check "updatedAt is an ISO timestamp"        bash -c "[[ \"\$(python3 -c 'import json;print(json.load(open(\"$STATE\"))[\"updatedAt\"])')\" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$ ]]"

run_ok() {
  check "run.key is rigrepo__rig"            is 'd["run"]["key"]' rigrepo__rig
  check "run.kind is work"                   is 'd["run"]["kind"]' work
  check "run.slug is rig"                    is 'd["run"]["slug"]' rig
  check "run.repo is rigrepo"                is 'd["run"]["repo"]' rigrepo
  check "run.repoPath is the rig's repo"     is 'd["run"]["repoPath"]' "$RIG"
  check "run.branch is pir/rig"              is 'd["run"]["branch"]' pir/rig
  check "run.cwd is the shared worktree"     is 'd["run"]["cwd"]' "$RUNCWD"
  check "pid unchanged"                      is 'd["pid"]' "$PIRPID"
}

# --- 2. open the run -----------------------------------------------------------------
echo "step 2: open the rig's run (Enter)"
send $'\r'
check "view is run"                          wait_for 10 view_is run
run_ok
check "worker is null"                       is 'd["worker"]' null

# --- 3. open its worker --------------------------------------------------------------
echo "step 3: open the worker (→)"
sleep 1  # the live view loads T01 from the rig's status.json
send $'\x1b[C'
check "view is worker"                       wait_for 10 view_is worker
run_ok
check "worker.task is T01"                   is 'd["worker"]["task"]' T01
check "worker.role is implement"             is 'd["worker"]["role"]' implement
check "worker.id is set"                     bash -c "[ -n \"\$(python3 -c 'import json;print(json.load(open(\"$STATE\"))[\"worker\"][\"id\"] or \"\")')\" ]"
check "worker.cwd is where the rig spawned it" is 'd["worker"]["cwd"]' "$RIG"

# --- 4. back to the run --------------------------------------------------------------
echo "step 4: back (←)"
send $'\x1b[D'
check "view is run"                          wait_for 10 view_is run
run_ok
check "worker is null"                       is 'd["worker"]' null

# --- 5. back to the list -------------------------------------------------------------
echo "step 5: back (←)"
send $'\x1b[D'
check "view is list"                         wait_for 10 view_is list
check "run and worker are null"              is '[d["run"], d["worker"]]' '[null, null]'

# --- 6. quit -------------------------------------------------------------------------
echo "step 6: quit (Esc)"
send $'\x1b'
gone() { [ ! -e "$STATE" ]; }
exited() { screen | grep 'PIR EXITED' >/dev/null; }
check "pir exited"                           wait_for 10 exited
check "pir exited 0"                         bash -c "WEZTERM_UNIX_SOCKET='$T/sock' wezterm --config-file '$MUXCFG' cli --no-auto-start get-text --pane-id $PANE | grep 'PIR EXITED 0' >/dev/null"
check "the state file is gone"               gone
check "no temp file left beside it"          bash -c "! ls '$T' | grep '^x\\.json\\.' >/dev/null"
check "pir's pid is gone"                    bash -c "! kill -0 $PIRPID 2>/dev/null"

echo
if [ "$FAIL" -eq 0 ]; then echo "RIG CHECK PASS ($PASS checks)"; exit 0
else echo "RIG CHECK FAILURES ($FAIL of $((PASS+FAIL)))"; exit 1; fi
