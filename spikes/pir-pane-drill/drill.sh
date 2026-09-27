#!/usr/bin/env bash
# The pir-pane drill (pir-pane T06): the whole flow, driven the way a person uses it,
# on a REAL headless wezterm mux rather than cockpit-test's stub.
#
#   bash spikes/pir-pane-drill/drill.sh [COLSxROWS ...]     # default: 120x40 80x24
#
# Real: cockpit-layout.sh as the mux's first pane, cockpitd.mjs, cockpit-strip.mjs,
# cockpit-welcome.mjs, cockpit-pir.sh, revdiff. Stand-ins: a fake `claude` (a fleet
# list that attaches one agent on command) and a fake `pir` that writes
# pir-dashboard.json the way pir d4f2e7e does, driven by lines sent to its pane.
#
# Seatbelts (pir-pane DESIGN 5.2): a private wezterm-mux-server with its own socket,
# pid file and config; HOME, COCKPIT_DIR and PIR_HOME in a scratch dir; PATH without
# ~/.local/bin, so neither the real claude nor the real pir can be reached; and a
# `pkill` shim, because the layout script kills cockpitd.mjs by name (pkill -f) and
# would otherwise kill the LIVE cockpit's daemon. Teardown kills the mux by its pid file and config
# path, kills the scratch daemon, and confirms both are gone.
#
# Prints one line per check and ends with `DRILL PASS (N checks)` or
# `DRILL FAILURES (k of N)`, exiting non-zero on a failure. DRILL_KEEP=1 keeps the
# scratch dir for inspection.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SIZES=("$@"); [ ${#SIZES[@]} -gt 0 ] || SIZES=(120x40 80x24)

for t in wezterm wezterm-mux-server revdiff micro broot node git python3; do
  command -v "$t" >/dev/null || { echo "drill: $t not on PATH"; exit 2; }
done

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $*"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $*"; }
check() { local what="$1"; shift; if "$@"; then ok "$what"; else bad "$what"; fi; }

# ---------------------------------------------------------------------------
# One scratch world per size: repo + worktrees, stand-ins, mux, cockpit.
# ---------------------------------------------------------------------------
T=""; MUXCFG=""
teardown() {
  [ -n "$T" ] || return 0
  local dpids
  dpids=$(pgrep -f "$ROOT/bin/cockpitd.mjs" 2>/dev/null | while read -r p; do
            ps -Eww -o command= -p "$p" 2>/dev/null | grep -q "HOME=$T/home" && echo "$p"; done)
  # The scratch daemon: its env names the scratch HOME, which no live daemon's does.
  for p in $dpids; do kill "$p" 2>/dev/null; done
  kill "$(cat "$T/pid" 2>/dev/null)" 2>/dev/null
  pkill -f "$MUXCFG" 2>/dev/null
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$MUXCFG" >/dev/null || break; sleep 0.3
  done
  if pgrep -f "$MUXCFG" >/dev/null; then echo "  TEARDOWN: mux still running"; FAIL=$((FAIL+1)); fi
  if pgrep -f "$ROOT/bin/cockpitd.mjs" >/dev/null && \
     pgrep -f "$ROOT/bin/cockpitd.mjs" | while read -r p; do ps -Eww -o command= -p "$p"; done | grep -q "HOME=$T/home"; then
    echo "  TEARDOWN: scratch daemon still running"; FAIL=$((FAIL+1))
  else
    echo "  teardown: mux and scratch daemon gone"
  fi
  if [ -n "${DRILL_KEEP:-}" ]; then echo "  kept $T"; else rm -rf "$T"; fi
  T=""
}
trap teardown EXIT

cli()  { WEZTERM_UNIX_SOCKET="$T/sock" wezterm --config-file "$MUXCFG" cli --no-auto-start "$@"; }
send() { cli send-text --pane-id "$1" --no-paste "$2"; }
text() { cli get-text --pane-id "$1" 2>/dev/null; }
# The last `rows` lines only: after a resize get-text also returns rows above the
# viewport (T00 finding).
screen() {
  local rows; rows=$(cli list --format json | python3 -c "import json,sys
for p in json.load(sys.stdin):
  if p['pane_id']==$1: print(p['size']['rows'])")
  text "$1" | tail -n "${rows:-40}"
}
pj()   { python3 -c "import json,sys; d=json.load(open('$CD/panes.json')); print(d.get('$1',''))"; }
tj()   { python3 -c "import json,sys
d=json.load(open('$CD/terminals.json'))
v=d
for k in '$1'.split('.'): v=v.get(k) if isinstance(v,dict) else None
print(json.dumps(v) if not isinstance(v,str) else v)"; }
# pane_id -> "tab cols rows cwd" for every pane
table() { cli list --format json | python3 -c '
import json,sys,urllib.parse
for p in json.load(sys.stdin):
  cwd=urllib.parse.unquote(urllib.parse.urlparse(p.get("cwd") or "").path).rstrip("/")
  print(p["pane_id"], p["tab_id"], p["size"]["cols"], p["size"]["rows"], cwd)'; }
paneinfo() { table | awk -v id="$1" '$1==id'; }
tabof()  { paneinfo "$1" | awk '{print $2}'; }
colsof() { paneinfo "$1" | awk '{print $3}'; }
rowsof() { paneinfo "$1" | awk '{print $4}'; }
cwdof()  { paneinfo "$1" | cut -d' ' -f5-; }
cockpit_tab() { tabof "$(pj foot)"; }
# wait_for <seconds> <cmd...>: poll every 0.25s
wait_for() { local n; n=$(python3 -c "print(int($1*4))"); shift
  local i; for ((i=0;i<n;i++)); do "$@" && return 0; sleep 0.25; done; "$@"; }
verb() { printf '%s\n' "$1" >> "$CD/cmd"; }
dlog() { cat "$CD/daemon.log"; }
real() { (cd "$1" 2>/dev/null && pwd -P) || echo "$1"; }

bring_up() {
  local cols="$1" rows="$2"
  T="$(cd "$(mktemp -d /tmp/pird.XXXX)" && pwd -P)"
  MUXCFG="$T/wezterm.lua"
  export HOME_S="$T/home"; CD="$HOME_S/.claude/cockpit"
  mkdir -p "$HOME_S" "$T/bin" "$T/pirhome"

  # --- the repo: main, a pir run worktree forked from it, a worker, an agent ----
  R="$T/repo"; mkdir -p "$R"
  ( cd "$R"
    git init -q -b main .; git config user.email d@d; git config user.name drill
    printf '.claude/\n' > .gitignore; printf 'base\n' > base.txt; git add -A; git commit -qm base
    RUN="$R/.claude/worktrees/pir-demo"
    git worktree add -q -b pir/demo "$RUN"
    ( cd "$RUN"; printf 'the plan work\n' > planwork.txt; git add -A; git commit -qm "T01 merged" )
    # main moves on after the fork: a diff against main's TIP would show this reversed
    printf 'later on main\n' > mainlater.txt; git add mainlater.txt; git commit -qm "main later"
    git worktree add -q -b pir/demo-T02 "$R/.claude/worktrees/pir-demo-T02" pir/demo
    printf 'task two in flight\n' > "$R/.claude/worktrees/pir-demo-T02/tasktwo.txt"
    git worktree add -q -b agent/alpha "$R/.claude/worktrees/alpha"
    printf 'alpha agent edit\n' > "$R/.claude/worktrees/alpha/alphaedit.txt" )
  RUN="$R/.claude/worktrees/pir-demo"; WK="$R/.claude/worktrees/pir-demo-T02"
  AG="$R/.claude/worktrees/alpha"
  FORK=$(git -C "$RUN" rev-parse --short "$(git -C "$RUN" merge-base main HEAD)")

  # --- stand-ins ---------------------------------------------------------------
  cat > "$T/bin/claude" <<CLAUDE
#!/usr/bin/env bash
# fake claude: 'agents --json' lists one agent; 'agents' is a fleet list that
# attaches it on 'a' and goes back on 'l'.
if [ "\$1" = agents ] && [ "\${2:-}" = --json ]; then
  printf '[{"pid":%s,"id":"alpha111","cwd":"%s","kind":"background","sessionId":"s1","name":"alpha agent","startedAt":0,"status":"idle","state":"done"}]\n' "\$\$" "$AG"
  exit 0
fi
list() { clear; echo "FAKE CLAUDE AGENTS"; echo; echo "  alpha agent   idle"; echo; echo "❯ describe a task for a new session"; }
list
while IFS= read -r line; do
  case "\$line" in
    a) clear; echo "──────────────────── alpha agent ─"; echo "(fake conversation)";;
    l) list;;
    q) exit 0;;
  esac
done
CLAUDE
  cat > "$T/bin/pir" <<'PIR'
#!/usr/bin/env bash
# stand-in pir: keeps $PIR_DASHBOARD_STATE current (pir-pane DESIGN 2.4) with the
# view named by each line typed into its pane.
S="${PIR_DASHBOARD_STATE:-}"
run='{"key":"repo__demo","kind":"work","slug":"demo","repo":"repo","repoPath":"'"$DRILL_REPO"'","branch":"pir/demo","cwd":"'"$DRILL_RUN"'"}'
wk='{"id":"w-T02","task":"T02","role":"implement","cwd":"'"$DRILL_WK"'"}'
write() {
  [ -n "$S" ] || return 0
  local r=null w=null
  [ "$1" != list ] && r="$run"; [ "$1" = worker ] && w="$wk"
  printf '{"version":1,"pid":%s,"view":"%s","run":%s,"worker":%s,"updatedAt":"2026-09-27T00:00:00.000Z"}\n' \
    $$ "$1" "$r" "$w" > "$S.tmp.$$" && mv "$S.tmp.$$" "$S"
}
draw() { clear; echo "PIR STAND-IN · view: $1"; echo "runs: repo / demo"; }
view=list; write list; draw list
while IFS= read -r line; do
  case "$line" in
    list|run|worker) view="$line"; write "$view"; draw "$view";;
    again) write "$view";;
    quit) rm -f "$S"; exit 0;;
    crash) exit 3;;
  esac
done
PIR
  cat > "$T/bin/pkill" <<SHIM
#!/bin/sh
# The layout script kills cockpitd.mjs by name, which would take the LIVE cockpit's daemon.
echo "pkill shim: ignored \$*" >> "$T/pkill.log"
exit 1
SHIM
  chmod +x "$T/bin/"*

  # A usage reading, as the person's personal sessions leave one: with it the footer
  # trims to one row; without one it never trims (usage-limits DESIGN), see RESULTS.
  mkdir -p "$CD"
  if [ -z "${DRILL_NO_USAGE:-}" ]; then
    local now; now=$(python3 -c 'import time; print(int(time.time()))')
    printf '{"writtenAt":%s000,"fiveHour":{"usedPct":42,"resetsAt":%s},"sevenDay":{"usedPct":30,"resetsAt":%s}}\n' \
      "$now" "$((now+7200))" "$((now+400000))" > "$CD/usage-cache.json"
  fi

  cat > "$MUXCFG" <<LUA
return {
  initial_cols = $cols, initial_rows = $rows,
  unix_domains = { { name = 'pirdrill', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
  default_prog = { '/bin/bash', '$ROOT/bin/cockpit-layout.sh', '$R' },
  default_cwd = '$R',
}
LUA
  env -i HOME="$HOME_S" USER="${USER:-drill}" LOGNAME="${LOGNAME:-drill}" TERM=xterm-256color \
      SHELL=/bin/bash LANG=en_US.UTF-8 TMPDIR="$T/" \
      PATH="$T/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
      PIR_HOME="$T/pirhome" WEZTERM_UNIX_SOCKET="$T/sock" \
      DRILL_REPO="$R" DRILL_RUN="$RUN" DRILL_WK="$WK" \
      wezterm-mux-server --config-file "$MUXCFG" --daemonize
  wait_for 20 test -s "$CD/daemon.log" || { echo "drill: cockpit never started"; cat "$T/err" 2>/dev/null | tail -5; return 1; }
  fleet_listed() { text "$(pj fleet)" | grep -q "describe a task"; }
  wait_for 10 fleet_listed
  sleep 3
}


# ---------------------------------------------------------------------------
# What a screen shows
# ---------------------------------------------------------------------------
# The pane in the fleet slot: the cockpit tab's pane that is none of the others.
slot_pane() {
  local tab d s st f; tab=$(cockpit_tab); d=$(pj diff); s=$(pj shell); st=$(pj strip); f=$(pj foot)
  table | awk -v t="$tab" -v d="$d" -v s="$s" -v st="$st" -v f="$f" \
    '$2==t && $1!=d && $1!=s && $1!=st && $1!=f {print $1}'
}
# "slot shell strip diff" widths, and the diff pane's rows: the geometry that must hold
geometry() { echo "$(colsof "$(slot_pane)")x$(rowsof "$(slot_pane)") $(colsof "$(pj shell)") $(colsof "$(pj strip)") $(colsof "$(pj diff)")x$(rowsof "$(pj diff)")"; }
shows()    { screen "$1" | grep -qF -- "$2"; }
switch_visible() { screen "$(pj foot)" | grep -qE "Claude Agents +\| +PIR"; }
diff_has() { shows "$(pj diff)" "$1"; }
# BITBUCKET, not NOTES: at 80 columns the welcome pane drops its notes column.
welcome()  { shows "$(pj diff)" "BITBUCKET"; }
term_at()  { [ "$(cwdof "$(pj shell)")" = "$(real "$1")" ]; }
foot_line() { screen "$(pj foot)"; }
# SGR parameters in front of a footer label: "7" = reverse, "2;7" = dim reverse
label_sgr() { cli get-text --pane-id "$(pj foot)" --escapes | python3 -c "
import re,sys
lines=[l for l in sys.stdin.read().replace('\\r','').split('\\n')
       if re.sub(r'\\x1b(\\[[0-9;]*[a-zA-Z]|\\(B)','',l).strip()]
m=re.findall(r'\\x1b\\[([0-9;]*)m ?$(printf %s "$1")', lines[-1] if lines else '')
print(m[-1] if m else 'none')"; }
# The shown program's label is reverse video; bright when a switch is allowed, dim when not.
foot_bright() { local p; p=$(label_sgr "$1"); [[ ";$p;" == *";7;"* && ";$p;" != *";2;"* ]]; }
foot_dim()    { local p; p=$(label_sgr "$1"); [[ ";$p;" == *";7;"* && ";$p;" == *";2;"* ]]; }
program()  { tj fleet.program; }
is_program() { [ "$(program)" = "$1" ]; }
slot_is()  { [ "$(slot_pane)" = "$1" ]; }
attached() { tj agent; }
in_cockpit_tab() { [ "$(tabof "$1")" = "$(cockpit_tab)" ]; }
parked()   { local t; t=$(tabof "$1"); [ -n "$t" ] && [ "$t" != "$(cockpit_tab)" ]; }
count_panes_showing() { local n=0 id; for id in $(table | awk '{print $1}'); do
  shows "$id" "$1" && n=$((n+1)); done; echo "$n"; }
logged()   { grep -qF -- "$1" "$CD/daemon.log"; }
not() { ! "$@"; }

SNAPS="${DRILL_SNAPS:-}"
snap() {   # snap <size> <step>: every cockpit-tab pane's screen, for RESULTS.md
  [ -n "$SNAPS" ] || return 0
  mkdir -p "$SNAPS"; local f="$SNAPS/$1-$2.txt" id
  { echo "# $1 · $2 · geometry(slot shell strip diff) $(geometry)"
    for id in $(pj diff) $(slot_pane) $(pj shell) $(pj strip) $(pj foot); do
      echo "## pane $id $(paneinfo "$id")"; screen "$id" | sed -e 's/[[:space:]]*$//' | awk 'NF||p{print;p=1}' | head -40
    done; } > "$f" 2>&1
}
common() {   # checks that hold at every step
  check "$1: footer shows the Claude Agents | PIR switch" switch_visible
  check "$1: footer pane stays in the cockpit tab (landmark)" in_cockpit_tab "$(pj foot)"
  check "$1: bottom row and diff geometry unchanged ($BASE)" test "$(geometry)" = "$BASE"
}

drill_size() {
  local cols="$1" rows="$2" sz="${1}x${2}"
  echo; echo "### $sz"
  bring_up "$cols" "$rows" || { bad "$sz: bring-up"; teardown; return; }
  local FL; FL=$(pj fleet)

  echo "-- 1. fleet list, claude shown"
  BASE=$(geometry)
  echo "   geometry(slot shell strip diff) = $BASE"
  check "fleet slot holds the claude pane" test "$(slot_pane)" = "$FL"
  check "claude shows its list" wait_for 5 shows "$FL" "describe a task for a new session"
  check "top pane is the welcome/notes pane" welcome
  check "terminal at the repo" term_at "$R"
  check "footer: Claude Agents shown, bright" foot_bright "Claude Agents"
  # The O hint itself is trimmed away at both drill widths (usage-limits trim order),
  # so what is judged is the flag the footer draws it from.
  check "terminals.json reviewable (O offered)" test "$(tj reviewable)" = true
  check "terminals.json: program claude, switchable" test "$(program) $(tj fleet.switchable)" = "claude true"
  common "list"; snap "$sz" 1-list

  echo "-- 2. an agent attached: the switch is dim and refused"
  send "$FL" $'a\n'
  wait_for 15 diff_has alphaedit.txt
  check "diff shows the agent's worktree" diff_has alphaedit.txt
  check "terminal at the agent worktree" wait_for 5 term_at "$AG"
  check "footer dim with an agent attached" wait_for 3 foot_dim "Claude Agents"
  verb fleet-pir
  check "fleet-pir refused while attached" wait_for 3 logged "refusing fleet-pir: claude is not at its list"
  check "claude still shown" test "$(program)" = claude
  common "agent"; snap "$sz" 2-agent
  send "$FL" $'l\n'
  check "back at the list: welcome again" wait_for 10 welcome
  check "footer bright again" wait_for 3 foot_bright "Claude Agents"

  echo "-- 3. click PIR: pir takes the slot"
  verb fleet-pir
  check "program becomes pir" wait_for 10 is_program pir
  local PI; PI=$(pj pir)
  check "pir pane recorded in panes.json" test -n "$PI"
  check "pir pane is the one in the slot" wait_for 5 slot_is "$PI"
  check "pir shows its runs list" wait_for 5 shows "$PI" "view: list"
  check "claude pane parked, not killed" parked "$FL"
  check "state file written by pir" test -s "$CD/pir-dashboard.json"
  check "footer: PIR shown, bright" wait_for 3 foot_bright "PIR"
  check "welcome still up" wait_for 3 welcome
  check "terminal still at the repo" term_at "$R"
  common "pir list"; snap "$sz" 3-pir-list

  echo "-- 4. open a run: the plan's worktree from its fork point"
  send "$PI" $'run\n'
  check "diff shows the run's plan work" wait_for 15 diff_has planwork.txt
  check "main's later commit is not in the diff (fork point, not main's tip)" not diff_has mainlater.txt
  check "footer reads Custom: $FORK" wait_for 3 shows "$(pj foot)" "Custom: $FORK"
  check "terminals.json reviewable false" test "$(tj reviewable)" = false
  check "footer dim at a run" wait_for 3 foot_dim "PIR"
  check "terminal at the run worktree" wait_for 8 term_at "$RUN"
  check "custom-refs.json not written" test ! -e "$CD/custom-refs.json"
  verb fleet-claude
  check "fleet-claude refused at a run" wait_for 3 logged "refusing fleet-claude: pir is not at its list"
  common "run"; snap "$sz" 4-run

  echo "-- 5. open a worker: its task worktree, uncommitted"
  send "$PI" $'worker\n'
  check "diff shows the task's uncommitted file" wait_for 15 diff_has tasktwo.txt
  check "footer: Uncommitted Changes active" wait_for 3 foot_bright "Uncommitted Changes"
  check "terminal at the worker worktree" wait_for 8 term_at "$WK"
  check "footer dim at a worker" foot_dim "PIR"
  common "worker"; snap "$sz" 5-worker

  echo "-- 6. the worker's folder is removed (pir merged the task)"
  git -C "$R" worktree remove --force "$WK"
  # pir writes nothing here: the worker's recorded cwd has not changed. Before the
  # T06 fix revdiff sat on a chdir error until pir moved.
  check "folder gone, no pir write: the run is shown" wait_for 10 diff_has planwork.txt
  check "...and its terminal" wait_for 8 term_at "$RUN"
  snap "$sz" 6a-worker-gone-no-write
  send "$PI" $'again\n'; sleep 2
  check "the same report again keeps the run (DESIGN 2.5 fallback)" diff_has planwork.txt
  common "worker gone"; snap "$sz" 6b-worker-gone-rewrite

  echo "-- 7. back to the run, then back to the list"
  send "$PI" $'run\n'; sleep 1.5
  check "run still shown" wait_for 5 diff_has planwork.txt
  send "$PI" $'list\n'
  check "list: welcome back" wait_for 15 welcome
  check "list: terminal at the repo" wait_for 8 term_at "$R"
  check "list: footer PIR bright" wait_for 3 foot_bright "PIR"
  check "list: reviewable again (O offered)" test "$(tj reviewable)" = true
  common "pir list again"; snap "$sz" 7-pir-list-again

  echo "-- 8. click Claude Agents: claude back as it was"
  verb fleet-claude
  check "program becomes claude" wait_for 10 is_program claude
  check "claude pane back in the slot" wait_for 5 slot_is "$FL"
  check "claude still at its list" shows "$FL" "describe a task for a new session"
  check "pir pane parked, not killed" parked "$PI"
  check "footer Claude Agents bright" wait_for 3 foot_bright "Claude Agents"
  common "claude again"; snap "$sz" 8-claude-again

  echo "-- 9. ten fast alternating switches"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if [ $((i % 2)) -eq 1 ]; then verb fleet-pir; else verb fleet-claude; fi
    sleep 0.1
  done
  sleep 5
  check "exactly one claude pane" test "$(count_panes_showing 'describe a task for a new session')" = 1
  check "exactly one pir pane" test "$(count_panes_showing 'PIR STAND-IN')" = 1
  check "the last click (Claude Agents) is what is shown" is_program claude
  local sp; sp=$(slot_pane)
  if [ "$(program)" = pir ]; then
    check "slot holds pir as the footer says" test "$sp" = "$PI"
  else
    check "slot holds claude as the footer says" test "$sp" = "$FL"
  fi
  echo "   ended on $(program); daemon: $(grep -c 'fleet slot now shows' "$CD/daemon.log") switches, $(grep -c 'refusing fleet-' "$CD/daemon.log") refusals in all"
  common "fast switches"; snap "$sz" 9-fast

  echo "-- 10. pir exits with a run open: relaunched at its list, cockpit detaches"
  [ "$(program)" = pir ] || { verb fleet-pir; wait_for 10 is_program pir; }
  send "$PI" $'run\n'
  check "run attached before the crash" wait_for 15 diff_has planwork.txt
  local oldpid; oldpid=$(python3 -c "import json; print(json.load(open('$CD/pir-dashboard.json'))['pid'])")
  send "$PI" $'crash\n'
  check "crash: cockpit detaches to the welcome pane" wait_for 15 welcome
  check "crash: pir relaunched in the same pane, at its list" wait_for 5 shows "$PI" "view: list"
  check "crash: a new pir wrote the file" test "$(python3 -c "import json; print(json.load(open('$CD/pir-dashboard.json'))['pid'])")" != "$oldpid"
  check "crash: footer PIR bright" wait_for 3 foot_bright "PIR"
  send "$PI" $'run\n'
  check "run attached again" wait_for 15 diff_has planwork.txt
  send "$PI" $'quit\n'
  check "clean quit: cockpit detaches" wait_for 15 welcome
  check "clean quit: pir relaunched at its list" wait_for 5 shows "$PI" "view: list"
  check "clean quit: terminal at the repo" wait_for 8 term_at "$R"
  common "pir exit"; snap "$sz" 10-pir-exit

  check "daemon logged no uncaught error" not grep -qiE "uncaught|TypeError|ReferenceError" "$CD/daemon.log"
  [ -n "$SNAPS" ] && cp "$CD/daemon.log" "$SNAPS/$sz-daemon.log"
  teardown
}

for s in "${SIZES[@]}"; do drill_size "${s%x*}" "${s#*x}"; done
echo
if [ "$FAIL" -eq 0 ]; then echo "DRILL PASS ($PASS checks)"; else echo "DRILL FAILURES ($FAIL of $((PASS+FAIL)))"; exit 1; fi
