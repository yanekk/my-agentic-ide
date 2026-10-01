#!/usr/bin/env bash
# Integration test for cockpitd, with WezTerm stubbed out.
#
# Replaces `wezterm` on PATH with a shim that records every invocation (argv plus
# stdin) so the daemon's actual output can be asserted on without a real terminal.
# Drives a fake fleet log through a full attach -> review -> detach cycle.
#
# The shim models pane TITLES as well as the pane tree, because that is how the
# daemon tells a restored diff pane still has revdiff running in it (WezTerm
# titles a pane after its foreground process). Sending a command containing
# `revdiff` to a pane sets its title, exactly as launching it would -- and
# $TITLELAG names panes whose title should be reported STALE, because WezTerm's
# really does lag the launch by about a second.
#
#   bash spikes/cockpit-test/run.sh          the test command: every section, prints
#                                            ALL PASS (N checks); ~107s median on a
#                                            quiet machine, 770 checks (2026-09-28)
#   ONLY=11c,13b bash .../run.sh             a partial run while iterating -- NOT the
#                                            test command, never prints ALL PASS
#   SECTIONS=1 bash .../run.sh               list section ids and titles, run nothing
#   TIMINGS=1 bash .../run.sh                add seconds per section after the result
#   bash spikes/cockpit-test/stress.sh       repeat full runs, serial or concurrent,
#                                            to prove the suite stable (see its header)
# Details of each switch are under "the section runner" below.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T_START=${EPOCHREALTIME/,/.}

# --- the section runner (plans/test-suite-speed DESIGN §3.4, §3.5) -----------
#   ONLY=11c,13b   run those sections, each with every section before it IN ITS
#                  CHAIN (a section leans on the state its predecessors leave);
#                  a chain with nothing selected is skipped whole, daemon and all
#   SECTIONS=1     list every id and title, run nothing
#   TIMINGS=1      after the result line, seconds per section run and the total
# A partial run never prints ALL PASS: that string is what the test command and
# pir's waiters look for, and a few sections passing is not the suite passing.
#
# Every section's chain, in heading order. A heading added without a row here (or
# the reverse) stops the run below, before anything starts.
declare -A CHAIN_OF=()
SECTION_ORDER=()
chain() { local c=$1 id; shift; for id; do SECTION_ORDER+=("$id"); CHAIN_OF[$id]=$c; done; }
chain main 1 2 3 3b 4 4b 4c 4d 5 5b "5b'" 5c "5c'" "5c''" 5d "5d'" "5d''" 5e "5e'" 5f "5f'" \
  5g "5g'" 6 6b 7 8 9 9b 9c 9d 10 \
  11 11a 11b "11b'" "11b''" 11c "11c'" "11c''" "11c'''" "11c''''" "11c'''''" 11d "11d'" \
  11e 11f 11g 11h 11i 11j 11k 11l 11m 11n 11o 11p \
  15a 15b 15c 15d 15e 15f 15g 15h 15i 15j 15k 15k2 15l \
  16a 16b 16c 16d 16e 16f 16g 16h 16i 16i2 16j 16k 16l 16m 16m3 16m2 16n 16o 16p 15m 15n 15o
chain footer 12 12b 12c
chain agenda 13 13b 13c
chain dashboard 14 14d 14b 14c
chain usage 15

# The headings as written below: `if section <id> "<title>"; then`, the id
# double-quoted when it carries primes.
section_headings() {
  sed -nE 's/^if section ("([^"]+)"|([^ ]+)) "(.*)"; then$/\2\3\t\4/p' "$HERE/run.sh"
}
if [ "$(section_headings | cut -f1)" != "$(printf '%s\n' "${SECTION_ORDER[@]}")" ]; then
  echo "run.sh: the chain table (CHAIN_OF) is out of step with the section headings" >&2
  exit 2
fi
if [ -n "${SECTIONS:-}" ]; then
  section_headings | while IFS=$'\t' read -r id title; do
    printf '%-10s %-9s %s\n' "$id" "${CHAIN_OF[$id]}" "$title"
  done
  exit 0
fi

declare -A SEC_RUN=()    # id -> 1 for every section a partial run executes
PARTIAL=""
if [ -n "${ONLY:-}" ]; then
  declare -A upto=()     # chain -> index (in SECTION_ORDER) of its last selected id
  IFS=, read -ra _only <<< "$ONLY"
  for id in "${_only[@]}"; do
    id="${id//[[:space:]]/}"
    [ -z "$id" ] && continue
    if [ -z "${CHAIN_OF[$id]:-}" ]; then echo "unknown section: $id" >&2; exit 2; fi
    for i in "${!SECTION_ORDER[@]}"; do
      [ "${SECTION_ORDER[$i]}" = "$id" ] || continue
      c=${CHAIN_OF[$id]}
      [ "${upto[$c]:--1}" -lt "$i" ] && upto[$c]=$i
    done
  done
  if [ "${#upto[@]}" -gt 0 ]; then
    PARTIAL=1
    for i in "${!SECTION_ORDER[@]}"; do
      id=${SECTION_ORDER[$i]}; c=${CHAIN_OF[$id]}
      [ -n "${upto[$c]:-}" ] && [ "$i" -le "${upto[$c]}" ] && SEC_RUN[$id]=1
    done
  fi
fi
# chain_runs <chain>: does any of its sections run? Gates starting a chain's daemon.
chain_runs() {
  [ -z "$PARTIAL" ] && return 0
  local id; for id in "${!SEC_RUN[@]}"; do [ "${CHAIN_OF[$id]}" = "$1" ] && return 0; done
  return 1
}

SEC_CUR=""; SEC_T0=""; SEC_TIMES=()
section_close() {        # file the running section's time, if one is running
  [ -z "$SEC_CUR" ] && return 0
  SEC_TIMES+=("$(awk -v a="$SEC_T0" -v b="${EPOCHREALTIME/,/.}" 'BEGIN{ printf "%7.1fs", b - a }')  $SEC_CUR")
  SEC_CUR=""
}
# section <id> "<title>": print the heading and return 0 if the section runs, or
# return 1 to skip its body. Heading output is the same for full and partial runs.
section() {
  section_close
  [ -n "$PARTIAL" ] && [ -z "${SEC_RUN[$1]:-}" ] && return 1
  echo; echo "== $1. $2 =="
  SEC_CUR=$1; SEC_T0=${EPOCHREALTIME/,/.}
  return 0
}

T="$(mktemp -d)"
# ONE EXIT trap, set here and never replaced: bash keeps only the last one set.
# It stops every daemon/stub pid the sections below may leave set, then sweeps by
# $T for any cockpitd a section launched without a pid variable here
# (plans/test-daemon-leaks/DESIGN.md §2.3).
. "$ROOT/spikes/lib/test-daemons.sh"
DPID=""; D2PID=""; D3PID=""; GPID=""; D4PID=""; D5PID=""; D6PID=""; D7PID=""; BBPID=""
DUPID=""; USPID=""   # the usage chain's daemon and pir stand-in (section 15)
# SIDE_PIDS: the side-chain subshells (T08). Stopped as a tree, so a run killed
# while they are mid-chain takes their sleeps, stubs and daemons down with them.
SIDE_PIDS=""
trap 'daemon_stop $SIDE_PIDS $DPID $D2PID $D3PID $GPID $D4PID $D5PID $D6PID $D7PID $BBPID $DUPID $USPID; daemon_sweep "$T"; rm -rf "$T"' EXIT

# The reader's launch line, in ONE place: the scheme name is asserted in four
# sections (the browse launch, two heals and the worktree rebuild) and a change of
# scheme has to stay a single edit here and a single edit in `viewerCommand`.
MICRO_SCHEME="one-dark"
MICRO_LAUNCH="micro -readonly true -colorscheme $MICRO_SCHEME"

mkdir -p "$T/bin" "$T/state"
# Seatbelt (pir-usage-reader DESIGN 5.2): every cockpitd here polls
# ${PIR_HOME ?? HOME}/.pir/api.json. HOME is scratch per daemon, but a PIR_HOME the
# caller exports would win over it, so this suite exports its own before any
# daemon starts. It holds no .pir/, so every daemon but the usage chain's (which
# sets its own) reads `absent` and logs nothing.
export PIR_HOME="$T/pir-home"
mkdir -p "$PIR_HOME"
# --- stub wezterm ----------------------------------------------------------
# Records every call, and emulates enough of the mux to exercise the per-agent
# panes: `get-text` renders a fake fleet pane from $FLEETSTATE (which is how the
# daemon decides what is attached), and `list`/`split-pane`/
# `move-pane-to-new-tab`/`kill-pane` operate on a tiny pane table in $PANESTATE
# (lines: "<pane-id> <tab-id> <title>"). Pane ids are handed out in order, so the
# assertions below can name them. $EDITING holds a pane id whose revdiff should
# pretend its annotation editor is open.
export CALLS="$T/calls.log"
export FLEETSTATE="$T/fleetstate"
export PANESTATE="$T/panestate"
export NEXTPANE="$T/nextpane"
export NEXTTAB="$T/nexttab"
export EDITING="$T/editing"
export TITLELAG="$T/titlelag"
# $ACTIVE holds the pane id that `list` should report as is_active (the focused
# pane), which is how the daemon routes ⌥[/⌥] between diff-mode and terminals.
export ACTIVE="$T/active"
: > "$CALLS"
: > "$EDITING"
: > "$TITLELAG"
: > "$ACTIVE"
echo list > "$FLEETSTATE"
# diff, fleet, repo shell -- and 9, the footer: the daemon's landmark for which tab
# is the cockpit, since the fleet pane itself can be parked while pir is shown.
printf '9 0 sh\n10 0 sh\n20 0 sh\n30 0 sh\n' > "$PANESTATE"
echo 31 > "$NEXTPANE"
echo 1  > "$NEXTTAB"

cat > "$T/bin/wezterm" <<'STUB'
#!/usr/bin/env bash
# invoked as: wezterm cli <subcommand> [args...]
sub="${2:-}"

{
  printf 'ARGV:'
  for a in "$@"; do printf ' %q' "$a"; done
  printf '\n'
  # ONLY send-text carries stdin. Reading it for the others hangs: node's async
  # execFile leaves the stdin pipe open, so `cat` would block until the daemon's
  # 4s timeout on every poll -- which looks exactly like a dead mux.
  if [ "$sub" = "send-text" ] && [ ! -t 0 ]; then
    payload="$(cat)"
    printf 'STDIN:%s\n' "$(printf '%s' "$payload" | sed -e 's/$/\\n/' | tr -d '\n')"
  fi
  printf 'END\n'
} >> "$CALLS"

flag() {                       # flag <name> <argv...> -> value
  local want="$1"; shift
  while [ $# -gt 0 ]; do
    [ "$1" = "$want" ] && { printf '%s' "${2:-}"; return; }
    shift
  done
}
rewrite() { mv "$PANESTATE.tmp" "$PANESTATE"; }
title() { awk -v p="$1" '$1 == p { print $3 }' "$PANESTATE"; }
retitle() {
  awk -v p="$1" -v t="$2" '{ if ($1 == p) print $1, $2, t; else print }' \
      "$PANESTATE" > "$PANESTATE.tmp"
  rewrite
}

case "$sub" in
  send-text)
    # Launching a program makes it the pane's foreground process, so WezTerm
    # retitles the pane -- which is the signal the daemon reads back. For the two
    # browse-mode halves it is the ONLY signal: measured, neither broot nor micro
    # draws a single framed line, so get-text below deliberately answers them with
    # a bare shell prompt and the title has to carry the whole decision.
    case "$payload" in
      *revdiff*) retitle "$(flag --pane-id "$@")" revdiff ;;
      *broot*)   retitle "$(flag --pane-id "$@")" broot ;;
      *micro*)   retitle "$(flag --pane-id "$@")" micro ;;
    esac
    ;;
  get-text)
    pane=$(flag --pane-id "$@")
    if [ "$pane" = "20" ]; then                    # the fleet pane
      s=$(cat "$FLEETSTATE")
      if [ "$s" = "list" ]; then
          printf '  enter to collapse\n❯ describe a task for a new session\n'
      else
          printf -- '──────────────────────────── %s ─\n❯ \n' "$s"
      fi
    elif [ "$pane" = "$(cat "$EDITING")" ]; then   # revdiff, annotation editor up
      printf ' 💬 > half a comment\n [enter] save  [esc] cancel\n'
    elif [ "$(title "$pane")" = revdiff ]; then
      # revdiff frames the tree and the diff, so every row starts with a rule.
      for _ in 1 2 3 4 5 6 7 8; do printf '│  M f.txt   ││   1  1   context\n'; done
      printf ' f.txt | +2/-1 | 2 hunks |  ? help\n'
    else
      printf '$ \n'
    fi
    ;;
  list)
    # $PANECWD (lines "<pane> <file-url>") overrides a pane's reported cwd, so a
    # test can model a shell that stayed put while its agent moved on; default is
    # file:///tmp. tty_name is emitted for the idle check (which shells out to the
    # `ps` stub below).
    awk 'BEGIN{ printf "["
                while ((getline l < ENVIRON["TITLELAG"]) > 0) lag[l] = 1
                while ((getline a < ENVIRON["ACTIVE"]) > 0) active = a
                while ((getline c < ENVIRON["PANECWD"]) > 0) { n = split(c, kv, " "); if (n >= 2) cwd[kv[1]] = kv[2] } }
         { t = ($1 in lag) ? "sh" : $3
           act = ($1 == active) ? "true" : "false"
           u = ($1 in cwd) ? cwd[$1] : "file:///tmp"
           printf "%s{\"window_id\":0,\"tab_id\":%s,\"pane_id\":%s,\"workspace\":\"default\",\"size\":{\"rows\":10,\"cols\":40},\"title\":\"%s\",\"tty_name\":\"/dev/ttys%s\",\"cwd\":\"%s\",\"is_active\":%s}", (NR>1 ? "," : ""), $2, $1, t, $1, u, act }
         END{printf "]\n"}' "$PANESTATE"
    ;;
  split-pane)
    moved=$(flag --move-pane-id "$@")
    if [ -n "$moved" ]; then                       # move an existing pane
      # It joins the tab of the pane it is split INTO. Usually that is the cockpit
      # tab (a parked pane coming back), but the browse pair parks as a unit by
      # splitting the viewer in beside its ALREADY-PARKED browser, which lands both
      # in that browser's tab -- the one call that makes the pair one tab and not
      # two (T05, spikes/browse-mode/RESULTS.md 1).
      into=$(awk -v p="$(flag --pane-id "$@")" '$1 == p { print $2 }' "$PANESTATE")
      awk -v p="$moved" -v t="${into:-0}" '{ if ($1 == p) print $1, t, $3; else print }' "$PANESTATE" > "$PANESTATE.tmp"
      rewrite
      printf '%s\n' "$moved"
    else
      id=$(cat "$NEXTPANE"); echo $((id + 1)) > "$NEXTPANE"
      printf '%s 0 sh\n' "$id" >> "$PANESTATE"
      printf '%s\n' "$id"
    fi
    ;;
  move-pane-to-new-tab)                            # park
    pane=$(flag --pane-id "$@")
    tab=$(cat "$NEXTTAB"); echo $((tab + 1)) > "$NEXTTAB"
    awk -v p="$pane" -v t="$tab" '{ if ($1 == p) print $1, t, $3; else print }' "$PANESTATE" > "$PANESTATE.tmp"
    rewrite
    printf '%s\n' "$tab"
    ;;
  kill-pane)
    pane=$(flag --pane-id "$@")
    awk -v p="$pane" '$1 != p' "$PANESTATE" > "$PANESTATE.tmp"
    rewrite
    ;;
esac
exit 0
STUB
chmod +x "$T/bin/wezterm"

# --- stub ps ---------------------------------------------------------------
# The daemon asks `ps -t <tty> -o stat=,comm=` whether a terminal is idle (its
# foreground process is the login shell) before cd-ing it. $PSBUSY names a
# foreground command to report instead of the shell, so the busy path can be
# exercised; empty means idle.
#
# $PSFG maps a TTY to the command in its foreground group ("ttys41 broot"), which
# is how a test says "this pane really is running broot" independently of its
# TITLE. The two disagree on a real machine -- a shell with a preexec hook titles
# the pane after the command's first word -- and that disagreement is section 11b'.
# $PSBUSY is the older tty-blind switch; $PSFG wins wherever it names the tty.
#
# A $PSFG value may be a bare name OR an absolute path, because a real `ps -o comm=`
# gives both: measured 2026-09-02 on this machine, a homebrew binary reports its
# full path (`ps -p <pid> -o comm=` -> `/opt/homebrew/bin/node`), while the live
# cockpit's revdiff reported the bare `revdiff`. broot and micro are homebrew
# binaries, so on the real machine they answer as PATHS -- which is why the daemon
# reduces the answer to a basename, and why 11b' asserts through a path.
#
# A line may name MORE THAN ONE command ("ttys41 broot node"), and then every one
# of them is printed as its own `+` line, in order. That is not a contrivance: a
# program that spawns a child without putting it in a new process group leaves both
# in the foreground group at once, which is exactly what broot does while it runs
# the Enter verb (T13, measured under `script(1)`). Section 11c''''' is that case.
#
# The value `!fail` makes `ps` exit non-zero: the "no answer at all" branch, which
# must still read as a shell so a genuinely dead half is still healed.
#
# `ps -o tty= -p <pid>` is how the daemon tells the cockpit's own pir from another
# one writing the same state file (the dashboards a worker's test run spawns). $PSTTY
# maps a pid to its tty ("12345 ttys21"); an unmapped pid answers `??`, no terminal,
# which is what a real headless worker's is.
cat > "$T/bin/ps" <<'PS'
#!/usr/bin/env bash
tty=""; pid=""
while [ $# -gt 0 ]; do
  [ "$1" = "-t" ] && { tty="${2:-}"; shift; }
  [ "$1" = "-p" ] && { pid="${2:-}"; shift; }
  shift
done
if [ -n "$pid" ]; then
  t=$(awk -v p="$pid" '$1 == p { print $2 }' "${PSTTY:-/dev/null}" 2>/dev/null | tail -1)
  printf '%s\n' "${t:-??}"
  exit 0
fi
if [ -n "$tty" ] && [ -s "${PSFG:-/dev/null}" ]; then
  fg=$(awk -v t="$tty" '$1 == t { $1 = ""; sub(/^[ \t]+/, ""); print }' "$PSFG")
  [ "$fg" = "!fail" ] && exit 1
  if [ -n "$fg" ]; then
    printf 'Ss   /bin/zsh\n'
    for c in $fg; do printf 'S+   %s\n' "$c"; done
    exit 0
  fi
fi
if [ -s "$PSBUSY" ]; then printf 'R+ %s\n' "$(cat "$PSBUSY")"; else printf 'Ss+ zsh\n'; fi
PS
chmod +x "$T/bin/ps"
export PANECWD="$T/panecwd"; : > "$PANECWD"
export PSBUSY="$T/psbusy"; : > "$PSBUSY"
export PSFG="$T/psfg"; : > "$PSFG"
export PSTTY="$T/pstty"; : > "$PSTTY"

# --- stub broot ------------------------------------------------------------
# Only the CONTROL side is stubbed: the daemon never runs broot itself (it types
# a command line into a pane), but it does ask a running one where it is and send
# it back -- `broot --send <sock> --get-root` / `--cmd ":focus <path>"` (T09).
#
# $BROOTROOT holds where the fake broot claims its root is. `:focus` REWRITES it,
# so a successful fence closes its own loop exactly as the wezterm stub's retitle
# does: without that the daemon would keep sending, and "it was put back" could not
# be told from "it was told to go back, forever".
cat > "$T/bin/broot" <<'BROOT'
#!/usr/bin/env bash
printf 'BROOT: %s\n' "$*" >> "$CALLS"        # plain, not %q: these lines are asserted on
cmd=""; want_root=0
while [ $# -gt 0 ]; do
  case "$1" in
    --get-root) want_root=1 ;;
    --cmd)      cmd="${2:-}"; shift ;;
  esac
  shift
done
case "$cmd" in
  :focus\ *) printf '%s\n' "${cmd#:focus }" > "$BROOTROOT" ;;
esac
[ "$want_root" = 1 ] && cat "$BROOTROOT"
exit 0
BROOT
chmod +x "$T/bin/broot"
export BROOTROOT="$T/brootroot"; : > "$BROOTROOT"

# --- stub pir --------------------------------------------------------------
# Only its PRESENCE matters to the daemon: it resolves `pir` on PATH once at start
# and hands that path to cockpit-pir.sh on the pir pane's command line. The stub
# wezterm never runs a pane's program, so this is never executed here.
printf '#!/bin/sh\nexit 0\n' > "$T/bin/pir"
chmod +x "$T/bin/pir"

export PATH="$T/bin:$PATH"

# --- a real git repo to act as the agent's worktree -------------------------
WT="$T/worktree"
mkdir -p "$WT"
git init -q -b main "$WT"
git -C "$WT" config user.email t@t; git -C "$WT" config user.name t
echo base > "$WT/tracked.txt"
git -C "$WT" add -A; git -C "$WT" commit -qm base
git -C "$WT" checkout -qb agent-branch
echo changed >> "$WT/tracked.txt"
echo brand-new > "$WT/created-by-agent.txt"      # untracked, must still be reviewed

# A second worktree, to prove switching between agents follows to a new folder.
WT2="$T/worktree2"
mkdir -p "$WT2"
git init -q -b main "$WT2"
git -C "$WT2" config user.email t@t; git -C "$WT2" config user.name t
echo other > "$WT2/other.txt"
git -C "$WT2" add -A; git -C "$WT2" commit -qm base2

# A directory an agent moves INTO must be a real git repo, because the daemon now
# skips a non-repo cwd (isGitRepo, commit 2ce144d: an agent left at the projects
# root has nothing to review). The sections below simulate an agent entering a
# worktree it just created; a bare mkdir'd dir reads as a non-repo and the daemon
# rightly refuses to follow it, so these fixtures must be real repos like the real
# worktrees they stand in for.
mkrepo() {
  mkdir -p "$1"; git init -q -b main "$1"
  git -C "$1" config user.email t@t; git -C "$1" config user.name t
  git -C "$1" commit -q --allow-empty -m base
}

# --- stub `claude agents --json` -------------------------------------------
# Read from a file rather than baked in, so the fleet can lose an agent partway
# through and the terminal reaper can be observed.
export AGENTS_JSON="$T/agents.json"
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$WT","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":2,"id":"def67890","cwd":"$WT2","kind":"background",
  "sessionId":"s2","name":"second agent","startedAt":0,"status":"idle","state":"done"}]
JSON

# The side chains' daemons (sections 13, 13b, 14, 14d, 14b) read a SNAPSHOT of
# the fleet as it starts, never $AGENTS_JSON: the main chain rewrites that file as
# it goes (a reap, a migration, a stray agent), and with the chains running side
# by side (T08) what a side daemon saw would depend on how far main had got.
SIDE_AGENTS="$T/agents-side.json"; cp "$AGENTS_JSON" "$SIDE_AGENTS"

cat > "$T/bin/claude" <<'CLAUDE'
#!/usr/bin/env bash
[ "$1" = "agents" ] && cat "$AGENTS_JSON"
CLAUDE
chmod +x "$T/bin/claude"

# --- test speed -------------------------------------------------------------
# This suite is dominated by WAITING for the daemon's poll/settle intervals, not
# by computation: it pokes the daemon, then sleeps a beat for it to react, ~45
# times. COCKPIT_TEST_SPEED scales BOTH the daemon's internal timers (through
# COCKPIT_TIME_SCALE, passed below) AND every `nap` the script sleeps, by the same
# factor -- so a smaller value runs the identical scenario proportionally faster.
# 1.0 is the original timing. The default 0.5 was chosen by sweeping down and
# measuring pass-rate, when the suite was a fraction of its present size: 0.5 passed
# every repeat at ~1.7x the speed of 1.0 and kept margin on the timing-sensitive
# worktree-migration checks (section 9c). The speedup is sublinear because fixed
# costs (node startup, subprocess spawns) and a few detach/re-attach waits do NOT
# scale -- which is what protects those checks from going flaky. Re-run the sweep
# any time with e.g. `COCKPIT_TEST_SPEED=0.3 bash run.sh`; go lower and section 9c
# starts to flake.
# Most waits are now bounded polls (waitfor/waitmore/waituntil) that return the
# moment the daemon reacts, so SPEED mainly sets the daemon's own timers and the
# windows that prove something does NOT happen. Measured 2026-09-28 (plans/
# test-suite-speed T09, 770 checks): 10 serial full runs, median 106.7s, max 114.9s;
# 3 rounds of 4 concurrent, median 115.7s, max 116.9s; zero failures. Before that
# plan one run took 6 min 13 s.
SPEED="${COCKPIT_TEST_SPEED:-0.5}"
# nap N: sleep N seconds scaled by SPEED, with a small floor so it never hits zero.
nap() { sleep "$(awk -v b="$1" -v s="$SPEED" 'BEGIN{ v=b*s; if (v<0.05) v=0.05; printf "%.3f", v }')"; }
# The dashboard daemons' tick (D4, D6). cockpitd reads COCKPIT_BITBUCKET_TICK_MS
# as-is, NOT through COCKPIT_TIME_SCALE, so it is scaled here by the same factor
# as `nap`: a nap that proves "N ticks went by" must shrink with the tick, or a
# lower SPEED would prove it against a tick that no longer fits (DESIGN 3.2).
# 400ms at the default 0.5, as it was when it was a literal. D5 keeps its hour.
BB_TICK_MS="$(awk -v s="$SPEED" 'BEGIN{ v=800*s; if (v<50) v=50; printf "%d", v }')"

# --- state -----------------------------------------------------------------
echo '{"diff":10,"fleet":20,"shell":30,"foot":9,"repo":"'"$WT"'"}' > "$T/state/panes.json"
: > "$T/state/fleet.log"

# HOME is redirected so the daemon's stale-socket repair looks for wezterm
# sockets under $T and finds none, rather than relinking the real one.
mkdir -p "$T/home"
# SHELL is pinned so LOGIN_SHELL's basename ("zsh") matches what the ps stub
# reports as an idle terminal's foreground process. COCKPIT_REAP_MS is scaled by
# SPEED like everything else (never below 50ms); COCKPIT_TIME_SCALE scales the
# daemon's own poll/debounce/settle constants to match the naps below.
REAP_MS="$(awk -v s="$SPEED" 'BEGIN{ v=700*s; if (v<50) v=50; printf "%d", v }')"
# The agenda daemons' tick (sections 13, 13b) has its own env seam and is NOT
# scaled by COCKPIT_TIME_SCALE, so it is scaled here: 800*SPEED is the old fixed
# 400ms at the default 0.5, and `nap 0.8` is one tick at any SPEED (same 50ms floor
# as REAP_MS). Without this a lower SPEED would shrink the naps that prove "no
# fetch within N ticks" below the tick itself, and they would pass vacuously.
AGENDA_TICK_MS="$(awk -v s="$SPEED" 'BEGIN{ v=800*s; if (v<50) v=50; printf "%d", v }')"
# Staleness must outlast the whole agenda section (nothing may go stale unless a
# line zeroes its fetchedAt), and the section's length is mostly unscaled polls --
# so it scales UP with SPEED but never drops below the old 60s.
AGENDA_STALE_MS="$(awk -v s="$SPEED" 'BEGIN{ v=120000*s; if (v<60000) v=60000; printf "%d", v }')"
# AGENDA_ORIGIN points at a port nothing listens on. This daemon never has a
# calendar configured so it never fetches at all -- but a later edit that gave it
# one must fail loudly here rather than open a real socket to Google on whatever
# machine happens to be running the suite (DESIGN 5.2).
# Started only when a main-chain section runs: a partial run of another chain
# would pay its startup and its leak risk for nothing.
: > "$T/daemon.log"
if chain_runs main; then
HOME="$T/home" COCKPIT_DIR="$T/state" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_OWNER_PID="$$" \
    COCKPIT_TIME_SCALE="$SPEED" SHELL=/bin/zsh \
    AGENDA_ORIGIN="http://127.0.0.1:9" COCKPIT_TEST_PIR_WATCH_MUTE="$T/pir-watch-mute" \
    node "$ROOT/bin/cockpitd.mjs" > "$T/daemon.log" 2>&1 &
DPID=$!
sleep 1   # node startup is fixed overhead -- not scaled by SPEED
fi

fail=0
pass=0
# Quiet by default: a passing check just bumps the count. VERBOSE=1 restores the
# per-check "ok" listing (~950 lines, ~13k tokens across the suites -- that noise
# is why it is off unless asked for). Failures always print in full.
okline() { pass=$((pass+1)); [ -n "${VERBOSE:-}" ] && echo "  ok   $1"; return 0; }
check() {  # check <description> <pattern> <file>
  if grep -qF -- "$2" "$3"; then
    okline "$1"
  else
    echo "  FAIL $1"
    echo "       expected to find: $2"
    fail=1
  fi
}
refute() {
  if grep -qF -- "$2" "$3"; then echo "  FAIL $1"; fail=1; else okline "$1"; fi
}
# same <description> <got> <want>: an exact value, for the ids a park has to give
# back unchanged. `check` would pass on a substring, and pane ids are substrings of
# one another (31 is inside 131).
same() { if [ "$2" = "$3" ]; then okline "$1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }
# Which tab a pane sits in, straight out of the stub's pane table: 0 is the cockpit
# tab (in a slot), anything else is a park, and empty means the pane is GONE. That
# distinction is the whole of T05 -- a parked half is alive and off screen, a killed
# one is not coming back.
pane_tab() { awk -v p="$1" '$1 == p { print $2 }' "$PANESTATE"; }
parked() {   # parked <description> <pane>
  local t; t=$(pane_tab "$2")
  if [ -n "$t" ] && [ "$t" != 0 ]; then okline "$1"
  else echo "  FAIL $1"; echo "       pane $2 is in tab [${t:-gone}], expected a park"; fail=1; fi
}
in_slot() {  # in_slot <description> <pane>
  local t; t=$(pane_tab "$2")
  if [ "$t" = 0 ]; then okline "$1"
  else echo "  FAIL $1"; echo "       pane $2 is in tab [${t:-gone}], expected the cockpit tab"; fail=1; fi
}
# gone <description> <pane>: out of the mux altogether. A reap has to leave NOTHING
# behind -- a pane still sitting in some tab is one nobody can reach again, for the
# life of the window.
gone() {
  local t; t=$(pane_tab "$2")
  if [ -z "$t" ]; then okline "$1"
  else echo "  FAIL $1"; echo "       pane $2 is still in tab [$t], expected it killed"; fail=1; fi
}

# before <description> <earlier> <later> <file>: both present, in that order. The
# browse-mode pane dances are ORDERED -- split the incoming occupant in, dispose of
# the outgoing one afterwards -- and a plain grep passes just as happily backwards,
# which is the mistake that brings a pane back at half width.
before() {
  local a b
  a=$(grep -nF -- "$2" "$4" | head -1 | cut -d: -f1)
  b=$(grep -nF -- "$3" "$4" | head -1 | cut -d: -f1)
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then
    okline "$1"
  else
    echo "  FAIL $1"
    echo "       expected [$2] (line ${a:-none}) before [$3] (line ${b:-none})"
    fail=1
  fi
}
# before_last: the same, on the LAST occurrence of each. The daemon's log is
# cumulative and this suite reaps the same agent twice, so `before` would keep
# answering about the first reap however the second one behaved.
before_last() {
  local a b
  a=$(grep -nF -- "$2" "$4" | tail -1 | cut -d: -f1)
  b=$(grep -nF -- "$3" "$4" | tail -1 | cut -d: -f1)
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then
    okline "$1"
  else
    echo "  FAIL $1"
    echo "       expected [$2] (line ${a:-none}) before [$3] (line ${b:-none})"
    fail=1
  fi
}

# retitle <pane> <title>: what WezTerm reports for a pane's foreground process.
# Setting it to `sh` is how a test says "the user quit the program in that pane" --
# for the two browse halves it is the ONLY signal, since neither draws a frame.
retitle() {
  awk -v p="$1" -v t="$2" '{ if ($1 == p) print $1, $2, t; else print }' \
      "$PANESTATE" > "$PANESTATE.rt" && mv "$PANESTATE.rt" "$PANESTATE"
}
# waitfor <pattern> <file> <seconds> [description]: poll until it shows up. Where
# the daemon announces what it did, waiting for the announcement beats sleeping a
# guess -- and a wait that ENDS at a known moment is what makes the cooldown checks
# below measure a window rather than a race. With a description, a timeout also
# prints waited_fail's line, so the report says what never arrived rather than only
# the check after it failing; without one it stays silent, as every caller that
# predates the description expects.
waitfor() {
  local i=0 lim
  lim=$(awk -v s="$3" 'BEGIN{ printf "%d", s * 10 }')
  while [ "$i" -lt "$lim" ]; do
    grep -qF -- "$1" "$2" && return 0
    sleep 0.1; i=$((i + 1))
  done
  [ -n "${4:-}" ] && waited_fail "$3" "$4"
  return 1
}
# waited_fail <seconds> <description>: the one line every timed-out wait prints.
# It sets fail but does not count a check -- the assertion after the wait does.
waited_fail() { echo "  FAIL timed out after ${1}s waiting for: $2"; fail=1; }
# The daemon's log is cumulative, so a heal that has happened once already makes
# `check` pass without the daemon doing anything at all. Where the same line is
# expected AGAIN, the assertion is on its COUNT against a baseline taken first.
countof() { grep -cF -- "$1" "$2"; }
grew() {     # grew <description> <pattern> <file> <baseline>
  local n; n=$(countof "$2" "$3")
  if [ "${n:-0}" -gt "$4" ]; then okline "$1"
  else echo "  FAIL $1"; echo "       [$2] appears $n times, expected more than $4"; fail=1; fi
}
waitmore() { # waitmore <pattern> <file> <baseline> <seconds> [description]
  local i=0 lim n
  lim=$(awk -v s="$4" 'BEGIN{ printf "%d", s * 10 }')
  while [ "$i" -lt "$lim" ]; do
    n=$(countof "$1" "$2")
    [ "${n:-0}" -gt "$3" ] && return 0
    sleep 0.1; i=$((i + 1))
  done
  [ -n "${5:-}" ] && waited_fail "$4" "$5"
  return 1
}
# waituntil <seconds> <description> <command...>: poll for a condition that is not
# a log line -- a cache file's JSON, the stub's pane table, a call count. Runs the
# command (output discarded) every 0.1s until it exits 0, then returns 0 silently.
# On timeout it prints waited_fail's line, sets fail and returns 1; the run carries
# on, exactly as after a failed check. It is not itself a check: the assertion that
# follows it is, so replacing a sleep with it leaves the check count unchanged.
#
# The limit is deliberately NOT scaled by SPEED (DESIGN 3.1). It is not a window
# being proved -- a passing wait returns the moment the condition holds -- so it
# only decides how long a real failure takes to report. Scaling it down would make
# a loaded machine (four suites at once) fail waits that were merely slow.
# Like waitfor it counts 0.1s ticks, so a slow command stretches the limit rather
# than cutting it short.
waituntil() {
  local i=0 lim secs="$1" what="$2"
  shift 2
  lim=$(awk -v s="$secs" 'BEGIN{ printf "%d", s * 10 }')
  while :; do
    "$@" >/dev/null 2>&1 && return 0
    [ "$i" -ge "$lim" ] && break
    sleep 0.1; i=$((i + 1))
  done
  waited_fail "$secs" "$what"
  return 1
}

# The main chain (DESIGN 4.1). Each chain is a function so the dispatch at the
# bottom can run the three side chains alongside it (T08, DESIGN 3.6).
run_main() {
if section 1 "attach: panes retargeted"; then
# The pane now shows an agent; the log line is only a nudge to reconcile sooner.
echo "test agent" > "$FLEETSTATE"
echo '[DEBUG] [FV-attach] respawnJob abc12345: ok=false alive=true' >> "$T/state/fleet.log"
# The attach's last act is arming the annotation watch, which creates the review
# file (watchAnnotations writes it empty). Every pane move checked below precedes it.
waituntil 10 "the attach to finish (review-abc12345.md created)" test -e "$T/state/review-abc12345.md"

check "diff pane told to cd to the worktree"     "cd \"$WT\"" "$CALLS"
check "revdiff invoked with --wrap --untracked"  "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"
check "diff range is HEAD -> working tree"       "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"
check "annotations routed to a per-job file"     "review-abc12345.md" "$CALLS"
check "the agent got its OWN diff pane"          "opened diff pane 31" "$T/daemon.log"
check "revdiff typed into that pane, not the old one" "--pane-id 31 --no-paste" "$CALLS"
check "repo diff pane parked, not reused"        "move-pane-to-new-tab --pane-id 10" "$CALLS"
refute "the repo diff pane was not typed into"   "--pane-id 10 --no-paste" "$CALLS"
check "repo shell parked, not reused"            "move-pane-to-new-tab --pane-id 30" "$CALLS"
check "a terminal opened in the agent worktree"  "--cwd $WT --" "$CALLS"
# A cockpit terminal is where `note` lives. It cannot be inherited: split-pane
# spawns from the mux server, so the env is named on the command line or the
# command simply is not there.
check "the terminal carries the cockpit's note command" "/state/bin:" "$CALLS"
check "...and which repo's notes are its own"    "COCKPIT_REPO=$WT" "$CALLS"
check "opened terminal is pane 32"               "opened terminal pane 32" "$T/daemon.log"
refute "repo shell was not cd'd into the worktree" "--pane-id 30 --no-paste" "$CALLS"
fi

if section 2 "review flushed: typed into the fleet pane, unsent"; then
: > "$CALLS"
R0=$(countof "relaunched diff pane" "$T/daemon.log")
printf '## tracked.txt:2 (+)\nthis allocates in a loop\n' > "$T/state/review-abc12345.md"
waitfor "this allocates in a loop" "$CALLS" 10 "the review typed into the fleet pane"
# The send also resets the diff (resetDiffAfterReview: Q, then a relaunch). Wait for
# it to finish so section 3's detach does not land in the middle of it.
waitmore "relaunched diff pane" "$T/daemon.log" "$R0" 10 "the diff reset after the send"

check "sent to the FLEET pane"                   "--pane-id 20" "$CALLS"
check "annotation text present"                  "this allocates in a loop" "$CALLS"
check "sent raw (editable), not as a chip"       "--no-paste" "$CALLS"
refute "no carriage return in payload"           '\r' "$CALLS"
fi

if section 3 "detach: injection refused while the fleet list is showing"; then
echo list > "$FLEETSTATE"
echo '[DEBUG] [FV-attach] attachJob returned after 2020ms — remounting list' >> "$T/state/fleet.log"
# The detach's last act is the repo shell's showTerminal writing terminals.json.
waituntil 10 "the detach to finish (terminals.json back to repo)" grep -qF '"agent":"repo"' "$T/state/terminals.json"
: > "$CALLS"
printf '## tracked.txt:9 (+)\nSHOULD NOT BE SENT\n' >> "$T/state/review-abc12345.md"
nap 1   # window: ANNOTATION_DEBOUNCE_MS (250, scaled) before a wrongful inject, 750 margin

# Nothing reaches the fleet pane once the list is showing. Two independent
# mechanisms enforce this and only the first is exercised here: watchers are torn
# down on detach, so injectReview is never called. The `attached` guard inside
# injectReview is deliberate belt-and-braces for any path that slips past that.
refute "nothing typed after detach"              "SHOULD NOT BE SENT" "$CALLS"
check  "detach was processed"                    "exit abc12345" "$T/daemon.log"
refute "no stray git errors in the log"          "fatal:" "$T/daemon.log"
fi

if section 3b "a SECOND flush injects too (atomic rename must not kill the watch)"; then
# revdiff flushes by writing a temp file and renaming it over the target, so the
# path gets a new inode each time. Watching the file rather than its directory
# fired once and then watched a deleted inode forever -- the second O did nothing.
#
# The re-attach re-arms the watch by EMPTYING the review file (watchAnnotations),
# and section 3 left "SHOULD NOT BE SENT" in it -- so an empty file is the signal
# that the watch is up. The planning baseline flaked here under load: a flush
# written after a fixed sleep but before the re-attach finished was wiped by that
# emptying, or landed with no watch at all, and the fixed wait after each flush was
# shorter than the inject + reset (Q, settle, relaunch) took on a loaded machine.
echo "test agent" > "$FLEETSTATE"          # re-attach
waituntil 10 "the re-attach to arm the annotation watch (review file emptied)" test ! -s "$T/state/review-abc12345.md"
: > "$CALLS"
R0=$(countof "relaunched diff pane" "$T/daemon.log")
printf '## a.txt:1 (+)\nfirst flush\n' > "$T/state/tmp.$$" \
    && mv "$T/state/tmp.$$" "$T/state/review-abc12345.md"
waitfor "first flush" "$CALLS" 10 "the first flush injected"
check "first flush injected"                     "first flush" "$CALLS"
# Its reset empties the file and relaunches revdiff; a second flush written before
# that emptying would be wiped by it, so the reset has to be over first.
waitmore "relaunched diff pane" "$T/daemon.log" "$R0" 10 "the diff reset after the first flush"

: > "$CALLS"
R0=$(countof "relaunched diff pane" "$T/daemon.log")
printf '## a.txt:1 (+)\nfirst flush\n## b.txt:2 (+)\nsecond flush\n' > "$T/state/tmp2.$$" \
    && mv "$T/state/tmp2.$$" "$T/state/review-abc12345.md"
waitmore "relaunched diff pane" "$T/daemon.log" "$R0" 10 "the second flush injected and its diff reset"
check "second flush injected after rename"       "second flush" "$CALLS"
# Sending a review now ENDS it (see resetDiffAfterReview): the daemon empties the
# handoff file and relaunches the diff clean. That relaunch drops the annotations
# revdiff holds in memory and re-reads HEAD, which is what lets the agent's next
# commit refresh the diff -- a handoff file left full used to freeze it after one
# send, showing committed work as uncommitted until the next re-attach.
check "the diff is reset (relaunched clean) on send" \
      "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"
# The reset must quit revdiff with Q (discard), not q. revdiff writes its
# annotations to the -o file ON QUIT, so a plain q re-writes the annotations just
# flushed and the watcher injects the SAME review a second time -- the comments
# arrive twice. Q discards without writing (--no-confirm-discard is set).
check "revdiff quit with Q (discard) on send, not q" "STDIN:Q" "$CALLS"
refute "the send did not quit with a plain q"        "STDIN:q" "$CALLS"
[ -s "$T/state/review-abc12345.md" ] \
    && { echo "  FAIL the handoff file was not emptied on send"; fail=1; } \
    || okline "handoff file emptied on send"

: > "$CALLS"
touch "$T/state/review-abc12345.md"        # bare re-touch: the reset already cleared it
nap 1   # window: ANNOTATION_DEBOUNCE_MS (250, scaled) before a wrongful re-inject, 750 margin
# "Press O twice to re-send the same review" is deliberately gone: a sent review
# leaves no annotations, so re-touching the now-empty handoff file injects nothing.
refute "a spent review does not re-inject"       "second flush" "$CALLS"
fi

if section 4 "switch A→B with NO log line: the pane itself is the signal"; then
: > "$CALLS"
echo "second agent" > "$FLEETSTATE"     # nothing appended to fleet.log
waituntil 10 "the attach to def67890 to finish (its review file created)" test -e "$T/state/review-def67890.md"

check "followed to the second agent's worktree"  "cd \"$WT2\"" "$CALLS"
check "resolved it by the name in the header"    "enter def67890" "$T/daemon.log"
check "review file re-keyed to the new job"      "review-def67890.md" "$CALLS"
refute "did not stay on the first worktree"      "cd \"$WT\" " "$CALLS"
check "first agent's diff parked, not killed"    "move-pane-to-new-tab --pane-id 31" "$CALLS"
check "first agent's terminal parked, not killed" "move-pane-to-new-tab --pane-id 32" "$CALLS"
check "second agent got its own diff pane"       "opened diff pane 33" "$T/daemon.log"
check "second agent got its own terminal"        "--cwd $WT2 --" "$CALLS"
refute "nothing was killed on a switch"          "kill-pane" "$CALLS"
fi

if section 4b "the PARKED agent's diff keeps following its worktree"; then
# This is what stops a restored pane from being a snapshot of whenever you last
# looked at it: the first agent's watcher is still running, so its revdiff
# reloads while it sits in a background tab.
: > "$CALLS"
: > "$T/state/review-abc12345.md"          # nothing flushed, so reloading is allowed
echo "more work by the agent" >> "$WT/tracked.txt"
waitfor 'STDIN:R\n' "$CALLS" 10 "an R sent to the parked diff"

check "a reload was sent"                        'STDIN:R\n' "$CALLS"
check "...to the first agent's PARKED pane"      "send-text --pane-id 31 --no-paste" "$CALLS"
refute "...and not to the visible one"           "send-text --pane-id 33 --no-paste" "$CALLS"
fi

if section 4c "nothing is typed into a pane whose annotation editor is open"; then
# revdiff reads every keystroke as comment text while the editor is up, so an
# auto-reload R would be typed INTO the comment -- unseen, in a parked pane.
: > "$CALLS"
echo 31 > "$EDITING"
E0=$(countof "annotation editor is open" "$T/daemon.log")
echo "yet more work" >> "$WT/tracked.txt"
waitmore "annotation editor is open" "$T/daemon.log" "$E0" 10 "the reload refused for the open editor"

refute "no reload while a comment is half-typed" "send-text --pane-id 31 --no-paste" "$CALLS"
check  "and the daemon said why"                 "annotation editor is open" "$T/daemon.log"
: > "$EDITING"
fi

if section 4d "ignored churn and identical rewrites send no reload; a real change does"; then
# Every R makes revdiff re-run git and repaint, a visible flicker even over an
# identical diff. A repo with pir running rewrites gitignored status files several
# times a second, and the pane flickered for ever over a diff that never changed.
# Three kinds of path the diff cannot show: ignored through .gitignore, ignored
# ONLY through .git/info/exclude (a .gitignore-only check calls it live), and a
# nested worktree git does not ignore at all (the parent's diff lists it as one
# entry and never sees inside it -- that one is the fingerprint's to catch).
printf 'churn/\n' > "$WT/.gitignore"
echo 'excluded-only/' >> "$WT/.git/info/exclude"
mkdir -p "$WT/churn" "$WT/excluded-only"
git -C "$WT" worktree add -q -b nested-wt "$WT/nested" 2>/dev/null
: > "$CALLS"
echo "setup done" >> "$WT/tracked.txt"     # a real change, so the baseline is fresh
waitfor 'STDIN:R\n' "$CALLS" 10 "the setup's reload"
nap 2.5   # window: RELOAD_DEBOUNCE_MS (1200, scaled) for any trailing setup event, 1300 margin

: > "$CALLS"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  echo x >> "$WT/churn/status.log"; echo x >> "$WT/excluded-only/run.log"
  echo x >> "$WT/nested/scratch.txt"; nap 0.2
done
nap 2.5   # window: the burst settles RELOAD_DEBOUNCE_MS after its last event, 1300 margin
refute "writes under .gitignore / info/exclude / a nested worktree send no reload" "STDIN:R\n" "$CALLS"

cp "$WT/tracked.txt" "$T/same.txt"; cat "$T/same.txt" > "$WT/tracked.txt"
nap 2.5   # window: as above
refute "a tracked file rewritten with identical bytes sends no reload" "STDIN:R\n" "$CALLS"

echo "real change" >> "$WT/tracked.txt"
waitfor 'STDIN:R\n' "$CALLS" 10 "a reload for a real change"
check "a real change to a tracked file still reloads" "send-text --pane-id 31 --no-paste" "$CALLS"
nap 2.5

# Endless ignored churn must not starve a real change: the trailing debounce keeps
# restarting, so only RELOAD_MAX_WAIT_MS (4000, scaled) gets it out. The churn runs
# ~6s with gaps far under the debounce, and the R must land before it stops.
: > "$CALLS"
echo "real change under churn" >> "$WT/tracked.txt"
for _ in $(seq 1 30); do echo x >> "$WT/churn/status.log"; nap 0.2; done
check "a real change lands while ignored churn never pauses" "STDIN:R\n" "$CALLS"

git -C "$WT" worktree remove --force "$WT/nested"; git -C "$WT" branch -qD nested-wt
rm -rf "$WT/churn" "$WT/excluded-only" "$WT/.gitignore"
sed -i '' '/^excluded-only\/$/d' "$WT/.git/info/exclude"
nap 2.5   # let the cleanup's own reload settle before section 5 clears $CALLS
fi

if section 5 "switching BACK restores both panes (the whole point)"; then
# The panes are moved, never respawned: whatever was running is still running,
# revdiff still has the diff parsed, and scrollback comes back with them.
#
# The restored pane's TITLE is reported stale here on purpose. WezTerm's lags a
# launch by about a second and longer across a move, and believing it would
# retype the whole revdiff command into a running revdiff, where every character
# is a keybinding. The framed screen is what has to carry the decision.
: > "$CALLS"
echo 31 > "$TITLELAG"
echo "test agent" > "$FLEETSTATE"
# showTerminal's terminals.json write is the switch's last pane step.
waituntil 10 "the switch back to test agent (terminals.json)" grep -qF '"agent":"test agent"' "$T/state/terminals.json"

check "the agent's diff pane is moved back in"   "--move-pane-id 31" "$CALLS"
check "the agent's terminal is moved back in"    "--move-pane-id 32" "$CALLS"
check "daemon says restored, not opened (diff)"  "restored diff pane 31" "$T/daemon.log"
check "daemon says restored, not opened (term)"  "restored terminal pane 32" "$T/daemon.log"
refute "no second shell spawned for that agent"  "--cwd $WT --" "$CALLS"
# The reason switching back is instant: nothing is retyped and no diff reparsed.
refute "revdiff was NOT restarted on return"     "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"
refute "no cd was retyped either"                "cd \"$WT\"" "$CALLS"
check "second agent's diff parked in turn"       "move-pane-to-new-tab --pane-id 33" "$CALLS"
: > "$TITLELAG"
check "second agent's terminal parked in turn"   "move-pane-to-new-tab --pane-id 34" "$CALLS"
fi

if section 5b "⌥] with the diff pane focused switches the diff MODE, not a terminal"; then
# The same keys cycle terminals when a terminal is focused and diff modes when the
# diff pane is. Focus is read from the cockpit tab's active pane (is_active).
: > "$CALLS"
echo 31 > "$ACTIVE"                       # focus the agent's diff pane (31)
echo next >> "$T/state/cmd"
# A mode switch ends by handing focus back to the relaunched diff pane.
waitfor "activate-pane --pane-id 31" "$CALLS" 10 "the switch to last-commit"

check "the running revdiff was quit first"       "STDIN:q\n" "$CALLS"
check "revdiff relaunched in the last-commit range" "revdiff --wrap --no-confirm-discard -o \"$T/state/review-abc12345.md\" HEAD~1 HEAD" "$CALLS"
check "...in the agent's OWN diff pane"           "send-text --pane-id 31" "$CALLS"
check "this agent's mode is now last-commit"      '"diffMode":"lastcommit"' "$T/state/terminals.json"
check "an attached agent is reviewable (pir-pane)" '"reviewable":true' "$T/state/terminals.json"
check "the switch was logged"                     "relaunched diff pane 31 for abc12345 in lastcommit" "$T/daemon.log"
fi

if section "5b'" "toggling again returns to the uncommitted range"; then
: > "$CALLS"
echo prev >> "$T/state/cmd"
waitfor "activate-pane --pane-id 31" "$CALLS" 10 "the switch back to uncommitted"
check "back to HEAD -> working tree"              "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"
check "this agent's mode is back to uncommitted"  '"diffMode":"uncommitted"' "$T/state/terminals.json"
fi

if section 5c "⌥] with a TERMINAL focused leaves the diff mode alone"; then
# Focus routing must not fire the diff switch when the reviewer is in a terminal.
: > "$CALLS"
echo 32 > "$ACTIVE"                       # focus the agent's terminal, not the diff
echo next >> "$T/state/cmd"
nap 1   # window: the cmd tail's read (200) + SHELL_SETTLE_MS (400) before a wrongful relaunch, scaled; 400 margin
refute "the diff was not relaunched"              "HEAD~1 HEAD" "$CALLS"
check  "the mode is untouched"                    '"diffMode":"uncommitted"' "$T/state/terminals.json"
fi

if section "5c'" "a revdiff flush (O) jumps focus to the agent's Claude pane"; then
# revdiff's flush key IS O, so it can no longer be a WezTerm binding (that stole
# the key and stopped the flush). Instead --post-flush-command appends focus-claude
# after a successful flush, and the daemon activates the fleet/Claude pane (20) --
# where injectReview has just typed the review. No focus gate: only a real flush
# emits this.
: > "$CALLS"
echo 32 > "$ACTIVE"                       # even from the terminal (the verb only ever comes from revdiff)
echo focus-claude >> "$T/state/cmd"
waitfor "activate-pane --pane-id 20" "$CALLS" 10 "focus moved to the Claude pane"
check "focus moved to the Claude (fleet) pane"    "activate-pane --pane-id 20" "$CALLS"
refute "did NOT focus the shell pane"             "activate-pane --pane-id 32" "$CALLS"
fi

if section "5c''" "revdiff is launched with the focus-claude post-flush command"; then
# The flush->focus jump rides on revdiff's own --post-flush-command, not a keybind.
: > "$CALLS"
echo 31 > "$ACTIVE"                       # focus the diff pane
echo next >> "$T/state/cmd"               # uncommitted -> last-commit forces a relaunch
waitfor "activate-pane --pane-id 31" "$CALLS" 10 "the switch to last-commit"
check "revdiff carries the post-flush hook"       "--post-flush-command \"echo focus-claude >> $T/state/cmd\"" "$CALLS"
: > "$CALLS"
echo prev >> "$T/state/cmd"               # back to uncommitted, restoring state for later sections
waitfor "activate-pane --pane-id 31" "$CALLS" 10 "the switch back to uncommitted"
: > "$ACTIVE"                             # unfocus for the remaining sections
fi

if section 5d "cycling into Custom opens the ASCII prompt, unset revdiff until answered"; then
# Custom asks for a branch/SHA every time you cycle in (pre-filled per agent).
# The daemon quits revdiff and types the prompt script into the SAME pane; it
# does NOT launch revdiff until the answer comes back through the cmd channel.
# Two steps forward, because BROWSE is now the fourth stop and sits between
# custom and uncommitted -- one `prev` from uncommitted lands on browse (11 below).
echo 31 > "$ACTIVE"                       # focus the diff pane
L0=$(countof "in lastcommit mode" "$T/daemon.log")
echo next >> "$T/state/cmd"               # uncommitted -> lastcommit
waitmore "in lastcommit mode" "$T/daemon.log" "$L0" 10 "the switch to last-commit"
: > "$CALLS"
P0=$(countof "opened custom-range prompt" "$T/daemon.log")
echo next >> "$T/state/cmd"               # lastcommit -> custom
waitmore "opened custom-range prompt" "$T/daemon.log" "$P0" 10 "the custom prompt opened"
check "the running revdiff was quit first"        "STDIN:q\n" "$CALLS"
check "the custom-range prompt was launched"      "cockpit-custom-prompt.mjs" "$CALLS"
check "...in the agent's OWN diff pane"           "send-text --pane-id 31" "$CALLS"
check "this agent's mode is now custom"           '"diffMode":"custom"' "$T/state/terminals.json"
refute "revdiff is NOT relaunched yet"            "revdiff --wrap" "$CALLS"
fi

if section "5d'" "answering the prompt launches revdiff against that ref, persisted per agent"; then
# The prompt writes the chosen ref + a custom-ok verb (here we stand in for it).
: > "$CALLS"
printf '{"jobId":"abc12345","ref":"main"}' > "$T/state/custom-ref-pending"
echo custom-ok >> "$T/state/cmd"
waitfor "custom range set for abc12345: main" "$T/daemon.log" 10 "the custom range set"
check "revdiff diffs the given ref -> working tree" "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" \"main\"" "$CALLS"
check "...in the agent's OWN diff pane"            "send-text --pane-id 31" "$CALLS"
check "the per-agent ref was persisted"           "\"abc12345\":\"main\"" "$T/state/custom-refs.json"
check "the base was set was logged"               "custom range set for abc12345: main" "$T/daemon.log"
fi

if section "5d''" "cancelling the prompt reverts to the previous mode"; then
# Leave custom (backwards, to last-commit -- forwards is browse now), then cycle
# back in so the prompt opens with last-commit as the mode to fall back to, and
# answer with a cancel.
L0=$(countof "in lastcommit mode" "$T/daemon.log")
echo prev >> "$T/state/cmd"               # custom -> lastcommit
waitmore "in lastcommit mode" "$T/daemon.log" "$L0" 10 "the switch back to last-commit"
: > "$CALLS"
P0=$(countof "opened custom-range prompt" "$T/daemon.log")
echo next >> "$T/state/cmd"               # lastcommit -> custom, opens the prompt again
waitmore "opened custom-range prompt" "$T/daemon.log" "$P0" 10 "the custom prompt opened again"
check "the prompt opened again"                   "cockpit-custom-prompt.mjs" "$CALLS"
: > "$CALLS"
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
echo custom-cancel >> "$T/state/cmd"
# The cancel relaunches revdiff, then writes the reverted mode to terminals.json.
waituntil 10 "the cancel to revert to last-commit" grep -qF '"diffMode":"lastcommit"' "$T/state/terminals.json"
check "cancel reverted to the prior mode"         '"diffMode":"lastcommit"' "$T/state/terminals.json"
check "and revdiff came back in that range"       "revdiff --wrap --no-confirm-discard -o \"$T/state/review-abc12345.md\" HEAD~1 HEAD" "$CALLS"
U0=$(countof "in uncommitted mode" "$T/daemon.log")
echo prev >> "$T/state/cmd"               # back to the uncommitted default for 5e
waitmore "in uncommitted mode" "$T/daemon.log" "$U0" 10 "the switch back to uncommitted"
fi

if section 5e "the diff mode is PER AGENT: a new agent is never carried into another's mode"; then
# Put this agent in last-commit, switch to the OTHER agent, and it must come up
# in the uncommitted default -- not inherit last-commit. (Its parked revdiff was
# launched uncommitted and comes back untouched.)
echo 31 > "$ACTIVE"                       # focus abc12345's diff pane
L0=$(countof "in lastcommit mode" "$T/daemon.log")
echo next >> "$T/state/cmd"               # uncommitted -> last-commit for abc12345 only
waitmore "in lastcommit mode" "$T/daemon.log" "$L0" 10 "the switch to last-commit"
check "this agent went to last-commit"            '"diffMode":"lastcommit"' "$T/state/terminals.json"
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"       # switch to def67890
waituntil 10 "the switch to second agent (terminals.json)" grep -qF '"agent":"second agent"' "$T/state/terminals.json"
check "the OTHER agent shows the uncommitted default" '"diffMode":"uncommitted"' "$T/state/terminals.json"
refute "it did NOT inherit last-commit"           "HEAD~1 HEAD" "$CALLS"
fi

if section "5e'" "switching back leaves abc12345 in its own last-commit, then reset"; then
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"         # back to abc12345
waituntil 10 "the switch back to test agent (terminals.json)" grep -qF '"agent":"test agent"' "$T/state/terminals.json"
check "abc12345 kept its own last-commit mode"    '"diffMode":"lastcommit"' "$T/state/terminals.json"
# Reset to the uncommitted default so the later sections see the default range.
echo 31 > "$ACTIVE"
U0=$(countof "in uncommitted mode" "$T/daemon.log")
echo prev >> "$T/state/cmd"               # last-commit -> uncommitted
waitmore "in uncommitted mode" "$T/daemon.log" "$U0" 10 "the switch back to uncommitted"
check "reset to the uncommitted default"          '"diffMode":"uncommitted"' "$T/state/terminals.json"
: > "$ACTIVE"                             # unfocus for the remaining sections; back at the uncommitted default
fi

if section 5f "clicking a diff-mode label switches the mode regardless of focus"; then
# The footer appends `diff-<mode>` to the cmd channel when a label is clicked.
# Unlike ⌥[/⌥], a click names the mode outright and must NOT depend on which pane
# is focused -- the click landed on the footer, not the diff pane. $ACTIVE is left
# empty so no pane reads as the focused diff pane, proving focus-independence.
: > "$CALLS"; : > "$ACTIVE"
echo diff-lastcommit >> "$T/state/cmd"
waitfor "activate-pane --pane-id 31" "$CALLS" 10 "the clicked switch to last-commit"
check "clicked label switched to last-commit while unfocused" "revdiff --wrap --no-confirm-discard -o \"$T/state/review-abc12345.md\" HEAD~1 HEAD" "$CALLS"
check "the mode reflects the clicked label"       '"diffMode":"lastcommit"' "$T/state/terminals.json"

: > "$CALLS"
echo diff-uncommitted >> "$T/state/cmd"
waitfor "activate-pane --pane-id 31" "$CALLS" 10 "the clicked switch to uncommitted"
check "clicking Uncommitted returns to that range" "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"
check "the mode is back to uncommitted"           '"diffMode":"uncommitted"' "$T/state/terminals.json"

: > "$CALLS"
echo diff-uncommitted >> "$T/state/cmd"           # clicking the ALREADY-active label
nap 1   # window: the cmd tail's read (200) + SHELL_SETTLE_MS (400) before a wrongful relaunch, scaled; 400 margin
refute "clicking the active label relaunches nothing" "revdiff --wrap" "$CALLS"
fi

if section "5f'" "clicking Custom always (re)opens the ref prompt"; then
# Matches "cycling into custom always re-prompts": a click on Custom pops the
# prompt so the base ref can be entered (or changed), and revdiff is not
# relaunched until the answer comes back.
: > "$CALLS"
P0=$(countof "opened custom-range prompt" "$T/daemon.log")
echo diff-custom >> "$T/state/cmd"
waitmore "opened custom-range prompt" "$T/daemon.log" "$P0" 10 "the clicked custom prompt"
check "clicking Custom opened the ref prompt"     "cockpit-custom-prompt.mjs" "$CALLS"
check "the mode is now custom"                    '"diffMode":"custom"' "$T/state/terminals.json"
refute "revdiff is NOT relaunched until answered" "revdiff --wrap" "$CALLS"
# Cancel so state is clean and later sections see the uncommitted default again.
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
echo custom-cancel >> "$T/state/cmd"
waituntil 10 "the cancel to revert to uncommitted" grep -qF '"diffMode":"uncommitted"' "$T/state/terminals.json"
check "cancel reverted to the uncommitted default" '"diffMode":"uncommitted"' "$T/state/terminals.json"
fi

if section 5g "the strip's [+ add] and [x] buttons manage terminals by number"; then
# The strip appends `new` ([+ add]) and `close-<n>` (a terminal's [x]) to the cmd
# channel; like 5f these name the action outright, so they are driven here by
# writing the verb directly (the click->verb mapping itself needs a real WezTerm
# pointer and is verified by hand). abc12345 is attached with its one terminal.
# Every open/close below is of a FRESH pane -- the agent's original terminal (32,
# leaned on by later sections) is never the one killed -- so the section nets to
# zero and leaves that one terminal exactly as it found it.
: > "$CALLS"
O0=$(countof "opened terminal pane" "$T/daemon.log")
echo new >> "$T/state/cmd"                        # [+ add]
# A terminal command's last act is writing terminals.json, after its log line.
waituntil 10 "[+ add] to open terminal #2" grep -qF '"n":2' "$T/state/terminals.json"
check "[+ add] opened a second terminal"          '"n":2' "$T/state/terminals.json"
# Count-based: section 1 already logged "opened terminal pane" (DESIGN 3.3).
grew  "opening a terminal was logged"             "opened terminal pane" "$T/daemon.log" "$O0"

# close-2 targets the terminal ON SCREEN (the one just added, now current): the
# slot-dance path brings the original sibling back before killing the new one.
: > "$CALLS"
echo close-2 >> "$T/state/cmd"
waituntil 10 "[x] to close on-screen terminal #2" sh -c '! grep -qF "\"n\":2" "$1"' _ "$T/state/terminals.json"
check "[x] on the on-screen terminal closed it"   "closed terminal pane" "$T/daemon.log"
refute "one terminal left after closing #2"       '"n":2' "$T/state/terminals.json"

# Add another, switch BACK to #1, then close-2 -- terminal #2 is now PARKED (not on
# screen), so the no-slot-dance path just kills it and keeps #1 shown. ($ACTIVE is
# empty, so `prev` cycles terminals, not the diff mode.)
: > "$CALLS"
echo new >> "$T/state/cmd"
waituntil 10 "a second terminal to open again" grep -qF '"n":2' "$T/state/terminals.json"
check "a second terminal is open again"           '"n":2' "$T/state/terminals.json"
echo prev >> "$T/state/cmd"                        # show terminal #1, parking #2
waituntil 10 "prev to show terminal #1" grep -qF '"n":1,"active":true' "$T/state/terminals.json"
: > "$CALLS"
echo close-2 >> "$T/state/cmd"
waituntil 10 "[x] to close parked terminal #2" sh -c '! grep -qF "\"n\":2" "$1"' _ "$T/state/terminals.json"
check "[x] on a PARKED terminal closed it"        "closed parked terminal pane" "$T/daemon.log"
refute "back to one terminal"                     '"n":2' "$T/state/terminals.json"

# The last terminal has no [x] in the strip, but a stray close-<n> must still be
# refused -- the slot must always hold a terminal (mirrors ⌥w).
: > "$CALLS"
F0=$(countof "refusing to close the last terminal for abc12345" "$T/daemon.log")
echo close-1 >> "$T/state/cmd"
waitmore "refusing to close the last terminal for abc12345" "$T/daemon.log" "$F0" 10 "close-1 refused"
refute "closing the last terminal killed nothing" "kill-pane" "$CALLS"
check "refusing to close the last was logged"     "refusing to close the last terminal" "$T/daemon.log"
fi

if section "5g'" "clicking a terminal's label selects it (select-<n>)"; then
# The strip appends `select-<n>` when a terminal's label area (not its [x]) is
# clicked -- it shows that terminal outright rather than cycling to it. Driven here
# by the verb directly, like 5g; the pointer->verb mapping needs a real WezTerm and
# is verified by hand. Nets to zero: the fresh pane opened here is closed again, so
# the agent's original terminal (32) is left exactly as found.
: > "$CALLS"
echo new >> "$T/state/cmd"                        # a second terminal, now on screen (#2)
waituntil 10 "a second terminal to open" grep -qF '"n":2' "$T/state/terminals.json"
check "a second terminal is open"                 '"n":2' "$T/state/terminals.json"

: > "$CALLS"
echo select-1 >> "$T/state/cmd"                   # click terminal #1's label
waituntil 10 "select-1 to show terminal #1" grep -qF '"n":1,"active":true' "$T/state/terminals.json"
check "selecting #1 was logged"                   "selected terminal pane" "$T/daemon.log"
check "terminal #1 is now active"                 '"n":1,"active":true' "$T/state/terminals.json"
check "terminal #2 is now parked"                 '"n":2,"active":false' "$T/state/terminals.json"

# Selecting the terminal already on screen is a no-op: no slot swap, nothing moves.
: > "$CALLS"
echo select-1 >> "$T/state/cmd"
nap 1   # window: the cmd tail's read (200, scaled) + the command itself; 800 margin
refute "re-selecting the active terminal moved nothing" "move-pane-id" "$CALLS"

# An out-of-range number names no terminal and is refused, not guessed.
: > "$CALLS"
N0=$(countof "no terminal #9" "$T/daemon.log")
echo select-9 >> "$T/state/cmd"
waitmore "no terminal #9" "$T/daemon.log" "$N0" 10 "select-9 refused"
check "an out-of-range select is refused"         "no terminal #9" "$T/daemon.log"
refute "an out-of-range select moved nothing"     "move-pane-id" "$CALLS"

# Bring #2 back and close it, netting the section to zero (leaves terminal 32).
echo select-2 >> "$T/state/cmd"
waituntil 10 "select-2 to show terminal #2" grep -qF '"n":2,"active":true' "$T/state/terminals.json"
: > "$CALLS"
echo close-2 >> "$T/state/cmd"
waituntil 10 "close-2 to close terminal #2" sh -c '! grep -qF "\"n\":2" "$1"' _ "$T/state/terminals.json"
refute "back to one terminal after 5g'"           '"n":2' "$T/state/terminals.json"
fi

if section 6 "back to the list: the repo shell returns, agents keep running"; then
: > "$CALLS"
echo list > "$FLEETSTATE"
waituntil 10 "the detach to finish (terminals.json back to repo)" grep -qF '"agent":"repo"' "$T/state/terminals.json"

check "repo diff pane moved back into the slot"  "--move-pane-id 10" "$CALLS"
check "repo shell moved back into the slot"      "--move-pane-id 30" "$CALLS"
refute "no agent pane was killed on detach"      "kill-pane" "$CALLS"
fi

if section 6b "the fleet LIST has terminals of its own: ⌥t / [+ add] work unattached"; then
# The list's shells are a terminal set like any agent's -- the strip draws its
# [+ add] and each row's [x] whether an agent is entered or not, and the footer
# always legends ⌥t. These used to be silently dropped when no agent was attached,
# so every one of those buttons was drawn and dead. A new one opens at the cockpit
# repo ($WT here, panes.repo), NOT at some agent's worktree.
# Nets to zero: the fresh pane is closed again, leaving pane 30 in the slot for the
# sections below.
: > "$CALLS"
echo new >> "$T/state/cmd"                        # ⌥t / [+ add], at the list
waituntil 10 "a second repo shell to open" grep -qF '"n":2' "$T/state/terminals.json"
check "a second repo shell was opened"           '"n":2' "$T/state/terminals.json"
check "...for the repo, not an agent"            '"agent":"repo"' "$T/state/terminals.json"
check "...at the cockpit repo, not a worktree"    "--cwd $WT --" "$CALLS"
check "...and it can leave notes on that repo"   "COCKPIT_REPO=$WT" "$CALLS"
check "opening it was logged against 'repo'"     "for repo (2 total) at $WT" "$T/daemon.log"

# Cycling works too: prev shows #1 again and parks #2, both still alive.
: > "$CALLS"
echo prev >> "$T/state/cmd"
waituntil 10 "prev to show repo shell #1" grep -qF '"n":1,"active":true' "$T/state/terminals.json"
check "cycling back showed repo shell #1"        '"n":1,"active":true' "$T/state/terminals.json"
check "repo shell #2 was parked, not killed"     "move-pane-to-new-tab" "$CALLS"
refute "no repo shell was killed by cycling"     "kill-pane" "$CALLS"

# And closing by number, the strip's [x] on a parked one.
: > "$CALLS"
C0=$(countof "closed parked terminal pane" "$T/daemon.log")
echo close-2 >> "$T/state/cmd"
waituntil 10 "[x] to close parked repo shell #2" sh -c '! grep -qF "\"n\":2" "$1"' _ "$T/state/terminals.json"
# Count-based: 5g already logged "closed parked terminal pane" (DESIGN 3.3).
grew  "[x] closed the parked repo shell"         "closed parked terminal pane" "$T/daemon.log" "$C0"
refute "back to one repo shell"                  '"n":2' "$T/state/terminals.json"

# The last one is refused here exactly as it is for an agent: the slot must always
# hold a terminal.
: > "$CALLS"
F0=$(countof "refusing to close the last terminal for repo" "$T/daemon.log")
echo close >> "$T/state/cmd"                      # ⌥w on the lone repo shell
waitmore "refusing to close the last terminal for repo" "$T/daemon.log" "$F0" 10 "the last repo shell's close refused"
refute "closing the last repo shell killed nothing" "kill-pane" "$CALLS"
check "refusing the last was logged against 'repo'" "refusing to close the last terminal for repo" "$T/daemon.log"
fi

if section 7 "an agent that leaves the fleet has BOTH its panes reaped"; then
# Two consecutive misses are required, so one bad read cannot kill a shell.
: > "$CALLS"
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$WT","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
# Two reaper ticks (REAP_MS each), then the terminal and the diff go, diff last.
waitfor "diff pane 33 — agent def67890 is gone" "$T/daemon.log" 10 "def67890's diff pane reaped"

check "the vanished agent's terminal was killed" "kill-pane --pane-id 34" "$CALLS"
check "the vanished agent's diff pane too"       "kill-pane --pane-id 33" "$CALLS"
check "reaping was logged with the job id"       "agent def67890 is gone" "$T/daemon.log"
refute "the surviving agent kept its terminal"   "kill-pane --pane-id 32" "$CALLS"
refute "the surviving agent kept its diff pane"  "kill-pane --pane-id 31" "$CALLS"
refute "the repo shell is never reaped"          "kill-pane --pane-id 30" "$CALLS"
refute "the repo diff pane is never reaped"      "kill-pane --pane-id 10" "$CALLS"
fi

if section 8 "a diff pane that dies is rebuilt, at full width"; then
# Quit revdiff with `q`, exit the shell, and the pane is gone. Nothing else
# repairs it: the reconcile poll returns early while the same agent is still
# showing, so the slot would sit empty until the next switch.
echo "test agent" > "$FLEETSTATE"
waituntil 10 "the attach to test agent (terminals.json)" grep -qF '"agent":"test agent"' "$T/state/terminals.json"
: > "$CALLS"
O0=$(countof "opened diff pane" "$T/daemon.log")
awk '$1 != 31' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
# healMissingPanes notices on its REAP_MS tick, the next reconcile rebuilds, and
# launching revdiff in the fresh pane is the last step checked.
waitfor "revdiff --wrap --no-confirm-discard --untracked" "$CALLS" 10 "revdiff in the rebuilt diff pane"

check "the loss was noticed"                     "diff pane for abc12345 is gone" "$T/daemon.log"
check "the slot was rebuilt"                     "rebuilt the diff slot" "$T/daemon.log"
# Full width is only possible with the fleet pane alone in the tab, so the
# terminal has to step out of the way and come back.
check "the terminal stepped aside for the rebuild" "move-pane-to-new-tab --pane-id 32" "$CALLS"
check "and was moved back, not respawned"        "--move-pane-id 32" "$CALLS"
check "the full-width split came off the fleet pane" "--top --percent 42 --pane-id 20" "$CALLS"
check "the placeholder was killed, not parked"   "kill-pane" "$CALLS"
# Count-based: section 1 already logged "opened diff pane" (DESIGN 3.3).
grew  "a fresh diff pane took the slot"          "opened diff pane" "$T/daemon.log" "$O0"
check "revdiff started in it"                    "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"
fi

if section 9 "an agent that changed directory drags its idle, untouched terminal along"; then
# `claude agents` reports an agent's LIVE cwd, and that migrates: an agent can
# start in the checkout and later create and enter a worktree. A terminal is
# spawned once and only moved between tabs after that, so without help it stays
# frozen at the old directory. On re-attach the daemon cd's the shell forward --
# but only when it is idle AND still sitting where it was spawned (untouched).
echo list > "$FLEETSTATE"
waituntil 10 "the detach to finish (terminals.json back to repo)" grep -qF '"agent":"repo"' "$T/state/terminals.json"

MOVED="$T/moved"; mkrepo "$MOVED"       # where the agent went (its new worktree)
echo "32 file://$WT" > "$PANECWD"         # its terminal (pane 32) is still at $WT
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
waitfor "cd terminal 32" "$T/daemon.log" 10 "terminal 32 cd'd forward"

check "the stale idle terminal was cd'd forward"  "cd terminal 32" "$T/daemon.log"
check "logged as an agent directory move"         "agent moved from" "$T/daemon.log"
# The terminal's cd is standalone (`cd "X"` then newline); the diff pane's, when
# revdiff is relaunched, is `cd "X" && revdiff ...`. The trailing \n distinguishes
# the shell being followed from the diff being reloaded.
check "the new dir was typed into the terminal"   'cd "'"$MOVED"'"\n' "$CALLS"
fi

if section 9b "a BUSY terminal is left where it is (a cd must not land mid-command)"; then
echo list > "$FLEETSTATE"
waituntil 10 "the detach to finish (terminals.json back to repo)" grep -qF '"agent":"repo"' "$T/state/terminals.json"
MOVED2="$T/moved2"; mkrepo "$MOVED2"
echo "32 file://$MOVED" > "$PANECWD"       # 32 is now at $MOVED (untouched), still
echo node > "$PSBUSY"                      # ...but a job is running in it now
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED2","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
waitfor "busy at" "$T/daemon.log" 10 "the busy terminal refused"

check  "the daemon refused because it was busy"   "busy at" "$T/daemon.log"
refute "the busy shell was NOT cd'd"              'cd "'"$MOVED2"'"\n' "$CALLS"
: > "$PSBUSY"
fi

if section 9c "an agent that moves WHILE ATTACHED drags its revdiff along, no re-attach"; then
# The bug this guards: reconcile() short-circuits on a matching fleet-header name,
# so a cwd migration under a CONTINUOUSLY attached agent (it enters a worktree it
# just created, without any detach/re-attach) was never noticed. revdiff stayed
# pinned to the launch dir and Shift+R could not fix it -- revdiff's reload re-runs
# the SAME range in the SAME directory. followWorktreeMigration re-reads the live
# cwd on the same-name poll branch and relaunches revdiff (cd + revdiff) in the new
# worktree. No `echo list` here: the agent never leaves the fleet header.
MOVED3="$T/moved3"; mkrepo "$MOVED3"     # the watch is re-pointed, so it must exist
echo "32 file://$MOVED2" > "$PANECWD"      # its terminal sits at the previous worktree
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED3","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
# followWorktreeMigration re-reads the cwd once per MIGRATION_CHECK_MS, and not
# inside DIFF_RELAUNCH_COOLDOWN_MS of 9b's relaunch; the relaunch in the new
# worktree is its last step. (The fixed sleep 3 this replaces was measured flaky
# when scaled; a poll has no such floor.)
waitfor 'cd "'"$MOVED3"'" && revdiff' "$CALLS" 10 "revdiff relaunched in the new worktree"

check  "the mid-attach move was noticed"          "moved worktree" "$T/daemon.log"
check  "revdiff was re-pointed at the new dir"    'cd "'"$MOVED3"'" && revdiff' "$CALLS"
refute "revdiff did not stay on the old dir"      'cd "'"$MOVED2"'" && revdiff' "$CALLS"
fi

if section 9d "an agent that moves WHILE PARKED is caught on return, not left stale"; then
# followWorktreeMigration only follows the ATTACHED agent. An agent you switched
# AWAY from keeps working and can enter a worktree while its diff pane is parked --
# so its stored launch cwd is compared on return and the parked revdiff (and its
# watch) is relaunched in the new worktree. Here: detach to the list, move the
# agent while it is parked, then re-attach.
MOVED4="$T/moved4"; mkrepo "$MOVED4"     # the watch is re-pointed on return, so it must exist
echo list > "$FLEETSTATE"                   # park abc12345's diff (last launched at $MOVED3)
waituntil 10 "the detach to finish (terminals.json back to repo)" grep -qF '"agent":"repo"' "$T/state/terminals.json"
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED4","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
R0=$(countof "relaunched diff pane" "$T/daemon.log")
echo "test agent" > "$FLEETSTATE"           # re-attach: onEnter sees the parked pane moved
waitmore "relaunched diff pane" "$T/daemon.log" "$R0" 10 "the parked pane relaunched on return"
# ...and for the attach to END (showTerminal's terminals.json write): the terminal
# swap after the relaunch rewrites the stub's pane table, and section 10's own
# rewrite of it (marking revdiff quit) must not race that and be lost.
waituntil 10 "the re-attach to finish (terminals.json)" grep -qF '"agent":"test agent"' "$T/state/terminals.json"

# Count-based: 3b and 5 already logged "relaunched diff pane" (DESIGN 3.3).
grew   "the parked pane was relaunched on return" "relaunched diff pane" "$T/daemon.log" "$R0"
check  "revdiff came back on the new worktree"    'cd "'"$MOVED4"'" && revdiff' "$CALLS"
refute "revdiff did not come back on the old one" 'cd "'"$MOVED3"'" && revdiff' "$CALLS"
fi

if section 10 "quitting revdiff is reinstated, never left as a bare shell"; then
# Shift+Q discards every annotation and quits (no confirm, thanks to
# --no-confirm-discard); lowercase q just quits. Either way the daemon brings
# revdiff back on the same diff so the top pane is not left at an empty shell.
DP=$(grep -oE '"diff":[0-9]+' "$T/state/panes.json" | grep -oE '[0-9]+')
: > "$CALLS"
Q0=$(countof "reinstated it" "$T/daemon.log")
# Simulate the quit: the pane falls back to a shell prompt (title no longer
# revdiff), exactly what the daemon sees the moment revdiff exits.
awk -v p="$DP" '{ if ($1 == p) print $1, $2, "sh"; else print }' "$PANESTATE" > "$PANESTATE.q" \
    && mv "$PANESTATE.q" "$PANESTATE"
# healQuitDiff fires every 1000ms (scaled) once DIFF_RELAUNCH_COOLDOWN_MS has
# passed since 9d's relaunch; the reinstate is logged after the launch is typed.
waitmore "reinstated it" "$T/daemon.log" "$Q0" 10 "revdiff reinstated after the quit"

grew  "the quit was noticed and revdiff reinstated" "reinstated it" "$T/daemon.log" "$Q0"
check "revdiff relaunched in the same diff pane"     "send-text --pane-id $DP" "$CALLS"
check "...on the current range"                      "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"

# ===========================================================================
# Browse mode -- the fourth stop in the diff-slot cycle (T04)
#
# The slot holds TWO panes here: the browser (broot) on the left and the read-only
# viewer (micro) on the right. Everything below drives the daemon exactly as the
# keys and the footer do, through the cmd channel, and reads the pane ids back out
# of panes.json rather than assuming them -- by this point in the suite the slot
# has been rebuilt once (section 8) and the ids are no longer the ones section 1
# handed out.
# ===========================================================================

# The pane ids the daemon is publishing right now.
pane_key() { grep -oE "\"$1\":[0-9]+" "$T/state/panes.json" | grep -oE '[0-9]+' | tail -1; }
fi

if section 11 "⌥[ from uncommitted lands on BROWSE and launches both halves"; then
# Browse is the fourth stop, so one step BACK from uncommitted is browse -- and it
# must not open the custom-range prompt on the way: that is keyed on the transition
# into `custom` specifically.
DP="$(pane_key diff)"
# Entering browse moves the pane revdiff is in out from under it, so it must not
# happen with a half-written annotation on screen -- the same rule that stops a
# mode switch typing into the editor, applied to a pane about to be parked.
echo "$DP" > "$EDITING"
: > "$CALLS"
echo "$DP" > "$ACTIVE"                    # focus the diff pane
NOBR0="$(countof "not entering browse for abc12345" "$T/daemon.log")"
EB0="$(countof "entered browse for abc12345" "$T/daemon.log")"
echo prev >> "$T/state/cmd"
waitmore "not entering browse for abc12345" "$T/daemon.log" "$NOBR0" 10 "the refusal to enter browse"
grew   "browse is refused while the annotation editor is open" \
                                                  "not entering browse for abc12345" "$T/daemon.log" "$NOBR0"
check  "...so the mode is untouched"              '"diffMode":"uncommitted"' "$T/state/terminals.json"
refute "...and nothing was split off the slot"    "split-pane" "$CALLS"
: > "$EDITING"

: > "$CALLS"
echo prev >> "$T/state/cmd"
# enterBrowse logs this last, after the split, the park, both launches and focus.
waitmore "entered browse for abc12345" "$T/daemon.log" "$EB0" 10 "the pair entering browse"

check  "the mode is now browse"                   '"diffMode":"browse"' "$T/state/terminals.json"
refute "cycling into browse opens no ref prompt"  "cockpit-custom-prompt.mjs" "$CALLS"
BR="$(pane_key diff)"; VW="$(pane_key viewer)"
check  "the BROWSER was split into the slot"      "--top --percent 50 --pane-id $DP" "$CALLS"
check  "...and the revdiff pane PARKED afterwards, so the browser inherits the slot" \
                                                  "move-pane-to-new-tab --pane-id $DP" "$CALLS"
refute "...never killed: browse is passed through, not arrived at" \
                                                  "kill-pane --pane-id $DP" "$CALLS"
parked "...so revdiff is still alive, in a tab of its own" "$DP"
check  "...and it says so"                        "parked diff pane $DP for abc12345 while it browses" "$T/daemon.log"
before "...in that order, or the browser comes back at half width" \
       "--top --percent 50 --pane-id $DP" "move-pane-to-new-tab --pane-id $DP" "$CALLS"
check  "the VIEWER was split off the browser's right at 80%" \
                                                  "--right --percent 80 --pane-id $BR" "$CALLS"
before "...only once the browser held the whole slot (80% of half a slot is not 80%)" \
       "move-pane-to-new-tab --pane-id $DP" "--right --percent 80 --pane-id $BR" "$CALLS"
check  "broot launched, with the cockpit's verb file FIRST in the --conf chain" \
                                                  "broot --git-ignored --conf \"$ROOT/bin/cockpit-browse-verbs.hjson" "$CALLS"
check  "micro launched read-only, with NO file argument and no review file" \
                                                  "$MICRO_LAUNCH"'\n' "$CALLS"
# DESIGN 7: micro's default draws the tab bar light on light, so three open tabs
# read as none. The scheme rides on the LAUNCH LINE and never on the user's own
# micro config -- and it is ADDED to read-only, not swapped for it.
check  "...in the reader's dark colourscheme, so the tab bar is legible" \
                                                  "-colorscheme $MICRO_SCHEME" "$CALLS"
check  "...added to read-only, not swapped for it" \
                                                  "-readonly true -colorscheme" "$CALLS"
check  "both halves start in the agent's own worktree" "--cwd $MOVED4 --" "$CALLS"
# A split inherits NO environment, and broot's Enter verb runs `cockpit-open` by
# name -- which exists only in the cockpit's own bin directory.
check  "both spawned through /usr/bin/env"        "-- /usr/bin/env" "$CALLS"
check  "...with the cockpit's bin directory on PATH, where cockpit-open lives" \
                                                  "/state/bin:" "$CALLS"
check  "...and COCKPIT_REPO named with it"        "COCKPIT_REPO=" "$CALLS"
check  "the BROWSER holds focus -- that is where the gesture continues" \
                                                  "activate-pane --pane-id $BR" "$CALLS"
refute "...not the viewer"                        "activate-pane --pane-id $VW" "$CALLS"
check  "panes.json names the viewer pane"         "\"viewer\":$VW" "$T/state/panes.json"
check  "...its agent by JOB ID, not the display name" \
                                                  '"viewerAgent":"abc12345"' "$T/state/panes.json"
refute "...(the display name would be this)"      '"viewerAgent":"test agent"' "$T/state/panes.json"
check  "...and its root as the agent's WORKTREE"  "\"viewerRoot\":\"$MOVED4\"" "$T/state/panes.json"
refute "...not panes.repo, which is the projects root" \
                                                  "\"viewerRoot\":\"$WT\"" "$T/state/panes.json"
fi

if section 11a "nothing revdiff-shaped is aimed at a browse pane"; then
# The worktree watch is still running (it belongs to the agent, not the mode), and
# `R` in broot is a character typed into its filter box, not a reload.
: > "$CALLS"
echo "the agent keeps working" >> "$MOVED4/file.txt"
# window: RELOAD_DEBOUNCE_MS (1200, scaled) after the write, plus 1300 of margin
# for the watcher's own event -- reloadDiff returns silently in browse, so there is
# no line to wait for.
nap 2.5
refute "an agent write sends no reload to the browser" "STDIN:R\n" "$CALLS"
refute "nothing at all was typed into the browser"     "send-text --pane-id $BR" "$CALLS"
refute "nor into the viewer"                           "send-text --pane-id $VW" "$CALLS"
fi

if section 11b "the 1s healer leaves a HEALTHY pair alone"; then
# The whole reason detection lands with the mode: neither broot nor micro draws a
# framed line, so without this both halves read as a quit revdiff and the healer
# types a command line into two live programs, once a second.
: > "$CALLS"
waitfor "browse browser pane $BR for abc12345: running" "$T/daemon.log" 10 "the browser's status"
waitfor "browse viewer pane $VW for abc12345: running" "$T/daemon.log" 10 "the viewer's status"
# window: DIFF_RELAUNCH_COOLDOWN_MS (3000, scaled like nap) armed when section 11
# launched the pair, then two healer ticks (ms(1000)) -- a wrong heal lands in the
# first tick after the cooldown, and the section 11a window already ran off part
# of it.
nap 5
check "the browser is seen as RUNNING, not a bare shell" \
                                                  "browse browser pane $BR for abc12345: running" "$T/daemon.log"
check  "the viewer is seen as RUNNING too"        "browse viewer pane $VW for abc12345: running" "$T/daemon.log"
refute "nothing was typed into the browser"       "send-text --pane-id $BR" "$CALLS"
refute "nothing was typed into the viewer"        "send-text --pane-id $VW" "$CALLS"
refute "no revdiff was reinstated over either half" "revdiff --wrap" "$CALLS"
fi

if section "11b'" "a healthy pair whose TITLE LIES is still left alone"; then
# The defect T07 found by hand, and the reason detection cannot rest on the title.
# A pane's title is not a name for what it runs -- it is whatever last wrote it,
# and a shell with a `preexec` hook (zsh's usual setup) rewrites it to the FIRST
# WORD of the command line. Both halves are launched as `cd <worktree> && …`, so on
# a real machine their title is `cd`, never `broot`/`micro`, for the whole of their
# lives. Measured on the live cockpit: a pane running revdiff reported the title
# "cd" while `ps` reported `S+ revdiff`.
#
# Modelled exactly that way here: the titles say `cd`, `ps` says the truth. Without
# the foreground-process check the healer reads two live programs as quit shells and
# types broot's own command line into broot's filter box every three seconds, which
# is what made the tree unusable.
# Asserted as COUNTS that did not move, not as "running" appearing: the status log
# is written once per CHANGE, so a pair that stays healthy writes nothing at all and
# a `check` for "running" would pass on 11b's line however this section behaved.
# The converse -- ps says shell, so the half really did die and must heal -- is not
# re-tested here: 11c, 11c' and 11c'' all heal with $PSFG empty, which is exactly
# the ps stub answering `zsh`.
SHELLB="$(countof "browse browser pane $BR for abc12345: shell" "$T/daemon.log")"
SHELLV="$(countof "browse viewer pane $VW for abc12345: shell" "$T/daemon.log")"
# The browser answers as an absolute path and the viewer as a bare name: both
# forms occur on a real machine (see the $PSFG note by the stub), and the path is
# the one that matters -- it is what a homebrew broot actually reports, and it
# only matches `broot` because the daemon reduces it to a basename. Asserted
# through a path so that reduction cannot be dropped without this section going
# red; with a bare name on both halves the whole suite passes without it.
printf 'ttys%s /opt/homebrew/bin/broot\nttys%s micro\n' "$BR" "$VW" > "$T/psfg"
retitle "$BR" cd
retitle "$VW" cd
: > "$CALLS"
# window: three healer ticks (ms(1000) each); both cooldowns expired back in 11b,
# so a half misread as a shell would be retyped on the first of them.
nap 3
same   "the browser was never called a shell"    "$(countof "browse browser pane $BR for abc12345: shell" "$T/daemon.log")" "$SHELLB"
same   "...nor was the viewer"                    "$(countof "browse viewer pane $VW for abc12345: shell" "$T/daemon.log")" "$SHELLV"
refute "nothing was typed into the browser"       "send-text --pane-id $BR" "$CALLS"
refute "...nor into the viewer"                   "send-text --pane-id $VW" "$CALLS"
refute "broot was NOT retyped into its own filter box" "broot --git-ignored --conf" "$CALLS"
refute "...nor micro over a live one"             "micro -readonly" "$CALLS"
: > "$T/psfg"                             # back to the stub's default for what follows
retitle "$BR" broot
retitle "$VW" micro
fi

if section "11b''" "a browser that wanders OUT of the worktree is put back"; then
# broot cannot be confined -- checked, not assumed: v1.59 has no jail option, and a
# verb of ours named `parent` does not shadow the built-in `:parent` (it still moved
# the root, with our file loaded cleanly and FIRST in the chain). So the fence
# checks where broot ENDED UP rather than how it got there, which closes every
# route at once instead of the ones somebody thought to block.
mkdir -p "$MOVED4/sub"                    # a real dir: the fence realpaths both sides
printf '%s\n' "$T" > "$BROOTROOT"         # the parent of the worktree -- one `:parent` away
WANDER0="$(countof "wandered to $T; put it back in $MOVED4" "$T/daemon.log")"
: > "$CALLS"
# fenceBrowseRoot logs this after the :focus has landed, so the root is back too.
waitmore "wandered to $T; put it back in $MOVED4" "$T/daemon.log" "$WANDER0" 10 "the fence to pull broot back"
check "the daemon asked broot where it was"     "BROOT: --send cockpit-abc12345 --get-root" "$CALLS"
check  "...and sent it back to the worktree"     "--cmd :focus $MOVED4" "$CALLS"
check  "...and said so"                          "wandered to $T; put it back in $MOVED4" "$T/daemon.log"
same   "broot's root is the worktree again"      "$(cat "$BROOTROOT")" "$MOVED4"
# Descending is not wandering: a root BELOW the worktree is what browsing a
# subdirectory looks like, and yanking that back would make the tree unusable in
# the other direction.
printf '%s\n' "$MOVED4/sub" > "$BROOTROOT"
: > "$CALLS"
# Counted, not timed: the fence asks and decides in one synchronous pass, so once
# it has asked TWICE since the move, a whole pass has judged the new root.
waitmore "BROOT: --send cockpit-abc12345 --get-root" "$CALLS" 1 10 "two fence passes over the root below the worktree"
refute "a root INSIDE the worktree is left alone" "--cmd :focus" "$CALLS"
same   "...and broot was not moved"              "$(cat "$BROOTROOT")" "$MOVED4/sub"
printf '%s\n' "$MOVED4" > "$BROOTROOT"    # back at the worktree for what follows
fi

if section 11c "a quit VIEWER is healed in its own half, and nothing else is touched"; then
# micro quit with Ctrl+Q: the pane falls back to a shell prompt and its title with
# it. The whole of T06 is that the answer is micro in THAT pane -- not a rebuilt
# pair, which would throw away broot's place in the tree to fix a half that was
# never broken. The stub retitles the pane back to `micro` when the command lands,
# so a successful heal closes its own loop.
printf '{"abc12345":["bin/kept-across-the-heal.mjs"]}\n' > "$T/state/viewer-tabs.json"
HEALV="$(countof "the browse viewer was quit in abc12345; reinstated it in pane $VW" "$T/daemon.log")"
: > "$CALLS"
retitle "$VW" sh
# The heal's own last line: the status line, the launch and the tab-list reset
# all come before it in the same pass.
waitmore "the browse viewer was quit in abc12345; reinstated it in pane $VW" "$T/daemon.log" "$HEALV" 10 \
  "the viewer's heal"
check "the quit half is reported as a shell"     "browse viewer pane $VW for abc12345: shell" "$T/daemon.log"
check  "...and micro was reinstated in that very pane" \
                                                  "the browse viewer was quit in abc12345; reinstated it in pane $VW" "$T/daemon.log"
check  "...typed into the viewer's own pane"      "send-text --pane-id $VW" "$CALLS"
check  "...read-only, in the agent's worktree"    "cd \"$MOVED4\" && $MICRO_LAUNCH" "$CALLS"
# A healed half must come back looking like the one it replaced: a reader that
# changed colour mid-session would read as a different program, not a repair.
check  "...and in the same scheme it was launched in" \
                                                  "-colorscheme $MICRO_SCHEME" "$CALLS"
# The tabs died with the process, so what we believe micro has open has to die too:
# a leftover list makes the next push a `tabswitch` onto a tab that is not there.
check  "the agent's tab list was reset with it"   "reset the viewer tab list for abc12345 (healed viewer)" "$T/daemon.log"
refute "...so nothing is left claiming to be open" "bin/kept-across-the-heal.mjs" "$T/state/viewer-tabs.json"
# The four ways a heal could overreach, each asserted rather than assumed.
refute "the healthy browser was not typed into"   "send-text --pane-id $BR" "$CALLS"
refute "no pane was killed to fix one half"       "kill-pane" "$CALLS"
refute "...and the slot was not re-split"         "split-pane" "$CALLS"
refute "the heal never takes the keyboard"        "activate-pane" "$CALLS"
same   "the viewer keeps its pane id"             "$(pane_key viewer)" "$VW"
same   "...and the browser keeps its own"         "$(pane_key diff)" "$BR"
in_slot "both are still in the cockpit tab"       "$VW"
fi

if section "11c'" "a quit BROWSER is healed the same way, and the viewer's tabs survive"; then
# The mirror image, and the half where the difference shows: relaunching broot must
# NOT reset the tab list -- those tabs belong to a micro that never stopped running.
printf '{"abc12345":["bin/still-open.mjs"]}\n' > "$T/state/viewer-tabs.json"
HEALB="$(countof "the browse browser was quit in abc12345; reinstated it in pane $BR" "$T/daemon.log")"
: > "$CALLS"
retitle "$BR" sh
waitmore "the browse browser was quit in abc12345; reinstated it in pane $BR" "$T/daemon.log" "$HEALB" 10 \
  "the browser's heal"
check "the quit browser is reported as a shell"  "browse browser pane $BR for abc12345: shell" "$T/daemon.log"
check  "...and broot was reinstated in that pane" "the browse browser was quit in abc12345; reinstated it in pane $BR" "$T/daemon.log"
check  "...typed into the browser's own pane"     "send-text --pane-id $BR" "$CALLS"
check  "...with the cockpit's verb file first in the --conf chain" \
                                                  "broot --git-ignored --conf \"$ROOT/bin/cockpit-browse-verbs.hjson" "$CALLS"
refute "the healthy viewer was not typed into"    "send-text --pane-id $VW" "$CALLS"
check  "...and its tab list is untouched"         "bin/still-open.mjs" "$T/state/viewer-tabs.json"
refute "no pane was killed"                       "kill-pane" "$CALLS"
refute "...and the slot was not re-split"         "split-pane" "$CALLS"
same   "the viewer keeps its pane id"             "$(pane_key viewer)" "$VW"
same   "...and the browser its own"               "$(pane_key diff)" "$BR"
fi

if section "11c''" "BOTH halves quit at once: both come back, in the same pass"; then
# The reason the relaunch cooldown is per PANE and not per agent. A single
# per-agent stamp is set by the first heal, which then reads as "something was just
# launched for this agent" and silences the second half for the whole cooldown.
#
# SAME PASS is the assertion, and it has to be: waiting a flat 5s for both would
# pass under a per-agent clock too -- the second half is merely held for three
# seconds and then healed, not abandoned (measured: keyed per agent, this section
# went green). So the wait ENDS at the browser's heal, and the viewer's is required
# half a cooldown later -- comfortably longer than the two log writes of one pass,
# and comfortably shorter than the whole DIFF_RELAUNCH_COOLDOWN_MS a per-agent stamp
# would impose. Both are scaled by SPEED, so the ratio holds at any speed.
HEALB="$(countof "reinstated it in pane $BR" "$T/daemon.log")"
HEALV="$(countof "reinstated it in pane $VW" "$T/daemon.log")"
: > "$CALLS"
retitle "$BR" sh
retitle "$VW" sh
waitmore "reinstated it in pane $BR" "$T/daemon.log" "$HEALB" 8 \
  || { echo "  FAIL the browser was never healed, so the pass cannot be timed"; fail=1; }
nap 1.5                                   # window: half of DIFF_RELAUNCH_COOLDOWN_MS (3000)
grew   "the browser came back"                    "reinstated it in pane $BR" "$T/daemon.log" "$HEALB"
grew   "...and the viewer in the SAME pass, not a cooldown later" \
                                                  "reinstated it in pane $VW" "$T/daemon.log" "$HEALV"
check "broot was typed into the browser half"    "send-text --pane-id $BR" "$CALLS"
check  "micro into the viewer half"               "send-text --pane-id $VW" "$CALLS"
refute "neither heal killed the other half"       "kill-pane" "$CALLS"
refute "...nor re-split the slot"                 "split-pane" "$CALLS"
in_slot "the browser is still in the slot"        "$BR"
in_slot "...and the viewer beside it"             "$VW"
fi

if section "11c'''" "no heal fires inside the cooldown window"; then
# broot and micro each look like a bare shell for a moment while they start, so a
# heal that fired straight away would type a command line into a live program --
# where every character is a keybinding. The window is measured from the heal just
# performed: quit the same half again the moment the daemon says it healed it.
HEALV="$(countof "reinstated it in pane $VW" "$T/daemon.log")"
retitle "$VW" sh
waitmore "reinstated it in pane $VW" "$T/daemon.log" "$HEALV" 8 \
  || { echo "  FAIL the cooldown window could not be measured -- no heal to start it"; fail=1; }
# The clock starts HERE, at the moment the daemon says it launched micro.
HEALV2="$(countof "reinstated it in pane $VW" "$T/daemon.log")"
: > "$CALLS"
retitle "$VW" sh
# window: half of DIFF_RELAUNCH_COOLDOWN_MS (3000, scaled by the same SPEED as nap),
# so 1500 of margin before it expires -- and still longer than one healer tick
# (ms(1000)), so a heal that ignored the cooldown would have landed inside it.
nap 1.5
refute "nothing typed into the half that was just launched" "send-text --pane-id $VW" "$CALLS"
# ...and once it expires, the heal happens: a poll, since that half must be able to fail.
# On the daemon's line, not the stub's ARGV in $CALLS: the stub logs its argv BEFORE
# it retitles the pane, and a pane-table rewrite still in flight would overwrite the
# next section's own retitle (seen under 4 copies: the next section never saw broot
# quit). The daemon logs only after the stub call has returned.
waitmore "reinstated it in pane $VW" "$T/daemon.log" "$HEALV2" 10 "the viewer's heal after the cooldown"
check "...and it is healed once the cooldown expires" "send-text --pane-id $VW" "$CALLS"
fi

if section "11c''''" "the fence only questions a browser that is UP"; then
# fenceBrowseRoot asks a LIVE broot where it is. A half sitting at a shell has
# nothing listening on its socket, and one still painting has not opened it yet:
# either way the query is a `broot --send` spawned once a second only to be
# refused -- and a refused query is INVISIBLE in its effects, so without this
# section the guard could be deleted and every other check would stay green.
# Three bounded windows rather than one long refute, because the fence is
# SUPPOSED to resume the moment the grace expires.
HEALB="$(countof "reinstated it in pane $BR" "$T/daemon.log")"
SHB0="$(countof "browse browser pane $BR for abc12345: shell" "$T/daemon.log")"
retitle "$BR" sh                          # broot quit: the title and `ps` both say shell
# Truncated only once a healer tick has SEEN the shell. Truncating straight after the
# retitle was not enough: a tick that read the pane table just before it still ran
# its fence query afterwards, and under load (4 copies, load ~23) that query landed
# after the truncation and failed the refute below. Ticks are synchronous, so every
# tick after the one that logs this line reads the shell.
waitmore "browse browser pane $BR for abc12345: shell" "$T/daemon.log" "$SHB0" 10 "the healer to see the quit browser"
: > "$CALLS"
waitmore "reinstated it in pane $BR" "$T/daemon.log" "$HEALB" 8 \
  || { echo "  FAIL the browser was never healed, so the window cannot be timed"; fail=1; }
refute "a browser sitting at a shell is never questioned" "BROOT: --send" "$CALLS"
# The clock starts HERE, at the moment the daemon says it launched broot.
: > "$CALLS"
# window: half of the grace that heal just armed (DIFF_RELAUNCH_COOLDOWN_MS, 3000,
# scaled like nap), and longer than one fence pass (every healer tick, ms(1000)).
nap 1.5
refute "...nor is one that is still starting" "BROOT: --send" "$CALLS"
# ...and once the grace expires, the fence resumes: a poll, so this half can fail.
waitfor "BROOT: --send cockpit-abc12345 --get-root" "$CALLS" 10 "the fence to resume after the grace"
check "...and one that is up is asked again"     "BROOT: --send cockpit-abc12345 --get-root" "$CALLS"
fi

if section "11c'''''" "(five primes) a half is running if ANY of its foreground group is"; then
# The defect the user met while browsing, 2026-09-04: broot's own launch command
# appearing in broot's FILTER BOX, intermittently, on Enter.
#
# broot spawns the Enter verb's `cockpit-open` in ITS OWN process group rather than
# a new one, so for the length of a push the pane's foreground group holds broot AND
# a node. Measured under `script(1)`, asking `ps -t` about the verb's own tty:
#
#     SNs+ broot . SN+ /bin/sh . RN+ ps        -- all three carry `+`
#
# `foregroundComm` takes the LAST of them, so the answer was `node`: a live broot
# read as a quit shell, and with no frame to overrule it (and a title of `cd`, see
# 11b') the 1s healer typed `cd <wt> && broot --git-ignored --conf ...` into the running broot.
#
# So the question is not WHICH process is in front but WHETHER ANY of them is
# broot/micro/revdiff. That is the whole of T13, and this section is the only thing
# that tells the two readings apart: with last-wins restored, the assertions in this
# first block go red and broot's own command line appears in $CALLS.
#
# Asserted as counts that did NOT move, for the same reason as 11b': the status log
# is written once per change, so a pair that stays healthy writes nothing at all.
SHELLB="$(countof "browse browser pane $BR for abc12345: shell" "$T/daemon.log")"
SHELLV="$(countof "browse viewer pane $VW for abc12345: shell" "$T/daemon.log")"
# Both halves mid-push: the program first, its child last -- the order that makes
# last-wins answer `node`. The browser answers as a PATH, as a homebrew broot really
# does, so the basename reduction stays defended here too.
printf 'ttys%s /opt/homebrew/bin/broot node\nttys%s micro node\n' "$BR" "$VW" > "$T/psfg"
retitle "$BR" cd                          # ...and the title lies, as it always does
retitle "$VW" cd
: > "$CALLS"
# window: three healer ticks (ms(1000) each). Both halves are past their cooldown --
# the viewer's heal in 11c''' is older than the whole of 11c'''', and 11c'''' ended
# on the browser's grace expiring -- so a misread would be retyped on the first tick.
nap 3
same   "a broot with a child in its group is not a shell" \
                                                  "$(countof "browse browser pane $BR for abc12345: shell" "$T/daemon.log")" "$SHELLB"
same   "...nor is a micro with one"               "$(countof "browse viewer pane $VW for abc12345: shell" "$T/daemon.log")" "$SHELLV"
refute "nothing was typed into the browser mid-push" "send-text --pane-id $BR" "$CALLS"
refute "...nor into the viewer"                   "send-text --pane-id $VW" "$CALLS"
refute "broot's launch command never reached its own filter box" "broot --git-ignored --conf" "$CALLS"
refute "...nor micro over a live one"             "micro -readonly" "$CALLS"

# The other direction, which any-of must NOT weaken: a group holding no program
# name is still a shell, and still heals. A bare `zsh` is already covered by 11c
# and 11c' (they heal with $PSFG empty); what is new is a group of TWO with no
# program in it -- the shape that would pass a predicate written as "more than one
# process means something is running".
HEALB="$(countof "reinstated it in pane $BR" "$T/daemon.log")"
printf 'ttys%s zsh node\nttys%s micro node\n' "$BR" "$VW" > "$T/psfg"
: > "$CALLS"
waitmore "reinstated it in pane $BR" "$T/daemon.log" "$HEALB" 8 \
  || { echo "  FAIL a browser whose group holds no program was never healed"; fail=1; }
grew   "a group of zsh and a child is still a shell, and heals" \
                                                  "reinstated it in pane $BR" "$T/daemon.log" "$HEALB"
check  "...broot typed into that very pane"       "send-text --pane-id $BR" "$CALLS"
refute "...and the live viewer beside it left alone" "send-text --pane-id $VW" "$CALLS"

# And an answer that is no answer -- `ps` itself failing -- is still a shell, which
# is the recoverable direction: a spurious relaunch of a dead half is invisible,
# a refusal to heal one is a bare prompt for the life of the window.
HEALV="$(countof "reinstated it in pane $VW" "$T/daemon.log")"
printf 'ttys%s /opt/homebrew/bin/broot node\nttys%s !fail\n' "$BR" "$VW" > "$T/psfg"
: > "$CALLS"
waitmore "reinstated it in pane $VW" "$T/daemon.log" "$HEALV" 8 \
  || { echo "  FAIL a viewer whose ps failed was never healed"; fail=1; }
grew   "an unanswerable pane is a shell, and heals"  "reinstated it in pane $VW" "$T/daemon.log" "$HEALV"
check  "...micro typed into the viewer's own pane" "cd \"$MOVED4\" && $MICRO_LAUNCH" "$CALLS"
refute "...and the healthy browser was not touched" "send-text --pane-id $BR" "$CALLS"
: > "$T/psfg"                             # back to the stub's default for what follows
retitle "$BR" broot
retitle "$VW" micro
fi

if section 11d "⌥] out of browse, from the BROWSER half -- the trap case"; then
# Focus starts in the browser, so if ⌥[/⌥] only answered to the single slot pane
# there would be no way out of browse mode without clicking the other half first.
: > "$CALLS"
echo "$BR" > "$ACTIVE"                    # the browser holds focus
CB0="$(countof "came back from its park in uncommitted mode" "$T/daemon.log")"
CBD0="$(countof "diff pane $DP for abc12345 came back from its park" "$T/daemon.log")"
echo next >> "$T/state/cmd"               # browse -> uncommitted (browse is last)
# The mode switch's last line: leaveBrowse has parked the pair and moved the revdiff back.
waitmore "diff pane $DP for abc12345 came back from its park in uncommitted mode" "$T/daemon.log" "$CBD0" 10 \
  "the parked revdiff to come back"
check  "the keys cycled the MODE with the browser focused" \
                                                  '"diffMode":"uncommitted"' "$T/state/terminals.json"
check  "the browser was PARKED first, so the viewer inherited the slot" \
                                                  "move-pane-to-new-tab --pane-id $BR" "$CALLS"
check  "the agent's OWN parked revdiff was split back into the viewer" \
                                                  "--top --percent 50 --pane-id $VW --move-pane-id $DP" "$CALLS"
before "...after the browser went, not before" \
       "move-pane-to-new-tab --pane-id $BR" "--top --percent 50 --pane-id $VW" "$CALLS"
check  "and the viewer parked LAST, beside its browser, at the same 80%" \
                                                  "--right --percent 80 --pane-id $BR --move-pane-id $VW" "$CALLS"
before "...only after the incoming pane was split into it, or the slot is empty" \
       "--top --percent 50 --pane-id $VW" "--right --percent 80 --pane-id $BR --move-pane-id $VW" "$CALLS"
# The whole task in four lines: nothing died, and revdiff came back as it was.
refute "NEITHER half was killed on the way past"  "kill-pane" "$CALLS"
parked "the browser is parked, still running"     "$BR"
parked "...and the viewer with it"                "$VW"
same   "the slot holds the SAME revdiff pane as before browse" "$(pane_key diff)" "$DP"
in_slot "...and it really is back in the cockpit tab" "$DP"
refute "revdiff was NOT relaunched into it"       "revdiff --wrap" "$CALLS"
grew   "...it simply came back from its park"     "came back from its park in uncommitted mode" "$T/daemon.log" "$CB0"
check  "all three viewer keys were cleared together" \
                                                  '"viewer":null,"viewerAgent":null,"viewerRoot":null' "$T/state/panes.json"
fi

if section "11d'" "a PARKED half is never healed; the slot's revdiff still is"; then
# Both halves are parked now, in a tab of their own, and the healer's business is
# the SLOT. A parked pane sitting at a prompt is not a broken cockpit -- nobody can
# see it -- and typing into one would fight whatever the user does with it next.
# Meanwhile the ordinary revdiff heal has to go on working exactly as it did.
: > "$CALLS"
retitle "$BR" sh
retitle "$VW" sh
HEALD0="$(countof "revdiff was quit in abc12345; reinstated it" "$T/daemon.log")"
retitle "$DP" sh                          # ...and quit the revdiff that holds the slot
waitmore "revdiff was quit in abc12345; reinstated it" "$T/daemon.log" "$HEALD0" 10 "the slot revdiff's heal"
# window: two more healer ticks (ms(1000)) after the slot's heal. The parked halves
# have been shells since before it and their cooldowns ran out sections ago, so a
# heal that reached for them would land in the same tick or the next.
nap 2
refute "nothing was typed into the parked browser" "send-text --pane-id $BR" "$CALLS"
refute "...nor into the parked viewer"             "send-text --pane-id $VW" "$CALLS"
check  "the SLOT's revdiff was reinstated as ever" "send-text --pane-id $DP" "$CALLS"
check  "...on this agent's own uncommitted range"  "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"
parked "the browser is still parked, untouched"    "$BR"
parked "...and the viewer with it"                 "$VW"
# Put the pair back as it was, so the restore below sees two running programs.
retitle "$BR" broot
retitle "$VW" micro
fi

if section 11e "⌥[/⌥] cycle modes from the VIEWER half as well"; then
: > "$CALLS"
echo "$(pane_key diff)" > "$ACTIVE"
EB0="$(countof "entered browse for abc12345" "$T/daemon.log")"
echo prev >> "$T/state/cmd"               # uncommitted -> browse again
waitmore "entered browse for abc12345" "$T/daemon.log" "$EB0" 10 "the pair coming back from its park"
BR2="$(pane_key diff)"; VW2="$(pane_key viewer)"
check "back in browse"                            '"diffMode":"browse"' "$T/state/terminals.json"
# The round trip, and the reason tabs are worth having: browse is one stop in a
# four-way cycle, so it is passed through constantly. Two new panes here would mean
# an empty tab bar and broot back at the top of the tree every time.
same   "the SAME browser came back, not a new one" "$BR2" "$BR"
same   "...and the same viewer beside it"          "$VW2" "$VW"
refute "broot was not relaunched"                  "broot --git-ignored --conf" "$CALLS"
refute "nor micro"                                 "micro -readonly true" "$CALLS"
refute "and nothing at all was typed into the browser" "send-text --pane-id $BR2" "$CALLS"
refute "...nor into the viewer"                    "send-text --pane-id $VW2" "$CALLS"
check  "the restored browser was moved, not respawned" "--move-pane-id $BR2" "$CALLS"
check  "...and the viewer split off it at 80% again"   "--right --percent 80 --pane-id $BR2 --move-pane-id $VW2" "$CALLS"
# The same order the fresh launch is held to, asserted again on the RESTORE path so
# a later session cannot "tidy" the two calls into the other order: the browser is
# the half that carries the slot, and 80% taken off half a slot is not 80%.
before "...the browser back in the slot FIRST, never the viewer" \
       "--move-pane-id $BR2" "--right --percent 80 --pane-id $BR2 --move-pane-id $VW2" "$CALLS"
: > "$CALLS"
echo "$VW2" > "$ACTIVE"                   # the VIEWER holds focus this time
LB0="$(countof "left browse for abc12345" "$T/daemon.log")"
echo next >> "$T/state/cmd"
# The mode is written before the pair moves; wait for the pair to be out of the
# slot too, so 11f's own keypress does not arrive mid-swap.
waitmore "left browse for abc12345" "$T/daemon.log" "$LB0" 10 "the pair leaving the slot"
check "the keys cycled the MODE with the viewer focused" \
                                                  '"diffMode":"uncommitted"' "$T/state/terminals.json"
fi

if section 11f "a TERMINAL focused still cycles terminals, in browse mode too"; then
: > "$CALLS"
echo "$(pane_key diff)" > "$ACTIVE"
EB0="$(countof "entered browse for abc12345" "$T/daemon.log")"
echo prev >> "$T/state/cmd"               # back into browse
waitmore "entered browse for abc12345" "$T/daemon.log" "$EB0" 10 "the pair back in the slot"
BR3="$(pane_key diff)"
: > "$CALLS"
echo 32 > "$ACTIVE"                       # focus the agent's terminal
echo next >> "$T/state/cmd"
# window: `next` with one terminal changes nothing and logs nothing. The cmd channel
# is read every ms(200): ten reads, and time for a wrong switch's first pane call.
nap 2
check  "the mode is untouched"                    '"diffMode":"browse"' "$T/state/terminals.json"
refute "no half was disposed of"                  "kill-pane" "$CALLS"
refute "and no revdiff was launched"              "revdiff --wrap" "$CALLS"

# ⌥t/⌥w are always terminals, from either half. Nets to zero: the fresh terminal
# opened here is closed again, leaving the agent's original terminal 32.
: > "$CALLS"
echo "$BR3" > "$ACTIVE"                   # from the BROWSER half
echo new >> "$T/state/cmd"
waituntil 10 "a second terminal in terminals.json" grep -qF '"n":2' "$T/state/terminals.json"
check "⌥t opened a terminal from the browser half" '"n":2' "$T/state/terminals.json"
echo close-2 >> "$T/state/cmd"
# terminals.json is one line, so -v succeeds exactly when that line has no "n":2.
waituntil 10 "the second terminal gone from terminals.json" grep -qvF '"n":2' "$T/state/terminals.json"
refute "⌥w closed it again"                        '"n":2' "$T/state/terminals.json"
fi

if section 11g "the mode is PER AGENT: browse is never inherited"; then
# The second agent was reaped in section 7; bring it back so a switch has somewhere
# to go. It has never been in browse and must open in the uncommitted default.
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED4","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":2,"id":"def67890","cwd":"$WT2","kind":"background",
  "sessionId":"s2","name":"second agent","startedAt":0,"status":"idle","state":"done"}]
JSON
BRS="$(pane_key diff)"; VWS="$(pane_key viewer)"
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"
# An agent switch ends in showTerminal, whose terminals.json write is the first to
# carry the new agent's name -- after both slots have been swapped.
waituntil 10 "the switch to the second agent to finish" grep -qF '"agent":"second agent"' "$T/state/terminals.json"
check  "the other agent opens in the uncommitted default" \
                                                  '"diffMode":"uncommitted"' "$T/state/terminals.json"
refute "no browser was launched for it"           "broot --git-ignored --conf" "$CALLS"
# Switching away is the case browse is passed through most often of all, so it is
# the one that must not cost the tabs either.
check  "the browsing agent's browser was PARKED on the way out" \
                                                  "move-pane-to-new-tab --pane-id $BRS" "$CALLS"
check  "...and its viewer parked beside it, in the same tab" \
                                                  "--right --percent 80 --pane-id $BRS --move-pane-id $VWS" "$CALLS"
before "...the browser first, so the viewer could hold the slot meanwhile" \
       "move-pane-to-new-tab --pane-id $BRS" "--right --percent 80 --pane-id $BRS --move-pane-id $VWS" "$CALLS"
refute "the browser was not killed"               "kill-pane --pane-id $BRS" "$CALLS"
refute "nor the viewer"                           "kill-pane --pane-id $VWS" "$CALLS"
parked "the browser is alive, parked"             "$BRS"
parked "...and so is the viewer"                  "$VWS"
check  "the viewer keys went with it"             '"viewer":null' "$T/state/panes.json"
same   "the two are parked TOGETHER, in one tab"  "$(pane_tab "$BRS")" "$(pane_tab "$VWS")"

: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
waituntil 10 "the switch back to the test agent to finish" grep -qF '"agent":"test agent"' "$T/state/terminals.json"
check "the browsing agent kept its OWN browse mode" '"diffMode":"browse"' "$T/state/terminals.json"
same  "the same browser came back to the slot"      "$(pane_key diff)" "$BRS"
same  "...and the same viewer"                      "$(pane_key viewer)" "$VWS"
check "...moved, not respawned"                     "--move-pane-id $BRS" "$CALLS"
check "...with the viewer split off it at 80%"      "--right --percent 80 --pane-id $BRS --move-pane-id $VWS" "$CALLS"
refute "neither half was relaunched"                "broot --git-ignored --conf" "$CALLS"
refute "...nor micro"                               "micro -readonly true" "$CALLS"
check "panes.json names a viewer again"             '"viewerAgent":"abc12345"' "$T/state/panes.json"
fi

if section 11h "detaching to the fleet list clears all three keys"; then
: > "$CALLS"
echo list > "$FLEETSTATE"
waituntil 10 "the detach to the fleet list to finish" grep -qF '"agent":"repo"' "$T/state/terminals.json"
check "the viewer keys are cleared on detach"     '"viewer":null,"viewerAgent":null,"viewerRoot":null' "$T/state/panes.json"
fi

if section 11i "clicking the footer's Browse label"; then
# The footer appends `diff-browse`; like the other labels it names the mode outright
# and must not depend on which pane is focused.
echo "test agent" > "$FLEETSTATE"
waituntil 10 "the switch back to the test agent to finish" grep -qF '"agent":"test agent"' "$T/state/terminals.json"
BRC="$(pane_key diff)"; VWC="$(pane_key viewer)"
: > "$CALLS"; : > "$ACTIVE"
LB0="$(countof "left browse for abc12345" "$T/daemon.log")"
echo diff-uncommitted >> "$T/state/cmd"   # leave browse by clicking, not by key
waitmore "left browse for abc12345" "$T/daemon.log" "$LB0" 10 "the click to take the pair out"
check "clicking Uncommitted left browse"          '"diffMode":"uncommitted"' "$T/state/terminals.json"
# Counted: 11d and 11e already wrote this line, so a plain check passed on theirs.
grew  "...and the pair went with it"              "left browse for abc12345" "$T/daemon.log" "$LB0"
# How you left browse must not decide whether the tabs survive it: the click path
# is a different function from the key path and would happily kill what the keys
# park.
refute "...parked, not killed -- the browser"     "kill-pane --pane-id $BRC" "$CALLS"
refute "...nor the viewer"                        "kill-pane --pane-id $VWC" "$CALLS"
parked "the clicked-away browser is still alive"  "$BRC"
parked "...and its viewer"                        "$VWC"

EB0="$(countof "entered browse for abc12345" "$T/daemon.log")"
: > "$CALLS"
echo diff-browse >> "$T/state/cmd"
waitmore "entered browse for abc12345" "$T/daemon.log" "$EB0" 10 "the click to bring the pair back"
check "clicking Browse switched, unfocused"       '"diffMode":"browse"' "$T/state/terminals.json"
same  "...and brought the SAME browser back"      "$(pane_key diff)" "$BRC"
same  "...and the same viewer"                    "$(pane_key viewer)" "$VWC"
refute "...without relaunching broot"             "broot --git-ignored --conf" "$CALLS"
check "...publishing the viewer with it"          '"viewerAgent":"abc12345"' "$T/state/panes.json"

: > "$CALLS"
echo diff-browse >> "$T/state/cmd"        # the ALREADY-active label
# window: diffModeSet returns at once for the active label and logs nothing. The cmd
# channel is read every ms(200): ten reads, and time for a wrong launch's first pane call.
nap 2
refute "clicking Browse again launches nothing"   "broot --git-ignored --conf" "$CALLS"
refute "...and disposes of nothing"               "kill-pane" "$CALLS"
fi

if section 11j "⌥[ out of browse lands on CUSTOM and opens the ref prompt"; then
# The one transition the mode cycle makes that is neither "launch revdiff" nor
# "launch the pair": leaveBrowse hands the slot to a fresh shell and the PROMPT is
# typed into that, not into a browse half that no longer exists.
BR4="$(pane_key diff)"; VW4="$(pane_key viewer)"
: > "$CALLS"
echo "$BR4" > "$ACTIVE"                   # the browser holds focus
CP0="$(countof "opened custom-range prompt for abc12345" "$T/daemon.log")"
echo prev >> "$T/state/cmd"               # browse -> custom (browse is the fourth stop)
waitmore "opened custom-range prompt for abc12345" "$T/daemon.log" "$CP0" 10 "the ref prompt to open"
SLOT4="$(pane_key diff)"
check  "the mode is now custom"                   '"diffMode":"custom"' "$T/state/terminals.json"
check  "the ref prompt opened"                    "cockpit-custom-prompt.mjs" "$CALLS"
check  "...in the slot pane the pair handed back" \
                                                  "send-text --pane-id $SLOT4" "$CALLS"
refute "...not into the browser, which is gone"   "send-text --pane-id $BR4" "$CALLS"
refute "...nor into the viewer"                   "send-text --pane-id $VW4" "$CALLS"
check  "the viewer keys were cleared leaving browse" \
                                                  '"viewer":null,"viewerAgent":null,"viewerRoot":null' "$T/state/panes.json"
refute "and revdiff is NOT launched until the prompt answers" "revdiff --wrap" "$CALLS"

# The prompt is a plain node process, so the pane it owns reads as a bare `shell` --
# exactly the healer's cue. Long enough for the relaunch cooldown to expire, so what
# holds the healer off is the customPromptOpen guard and nothing else; without it,
# revdiff is typed over a live prompt where every character is an editor keystroke.
: > "$CALLS"
# window: DIFF_RELAUNCH_COOLDOWN_MS (3000, scaled like nap), armed when the prompt
# opened, plus two healer ticks (ms(1000)) after it runs out.
nap 5
refute "no heal fires while the ref prompt owns the pane" "send-text --pane-id $SLOT4" "$CALLS"
refute "...so no revdiff was typed over it"              "revdiff --wrap" "$CALLS"

# Cancelling reverts to browse -- which is not a revdiff range at all, so the pair
# has to come back rather than diffCommand picking something for it.
: > "$CALLS"
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
EB0="$(countof "entered browse for abc12345" "$T/daemon.log")"
echo custom-cancel >> "$T/state/cmd"
waitmore "entered browse for abc12345" "$T/daemon.log" "$EB0" 10 "the cancel to bring the pair back"
# resolveCustomPrompt writes the footer's mode only after enterBrowse returns.
waituntil 10 "the reverted mode in terminals.json" grep -qF '"diffMode":"browse"' "$T/state/terminals.json"
check  "cancel reverted to browse"                '"diffMode":"browse"' "$T/state/terminals.json"
same   "...and brought the same browser back"     "$(pane_key diff)" "$BR4"
same   "...and the same viewer"                   "$(pane_key viewer)" "$VW4"
refute "...without relaunching broot"             "broot --git-ignored --conf" "$CALLS"
check  "...publishing the viewer again"           '"viewerAgent":"abc12345"' "$T/state/panes.json"
refute "...rather than putting a diff in the slot" "revdiff --wrap" "$CALLS"
fi

if section 11k "a worktree migration in browse mode FOLLOWS focus, never takes it"; then
# followWorktreeMigration fires on the AGENT's schedule -- it created a worktree and
# moved into it -- so it can land while you are typing into the Claude pane. The
# revdiff branch moves focus nowhere; the browse branch rebuilds two panes and must
# not take the keyboard with them, or the rest of your sentence goes into broot's
# filter box. Each move is a poll on the rebuild's own last line: the relaunch
# cooldown and the MIGRATION_CHECK_MS throttle (both scaled) come first, and a 15s
# limit covers them several times over under load.
MOVED5="$T/moved5"; mkrepo "$MOVED5"
echo 32 > "$ACTIVE"                       # focus is on the agent's TERMINAL, not the slot
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED5","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
waituntil 15 "the pair rebuilt in moved5" grep -qE "entered browse for abc12345: .* at $MOVED5\$" "$T/daemon.log"
BR5="$(pane_key diff)"
check  "the pair followed the agent into the new worktree" "--cwd $MOVED5 --" "$CALLS"
check  "...and broot was relaunched there"        "broot --git-ignored --conf" "$CALLS"
refute "the keyboard was NOT dragged into the new browser" \
                                                  "activate-pane --pane-id $BR5" "$CALLS"

# The other half of the same rule: focus that was already in the slot follows the
# pair, or a migration would leave you focused on a pane that has been killed.
MOVED6="$T/moved6"; mkrepo "$MOVED6"
echo "$BR5" > "$ACTIVE"                   # focus is on the BROWSER this time
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED6","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
waituntil 15 "the pair rebuilt in moved6" grep -qE "entered browse for abc12345: .* at $MOVED6\$" "$T/daemon.log"
BR6="$(pane_key diff)"
check "the pair moved again"                      "--cwd $MOVED6 --" "$CALLS"
check "...and focus came with it, since it was in the slot" \
                                                  "activate-pane --pane-id $BR6" "$CALLS"
fi

if section 11l "two agents BOTH in browse: the right pair in the slot, four panes parked"; then
# Each agent now owns THREE panes in the diff slot's world -- its revdiff, its
# browser and its viewer -- and only one pair may be on screen. Getting this wrong
# swaps one agent's browser in beside the other agent's viewer.
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED6","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":2,"id":"def67890","cwd":"$WT2","kind":"background",
  "sessionId":"s2","name":"second agent","startedAt":0,"status":"idle","state":"done"}]
JSON
# Which pane the daemon last parked as an agent's revdiff -- the third pane of the
# three, the one no published key names while its pair is in the slot.
last_parked_diff() { grep -o "parked diff pane [0-9]* for $1" "$T/daemon.log" | tail -1 | sed 's/[^0-9]*\([0-9]*\).*/\1/'; }
BRA="$(pane_key diff)"; VWA="$(pane_key viewer)"; DPA="$(last_parked_diff abc12345)"
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"
waituntil 10 "the switch to the second agent to finish" grep -qF '"agent":"second agent"' "$T/state/terminals.json"
DPB="$(pane_key diff)"                    # the second agent's revdiff, before it browses
: > "$CALLS"
EBD0="$(countof "entered browse for def67890" "$T/daemon.log")"
echo diff-browse >> "$T/state/cmd"
waitmore "entered browse for def67890" "$T/daemon.log" "$EBD0" 10 "the second agent's pair"
BRB="$(pane_key diff)"; VWB="$(pane_key viewer)"
check  "the second agent got a pair of ITS OWN"        "broot --git-ignored --conf" "$CALLS"
same   "...a different browser from the first agent's" \
       "$([ "$BRB" = "$BRA" ] && echo shared || echo separate)" "separate"
parked "...and its own revdiff parked behind it"       "$DPB"
# A parked half is alive and off screen, and nothing may reach for it.
# window: three healer ticks (ms(1000)) and four reap rounds (REAP_MS, 700) --
# both scaled by the same SPEED as nap.
nap 3
parked "the first agent's browser is untouched, parked" "$BRA"
parked "...and its viewer"                             "$VWA"
parked "...and its revdiff, parked behind its pair"    "$DPA"
refute "nothing was typed into the parked browser"     "send-text --pane-id $BRA" "$CALLS"
refute "...nor into the parked viewer"                 "send-text --pane-id $VWA" "$CALLS"

: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
waituntil 10 "the switch back to the test agent to finish" grep -qF '"agent":"test agent"' "$T/state/terminals.json"
same   "the first agent's own browser is back in the slot" "$(pane_key diff)" "$BRA"
same   "...beside its own viewer, not the other agent's"   "$(pane_key viewer)" "$VWA"
check  "the second agent's browser parked"                 "move-pane-to-new-tab --pane-id $BRB" "$CALLS"
check  "...with its viewer beside it"                      "--right --percent 80 --pane-id $BRB --move-pane-id $VWB" "$CALLS"
refute "no pane was killed switching between two pairs"    "kill-pane" "$CALLS"
parked "the second agent's browser is alive, parked"       "$BRB"
parked "...and its viewer"                                 "$VWB"
parked "...and its revdiff"                                "$DPB"
check  "the viewer keys name the FIRST agent again"        '"viewerAgent":"abc12345"' "$T/state/panes.json"
fi

if section 11m "an EMPTY slot is rebuilt full width, then handed a whole pair"; then
# The slot's pane can die under us (exit the shell revdiff is in). Rebuilding it
# needs the fleet pane alone in its row, so the terminal steps aside and comes
# back -- and what is put into the placeholder afterwards is now TWO panes.
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"
waituntil 10 "the switch to the second agent to finish" grep -qF '"agent":"second agent"' "$T/state/terminals.json"
CBD0="$(countof "for def67890 came back from its park in uncommitted mode" "$T/daemon.log")"
echo diff-uncommitted >> "$T/state/cmd"   # the second agent stops browsing
waitmore "for def67890 came back from its park in uncommitted mode" "$T/daemon.log" "$CBD0" 10 \
  "the second agent's revdiff back from its park"
DEAD="$(pane_key diff)"
RB0="$(countof "rebuilt the diff slot" "$T/daemon.log")"
: > "$CALLS"
awk -v p="$DEAD" '$1 != p' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
echo "test agent" > "$FLEETSTATE"         # ...and its slot pane dies as we leave it
waituntil 15 "the switch back to the test agent, through a rebuilt slot" \
  grep -qF '"agent":"test agent"' "$T/state/terminals.json"
# Counted: an earlier section rebuilt the slot too, so a plain check passed on that.
grew   "the slot was rebuilt"                     "rebuilt the diff slot" "$T/daemon.log" "$RB0"
check  "the full-width split came off the fleet pane" "--top --percent 42 --pane-id 20" "$CALLS"
same   "the browsing agent's browser took the placeholder" "$(pane_key diff)" "$BRA"
same   "...and its viewer came back beside it"             "$(pane_key viewer)" "$VWA"
refute "neither half was relaunched into the rebuilt slot"  "broot --git-ignored --conf" "$CALLS"
refute "...nor micro"                                       "micro -readonly true" "$CALLS"
fi

if section 11n "the viewer tab list: kept across a park, reset by a fresh launch"; then
# The list is the only record of what micro has open -- it cannot be asked. A
# restored viewer still has every tab, so the list must survive with it; a viewer
# started from scratch has none, so a leftover list would make the next push a
# `tabswitch` onto a tab that is not there and jump to the wrong file silently.
printf '{"abc12345":["bin/a.mjs"]}\n' > "$T/state/viewer-tabs.json"
: > "$CALLS"; : > "$ACTIVE"
LB0="$(countof "left browse for abc12345" "$T/daemon.log")"
EB0="$(countof "entered browse for abc12345" "$T/daemon.log")"
echo diff-uncommitted >> "$T/state/cmd"
waitmore "left browse for abc12345" "$T/daemon.log" "$LB0" 10 "the pair leaving the slot"
echo diff-browse >> "$T/state/cmd"
waitmore "entered browse for abc12345" "$T/daemon.log" "$EB0" 10 "the pair coming back"
same  "the same viewer came back from the park"   "$(pane_key viewer)" "$VWA"
check "...so the list of what was pushed into it is untouched" \
                                                  "bin/a.mjs" "$T/state/viewer-tabs.json"

# A worktree migration is the one thing that REPLACES the pair: broot would
# otherwise be rooted in a directory the agent has left. A poll on the rebuild's
# last line; the relaunch cooldown and MIGRATION_CHECK_MS throttle come first.
MOVED7="$T/moved7"; mkrepo "$MOVED7"
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED7","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":2,"id":"def67890","cwd":"$WT2","kind":"background",
  "sessionId":"s2","name":"second agent","startedAt":0,"status":"idle","state":"done"}]
JSON
RT0="$(countof "reset the viewer tab list for abc12345" "$T/daemon.log")"
: > "$CALLS"
waituntil 15 "the pair rebuilt in moved7" grep -qE "entered browse for abc12345: .* at $MOVED7\$" "$T/daemon.log"
check  "the pair was rebuilt in the new worktree"  "--cwd $MOVED7 --" "$CALLS"
check  "...micro started fresh with it"            "$MICRO_LAUNCH" "$CALLS"
# Counted: 11c's healed viewer already wrote this line for the same agent.
grew   "...so that agent's tab list was reset"     "reset the viewer tab list for abc12345" "$T/daemon.log" "$RT0"
refute "...and the stale tabs are gone"            "bin/a.mjs" "$T/state/viewer-tabs.json"
fi

if section 11o "the park's saving SURVIVES the next agent switch"; then
# What a parked revdiff was last launched with is recorded per agent, and entering
# browse overwrites that record with `browse` -- correctly, while the pair is up.
# Handing the revdiff back without relaunching it therefore has to put the record
# straight again: left saying `browse`, the next attach reads a mode that does not
# match the agent's and quits and relaunches the very revdiff the park just saved,
# losing the selected file, the scroll position and any unflushed annotations.
: > "$CALLS"; : > "$ACTIVE"
RL0="$(countof "for abc12345 in uncommitted mode" "$T/daemon.log")"
EB0="$(countof "entered browse for abc12345" "$T/daemon.log")"
CB0="$(countof "came back from its park in uncommitted mode" "$T/daemon.log")"
echo diff-uncommitted >> "$T/state/cmd"   # out of browse (stale: the agent moved in 11n)
# relaunchDiff's line, "relaunched diff pane N for abc12345 in uncommitted mode".
waitmore "for abc12345 in uncommitted mode" "$T/daemon.log" "$RL0" 10 "the stale revdiff's relaunch"
echo diff-browse >> "$T/state/cmd"        # in again -- the revdiff parks in uncommitted
waitmore "entered browse for abc12345" "$T/daemon.log" "$EB0" 10 "the pair entering browse"
: > "$CALLS"
echo diff-uncommitted >> "$T/state/cmd"   # and out: nothing to relaunch
waitmore "came back from its park in uncommitted mode" "$T/daemon.log" "$CB0" 10 "the revdiff back from its park"
DPARK="$(pane_key diff)"
refute "the revdiff came back from its park untouched" "revdiff --wrap" "$CALLS"
# Counted: 11d already wrote this line, so a plain check passed on that one.
grew   "...and the daemon said so"                     "came back from its park in uncommitted mode" "$T/daemon.log" "$CB0"

: > "$CALLS"
echo "second agent" > "$FLEETSTATE"
waituntil 10 "the switch to the second agent to finish" grep -qF '"agent":"second agent"' "$T/state/terminals.json"
: > "$CALLS"                              # the other agent's own launch is not ours
echo "test agent" > "$FLEETSTATE"
waituntil 10 "the switch back to the test agent to finish" grep -qF '"agent":"test agent"' "$T/state/terminals.json"
same   "the same revdiff pane came back to the slot"   "$(pane_key diff)" "$DPARK"
refute "...and it was NOT relaunched on the way in"    "revdiff --wrap" "$CALLS"
refute "...nor quit to be relaunched"                  'STDIN:q\n' "$CALLS"
fi

if section 11p "reaping an agent takes its WHOLE pair, and its tab list with it"; then
# An agent can now own four panes: a terminal, a browser, a viewer and the revdiff
# parked while the pair browses. Every one of them has to go when the agent leaves
# the fleet, or it lives on -- unreachable, since its agent is no longer in the list
# -- for the whole life of the window. And the record of what its viewer had open
# goes with it: job ids are not reused, so an entry left behind is never read again.
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"
waituntil 10 "the switch to the second agent to finish" grep -qF '"agent":"second agent"' "$T/state/terminals.json"
TRMD="$(grep -oE '(opened|restored) terminal pane [0-9]+' "$T/daemon.log" | tail -1 | grep -oE '[0-9]+$')"
DPD="$(pane_key diff)"                    # its revdiff, about to be parked
EBD0="$(countof "entered browse for def67890" "$T/daemon.log")"
echo diff-browse >> "$T/state/cmd"
waitmore "entered browse for def67890" "$T/daemon.log" "$EBD0" 10 "the second agent's pair"
BRD="$(pane_key diff)"; VWD="$(pane_key viewer)"
printf '{"abc12345":["bin/still-mine.mjs"],"def67890":["bin/gone-with-it.mjs"]}\n' > "$T/state/viewer-tabs.json"

# It vanishes from the fleet while its pair is ON SCREEN. The slot must survive
# that: an agent holding the slot is never a reap candidate, so nothing is killed
# out from under the window and the slot is left neither empty nor half-occupied.
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED7","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
# window: REAP_MS (700, scaled like nap) per round and REAP_STRIKES=2 misses to reap,
# so four seconds of base time is five rounds -- two and a half times what a reap
# of the on-screen agent would need.
nap 4
refute "the on-screen browser was not reaped"     "kill-pane --pane-id $BRD" "$CALLS"
refute "...nor its viewer"                        "kill-pane --pane-id $VWD" "$CALLS"
in_slot "the browser still holds the slot"        "$BRD"
in_slot "...with the viewer beside it"            "$VWD"

# Switch away and it becomes reapable: pair parked, revdiff parked, terminal parked.
STRIKE0="$(countof "agent def67890 missing (1/2); not reaping yet" "$T/daemon.log")"
GONE0="$(countof "agent def67890 is gone" "$T/daemon.log")"
# Cleared BEFORE the switch: the reap interval is a fraction of a second, so the
# disposal lands inside the switch itself -- clearing afterwards throws away the
# very calls this section is about.
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
waitmore "agent def67890 is gone" "$T/daemon.log" "$GONE0" 20 \
  || { echo "  FAIL the agent was never reaped"; fail=1; }
# "is gone" ends the FIRST line of reapKeyPanes; the parked revdiff is its last kill.
waitfor "reaped parked diff pane $DPD" "$T/daemon.log" 10 "the rest of the disposal"

check  "the parked BROWSER was killed"            "kill-pane --pane-id $BRD" "$CALLS"
# ONCE. In browse mode `diffs` names the browser, so the reaper used to kill it a
# second time on its way through the diff slot. The stub shrugs that off -- its
# kill-pane always succeeds -- but a real `wezterm cli` fails, and a failed call
# sends the daemon hunting for a dead mux socket, relinking it and spending the
# repair cooldown a genuine failure would need.
same   "...once, not twice"                       "$(grep -cE "kill-pane --pane-id $BRD\$" "$CALLS")" 1
check  "...and the parked VIEWER with it"         "kill-pane --pane-id $VWD" "$CALLS"
check  "...and the revdiff parked while it browsed" "kill-pane --pane-id $DPD" "$CALLS"
check  "...and its terminal"                      "kill-pane --pane-id $TRMD" "$CALLS"
gone   "the browser pane is out of the mux"       "$BRD"
gone   "...and the viewer pane"                   "$VWD"
gone   "...and the parked revdiff"                "$DPD"
gone   "...and the terminal"                      "$TRMD"
check  "its tab list was dropped, and said so"    "reset the viewer tab list for def67890 (agent gone)" "$T/daemon.log"
refute "...so nothing of its is left in the file" "bin/gone-with-it.mjs" "$T/state/viewer-tabs.json"
check  "the surviving agent's tabs are untouched" "bin/still-mine.mjs" "$T/state/viewer-tabs.json"
refute "panes.json never names the reaped viewer" "\"viewer\":$VWD" "$T/state/panes.json"
# Two consecutive misses, still: one failed `claude agents` read must not kill a
# shell with someone's build running in it. The strike is logged precisely so that
# a miss which does NOT reap leaves a trace to assert on.
grew   "the first miss was a strike, not a reap"  "agent def67890 missing (1/2); not reaping yet" "$T/daemon.log" "$STRIKE0"
before_last "...and it came BEFORE the reap, not after" \
       "agent def67890 missing (1/2); not reaping yet" "agent def67890 is gone" "$T/daemon.log"
# The surviving agent is untouched, slot and all.
in_slot "the attached agent still holds the slot" "$(pane_key diff)"
fi

# --- waits for the pir-pane sections (15a-16p, plans/test-suite-speed T07) ---
# No log line marks the END of an attach or an exit: "pir: enter" and "exit ... →
# fleet list" are logged BEFORE the panes move. showTerminal writes terminals.json
# LAST (after the parks, the focus and panes.json), so the footer's label changing
# is the end of the pane dance, and these sections poll for it with `waitfor` on
# terminals.json (a whole-file rewrite, so a poll there reads state, not history).
# tjlacks <fragment>: for waituntil, the footer no longer carries a fragment.
tjlacks() { ! grep -qF -- "$1" "$T/state/terminals.json"; }
# fleetclick <claude|pir>: click a fleet label and wait for switchFleet to finish.
# "fleet slot now shows" is its last line, after the park, the focus and the
# footer write; counted against a baseline because the log is cumulative (3.3).
fleetclick() {
  local n0; n0=$(countof "fleet slot now shows $1" "$T/daemon.log")
  echo "fleet-$1" >> "$T/state/cmd"
  waitmore "fleet slot now shows $1" "$T/daemon.log" "$n0" 10 "the fleet slot to show $1"
}

if section 15a "the fleet slot: PIR is refused with an agent attached, nothing moves"; then
# pir-pane T03. The bottom-left slot can hold claude agents OR the pir dashboard, the
# other one parked. A switch is only allowed with the shown program at its list
# (DESIGN 2.2), so it never has to decide what to do with an attached diff.
: > "$CALLS"
R0="$(countof "refusing fleet-pir: claude is not at its list" "$T/daemon.log")"
echo fleet-pir >> "$T/state/cmd"
waitmore "refusing fleet-pir: claude is not at its list" "$T/daemon.log" "$R0" 10 "the fleet-pir refusal"
grew   "the refusal was logged"                    "refusing fleet-pir: claude is not at its list" "$T/daemon.log" "$R0"
refute "no pir pane was spawned"                   "cockpit-pir.sh" "$CALLS"
refute "the claude pane was not parked"            "move-pane-to-new-tab --pane-id 20" "$CALLS"
check  "the footer still says claude"              '"program":"claude"' "$T/state/terminals.json"
check  "...and draws the switch as not clickable"  '"switchable":false' "$T/state/terminals.json"
fi

if section 15b "a NON-REPO agent attaches nothing, and is still not a list"; then
# An agent left at a folder with no repo keeps the default panes (unreviewableName),
# so "nothing attached" is not the same as "at the list": the footer must say so from
# the reconcile poll, not only on attach/exit.
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED7","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":3,"id":"fff00000","cwd":"$T/home","kind":"background",
  "sessionId":"s3","name":"stray agent","startedAt":0,"status":"idle","state":"done"}]
JSON
echo list > "$FLEETSTATE"
waitfor '"switchable":true' "$T/state/terminals.json" 10 "the switch to go clickable at the list"
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
check  "at the list the switch is clickable"       '"switchable":true' "$T/state/terminals.json"
echo "stray agent" > "$FLEETSTATE"
# The non-repo line is logged after noteSwitchable has written the dim switch.
waitfor "at non-repo $T/home" "$T/daemon.log" 10 "the stray agent to be judged non-repo"
check  "the stray agent was not attached"          "at non-repo $T/home" "$T/daemon.log"
check  "...the panes stayed on the repo"           '"agent":"repo"' "$T/state/terminals.json"
check  "...and the switch went dim anyway"         '"switchable":false' "$T/state/terminals.json"
: > "$CALLS"
R0="$(countof "refusing fleet-pir: claude is not at its list" "$T/daemon.log")"
echo fleet-pir >> "$T/state/cmd"
waitmore "refusing fleet-pir: claude is not at its list" "$T/daemon.log" "$R0" 10 "the stray fleet-pir refusal"
grew   "a stray fleet-pir is refused there too"    "refusing fleet-pir: claude is not at its list" "$T/daemon.log" "$R0"
refute "...and spawns nothing"                     "cockpit-pir.sh" "$CALLS"
fi

if section 15c "back at the list: claude shown, switchable, pir available"; then
echo list > "$FLEETSTATE"
waitfor '"fleet":{"program":"claude","switchable":true,"available":true}' "$T/state/terminals.json" 10 "the switch to go clickable again"
check  "terminals.json carries the fleet block"    '"fleet":{"program":"claude","switchable":true,"available":true}' "$T/state/terminals.json"
fi

if section 15d "PIR at the list: the pir pane is spawned into the slot, claude parked"; then
: > "$CALLS"
fleetclick pir
PIRP="$(pane_key pir)"
same   "panes.json names the pir pane"             "$([ -n "$PIRP" ] && echo yes || echo no)" "yes"
check  "split into the claude pane, T00's order"   "split-pane --left --percent 50 --pane-id 20 --cwd $WT --" "$CALLS"
check  "...through /usr/bin/env naming COCKPIT_REPO" "/usr/bin/env COCKPIT_REPO=$WT PATH=$T/state/bin:" "$CALLS"
check  "...running the relaunch loop on pir and the state file" \
       "$ROOT/bin/cockpit-pir.sh $T/bin/pir $T/state/pir-dashboard.json" "$CALLS"
before "the pir pane came in before claude was parked" "cockpit-pir.sh" "move-pane-to-new-tab --pane-id 20" "$CALLS"
parked "the claude pane is parked, not killed"     20
in_slot "the pir pane holds the slot"              "$PIRP"
check  "focus went to the pir pane"                "activate-pane --pane-id $PIRP" "$CALLS"
refute "nothing was killed"                        "kill-pane" "$CALLS"
check  "the footer says pir"                       '"fleet":{"program":"pir","switchable":true,"available":true}' "$T/state/terminals.json"
FTAB="$(pane_tab 20)"
fi

if section 15e "while pir is shown, the claude pane's text attaches nothing"; then
E0="$(countof "enter abc12345" "$T/daemon.log")"
echo "test agent" > "$FLEETSTATE"
# Window: POLL_MS (800 scaled) is the reconcile cadence, and an ungated one enters
# within one poll plus a `claude agents` read; 1.5s at 0.5 is ~4 polls. Nothing is
# logged while pir is shown, so there is no event to poll for instead.
nap 3
same   "no agent was entered (reconcile is gated)" "$(countof "enter abc12345" "$T/daemon.log")" "$E0"
check  "the panes stayed on the repo"              '"agent":"repo"' "$T/state/terminals.json"
in_slot "the pir pane still holds the slot"        "$PIRP"
echo list > "$FLEETSTATE"
fi

if section 15f "while pir is shown, focus-claude activates nothing"; then
: > "$CALLS"
F0="$(countof "focus-claude ignored: pir is shown" "$T/daemon.log")"
echo focus-claude >> "$T/state/cmd"
waitmore "focus-claude ignored: pir is shown" "$T/daemon.log" "$F0" 10 "focus-claude to be ignored"
refute "no pane was activated"                     "activate-pane" "$CALLS"
grew   "the ignore was logged"                     "focus-claude ignored: pir is shown" "$T/daemon.log" "$F0"
fi

if section 15g "terminals still land in the cockpit tab with claude parked"; then
# The landmark for "which tab is the cockpit" moved from the fleet pane to the
# footer. Left on the fleet pane, every park below would re-activate claude's
# parked tab ($FTAB) and fill the window with it.
: > "$CALLS"
echo new >> "$T/state/cmd"
# terminalCommand writes terminals.json after its park and its log line.
waitfor '"n":2,"active":true' "$T/state/terminals.json" 10 "the new repo terminal"
NEWT="$(grep -oE 'opened terminal pane [0-9]+ for repo' "$T/daemon.log" | tail -1 | grep -oE '[0-9]+')"
in_slot "the new repo terminal is in the slot"     "$NEWT"
check  "parking re-activated the cockpit tab"      "activate-tab --tab-id 0" "$CALLS"
refute "...never claude's parked tab"              "activate-tab --tab-id $FTAB" "$CALLS"
echo next >> "$T/state/cmd"
waitfor '"n":1,"active":true' "$T/state/terminals.json" 10 "next to cycle the repo terminals"
check  "next cycled the repo terminals"            '"n":1,"active":true' "$T/state/terminals.json"
echo close-2 >> "$T/state/cmd"
waituntil 10 "close-2 to close the second terminal" tjlacks '"n":2'
refute "close-2 closed the second"                 '"n":2' "$T/state/terminals.json"
refute "no park activated claude's tab"            "activate-tab --tab-id $FTAB" "$CALLS"
in_slot "the pir pane still holds the slot"        "$PIRP"
fi

if section 15h "Claude Agents: claude comes back, pir is parked, not killed"; then
: > "$CALLS"
fleetclick claude
check  "claude split back into the pir pane"      "split-pane --left --percent 50 --pane-id $PIRP --move-pane-id 20" "$CALLS"
before "...before pir was parked"                  "--move-pane-id 20" "move-pane-to-new-tab --pane-id $PIRP" "$CALLS"
in_slot "the claude pane holds the slot"           20
parked "the pir pane is parked"                    "$PIRP"
refute "nothing was killed"                        "kill-pane" "$CALLS"
check  "the footer says claude"                    '"program":"claude"' "$T/state/terminals.json"
fi

if section 15i "PIR again restores the SAME pir pane, spawning nothing"; then
: > "$CALLS"
fleetclick pir
check  "the parked pir pane was moved back"        "split-pane --left --percent 50 --pane-id 20 --move-pane-id $PIRP" "$CALLS"
refute "no second pir pane was spawned"            "cockpit-pir.sh" "$CALLS"
same   "panes.json still names the same pane"      "$(pane_key pir)" "$PIRP"
in_slot "the pir pane holds the slot"              "$PIRP"
parked "claude is parked again"                    20
fi

if section 15j "a Review click while pir is shown switches to claude, THEN spawns"; then
# spawnAgent types into claude's new-session box with a real Enter (DESIGN 2.8).
# Into pir those keys would drive its dashboard, so the switch comes first.
printf '{"version":1,"meUuid":null,"repos":{"alpha":{"fetchedAt":1,"prs":[{"id":7,"links":{"html":{"href":"https://bitbucket.org/ws/pr/7"}}}]}}}\n' \
  > "$T/state/bitbucket-cache.json"
: > "$CALLS"
SP0="$(countof "spawned agent in alpha" "$T/daemon.log")"
echo bb-review:alpha/7 >> "$T/state/cmd"
# spawnAgent logs this after the switch and both sends.
waitmore "spawned agent in alpha" "$T/daemon.log" "$SP0" 10 "the Review click to spawn"
before "claude was brought back before anything was typed" "--move-pane-id 20" "send-text --pane-id 20" "$CALLS"
check  "the review directive went to claude's box" "STDIN:@alpha Review Bitbucket PR https://bitbucket.org/ws/pr/7" "$CALLS"
same   "...as the text then a real Enter"          "$(grep -c -- 'send-text --pane-id 20 --no-paste' "$CALLS")" "2"
refute "nothing was typed into the pir pane"       "send-text --pane-id $PIRP" "$CALLS"
in_slot "claude holds the slot"                    20
parked "pir is parked"                             "$PIRP"
rm -f "$T/state/bitbucket-cache.json"
fi

if section 15k "a pir pane that died is spawned afresh on the next PIR"; then
awk -v p="$PIRP" '$1 != p' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
: > "$CALLS"
fleetclick pir
PIRP2="$(pane_key pir)"
check  "a new pir pane was spawned"                "cockpit-pir.sh" "$CALLS"
refute "...not a move of the dead one"             "--move-pane-id $PIRP" "$CALLS"
in_slot "the new pir pane holds the slot"          "$PIRP2"
fleetclick claude
in_slot "and claude comes back from it"            20
fi

if section 15k2 "PIR then Claude Agents read in one tick: both happen, claude ends up shown"; then
# The T06 drill on a real mux: the daemon reads cmd every 200ms, so two fast clicks
# arrive together, and the second was checked against the program before the first
# had switched -- dropped as "already shown", leaving pir up after a Claude click.
S0="$(countof "fleet slot now shows" "$T/daemon.log")"
C0="$(countof "fleet slot now shows claude" "$T/daemon.log")"
printf 'fleet-pir\nfleet-claude\n' >> "$T/state/cmd"
waitmore "fleet slot now shows claude" "$T/daemon.log" "$C0" 10 "the second click to switch"
same   "both clicks switched"                      "$(countof "fleet slot now shows" "$T/daemon.log")" "$((S0 + 2))"
in_slot "the last click's program holds the slot"  20
check  "...and the footer says claude"             '"program":"claude"' "$T/state/terminals.json"
fi

if section 15l "after the swaps, an agent attach still lands in the cockpit tab"; then
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
waitfor '"agent":"test agent"' "$T/state/terminals.json" 10 "the agent attach to finish"
check  "the agent was entered"                     "enter abc12345" "$T/daemon.log"
in_slot "its diff pane is in the slot"             "$(pane_key diff)"
in_slot "its terminal is in the slot"              "$(pane_key shell)"
check  "parks re-activated the cockpit tab"        "activate-tab --tab-id 0" "$CALLS"
check  "focus handed back to the claude pane"      "activate-pane --pane-id 20" "$CALLS"
echo list > "$FLEETSTATE"
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
fi

if section 16a "pir reports a RUN: its shared worktree attaches at custom-against-fork-point"; then
# pir-pane T04. The tests write pir-dashboard.json the way the real pir does (temp +
# rename). A run branched off main; main then moved on -- the person commits to main
# during builds -- so the fork point and main's tip differ (DESIGN 2.6).
PREPO="$T/pirrepo"; mkrepo "$PREPO"
echo base > "$PREPO/base.txt"; git -C "$PREPO" add -A; git -C "$PREPO" commit -qm fork
FORK="$(git -C "$PREPO" rev-parse --short HEAD)"
PRUN="$T/pirrun"; PWORK="$T/pirworker"; PRUN2="$T/pirrun2"
git -C "$PREPO" worktree add -q -b pir/slug "$PRUN"
echo run > "$PRUN/runwork.txt"; git -C "$PRUN" add -A; git -C "$PRUN" commit -qm "run work"
git -C "$PREPO" worktree add -q -b pir/slug-T01 "$PWORK" pir/slug
echo later > "$PREPO/mainlater.txt"; git -C "$PREPO" add -A; git -C "$PREPO" commit -qm "main later"
MAINTIP="$(git -C "$PREPO" rev-parse --short HEAD)"
# pirwrite <view> <run cwd|null> [<worker cwd|null>] [pid]: one atomic write. The pid
# defaults to this script's own, which is alive for as long as the suite runs.
pirjson() { [ "$1" = null ] && printf null || printf '"%s"' "$1"; }
# No spacing between writes: macOS's directory watch drops some changes made close
# together, and the daemon's reconcile-poll backstop follows those (16m2).
pirwrite() {
  local view="$1" run="null" worker="null" pid="${4:-$$}"
  [ "$view" != list ] && run="{\"key\":\"proj__slug\",\"kind\":\"work\",\"slug\":\"slug\",\"repo\":\"proj\",\"repoPath\":\"$PREPO\",\"branch\":\"pir/slug\",\"cwd\":$(pirjson "$2")}"
  [ "$view" = worker ] && worker="{\"id\":\"w1\",\"task\":\"T01\",\"role\":\"implement\",\"cwd\":$(pirjson "$3")}"
  printf '{"version":1,"pid":%s,"view":"%s","run":%s,"worker":%s,"updatedAt":"2026-09-27T00:00:00.000Z"}\n' \
    "$pid" "$view" "$run" "$worker" > "$T/state/pir-dashboard.json.tmp"
  mv "$T/state/pir-dashboard.json.tmp" "$T/state/pir-dashboard.json"
}
RK="pir.proj__slug"; WK="pir.proj__slug.w1"
RFILE="$T/state/review-$RK.md"
rm -f "$T/state/pir-dashboard.json"
fleetclick pir
# The suite stands in for the cockpit's own pir: its pid is on the pir pane's tty.
# Any other pid writing the file is some other pir, and is ignored (16m3).
echo "$$ ttys$(pane_key pir)" > "$PSTTY"
check  "pir is shown, and with no file it is at its list" '"fleet":{"program":"pir","switchable":true' "$T/state/terminals.json"
: > "$CALLS"
pirwrite run "$PRUN"
waitfor '"agent":"slug","diffMode":"custom"' "$T/state/terminals.json" 10 "the run key's attach to finish"
check  "the run key was entered at the run's folder" "pir: enter $RK → $PRUN" "$T/daemon.log"
RDIFF="$(pane_key diff)"; RTERM="$(pane_key shell)"
in_slot "its diff pane holds the slot"             "$RDIFF"
in_slot "its terminal holds the terminal slot"     "$RTERM"
check  "revdiff cd'd into the run's worktree"      "cd \"$PRUN\" && revdiff" "$CALLS"
check  "...custom against the fork point"          "--untracked -o \"$RFILE\" \"$FORK\"" "$CALLS"
refute "...never main's moved-on tip"              "\"$MAINTIP\"" "$CALLS"
refute "no ref prompt was opened"                  "cockpit-custom-prompt" "$CALLS"
check  "a terminal opened at the run's worktree"   "--cwd $PRUN --" "$CALLS"
check  "the footer reads Custom: <fork point>"     "\"diffMode\":\"custom\",\"customRef\":\"$FORK\"" "$T/state/terminals.json"
check  "...labelled with the run's slug"           '"agent":"slug"' "$T/state/terminals.json"
check  "reviewable is false with a pir key"        '"reviewable":false' "$T/state/terminals.json"
check  "the switch is dim while pir is in a run"   '"switchable":false' "$T/state/terminals.json"
refute "the fork point was never persisted"        "$RK" "$T/state/custom-refs.json"
R0="$(countof "refusing fleet-claude: pir is not at its list" "$T/daemon.log")"
echo fleet-claude >> "$T/state/cmd"
waitmore "refusing fleet-claude: pir is not at its list" "$T/daemon.log" "$R0" 10 "the fleet-claude refusal"
grew   "Claude Agents is refused inside a run"     "refusing fleet-claude: pir is not at its list" "$T/daemon.log" "$R0"
in_slot "...and pir keeps the slot"                "$PIRP2"
fi

if section 16b "main moved on after the fork: its new commit is not in the diff"; then
# What revdiff shows for <ref> -> working tree is git's diff against that ref.
same   "the fork point is the diff's base, main's commit absent" \
       "$(git -C "$PRUN" diff --name-only "$FORK" | tr '\n' ' ')" "runwork.txt "
refute "...where main's tip would have shown it reversed" "$MAINTIP" "$T/state/terminals.json"
fi

if section 16c "a revdiff flush on a pir key: nothing typed, logged, file kept"; then
: > "$CALLS"
N0="$(countof "review not sent: pir has no input box" "$T/daemon.log")"
printf '## runwork.txt:1 (+)\nPIR REVIEW STAYS\n' > "$RFILE"
waitmore "review not sent: pir has no input box" "$T/daemon.log" "$N0" 10 "the inert review's log line"
grew   "the inert review was logged"               "review not sent: pir has no input box" "$T/daemon.log" "$N0"
refute "nothing was typed into any pane"           "send-text" "$CALLS"
check  "the review file was left as flushed"       "PIR REVIEW STAYS" "$RFILE"
refute "revdiff was not relaunched to reset it"    "relaunched diff pane $RDIFF for $RK" "$T/daemon.log"
fi

if section 16d "⌥[ with the diff focused cycles the pir key's own mode"; then
: > "$CALLS"
echo "$RDIFF" > "$ACTIVE"
echo prev >> "$T/state/cmd"
# relaunchDiff logs, then diffModeCommand writes the footer.
waitfor "relaunched diff pane $RDIFF for $RK in lastcommit mode" "$T/daemon.log" 10 "the lastcommit relaunch"
waitfor '"diffMode":"lastcommit"' "$T/state/terminals.json" 10 "the footer to show lastcommit"
: > "$ACTIVE"
check  "the run key relaunched in lastcommit"      "relaunched diff pane $RDIFF for $RK in lastcommit mode" "$T/daemon.log"
check  "the footer shows it"                       '"diffMode":"lastcommit"' "$T/state/terminals.json"
fi

if section 16e "pir reports a WORKER: its own key and folder, at uncommitted"; then
: > "$CALLS"
pirwrite worker "$PRUN" "$PWORK"
waitfor '"agent":"slug / T01"' "$T/state/terminals.json" 10 "the worker key's attach to finish"
check  "the worker key was entered"                "pir: enter $WK → $PWORK" "$T/daemon.log"
WDIFF="$(pane_key diff)"; WTERM="$(pane_key shell)"
in_slot "its own diff pane holds the slot"         "$WDIFF"
parked "the run's diff pane is parked"             "$RDIFF"
parked "...and so is the run's terminal"           "$RTERM"
check  "revdiff uncommitted in the worker's folder" "cd \"$PWORK\" && revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-$WK.md\" HEAD" "$CALLS"
check  "the footer: uncommitted, the worker's label" '"agent":"slug / T01","diffMode":"uncommitted"' "$T/state/terminals.json"
check  "still not reviewable"                      '"reviewable":false' "$T/state/terminals.json"
check  "still not switchable"                      '"switchable":false' "$T/state/terminals.json"
fi

if section 16f "back to the RUN: its parked panes return untouched"; then
: > "$CALLS"
RL0="$(countof "relaunched diff pane $RDIFF" "$T/daemon.log")"
pirwrite run "$PRUN"
waitfor '"agent":"slug","diffMode":"lastcommit"' "$T/state/terminals.json" 10 "the run key's return to finish"
in_slot "the run's diff pane is back"              "$RDIFF"
in_slot "...and its terminal"                      "$RTERM"
parked "the worker's diff pane is parked"          "$WDIFF"
same   "the run's revdiff was not relaunched"      "$(countof "relaunched diff pane $RDIFF" "$T/daemon.log")" "$RL0"
refute "nothing was typed into it"                 "send-text --pane-id $RDIFF " "$CALLS"
check  "its own mode came back with it"            '"diffMode":"lastcommit"' "$T/state/terminals.json"
fi

if section 16g "back to the LIST: the welcome pane and the repo terminals"; then
: > "$CALLS"
pirwrite list
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
check  "the run key was left"                      "exit $RK → fleet list" "$T/daemon.log"
check  "the footer is back on the repo"            '"agent":"repo"' "$T/state/terminals.json"
check  "...reviewable again"                       '"reviewable":true' "$T/state/terminals.json"
check  "...and switchable"                         '"switchable":true' "$T/state/terminals.json"
parked "the run's diff pane is parked, not killed" "$RDIFF"
in_slot "the repo diff pane holds the slot"        10
in_slot "pir still holds the fleet slot"           "$PIRP2"
fi

if section 16h "a pir key's diff pane killed while shown is re-attached, no file write"; then
pirwrite run "$PRUN"
waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "the run key's attach to finish"
in_slot "the run is shown again"                   "$RDIFF"
H0="$(countof "pir: enter $RK" "$T/daemon.log")"
O0="$(countof "opened diff pane" "$T/daemon.log")"
awk -v p="$RDIFF" '$1 != p' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
waitfor "diff pane for $RK is gone; rebuilding" "$T/daemon.log" 10 "the heal to notice the killed pane"
waitmore "pir: enter $RK" "$T/daemon.log" "$H0" 10 "the heal to re-enter the run"
grew   "the heal re-ran pir's state"               "pir: enter $RK" "$T/daemon.log" "$H0"
# "pir: enter" is logged before showDiff splits the new pane, so wait for the open
# itself before reading its id (read too early, pane_key returned the killed one).
waitmore "opened diff pane" "$T/daemon.log" "$O0" 10 "the heal's new diff pane"
# ...and panes.json is published after that line: poll it off the killed id.
newdiff() { local k; k=$(pane_key diff); [ -n "$k" ] && [ "$k" != "$RDIFF" ]; }
waituntil 10 "panes.json to name the new diff pane" newdiff
RDIFF="$(pane_key diff)"
in_slot "a fresh diff pane holds the slot"         "$RDIFF"
check  "...opened at the run's folder"            "opened diff pane $RDIFF for slug at $PRUN" "$T/daemon.log"
fi

if section 16i "the same key at a new folder: revdiff relaunched there, watches moved"; then
git -C "$PREPO" worktree add -q -b pir/slug-renamed "$PRUN2" pir/slug
: > "$CALLS"
# Window: DIFF_RELAUNCH_COOLDOWN_MS (3000 scaled, 1.5s at 0.5) from the heal's launch
# in 16h, plus 0.25s; 16h no longer spends it on sleeps, so it is spent here whole.
nap 3.5
pirwrite run "$PRUN2"
waitfor "cd \"$PRUN2\" && revdiff" "$CALLS" 10 "revdiff to relaunch in the new folder"
check  "the move was followed"                     "agent $RK moved worktree $PRUN → $PRUN2" "$T/daemon.log"
check  "revdiff relaunched in the new folder"      "cd \"$PRUN2\" && revdiff" "$CALLS"
in_slot "the same diff pane still holds the slot"  "$RDIFF"
fi

if section 16i2 "the SHOWN worker's folder removed, pir writes nothing: the run is shown"; then
# pir removes a task's worktree after merging it and leaves the worker's
# conversation open; its recorded cwd has not changed, so it writes no new report.
# Found by the T06 drill on a real mux: revdiff sat on a chdir error until pir moved.
pirwrite worker "$PRUN2" "$PWORK"
waitfor '"agent":"slug / T01"' "$T/state/terminals.json" 10 "the worker key's attach to finish"
in_slot "the worker is shown"                      "$WDIFF"
E1="$(countof "pir: enter $RK" "$T/daemon.log")"
git -C "$PREPO" worktree remove --force "$PWORK"
waitfor "pir: the folder of $WK is gone; re-reading pir's report" "$T/daemon.log" 10 "the vanished worker folder to be noticed"
waitmore "pir: enter $RK" "$T/daemon.log" "$E1" 10 "the run to be re-entered"
grew   "the run was entered without a pir write"   "pir: enter $RK" "$T/daemon.log" "$E1"
waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "the run's attach to finish"
in_slot "the run's diff pane holds the slot"       "$RDIFF"
check  "...and the footer says so"                 '"agent":"slug"' "$T/state/terminals.json"
same   "the vanished folder was logged once"       "$(countof "the folder of $WK is gone" "$T/daemon.log")" "1"
fi

if section 16j "worker folder gone: the run is shown, and the worker key is reaped"; then
[ ! -d "$PWORK" ] || git -C "$PREPO" worktree remove --force "$PWORK"
E0="$(countof "pir: enter $WK" "$T/daemon.log")"
pirwrite worker "$PRUN2" "$PWORK"
# Window: PIR_DEBOUNCE_MS (150 scaled) after the write, plus fs.watch delivery and
# an attach's start; 1.5s at 0.5. decidePir answers the already-shown run, which
# logs nothing, so there is no event to poll for.
nap 3
same   "the worker was not entered"                "$(countof "pir: enter $WK" "$T/daemon.log")" "$E0"
in_slot "the run stays shown"                      "$RDIFF"
check  "...and the footer says so"                 '"agent":"slug"' "$T/state/terminals.json"
waitfor "pir folder $PWORK is gone" "$T/daemon.log" 10 "the worker key's reap"
gone   "the worker's diff pane was reaped"         "$WDIFF"
gone   "...and its terminal"                       "$WTERM"
fi

if section 16k "the shown run's folder goes too: the list, and only then is the key reaped"; then
# The reaper never takes the SHOWN key. What moves the cockpit off it is the re-read
# of pir's report when the attached folder vanishes (T06, section 16i2): with both
# folders gone decidePir answers the list (DESIGN 2.5), and the key, no longer shown,
# is reaped.
rm -rf "$PRUN2"
waitfor "pir: the folder of $RK is gone; re-reading pir's report" "$T/daemon.log" 10 "the vanished run folder to be noticed"
waitfor "pir: neither the worker's nor the run's folder exists; showing the list" "$T/daemon.log" 10 "the list to be chosen"
check  "both gone: the list, and why"              "pir: neither the worker's nor the run's folder exists; showing the list" "$T/daemon.log"
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
check  "the repo is shown"                         '"agent":"repo"' "$T/state/terminals.json"
check  "...not switchable: pir is not at its list" '"switchable":false' "$T/state/terminals.json"
waitfor "reaped diff pane $RDIFF — pir folder $PRUN2 is gone" "$T/daemon.log" 10 "the run key's reap"
gone   "once not shown, the run key was reaped"    "$RDIFF"
gone   "...terminal and all"                       "$RTERM"
git -C "$PREPO" worktree prune
fi

if section 16l "a folder that is not a git work tree reads as the list"; then
mkdir -p "$T/notgit"
pirwrite run "$T/notgit"
waitfor "pir: run folder is not a git work tree: $T/notgit" "$T/daemon.log" 10 "the non-git folder to be judged"
check  "logged"                                    "pir: run folder is not a git work tree: $T/notgit" "$T/daemon.log"
check  "the repo stays shown"                      '"agent":"repo"' "$T/state/terminals.json"
fi

if section 16m "the cockpit's pir gone: a dead pid, a corrupt file and no file all read as the list"; then
# Each case is the pir in the pane going away (a crash leaves its file, a quit
# deletes it), so it is played by a stand-in on the pane's tty that is then killed.
# While the pane's pir is alive the same three are someone else's doing (16m3).
for how in dead corrupt missing; do
  sleep 60 & OWNPID=$!
  echo "$OWNPID ttys$(pane_key pir)" >> "$PSTTY"
  pirwrite run "$PRUN" "" "$OWNPID"
  waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "$how: the run key's attach to finish"
  X0="$(countof "exit $RK → fleet list" "$T/daemon.log")"
  kill "$OWNPID"; wait "$OWNPID" 2>/dev/null
  case "$how" in
    dead)    pirwrite run "$PRUN" "" "$OWNPID" ;;
    corrupt) printf '{"version":1,"pid":' > "$T/state/pir-dashboard.json" ;;
    missing) rm -f "$T/state/pir-dashboard.json" ;;
  esac
  waitmore "exit $RK → fleet list" "$T/daemon.log" "$X0" 10 "$how: the run key to be left"
  waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "$how: the exit to the list to finish"
  grew "$how: the run key was left"               "exit $RK → fleet list" "$T/daemon.log" "$X0"
  check "$how: switchable again"                  '"switchable":true' "$T/state/terminals.json"
done
fi

if section 16m3 "another pir writing or deleting the file moves nothing"; then
# The bug of 2026-09-28: pir hands PIR_DASHBOARD_STATE to its workers, a worker's
# test run starts throwaway dashboards on ttys of their own, and those wrote this
# file too -- the cockpit followed each, swapping panes back and forth. RIG is such
# a pir: alive, on another tty. Only the pane's pir ($$ here) is followed.
pirwrite run "$PRUN"
waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "the run key's attach to finish"
sleep 60 & RIGPID=$!
echo "$RIGPID ttys999" >> "$PSTTY"
X0="$(countof "exit $RK → fleet list" "$T/daemon.log")"
E0="$(countof "pir: enter" "$T/daemon.log")"
I0="$(countof "pir: ignoring pir-dashboard.json from pid $RIGPID" "$T/daemon.log")"
pirwrite worker "$PRUN" "$PWORK" "$RIGPID"
waitmore "pir: ignoring pir-dashboard.json from pid $RIGPID" "$T/daemon.log" "$I0" 10 "the rig's report to be judged"
grew   "a rig's worker report is ignored, and says why" "pir: ignoring pir-dashboard.json from pid $RIGPID: not the pir in the cockpit's pir pane" "$T/daemon.log" "$I0"
pirwrite list "" "" "$RIGPID"
U0="$(countof "pir: pir-dashboard.json is missing or unreadable" "$T/daemon.log")"
rm -f "$T/state/pir-dashboard.json"
waitmore "pir: pir-dashboard.json is missing or unreadable" "$T/daemon.log" "$U0" 10 "the rig's delete to be judged"
grew   "a delete while the pane's pir lives keeps its report" "pir: pir-dashboard.json is missing or unreadable while the cockpit's pir (pid $$) runs; keeping its last report" "$T/daemon.log" "$U0"
same   "...the run key was never left"             "$(countof "exit $RK → fleet list" "$T/daemon.log")" "$X0"
same   "...and nothing else entered"               "$(countof "pir: enter" "$T/daemon.log")" "$E0"
check  "the run is still shown"                    '"agent":"slug"' "$T/state/terminals.json"
kill "$RIGPID"; wait "$RIGPID" 2>/dev/null
pirwrite list
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the pane's own list to be followed"
grew   "the pane's pir is still followed after"    "exit $RK → fleet list" "$T/daemon.log" "$X0"
fi

if section 16m2 "a change the watch never reports is still followed"; then
# macOS drops some directory-watch events (T07: 5 of 384 under load) but not on
# demand, and a write through a hard link elsewhere is still reported, so the watch
# is muted through the daemon's test-only seam: while $T/pir-watch-mute exists it
# ignores every event. Only the reconcile-poll backstop can see this change.
pirwrite run "$PRUN"
waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "the run key's attach to finish"
X0="$(countof "exit $RK → fleet list" "$T/daemon.log")"
B0="$(countof "pir: pir-dashboard.json changed without a watch event" "$T/daemon.log")"
: > "$T/pir-watch-mute"
pirwrite list
waitmore "exit $RK → fleet list" "$T/daemon.log" "$X0" 10 "the unwatched change to be followed"
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
# Window, not a wait for an effect: a backstop that re-fired on an unchanged file
# would do so on the next poll, so the count below needs polls to have run. Counted
# at once, a mutant that fires every poll passed 1 run in 3 (T11 review).
nap 2   # window: 2.5 x POLL_MS
rm -f "$T/pir-watch-mute"
grew   "the backstop saw the change"            "pir: pir-dashboard.json changed without a watch event" "$T/daemon.log" "$B0"
grew   "...and the run key was left"               "exit $RK → fleet list" "$T/daemon.log" "$X0"
same   "...once: the backstop does not re-fire"    "$(countof "pir: pir-dashboard.json changed without a watch event" "$T/daemon.log")" "$((B0+1))"
fi

if section 16n "a stored ref wins over the fork point; one that stopped resolving is uncommitted"; then
git -C "$PREPO" branch tmpbase "$FORK"
pirwrite run "$PRUN"
waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "the run key's attach to finish"
RDIFF="$(pane_key diff)"
echo diff-custom >> "$T/state/cmd"
waitfor "opened custom-range prompt for $RK" "$T/daemon.log" 10 "the custom-range prompt"
check  "the prompt is pre-filled with the fork point" "opened custom-range prompt for $RK (prefill \"$FORK\")" "$T/daemon.log"
printf '{"jobId":"%s","ref":"tmpbase"}' "$RK" > "$T/state/custom-ref-pending"
CS0="$(countof "custom range set for $RK: tmpbase" "$T/daemon.log")"
echo custom-ok >> "$T/state/cmd"
# Logged last, after the ref is stored and revdiff relaunched: past it, no launch
# line from this relaunch can land in the $CALLS truncated below.
waitmore "custom range set for $RK: tmpbase" "$T/daemon.log" "$CS0" 10 "the custom ref to be set"
check  "the person's ref is stored for the key"    "\"$RK\":\"tmpbase\"" "$T/state/custom-refs.json"
pirwrite list
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
# A parked pane that died is spawned afresh, so the launch line shows the ref used.
awk -v p="$RDIFF" '$1 != p' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
: > "$CALLS"
pirwrite run "$PRUN"
waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "the run key's attach to finish"
check  "the stored ref is used"                    "-o \"$RFILE\" \"tmpbase\"" "$CALLS"
RDIFF="$(pane_key diff)"
pirwrite list
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
git -C "$PREPO" branch -D -q tmpbase
awk -v p="$RDIFF" '$1 != p' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
: > "$CALLS"
pirwrite run "$PRUN"
waitfor '"agent":"slug"' "$T/state/terminals.json" 10 "the run key's attach to finish"
check  "a stale stored ref is logged"              "$RK starts at uncommitted: stored ref does not resolve: tmpbase" "$T/daemon.log"
check  "...and the key opens uncommitted"          "-o \"$RFILE\" HEAD" "$CALLS"
refute "...never the prompt"                       "cockpit-custom-prompt" "$CALLS"
pirwrite list
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
fi

if section 16o "no main to fork from: uncommitted, logged"; then
NOMAIN="$T/nomain"; mkdir -p "$NOMAIN"; git init -q -b trunk "$NOMAIN"
git -C "$NOMAIN" config user.email t@t; git -C "$NOMAIN" config user.name t
git -C "$NOMAIN" commit -q --allow-empty -m base
printf '{"version":1,"pid":%s,"view":"run","run":{"key":"proj__nomain","slug":"nomain","cwd":"%s"},"worker":null}\n' "$$" "$NOMAIN" \
  > "$T/state/pir-dashboard.json.tmp" && mv "$T/state/pir-dashboard.json.tmp" "$T/state/pir-dashboard.json"
: > "$CALLS"
waitfor '"agent":"nomain"' "$T/state/terminals.json" 10 "the nomain key's attach to finish"
check  "the failed merge-base is logged"           "pir.proj__nomain starts at uncommitted: no fork point from main (git merge-base failed)" "$T/daemon.log"
check  "...and the key opens uncommitted"          "review-pir.proj__nomain.md\" HEAD" "$CALLS"
# The key's own label with it: at the list the footer reads uncommitted too (3.3).
check  "the footer agrees"                         '"agent":"nomain","diffMode":"uncommitted"' "$T/state/terminals.json"
pirwrite list
waitfor '"agent":"repo"' "$T/state/terminals.json" 10 "the exit to the list to finish"
fi

if section 16p "while claude is shown, pir's file does nothing"; then
fleetclick claude
in_slot "claude is back in the fleet slot"         20
E0="$(countof "pir: enter" "$T/daemon.log")"
pirwrite run "$PRUN"
# Window: PIR_DEBOUNCE_MS (150 scaled) plus fs.watch delivery and an attach's start,
# as in 16j; 1.5s at 0.5. While claude is shown the watch drops the write silently.
nap 3
same   "nothing was entered"                       "$(countof "pir: enter" "$T/daemon.log")" "$E0"
check  "the repo stays shown"                      '"agent":"repo"' "$T/state/terminals.json"
rm -f "$T/state/pir-dashboard.json"
fi

if section 15m "no pir on PATH: nothing to switch to"; then
A7="$T/nopir"; S7="$A7/state"
mkdir -p "$A7/bin" "$S7"
for b in wezterm ps claude broot; do ln -s "$T/bin/$b" "$A7/bin/$b"; done
# The suite's own PATH has the pir stub, and this machine may have a real one: keep
# only directories with no `pir` in them.
NOPIR_PATH="$A7/bin"
IFS=: read -ra _pdirs <<< "$PATH"
for d in "${_pdirs[@]}"; do
  [ -n "$d" ] && [ "$d" != "$T/bin" ] && [ ! -x "$d/pir" ] && NOPIR_PATH="$NOPIR_PATH:$d"
done
NODE_BIN="$(command -v node)"
echo '{"diff":10,"fleet":20,"shell":30,"foot":9,"repo":"'"$WT"'"}' > "$S7/panes.json"
: > "$S7/fleet.log"; : > "$S7/cmd"
printf '9 0 sh\n10 0 sh\n20 0 sh\n30 0 sh\n' > "$A7/panestate"
echo 31 > "$A7/nextpane"; echo 1 > "$A7/nexttab"
echo list > "$A7/fleetstate"
for f in editing titlelag active panecwd psbusy psfg calls.log; do : > "$A7/$f"; done
PATH="$NOPIR_PATH" HOME="$T/home" SHELL=/bin/zsh COCKPIT_OWNER_PID="$$" \
  COCKPIT_DIR="$S7" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  AGENDA_ORIGIN="http://127.0.0.1:9" BITBUCKET_ORIGIN="http://127.0.0.1:9" \
  CALLS="$A7/calls.log" FLEETSTATE="$A7/fleetstate" PANESTATE="$A7/panestate" \
  NEXTPANE="$A7/nextpane" NEXTTAB="$A7/nexttab" EDITING="$A7/editing" \
  TITLELAG="$A7/titlelag" ACTIVE="$A7/active" PANECWD="$A7/panecwd" \
  PSBUSY="$A7/psbusy" PSFG="$A7/psfg" AGENTS_JSON="$AGENTS_JSON" \
  "$NODE_BIN" "$ROOT/bin/cockpitd.mjs" > "$A7/daemon.log" 2>&1 &
D7PID=$!
d7has() { grep -qF -- "$1" "$S7/terminals.json"; }
waituntil 10 "D7's first footer frame" d7has '"available":false'
check  "the footer is told pir is unavailable"    '"available":false' "$S7/terminals.json"
echo fleet-pir >> "$S7/cmd"
waitfor "refusing fleet-pir: pir is not on the daemon's PATH" "$A7/daemon.log" 10 "D7's fleet-pir refusal"
check  "PIR is refused, and says why"             "refusing fleet-pir: pir is not on the daemon's PATH" "$A7/daemon.log"
refute "...spawning nothing"                      "cockpit-pir.sh" "$A7/calls.log"
check  "...and claude stays shown"                '"program":"claude"' "$S7/terminals.json"
daemon_stop $D7PID; D7PID=""
fi

if section 15n "cockpit-pir.sh relaunches pir, and stops after five fast exits"; then
# Closed stdin: an EOF must not count as the Enter it waits for, or a pane with no
# reader would go straight back to spinning.
PL="$T/pirloop"; mkdir -p "$PL"; : > "$PL/runs"
cat > "$PL/pir" <<'PIRSTUB'
#!/bin/sh
printf '%s\n' "$PIR_DASHBOARD_STATE" >> "$PIRRUNS"
exit 3
PIRSTUB
chmod +x "$PL/pir"
PIRRUNS="$PL/runs" bash "$ROOT/bin/cockpit-pir.sh" "$PL/pir" "$PL/state.json" </dev/null > "$PL/out" 2>&1 &
PLPID=$!
waitfor "until you press Enter" "$PL/out" 10 "the relaunch loop to give up"
# Window, unscaled (the loop's own timing is real seconds): a closed stdin taken for
# Enter would relaunch pir within milliseconds of that message.
sleep 0.5
same   "five runs, then it stopped relaunching"   "$(wc -l < "$PL/runs" | tr -d ' ')" "5"
same   "...each handed the state file"            "$(grep -cFx "$PL/state.json" "$PL/runs")" "5"
check  "it said why"                              "pir exited immediately 5 times in a row (last exit status 3)" "$PL/out"
check  "...and what it is waiting for"            "until you press Enter" "$PL/out"
same   "it is still alive, waiting"               "$(kill -0 "$PLPID" 2>/dev/null && echo yes || echo no)" "yes"
pkill -P "$PLPID" 2>/dev/null; kill "$PLPID" 2>/dev/null; wait "$PLPID" 2>/dev/null
fi

if section 15o "a layout rebuild deletes pir-dashboard.json"; then
# Run for real, with every outside effect a function: bash resolves functions before
# PATH, so no real wezterm, pkill, daemon or claude agents is reached. pkill and
# nohup are also stubbed ON PATH, because the layout script kills cockpitd.mjs by name
# (pkill -f), which for real would take out this suite's daemon and the live cockpit's.
LH="$T/layouthome"; LB="$T/layoutbin"
mkdir -p "$LH/.claude/cockpit" "$LB"
echo '{"version":1,"view":"run"}' > "$LH/.claude/cockpit/pir-dashboard.json"
: > "$T/layout-calls"
for b in pkill nohup; do printf '#!/bin/sh\necho "PATH %s $*" >> "$LCALLS"\n' "$b" > "$LB/$b"; chmod +x "$LB/$b"; done
cat > "$T/layout-run.sh" <<'RUNNER'
#!/usr/bin/env bash
wezterm() { echo "wezterm $*" >> "$LCALLS"; [ "${2:-}" = split-pane ] && echo 7; return 0; }
pkill()   { echo "pkill $*" >> "$LCALLS"; return 0; }
nohup()   { echo "nohup $*" >> "$LCALLS"; return 0; }
claude()  { return 0; }
revdiff() { :; }; micro() { :; }; broot() { :; }
export -f wezterm pkill nohup claude revdiff micro broot
exec "$@"
RUNNER
chmod +x "$T/layout-run.sh"
( LCALLS="$T/layout-calls" HOME="$LH" WEZTERM_PANE=1 SHELL=/usr/bin/true PATH="$LB:$PATH" \
  "$T/layout-run.sh" "$ROOT/bin/cockpit-layout.sh" "$WT" </dev/null >/dev/null 2>"$T/layout.err" ) &
LPID=$!; i=0
while kill -0 "$LPID" 2>/dev/null && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
kill -0 "$LPID" 2>/dev/null && kill -9 "$LPID" 2>/dev/null
wait "$LPID" 2>/dev/null
same   "the stale pir-dashboard.json is gone"     "$([ -e "$LH/.claude/cockpit/pir-dashboard.json" ] && echo kept || echo gone)" "gone"
check  "...in a rebuild that got as far as the daemon" "nohup node" "$T/layout-calls"
# Built from a variable so the daemon-leak fence's name-match grep does not read
# this expected string as a kill.
PKF="pkill -f"
check  "the harness intercepted pkill"            "$PKF cockpitd.mjs" "$T/layout-calls"
fi

}  # run_main

run_footer() {
# --- the footer chain's helpers (12, 12b, 12c) ------------------------------
# Defined here, above the chain's first heading and outside every section, so
# what a section sees never depends on which sections ran before it
# (plans/test-suite-speed DESIGN 4.1). Nothing here starts a process.
SD="$T/strip"
# The capture goes OUTSIDE the state dir: the renderer watches that directory, so a
# capture file written into it makes the renderer repaint on its own output for ever.
RAW="$T/strip-cap"; PLAIN="$T/strip-plain"
# Escapes take no columns, so a click column is measured on the STRIPPED frame --
# and stripped by node, in utf8: the legend is full of multi-byte characters (⌥, ·,
# ←↑↓→) that a byte-oriented reader counts several times over, which lands the
# click ~35 columns to the right of the label it was aimed at.
STRIP_ANSI='const s=require("fs").readFileSync(process.argv[1],"utf8").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,"");process.stdout.write(process.argv[2] ? String(s.indexOf(process.argv[2]) + 1) : s)'
# Visible width of a rendered frame: strip the escapes (incl. 2J/H/K) and count
# code points. The legend is full of 1-column BMP glyphs (↺ ⌥ · →), so code
# points equal columns here -- which is what the one-row width assertion needs.
LEN='const s=require("fs").readFileSync(process.argv[1],"utf8").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,"");process.stdout.write(String([...s].length))'
# The hash normalises the frame's envelope back to the one the pins were taken with:
# a paint used to open with `2J` (erase all) + `H`, and now opens with DEC 2026's
# begin-sync + `H` and closes with `J` + end-sync, so an unchanged frame never flashes
# blank. Only the envelope is swapped; every byte of the frame itself is still pinned.
SHA='const b=require("fs").readFileSync(process.argv[1],"latin1").split("\x1b[?2026h\x1b[H").join("\x1b[2J\x1b[H").split("\x1b[J\x1b[?2026l").join("");process.stdout.write(require("crypto").createHash("sha256").update(b,"latin1").digest("hex"))'
# The renderer's start-up writes, in order: hide the cursor, the frame, then turn on
# mouse reporting (and, on a tty, raw mode straight after). So MOUSE_ON in the
# output means the first frame is complete and a click can be read. CURSOR_ON is
# what its SIGTERM handler writes on the way out.
MOUSE_ON=$'\033[?1006h'
CURSOR_ON=$'\033[?25h'

# strip_frame [cols]: render ONE footer frame of $SD/terminals.json into $RAW and
# $PLAIN. It used to sleep 0.8s and kill; now it polls for the finished frame. The
# kill must land after the renderer has registered its SIGTERM handler, or the
# frame loses its exit bytes (which 12c's hashes include), so a frame without them
# is simply rendered again. The single-command subshells matter: bash execs node,
# so the kill reaches node rather than a wrapper. No [cols] leaves COLUMNS as
# inherited, exactly as section 12's frames always ran.
strip_frame() {
  local p try
  for try in 1 2 3; do
    : > "$RAW"
    if [ $# -gt 0 ]; then
      ( COCKPIT_DIR="$SD" COLUMNS="$1" node "$ROOT/bin/cockpit-strip.mjs" footer > "$RAW" 2>&1 ) &
    else
      ( COCKPIT_DIR="$SD" node "$ROOT/bin/cockpit-strip.mjs" footer > "$RAW" 2>&1 ) &
    fi
    p=$!
    waituntil 10 "the footer to draw a frame" grep -qF -- "$MOUSE_ON" "$RAW"
    kill "$p" 2>/dev/null; wait "$p" 2>/dev/null
    grep -qF -- "$CURSOR_ON" "$RAW" && break
  done
  node -e "$STRIP_ANSI" "$RAW" > "$PLAIN"
}
footer() {   # footer <diffMode>: render one frame with that mode into $RAW/$PLAIN
  printf '{"agent":"test agent","diffMode":"%s","customRef":null,"terminals":[{"n":1,"active":true,"tty":null}]}\n' \
      "$1" > "$SD/terminals.json"
  strip_frame
}
useed() { printf '%s' "$1" > "$SD/usage-cache.json"; }   # seed the cache the footer reads
# ufooter <mode> <cols>: render one frame at a forced width (no TTY under the pipe,
# so COLUMNS is how the narrow-window trim is exercised).
ufooter() {
  printf '{"agent":"test agent","diffMode":"%s","customRef":null,"terminals":[{"n":1,"active":true,"tty":null}]}\n' "$1" > "$SD/terminals.json"
  strip_frame "$2"
}
# ffooter <agent> <extra-json> [cols]: one frame; <extra-json> is spliced into the
# object (e.g. `,"fleet":{...}`), [cols] forces a width through COLUMNS.
ffooter() {
  printf '{"agent":"%s","diffMode":"uncommitted","customRef":null,"terminals":[{"n":1,"active":true,"tty":null}]%s}\n' \
      "$1" "$2" > "$SD/terminals.json"
  strip_frame "${3:-}"
}
has() { grep -qF -- "$1" "$PLAIN" && echo 1 || echo 0; }

# press <cols|-> <label> [<sentinel-label> <sentinel-verb>]: left-press <label> in
# the frame last rendered into $RAW, through $CLICKER under script(1) (the footer
# needs a real terminal to read a mouse report), and echo the verbs it appended.
# `-` runs without COLUMNS, as section 12's clicks always did.
#
# This used to be `sleep 1; click; sleep 0.8` and then up to 4s waiting for
# script(1) to notice its input had closed, which it never did. Now each step is a
# poll: the press is sent once the renderer has drawn and turned on mouse input,
# and the result is read once the verb is in $SD/cmd.
#
# A press that must append NOTHING cannot end on a poll for a verb. So it is
# followed by a SENTINEL press on a label that does append one: the renderer reads
# its input in order, so once the sentinel's verb is in the file the first press
# has been handled, and whatever came before the sentinel's line is its result.
# That proves the absence without a timed window.
press() {
  local cols=$1 label=$2 sl=${3:-} sv=${4:-} col scol="" p i=0
  local out="$T/press-out" go="$T/press-go" done="$T/press-done"
  col=$(node -e "$STRIP_ANSI" "$RAW" "$label")
  [ -n "$sl" ] && scol=$(node -e "$STRIP_ANSI" "$RAW" "$sl")
  : > "$SD/cmd"; : > "$out"; rm -f "$go" "$done"
  # The feeder holds script's stdin open until told the result is in: closed early,
  # script(1) could take the renderer down before the press was read. Its own
  # loops are bounded so it can never outlive the helper by more than ~30s.
  feed() {
    local j=0
    until [ -e "$go" ] || [ "$j" -ge 300 ]; do sleep 0.05; j=$((j + 1)); done
    printf '\033[<0;%d;1M' "$col"
    [ -n "$scol" ] && printf '\033[<0;%d;1M' "$scol"
    j=0
    until [ -e "$done" ] || [ "$j" -ge 300 ]; do sleep 0.05; j=$((j + 1)); done
  }
  if [ "$cols" = - ]; then
    feed | ( COCKPIT_DIR="$SD" script -q /dev/null node "$CLICKER" footer > "$out" 2>&1 ) &
  else
    feed | ( COCKPIT_DIR="$SD" COLUMNS="$cols" script -q /dev/null node "$CLICKER" footer > "$out" 2>&1 ) &
  fi
  p=$!
  # Inside $(...) a wait's FAIL line would become part of the result, so it goes
  # to stderr; the `same` on the result is what fails the run.
  waituntil 10 "the clicked footer to draw and read the mouse" grep -qF -- "$MOUSE_ON" "$out" >&2
  : > "$go"
  if [ -n "$sv" ]; then
    waituntil 10 "the sentinel press on $sl to append $sv" grep -qxF -- "$sv" "$SD/cmd" >&2
  else
    waituntil 10 "a press on $label to append a verb" grep -q . "$SD/cmd" >&2
  fi
  : > "$done"
  pkill -f "$CLICKER" 2>/dev/null
  while kill -0 "$p" 2>/dev/null && [ "$i" -lt 40 ]; do sleep 0.1; i=$((i + 1)); done
  kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
  wait "$p" 2>/dev/null
  if [ -n "$sv" ]; then
    # Called inside $(...), where a timed-out wait's `fail=1` is lost: so a missing
    # sentinel is written INTO the result, and the `same` after it fails on it
    # rather than passing on an empty file that proved nothing.
    awk -v s="$sv" '$0 == s { exit } { printf "%s", $0 }' "$SD/cmd"
    grep -qxF -- "$sv" "$SD/cmd" || printf '<no %s: the press was never shown to be handled>' "$sv"
  else
    tr -d '\n' < "$SD/cmd"
  fi
}
click() { press - "$@"; }                    # section 12: no forced width
fclick() {  # fclick <label> <cols> [<sentinel-label> <sentinel-verb>]
  local l=$1 c=$2; shift 2; press "$c" "$l" "$@"
}

if section 12 "the footer draws -- and clicks -- a fourth label"; then
# The strip renderer is a separate process reading terminals.json, so this section
# runs it directly rather than through the daemon. It never exits on its own (it
# watches the state dir), so every run is backgrounded and killed.
mkdir -p "$SD"

footer browse
check  "the footer draws a Browse label"          "Browse" "$PLAIN"
check  "...highlighted while the agent is browsing" "$(printf '\033[7m Browse ')" "$RAW"
# Why the label is not optional: the highlight falls back to uncommitted for a mode
# it has no label for, so a missing entry lights up the WRONG range rather than
# merely leaving browse unlisted.
refute "...and Uncommitted is NOT highlighted instead" \
                                                  "$(printf '\033[7m Uncommitted Changes ')" "$RAW"
footer nonsense
check  "an unknown mode still falls back to Uncommitted" \
                                                  "$(printf '\033[7m Uncommitted Changes ')" "$RAW"
check  "...and Browse is drawn fourth, after Custom" \
                                                  "Last Commit | Custom | Browse" "$PLAIN"

# The click path. The footer needs a real terminal to read a mouse report, so it
# gets one from script(1) -- the same trick spikes/browse-test uses for broot. The
# column comes from the frame just rendered, so the test cannot drift out of step
# with the layout.
if ! command -v script >/dev/null; then
  echo "  FAIL script(1) is missing -- a footer click cannot be delivered without a terminal"
  fail=1
else
# Run the click through a COPY of the renderer, under this run's own temp path.
# Killing script(1) does not kill the node it spawned, so each click has to be
# cleaned up by name -- and matching on the real path could kill the footer of a
# live cockpit running from this very checkout.
CLICKER="$T/strip-under-test.mjs"
cp "$ROOT/bin/cockpit-strip.mjs" "$CLICKER"
# The strip imports its footer usage siblings by RELATIVE path (T05), so the copy
# needs them next to it or the node process dies on a missing import before it can
# read a click. They pull in only node builtins, so copying the two files is enough.
cp "$ROOT/bin/cockpit-usage-store.mjs" "$T/cockpit-usage-store.mjs"
cp "$ROOT/bin/cockpit-usage-model.mjs" "$T/cockpit-usage-model.mjs"

footer uncommitted                        # Browse drawn plain, as it would be clicked
same "clicking Browse appends diff-browse"        "$(click Browse)" "diff-browse"
# The three that were already there must keep their columns and their hit zones: a
# fourth label inserted anywhere but the end would silently move them.
same "clicking Custom still appends diff-custom"  "$(click Custom)" "diff-custom"
same "clicking Last Commit still appends diff-lastcommit" \
                                                  "$(click 'Last Commit')" "diff-lastcommit"
same "clicking Uncommitted Changes still appends diff-uncommitted" \
                                                  "$(click 'Uncommitted Changes')" "diff-uncommitted"
fi
fi

if section 12b "the footer's usage segment (T05)"; then
# The footer reads usage-cache.json through the store, asks the pure model what to
# show, and turns its semantic roles into ANSI colour (DESIGN 2.2-2.4). Rendered
# directly like section 12 (a separate process off terminals.json), with the cache
# seeded in $SD -- the strip's COCKPIT_DIR -- so readCache() picks it up. The model
# reads the clock live, so timestamps are relative to now: fresh = now, stale = 20
# min ago (past the 15-min window). Reset instants are future; the exact reset
# STRING is the model's own test, so here only the ↺ mark and percentages are
# asserted, which keeps these checks off the today-vs-tomorrow boundary.
NOW_S=$(date +%s)
NOW_MS=$(( NOW_S * 1000 ))
STALE_MS=$(( (NOW_S - 1200) * 1000 ))
R5=$(( NOW_S + 3600 ))
R7=$(( NOW_S + 3 * 86400 ))

# A fresh cache: the 5h / 1d / 7d windows with their percentages, coloured by role.
# R7 is NOW+3 days, so the weekly window started NOW-4 days -> we are in daily slice
# 5, and 1d% = 7*93 - 100*4 = 251 (well over budget, so red).
useed "{\"writtenAt\":$NOW_MS,\"fiveHour\":{\"usedPct\":80,\"resetsAt\":$R5},\"sevenDay\":{\"usedPct\":93,\"resetsAt\":$R7}}"
footer uncommitted
check  "a fresh cache draws the 5h window"         "5h 80% ↺" "$PLAIN"
check  "...the derived 1d daily-budget window"     "1d 251% ↺" "$PLAIN"
check  "...the 7d window with its percent"         "7d 93% ↺" "$PLAIN"
check  "windows are separated by /"                "/ 1d 251%" "$PLAIN"
check  "a 70-89% window is amber (warn)"           "$(printf '\033[33m5h 80%% ↺')" "$RAW"
check  "a >=90% window is red (crit)"              "$(printf '\033[31m7d 93%% ↺')" "$RAW"
check  "a 1d window over 100%% is red (crit)"      "$(printf '\033[31m1d 251%% ↺')" "$RAW"

# An under-70% window is green (the ok role).
useed "{\"writtenAt\":$NOW_MS,\"fiveHour\":{\"usedPct\":45,\"resetsAt\":$R5},\"sevenDay\":{\"usedPct\":61,\"resetsAt\":$R7}}"
footer uncommitted
check  "an under-70% window is green (ok)"         "$(printf '\033[32m5h 45%% ↺')" "$RAW"

# A stale cache: the WHOLE segment is dimmed and stamped, role colour suppressed.
# The segment now leads with the 5h window (no glyph), so the dim marker is [2m5h.
useed "{\"writtenAt\":$STALE_MS,\"fiveHour\":{\"usedPct\":45,\"resetsAt\":$R5},\"sevenDay\":{\"usedPct\":93,\"resetsAt\":$R7}}"
footer uncommitted
check  "a stale reading dims the whole segment"    "$(printf '\033[2m5h')" "$RAW"
check  "...and stamps the write time (as of)"      "· as of " "$PLAIN"
refute "...role colour suppressed (crit not red)"  "$(printf '\033[31m')" "$RAW"

# An absent cache: no usage segment, and the rest of the footer is today's -- the
# full legend (incl. the dim secondary hints) is kept, proving nothing was trimmed.
# The 1d key appears only inside the usage segment, so its absence proves no segment.
rm -f "$SD/usage-cache.json"
footer uncommitted
refute "an absent cache draws no usage segment"    "1d " "$PLAIN"
check  "...and the footer keeps today's full legend" "drag copy" "$PLAIN"

# A cache with seven_day null draws only 5h (no 7d, and no derived 1d).
useed "{\"writtenAt\":$NOW_MS,\"fiveHour\":{\"usedPct\":45,\"resetsAt\":$R5},\"sevenDay\":null}"
footer uncommitted
check  "a null 7d still draws the 5h window"       "5h 45% ↺" "$PLAIN"
refute "...and the null 7d is not drawn"           "7d " "$PLAIN"
refute "...and no 1d is derived without a 7d"      "1d " "$PLAIN"

# five_hour null but seven_day present: 1d and 7d draw, no 5h.
useed "{\"writtenAt\":$NOW_MS,\"fiveHour\":null,\"sevenDay\":{\"usedPct\":93,\"resetsAt\":$R7}}"
footer uncommitted
check  "seven_day alone still derives the 1d window" "1d 251% ↺" "$PLAIN"
check  "...and draws the 7d window"                "7d 93% ↺" "$PLAIN"
refute "...and draws no 5h window"                 "5h " "$PLAIN"

# A window too narrow for the full footer: the line stays one row and the usage
# readout survives while key hints are dropped first (DESIGN 2.2).
useed "{\"writtenAt\":$NOW_MS,\"fiveHour\":{\"usedPct\":80,\"resetsAt\":$R5},\"sevenDay\":{\"usedPct\":93,\"resetsAt\":$R7}}"
ufooter uncommitted 140
check  "a narrow window keeps the usage readout"   "1d " "$PLAIN"
refute "...dropping key hints to make room"        "drag copy" "$PLAIN"
NW=$(node -e "$LEN" "$RAW")
if [ "${NW:-0}" -le 140 ]; then okline "the narrow footer stays within the column count ($NW <= 140)"
else echo "  FAIL the narrow footer wrapped: width $NW > 140 columns"; fail=1; fi
rm -f "$SD/usage-cache.json"
fi

if section 12c "the footer's program switch: Claude Agents | PIR (pir-pane T02)"; then
# The footer reads a `fleet` block from terminals.json (pir-pane DESIGN 2.1, 2.2,
# 3.5) and draws `Claude Agents | PIR` leftmost; a click on the label NOT shown,
# while switchable, appends fleet-claude / fleet-pir. The daemon starts writing the
# block in T03, so here terminals.json is hand-written, as in sections 12 and 12b.
FL_CLAUDE=',"fleet":{"program":"claude","switchable":true,"available":true}'
FL_PIR=',"fleet":{"program":"pir","switchable":true,"available":true}'
FL_LOCKED=',"fleet":{"program":"claude","switchable":false,"available":true}'
FL_GONE=',"fleet":{"program":"claude","switchable":true,"available":false}'
rm -f "$SD/usage-cache.json"

# No fleet block: the frame is byte-for-byte the footer from before this task. The
# hashes are of the pre-T02 renderer's output for exactly these two states (agent
# attached, and the fleet list), captured before the change -- so "today" is pinned
# to a real frame, not to whatever the renderer happens to draw now.
ffooter "test agent" ""
same "no fleet block: attached footer is byte-identical to pre-T02" \
     "$(node -e "$SHA" "$RAW")" "6bd86012ba6cae631da6c470ae4c7fd122e65146adc8cf4c33d30d81d65abd48"
ffooter "repo" ""
same "no fleet block: fleet-list footer is byte-identical to pre-T02" \
     "$(node -e "$SHA" "$RAW")" "4d6c5ffb099b94af8754ff325c24b256a5bbfd6e85f7223ed8b4fa0ebf21e08f"
ffooter "test agent" "$FL_GONE"
same "available:false draws no segment (the pre-T02 frame again)" \
     "$(node -e "$SHA" "$RAW")" "6bd86012ba6cae631da6c470ae4c7fd122e65146adc8cf4c33d30d81d65abd48"
refute "...and no PIR label"                          "PIR" "$PLAIN"

# The O hint (DESIGN 2.7): only an explicit reviewable:false drops it.
ffooter "test agent" ',"reviewable":false'
refute "reviewable:false drops the O send→claude hint" "O send→claude" "$PLAIN"
check  "...and keeps the other primary keys"          "⌥w close  ·  ⌥←↑↓→ move" "$PLAIN"
ffooter "test agent" ',"reviewable":true'
check  "reviewable:true keeps the O hint"             "O send→claude" "$PLAIN"

# Drawn: leftmost, the shown program reversed, the other plain dim.
ffooter "test agent" "$FL_CLAUDE"
check  "the segment reads Claude Agents | PIR"        "Claude Agents  | PIR" "$PLAIN"
same   "...leftmost, ahead of the agent name" \
       "$(node -e "$STRIP_ANSI" "$RAW" "Claude Agents")" "3"
check  "...Claude Agents reversed while claude is shown" "$(printf '\033[7m Claude Agents ')" "$RAW"
check  "...PIR drawn dim"                             "$(printf '\033[2mPIR\033[0m')" "$RAW"
check  "...the agent name still follows"              "PIR    test agent · 1 terminal" "$PLAIN"
ffooter "test agent" "$FL_PIR"
check  "PIR reversed while pir is shown"              "$(printf '\033[7m PIR ')" "$RAW"
check  "...Claude Agents drawn dim"                   "$(printf '\033[2mClaude Agents\033[0m')" "$RAW"
ffooter "test agent" "$FL_LOCKED"
check  "switchable:false dims the shown label too (reverse kept)" "$(printf '\033[2;7m Claude Agents ')" "$RAW"
refute "...no bright reverse label left"              "$(printf '\033[7m Claude Agents ')" "$RAW"
ffooter "repo" "$FL_CLAUDE"
same   "the segment is drawn at the fleet list too, still leftmost" \
       "$(node -e "$STRIP_ANSI" "$RAW" "Claude Agents")" "3"

# Narrow window with usage (the 12b width): one row, the switch kept, and the
# existing parts trimmed in their existing order -- whatever is kept is one of the
# four levels (all keys+name, primary+name, name, nothing), never a mix. The switch
# pushes the untrimmable rest to ~145 columns, so a fifth level drops the dim
# `Diff mode:` caption as well (the person's choice, 2026-09-27).
useed "{\"writtenAt\":$NOW_MS,\"fiveHour\":{\"usedPct\":80,\"resetsAt\":$R5},\"sevenDay\":{\"usedPct\":93,\"resetsAt\":$R7}}"
ffooter "test agent" "$FL_CLAUDE" 140
check  "narrow: the switch is kept"                   "Claude Agents  | PIR" "$PLAIN"
check  "narrow: the usage readout is kept"            "1d " "$PLAIN"
check  "narrow: the diff labels are kept"             "Browse" "$PLAIN"
NW=$(node -e "$LEN" "$RAW")
if [ "${NW:-0}" -le 140 ]; then okline "narrow: the switch footer stays one row ($NW <= 140)"
else echo "  FAIL the switch footer wrapped: width $NW > 140 columns"; fail=1; fi
LV="$(has 'drag copy')$(has '⌥t new')$(has 'test agent')"
case "$LV" in 111|011|001|000) okline "narrow: trimming stays in its order ($LV)";;
  *) echo "  FAIL narrow trim is out of order: sec/pri/name = $LV"; fail=1;; esac
refute "narrow: the Diff mode: caption gives way"     "Diff mode:" "$PLAIN"
# Without the switch the 140 footer still fits at level four: the caption stays,
# so a daemon that writes no fleet block trims exactly as before.
ffooter "test agent" "" 140
check  "narrow, no switch: the caption is kept"       "Diff mode:  Uncommitted Changes" "$PLAIN"
# ...and below 140, where level four already overflows, the fifth level must still
# not engage without the switch: the pre-T02 footer kept its caption at any width.
ffooter "test agent" "" 100
check  "narrower (100), no switch: the caption is still kept" "Diff mode:  Uncommitted Changes" "$PLAIN"
ffooter "test agent" "$FL_GONE" 100
check  "narrower (100), available:false: the caption is still kept" "Diff mode:  Uncommitted Changes" "$PLAIN"
# At the live window's width nothing is trimmed, switch or not.
ffooter "test agent" "$FL_CLAUDE" 319
check  "wide (319): the full legend is kept with the switch" "drag copy" "$PLAIN"
check  "wide (319): ...and the caption"               "Diff mode:" "$PLAIN"
NW=$(node -e "$LEN" "$RAW")
if [ "${NW:-0}" -le 319 ]; then okline "wide: the switch footer stays one row ($NW <= 319)"
else echo "  FAIL the wide switch footer wrapped: width $NW > 319 columns"; fail=1; fi
# Below level five (pir-pane T06): at 120 columns level five measured 133 wide, and a
# wrapped one-row pane shows the TAIL, so the switch vanished. The usage readout now
# loses its reset times, then the line is cut at the edge -- never wrapped (the
# person's choice, 2026-09-27). Switch-only, like level five.
ffooter "test agent" "$FL_CLAUDE" 140
check  "140: reset times kept while level five fits"  "↺" "$PLAIN"
ffooter "test agent" "$FL_CLAUDE" 120
check  "120: the switch is kept"                      "Claude Agents  | PIR" "$PLAIN"
check  "120: the diff labels are kept"                "Browse" "$PLAIN"
check  "120: usage as percentages only"               "5h 80% / 1d " "$PLAIN"
refute "120: ...no reset times"                       "↺" "$PLAIN"
NW=$(node -e "$LEN" "$RAW")
if [ "${NW:-0}" -le 120 ]; then okline "120: the switch footer stays one row ($NW <= 120)"
else echo "  FAIL the 120 switch footer wrapped: width $NW > 120 columns"; fail=1; fi
ffooter "test agent" "$FL_CLAUDE" 80
same   "80: cut, not wrapped -- the switch still leads" \
       "$(node -e "$STRIP_ANSI" "$RAW" "Claude Agents")" "3"
NW=$(node -e "$LEN" "$RAW")
if [ "${NW:-0}" -le 80 ]; then okline "80: the line is cut at the edge ($NW <= 80)"
else echo "  FAIL the 80 switch footer wrapped: width $NW > 80 columns"; fail=1; fi
ffooter "test agent" "" 100
check  "100, no switch: reset times kept (no new level without the switch)" "↺" "$PLAIN"
rm -f "$SD/usage-cache.json"

# The click path, under script(1) exactly like section 12's click().
if command -v script >/dev/null; then
cp "$ROOT/bin/cockpit-strip.mjs" "$CLICKER"          # the copy with the switch in it
# Both sizes the task names: 319 (the live window) and the 140 narrow one, the
# latter with usage present so the trim is in play.
for W in 319 140; do
  if [ "$W" = 140 ]; then useed "{\"writtenAt\":$NOW_MS,\"fiveHour\":{\"usedPct\":80,\"resetsAt\":$R5},\"sevenDay\":{\"usedPct\":93,\"resetsAt\":$R7}}"; fi
  ffooter "test agent" "$FL_CLAUDE" "$W"
  same "[$W] claude shown: clicking PIR appends fleet-pir"           "$(fclick PIR "$W")" "fleet-pir"
  same "[$W] claude shown: clicking Claude Agents appends nothing"   "$(fclick 'Claude Agents' "$W" Browse diff-browse)" ""
  same "[$W] the diff labels still land behind the switch"           "$(fclick Browse "$W")" "diff-browse"
  same "[$W] ...and Uncommitted Changes too"                         "$(fclick 'Uncommitted Changes' "$W")" "diff-uncommitted"
  ffooter "test agent" "$FL_PIR" "$W"
  same "[$W] pir shown: clicking Claude Agents appends fleet-claude" "$(fclick 'Claude Agents' "$W")" "fleet-claude"
  same "[$W] pir shown: clicking PIR appends nothing"                "$(fclick PIR "$W" Browse diff-browse)" ""
  ffooter "test agent" "$FL_LOCKED" "$W"
  same "[$W] not switchable: clicking PIR appends nothing"           "$(fclick PIR "$W" Browse diff-browse)" ""
  same "[$W] not switchable: clicking Claude Agents appends nothing" "$(fclick 'Claude Agents' "$W" Browse diff-browse)" ""
  ffooter "repo" "$FL_CLAUDE" "$W"
  same "[$W] at the fleet list the switch still clicks (fleet-pir)"  "$(fclick PIR "$W")" "fleet-pir"
  same "[$W] ...while the diff labels stay inert there"              "$(fclick Browse "$W" PIR fleet-pir)" ""
done
rm -f "$SD/usage-cache.json"
fi
fi

}  # run_footer

# `same` is REDEFINED for the agenda and dashboard chains, with the expected/actual
# failure format. It used to be redefined inside section 13, so the sections after
# it (the dashboard chain) printed a different failure format depending on whether
# 13 had run: `ONLY=14c` got `want [..] got [..]`, a full run `expected:/actual:`.
# Installed first thing by both chains, so every run prints what a full serial run
# always printed -- including a concurrent one, where the dashboard chain's subshell
# never sees the agenda chain's redefinition. Main-chain and footer sections keep
# the first format.
late_same() {
same() {  # same <description> <actual> <expected>
  if [ "$2" = "$3" ]; then
    okline "$1"
  else
    echo "  FAIL $1"; echo "       expected: $3"; echo "       actual:   $2"; fail=1
  fi
}
}

run_agenda() {
late_same
# --- the agenda chain's helpers (13, 13b, 13c) ------------------------------
# Above the chain's first heading and outside every gate, like the footer chain's.
# Read one value out of a cache file; `c` is the parsed agenda-cache.json.
cq() {  # cq <state-dir> <expression over c>
  node -e 'const fs=require("fs");let c={calendars:{}};try{c=JSON.parse(fs.readFileSync(process.argv[1]+"/agenda-cache.json","utf8"));}catch{}let v;try{v=eval(process.argv[2]);}catch(e){v="<error>";}process.stdout.write(String(v===undefined?"undefined":v));' "$1" "$2"
}
# Zero the fetchedAt the daemon compares against, which is the only way anything
# here becomes stale. Written directly rather than through the store: nothing is
# stale at the moment this is called, so the daemon is not holding the lock.
makestale() {  # makestale <state-dir> <slug>...
  node -e 'const fs=require("fs");const p=process.argv[1]+"/agenda-cache.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));for(const s of process.argv.slice(2))if(c.calendars[s])c.calendars[s].fetchedAt=0;fs.writeFileSync(p,JSON.stringify(c));' "$@"
}
# ghits_ge <n> <fragment>...: has the fake Google logged at least n requests
# for EACH fragment? A poll condition for waituntil.
ghits_ge() {
  local n=$1 f; shift
  for f; do [ "$(grep -c -- "$f" "$GHITS")" -ge "$n" ] || return 1; done
}
# The fake Google's `slow` hold: five agenda ticks, so the in-flight window below
# (two and a half ticks) always closes before the held request is released.
GSLOW_MS="$(awk -v t="$AGENDA_TICK_MS" 'BEGIN{ printf "%d", t * 5 }')"

if section 13 "the agenda: the daemon keeps the event cache current"; then
# T07. THE DAEMON FETCHES AND THE PANE ONLY DRAWS (DESIGN 2.5), so the refresh is
# cockpitd's and is tested here rather than in agenda-test.
#
# Two more daemons, each with its own state dir AND its own copy of every file the
# wezterm stub reads ($CALLS/$PANESTATE/$FLEETSTATE/...), so neither can disturb
# the pane table the sections above assert on. The stub takes those paths from the
# environment, which is what makes the isolation a matter of env vars alone.
#
#   D2  an $AGENDA_TICK_MS tick (400ms at the default speed): everything the tick
#       itself does. Every window below is a `nap` counted in those ticks.
#   D3  a tick an hour long, so it can never fire in-test: whatever D3 refreshes
#       is the ON-RETURN trigger and cannot be confused for a tick.
#
# $AGENDA_STALE_MS (60s or more) in both -- longer than this section runs -- so nothing is
# ever re-fetched by accident. A calendar goes stale only when a line below zeroes
# its fetchedAt, and that is what makes every assertion here deterministic.

# --- a loopback stand-in for Google ----------------------------------------
# The seatbelt DESIGN 5.2 names: the client is pointed at 127.0.0.1, so a call
# that crept out to the real thing fails here instead of passing silently on a
# connected machine. $GMODE switches what the stub does to the NEXT request, which
# is how one long-lived daemon is walked through every failure mode in turn.
GHITS="$T/ghits.log"; : > "$GHITS"
GMODE="$T/gmode"; echo ok > "$GMODE"
cat > "$T/gstub.mjs" <<'GSTUB'
import http from "node:http";
import fs from "node:fs";
// argv[1] is this script's own path (it is run as a file, not with -e), so the
// two arguments start at 2. Getting this wrong is silent: the mode file is never
// read, every request looks like a success, and the hit log lands somewhere else.
// The third, the `slow` hold in ms, is scaled with the daemon's tick by the suite.
const [, , MODE, HITS, SLOW_ARG] = process.argv;
const SLOW = Number(SLOW_ARG) || 2000;
const mode = () => { try { return fs.readFileSync(MODE, "utf8").trim(); } catch { return "ok"; } };
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
// One timed event, in Google's RAW shape. The title is deliberately shouty: the
// daemon must never write it to a log that gets pasted into conversations.
const EVENTS = {
  timeZone: "Europe/Warsaw",
  items: [{
    id: "ev1", status: "confirmed", summary: "SECRET-MEETING-TITLE",
    start: { dateTime: "2026-08-29T10:00:00+02:00" },
    end:   { dateTime: "2026-08-29T11:00:00+02:00" },
  }],
};
const server = http.createServer((req, res) => {
  // Logged DECODED, so an assertion can look for a plain ISO stamp rather than
  // hunting %3A through a query string.
  fs.appendFileSync(HITS, `${req.method} ${decodeURIComponent(req.url)}\n`);
  const m = mode();
  if (req.url.startsWith("/token")) {
    if (m === "auth") return json(res, 400, { error: "invalid_grant" });
    return json(res, 200, { access_token: "TOKEN-MUST-NOT-BE-LOGGED", expires_in: 3600 });
  }
  const cal = decodeURIComponent((req.url.match(/\/calendars\/([^/]+)\/events/) || [])[1] || "");
  if (m === "net") return req.socket.destroy();     // a dropped socket -> kind network
  if (m === "gone") return json(res, 404, { error: { message: "Not Found" } });
  if (m === "one-bad" && cal === "bad-cal") return json(res, 404, { error: { message: "Not Found" } });
  if (m === "slow") return setTimeout(() => json(res, 200, EVENTS), SLOW);
  json(res, 200, EVENTS);
});
server.listen(0, "127.0.0.1", () => console.log(`PORT ${server.address().port}`));
GSTUB
node "$T/gstub.mjs" "$GMODE" "$GHITS" "$GSLOW_MS" > "$T/gstub.out" 2>&1 &
GPID=$!
for _ in $(seq 1 60); do grep -q '^PORT ' "$T/gstub.out" 2>/dev/null && break; sleep 0.1; done
GPORT="$(sed -n 's/^PORT //p' "$T/gstub.out" | head -1)"
ORIGIN="http://127.0.0.1:$GPORT"
same "the fake Google is listening on loopback" "$([ -n "$GPORT" ] && echo yes || echo no)" "yes"


# --- D2: the tick ----------------------------------------------------------
A2="$T/agenda2"; S2="$A2/state"
mkdir -p "$A2" "$S2"
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$S2/panes.json"
: > "$S2/fleet.log"
# The stub keys the fleet pane off id 20, so this second table reuses the same
# three ids -- it is a different FILE, so nothing collides with the first daemon.
printf '10 0 sh\n20 0 sh\n30 0 sh\n' > "$A2/panestate"
echo 31 > "$A2/nextpane"; echo 1 > "$A2/nexttab"
echo list > "$A2/fleetstate"
for f in editing titlelag active panecwd psbusy calls.log; do : > "$A2/$f"; done

# TZ is pinned so "start of today, local" is one string on any machine, the same
# way the notes-test frame harness pins it (FINDINGS 2026-08-29).
d2env() {
  HOME="$T/home" SHELL=/bin/zsh TZ=Europe/Warsaw COCKPIT_OWNER_PID="$$" \
  COCKPIT_DIR="$S2" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$A2/calls.log" FLEETSTATE="$A2/fleetstate" PANESTATE="$A2/panestate" \
  NEXTPANE="$A2/nextpane" NEXTTAB="$A2/nexttab" EDITING="$A2/editing" \
  TITLELAG="$A2/titlelag" ACTIVE="$A2/active" PANECWD="$A2/panecwd" \
  PSBUSY="$A2/psbusy" AGENTS_JSON="$SIDE_AGENTS" \
  AGENDA_ORIGIN="$ORIGIN" COCKPIT_AGENDA_TICK_MS="$AGENDA_TICK_MS" COCKPIT_AGENDA_STALE_MS="$AGENDA_STALE_MS" \
  "$@"
}
d2env node "$ROOT/bin/cockpitd.mjs" > "$A2/daemon.log" 2>&1 &
D2PID=$!
# Booted: it has reached the wezterm stub. Nothing is configured yet, so whether
# the start-up refresh has run by then does not matter here (D3's boot below is
# where it does). Then two and a half ticks with nothing configured is the window
# that proves a tick asks for nothing.
waituntil 10 "the agenda daemon D2 to boot" test -s "$A2/calls.log"
nap 2   # window: 2.5 x AGENDA_TICK_MS

# Nothing configured: the feature costs nothing until it is used (DESIGN 2.5).
same "no calendars: nothing was requested"     "$(wc -l < "$GHITS" | tr -d ' ')" "0"
same "no calendars: no cache file was written" "$([ -e "$S2/agenda-cache.json" ] && echo yes || echo no)" "no"

# One calendar, no cache entry at all -- which reads as fetchedAt 0, so it is
# stale and gets its first fetch.
d2env node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>{s.writeClient({clientId:"cid",clientSecret:"csec"});s.putAccount("me@x.test","REFRESH-TOKEN",1);s.putCalendar({slug:"work",account:"me@x.test",calendarId:"work-cal",title:"Work",colour:1},1);});' "$ROOT"
# Computed the same way the daemon computes it, and just before it runs, so the
# comparison is against dayBounds rather than against a hand-written stamp.
WINDOW="$(TZ=Europe/Warsaw node -e 'import(process.argv[1]+"/bin/cockpit-agenda-model.mjs").then(m=>{const b=m.dayBounds(Date.now(),{tz:"Europe/Warsaw"});process.stdout.write(new Date(b.todayStart).toISOString()+" "+new Date(b.dayAfterStart).toISOString());});' "$ROOT")"
WMIN="${WINDOW%% *}"; WMAX="${WINDOW##* }"
waitfor "agenda tick: work ok" "$A2/daemon.log" 10 "the first tick to fetch work"

check "a stale calendar is fetched"                  "agenda tick: work ok, 1 events" "$A2/daemon.log"
same  "...and its fetchedAt is set"                  "$(cq "$S2" 'c.calendars.work.fetchedAt > 0')" "true"
same  "...with no error"                             "$(cq "$S2" 'c.calendars.work.error')" "null"
# The window is start-of-today .. start-of-the-day-after, in LOCAL time, and never
# now +/- 24h: a day is not always 24 hours long (FINDINGS 2026-08-27).
check "the fetch window starts at the start of today, local" "timeMin=$WMIN" "$GHITS"
check "...and ends at the end of tomorrow"                   "timeMax=$WMAX" "$GHITS"
# What lands in the cache is the PURE model's shape, not Google's.
same   "the cache holds normalised events"           "$(cq "$S2" 'c.calendars.work.events[0].allDay')" "false"
same   "...with the model's title field"             "$(cq "$S2" 'c.calendars.work.events[0].title')" "SECRET-MEETING-TITLE"
same   "...and an epoch start, not a dateTime string" "$(cq "$S2" 'typeof c.calendars.work.events[0].start')" "number"
refute "no raw Google dateTime reached the cache"    '"dateTime"' "$S2/agenda-cache.json"
refute "...and no raw summary field either"          '"summary"'  "$S2/agenda-cache.json"

# Younger than AGENDA_STALE_MS: left alone, however many ticks pass.
: > "$GHITS"
nap 2   # window: 2.5 x AGENDA_TICK_MS, every tick finding work fresh
same "a fresh calendar is not re-fetched" "$(grep -c '/events' "$GHITS")" "0"

# Two calendars, both stale, one pass.
d2env node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>{s.putCalendar({slug:"home",account:"me@x.test",calendarId:"home-cal",title:"Home",colour:2},1);});' "$ROOT"
# Let the new calendar's first fetch land (its cache entry is written before the
# log line), so the pass after makestale is the one being asserted on.
waitfor "agenda tick: home ok" "$A2/daemon.log" 10 "the first tick to fetch home"
makestale "$S2" work home
: > "$GHITS"
waituntil 10 "one pass to request both work and home" \
    ghits_ge 1 /calendars/work-cal/events /calendars/home-cal/events
check "two calendars are both refreshed in one pass" "/calendars/work-cal/events" "$GHITS"
check "...the second one too"                        "/calendars/home-cal/events" "$GHITS"

# A failing calendar must not stop the ones after it in the same pass, so `late`
# is added AFTER `bad` and asserted on.
echo one-bad > "$GMODE"       # before the add: a new calendar is stale at once
d2env node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>{s.putCalendar({slug:"bad",account:"me@x.test",calendarId:"bad-cal",title:"Bad",colour:3},1);s.putCalendar({slug:"late",account:"me@x.test",calendarId:"late-cal",title:"Late",colour:4},1);});' "$ROOT"
# The pass is sequential, bad before late, and late's cache entry is written before
# its log line -- so late's line means bad's error is on disk too.
waitfor "agenda tick: late ok" "$A2/daemon.log" 10 "the pass to reach the calendar after the failing one"
same "a failing calendar records its error"                 "$(cq "$S2" 'c.calendars.bad.error.kind')" "gone"
same "...and does not stop the NEXT one being refreshed"    "$(cq "$S2" 'c.calendars.late.fetchedAt > 0')" "true"
same "...which has no error of its own"                     "$(cq "$S2" 'c.calendars.late.error')" "null"

# A wifi blip must not empty the agenda (DESIGN 2.7): the events stay, only the
# error is added.
echo net > "$GMODE"
makestale "$S2" work
waitfor "agenda tick: work failed, network" "$A2/daemon.log" 10 "work to fail on the dropped socket"
same "a network failure keeps the previous events" "$(cq "$S2" 'c.calendars.work.events.length')" "1"
same "...and sets error.kind = network"            "$(cq "$S2" 'c.calendars.work.error.kind')" "network"
SINCE1="$(cq "$S2" 'c.calendars.work.error.since')"
same "...and stamps when it broke"                 "$([ "${SINCE1:-0}" -gt 0 ] 2>/dev/null && echo yes || echo no)" "yes"
# A failure keeps the previous fetchedAt, so `work` is still stale and retries on
# every tick -- which is exactly the repeat this asserts `since` survives.
waitmore "agenda tick: work failed, network" "$A2/daemon.log" \
    "$(countof "agenda tick: work failed, network" "$A2/daemon.log")" 10 "a repeat of the network failure"
same "error.since is preserved across repeats"     "$(cq "$S2" 'c.calendars.work.error.since')" "$SINCE1"

echo auth > "$GMODE"
waitfor "agenda tick: work failed, auth" "$A2/daemon.log" 10 "work to fail on the refused token"
same "an auth failure classifies as auth"          "$(cq "$S2" 'c.calendars.work.error.kind')" "auth"
same "...and still keeps the previous events"      "$(cq "$S2" 'c.calendars.work.events.length')" "1"

# Counted before the switch: while the stub refuses tokens no new "ok" can appear.
OKN=$(countof "agenda tick: work ok" "$A2/daemon.log")
echo ok > "$GMODE"
waitmore "agenda tick: work ok" "$A2/daemon.log" "$OKN" 10 "work to recover"
same "a success after a failure clears the error entirely" "$(cq "$S2" 'c.calendars.work.error')" "null"
# Three passes have now thrown inside them. The daemon runs unattended behind a
# window; dying silently means the panes just stop following and nothing says why.
# That cleared error IS the proof it survived -- a later tick ran and wrote. A
# `kill -0` would not be: an unreaped child answers it exactly as a live one does.
same "...which is a later tick running after three thrown passes" \
     "$(cq "$S2" 'c.calendars.work.fetchedAt > 0')" "true"

# One pass in flight at a time, guarded like reconcile. `slow` holds the first
# calendar's events call open for 2s while ~5 ticks fire behind it.
echo slow > "$GMODE"
: > "$GHITS"                  # cleared FIRST: the pass below must stay recorded
makestale "$S2" work home
# The pass is in flight once its first events call is held. From there, two and a
# half ticks fire behind it; each would add an events call if the guard let a
# second pass in. The window closes well inside the stub's hold of five ticks.
waituntil 10 "a pass to enter the held events call" ghits_ge 1 /events
nap 2   # window: 2.5 x AGENDA_TICK_MS, inside the GSLOW_MS (5-tick) hold
same "a pass entered while one is in flight starts nothing" "$(grep -c '/events' "$GHITS")" "1"
HOMEN=$(countof "agenda tick: home ok" "$A2/daemon.log")
echo ok > "$GMODE"
# The held pass ends with home, the calendar after work: wait for it, so nothing is
# still writing when the log and the state file are read below.
waitmore "agenda tick: home ok" "$A2/daemon.log" "$HOMEN" 10 "the held pass to finish"

# daemon.log gets pasted into conversations.
refute "no access token ever reaches the log"  "TOKEN-MUST-NOT-BE-LOGGED" "$A2/daemon.log"
refute "no meeting title ever reaches the log" "SECRET-MEETING-TITLE"     "$A2/daemon.log"

# FINDINGS 2026-08-29: readState() MOVES a corrupt agenda.json aside, and that
# quarantine is a one-shot event only a caller that can speak to a person may
# consume. This daemon runs every 60 seconds with nobody to tell, so it would
# always win the race and the sign-ins would vanish unannounced. Rescuing is the
# `agenda` command's alone -- the same defect the T06 review fixed in the pane.
printf '{"calendars":[' > "$S2/agenda.json"
nap 2   # window: 2.5 x AGENDA_TICK_MS, each tick reading the corrupt file
same "a corrupt agenda.json is NOT quarantined by the daemon" \
     "$(ls "$S2" | grep -c 'agenda.json.corrupt')" "0"
same "...and the sign-ins are left exactly where they were" \
     "$(cat "$S2/agenda.json")" '{"calendars":['
fi

if section 13b "the agenda: coming back to the fleet list refreshes it"; then
# D2 is stopped first so nothing it does can land in the shared hit log, and so a
# 60s staleness boundary cannot expire underneath D3.
daemon_stop $D2PID
D2PID=""
: > "$GHITS"

A3="$T/agenda3"; S3="$A3/state"
mkdir -p "$A3" "$S3"
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$S3/panes.json"
: > "$S3/fleet.log"
printf '10 0 sh\n20 0 sh\n30 0 sh\n' > "$A3/panestate"
echo 31 > "$A3/nextpane"; echo 1 > "$A3/nexttab"
echo list > "$A3/fleetstate"
for f in editing titlelag active panecwd psbusy calls.log; do : > "$A3/$f"; done

d3env() {
  HOME="$T/home" SHELL=/bin/zsh TZ=Europe/Warsaw COCKPIT_OWNER_PID="$$" \
  COCKPIT_DIR="$S3" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$A3/calls.log" FLEETSTATE="$A3/fleetstate" PANESTATE="$A3/panestate" \
  NEXTPANE="$A3/nextpane" NEXTTAB="$A3/nexttab" EDITING="$A3/editing" \
  TITLELAG="$A3/titlelag" ACTIVE="$A3/active" PANECWD="$A3/panecwd" \
  PSBUSY="$A3/psbusy" AGENTS_JSON="$SIDE_AGENTS" \
  AGENDA_ORIGIN="$ORIGIN" COCKPIT_AGENDA_TICK_MS=3600000 COCKPIT_AGENDA_STALE_MS="$AGENDA_STALE_MS" \
  "$@"
}
d3env node "$ROOT/bin/cockpitd.mjs" > "$A3/daemon.log" 2>&1 &
D3PID=$!
# polls_past <n>: has D3 read the fleet pane more than n times? Only reconcile
# reads pane 20, and it holds its lock through onExit, so a poll counted AFTER the
# exit line was made after the on-return refresh had started. Two of them span a
# full POLL_MS, time for a fetch it started to reach the stub.
polls_past() { [ "$(grep -cxF "ARGV: cli get-text --pane-id 20" "$A3/calls.log")" -gt "$1" ]; }

# Configured only AFTER boot, so the one refresh at start-up finds nothing to do
# and cannot be mistaken for the on-return trigger below. Booted means a SECOND
# fleet poll: the first get-text, and the `list` writeTerminals makes before it, are
# issued while the module body is still running -- BEFORE refreshAgenda("start")
# reads the state -- so configuring on the first stub call races the start refresh
# into fetching w3 (reproduced with a 600ms stall before it). The second poll comes
# from the POLL_MS interval, which cannot fire until the whole body has run.
waituntil 10 "the agenda daemon D3 to boot" polls_past 1
d3env node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>{s.writeClient({clientId:"cid",clientSecret:"csec"});s.putAccount("me@x.test","REFRESH-TOKEN",1);s.putCalendar({slug:"w3",account:"me@x.test",calendarId:"w3-cal",title:"W3",colour:1},1);});' "$ROOT"
# D3's tick is an hour, so only a return could fetch here, and no return has
# happened: 2.5 fleet polls (POLL_MS, 800ms scaled by COCKPIT_TIME_SCALE) is the
# window in which a spurious one would have shown up.
nap 2   # window: 2.5 x POLL_MS
same "an hour-long tick has fetched nothing on its own" "$(grep -c '/events' "$GHITS")" "0"

# The return to the fleet LIST is the trigger (DESIGN 2.5) -- so attach first,
# then step back out, which is what makes reconcile call onExit.
echo "test agent" > "$A3/fleetstate"
waitfor "enter abc12345" "$A3/daemon.log" 10 "D3 to attach the agent"
echo list > "$A3/fleetstate"
waitfor "agenda returned: w3 ok" "$A3/daemon.log" 10 "the return to refresh w3"
check "the return to the fleet list refreshed a stale calendar" "agenda returned: w3 ok" "$A3/daemon.log"
same  "...and the cache was written"  "$(cq "$S3" 'c.calendars.w3.fetchedAt > 0')" "true"

# The same return, with nothing stale, must fetch nothing at all.
: > "$GHITS"
ENTN=$(countof "enter abc12345" "$A3/daemon.log")
EXITN=$(countof "exit abc12345" "$A3/daemon.log")
echo "test agent" > "$A3/fleetstate"
waitmore "enter abc12345" "$A3/daemon.log" "$ENTN" 10 "D3 to attach the agent again"
echo list > "$A3/fleetstate"
waitmore "exit abc12345" "$A3/daemon.log" "$EXITN" 10 "D3 to see the second return"
POLLN=$(grep -cxF "ARGV: cli get-text --pane-id 20" "$A3/calls.log")
waituntil 10 "two of D3's fleet polls after the return" polls_past $((POLLN + 1))
same "...while a return with nothing stale fetches nothing" "$(grep -c '/events' "$GHITS")" "0"
fi

if section 13c "the new seams are fenced"; then
# FINDINGS 2026-08-28: every test seam gets a guard, or a later edit points the
# real daemon at the real Google and the suite still passes on a connected
# machine. `grep -v grep` drops these guard lines themselves, which name the very
# patterns they are looking for.
same "every cockpitd in this suite is pointed at loopback" \
     "$(grep -F 'AGENDA_ORIGIN=' "$HERE/run.sh" | grep -v grep | grep -vcE 'AGENDA_ORIGIN="(\$ORIGIN|http://127\.0\.0\.1)')" "0"
same "no line in this suite names a real Google host" \
     "$(grep -E 'googleapis\.com|accounts\.google\.com' "$HERE/run.sh" | grep -vc grep)" "0"
# The two timing seams are test-only. Unset, the daemon must be on the numbers
# DESIGN 2.5 states -- so the defaults are asserted in the source, not trusted.
same "the tick defaults to 60s"        "$(grep -c 'COCKPIT_AGENDA_TICK_MS) || 60_000' "$ROOT/bin/cockpitd.mjs")" "1"
same "staleness defaults to one minute" "$(grep -c 'COCKPIT_AGENDA_STALE_MS) || 60_000' "$ROOT/bin/cockpitd.mjs")" "1"

daemon_stop $D3PID; D3PID=""
kill $GPID 2>/dev/null;  GPID=""
fi

}  # run_agenda

run_dashboard() {
late_same
if section 14 "the bitbucket dashboard: the daemon keeps the PR cache current"; then
# bitbucket-dashboard T05. THE DAEMON FETCHES AND THE PANE ONLY DRAWS (DESIGN 2.9,
# 3.1), so refreshPRs is cockpitd's and is tested here, refreshAgenda's sibling.
#
#   D4  a 400ms tick: everything a tick does (getUser once, per-repo isolation,
#       auth vs transient, the in-flight guard).
#   D5  an hour-long tick, so it never fires in-test: proves the START trigger fills
#       the cache and the ON-RETURN trigger re-fetches, neither confusable for a tick.
#
# BitBucket has NO staleness window (unlike the agenda): a pass fetches every watched
# repo, so a clean "nothing is fetching" edge for the guard test is made by
# UNCONFIGURING, not by ageing a cache entry.
# Every daemon below is stopped with daemon_stop (spikes/lib/test-daemons.sh), never a
# plain `kill`: the dashboard has NO staleness window, so a leaked daemon keeps hitting
# the stub every tick and poisons the shared hit log.

# --- a loopback stand-in for BitBucket (DESIGN 5.2) ------------------------
# The client is pointed at 127.0.0.1, so a call that crept out to the real API
# fails here instead of burning a real credential on a connected machine. $BBMODE
# switches what the NEXT request does, walking one daemon through every failure
# mode. The client is GET-only, so the stub only ever answers GETs.
BBHITS="$T/bbhits.log"; : > "$BBHITS"
BBMODE="$T/bbmode"; echo ok > "$BBMODE"
cat > "$T/bbstub.mjs" <<'BBSTUB'
import http from "node:http";
import fs from "node:fs";
const [, , MODE, HITS] = process.argv;
const mode = () => { try { return fs.readFileSync(MODE, "utf8").trim(); } catch { return "ok"; } };
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
// One raw PR in BitBucket's shape. The title is deliberately shouty: the daemon
// must never write it to a log that gets pasted into conversations. ME-UUID is a
// reviewer, so this PR CONCERNS me -- the daemon reads comments only for PRs that
// will show (DESIGN 2.3, 2.9), and this is the one that does.
const MINE = {
  id: 7, title: "SECRET-PR-TITLE", state: "OPEN", comment_count: 2,
  updated_on: "2026-09-04T10:00:00+00:00", author: { uuid: "{author}" },
  participants: [], reviewers: [{ uuid: "ME-UUID" }],
  links: { html: { href: "https://bitbucket.org/ws/pr/7" } },
};
// A second PR that concerns NOBODY here (I do not review it, I did not write it):
// the daemon must NOT spend a comment read on it. `two-prs` mode returns both.
const NOTMINE = {
  id: 8, title: "OTHER-PR", state: "OPEN", comment_count: 0,
  updated_on: "2026-09-03T10:00:00+00:00", author: { uuid: "{other}" },
  participants: [], reviewers: [],
  links: { html: { href: "https://bitbucket.org/ws/pr/8" } },
};
const PRS = { values: [MINE] };
const PRS2 = { values: [MINE, NOTMINE] };
// A batch of PRs that all concern me (I review each), for the paging clamp (T08,
// section 14d): enough open PRs that the dashboard overflows one page in the test
// pane's 40x10 geometry, so `bb-page:next` can be walked to the last page and clamped.
const MANY = { values: Array.from({ length: 20 }, (_, i) => ({
  id: 200 + i, title: "PAGED-PR", state: "OPEN", comment_count: 0,
  updated_on: "2026-09-01T10:00:00+00:00", author: { uuid: "{other}" },
  participants: [], reviewers: [{ uuid: "ME-UUID" }],
  links: { html: { href: `https://bitbucket.org/ws/pr/${200 + i}` } },
})) };
// One PR's comments: a single unresolved inline thread the sort would count
// (DESIGN 2.3). The daemon fetches this per open PR (decision A, DESIGN 2.9) and
// attaches it to the raw PR as `.comments`.
const COMMENTS = { values: [{ id: 100, inline: { path: "a.js" }, user: { uuid: "ME-UUID" }, content: { raw: "x" } }] };
// One PR's diffstat: two changed files, +10 -3 in total (DESIGN 2.4). The daemon
// fetches this per SHOWN PR, sums it with the pure summarizeDiffstat, and caches only
// the { files, added, removed } triple on the raw PR as `.diffstatSummary`.
const DIFFSTAT = { values: [
  { status: "modified", lines_added: 7, lines_removed: 3 },
  { status: "added",    lines_added: 3, lines_removed: 0 },
] };
const server = http.createServer((req, res) => {
  // Logged DECODED so an assertion looks for a plain `+` and `?state=OPEN` rather
  // than hunting %2B/%3D through a query string.
  fs.appendFileSync(HITS, `${req.method} ${decodeURIComponent(req.url)}\n`);
  const m = mode();
  if (req.url.startsWith("/2.0/user")) {
    if (m === "user-auth") return json(res, 401, { type: "error" });
    return json(res, 200, { uuid: "ME-UUID", nickname: "me", account_id: "acc" });
  }
  // The per-PR comments GET must be answered BEFORE the repo-list branch: the
  // comments path (/pullrequests/{id}/comments) still matches the pullrequests regex,
  // so without this it would be served a PR-list body. `comment-net` drops only the
  // comment call, so a repo whose LIST succeeds still exercises "keep the PR's
  // previous comments" (DESIGN 2.n).
  if (/\/pullrequests\/\d+\/comments/.test(req.url)) {
    if (m === "net" || m === "comment-net") return req.socket.destroy();  // -> transient
    return json(res, 200, COMMENTS);
  }
  // The per-PR diffstat GET, also answered BEFORE the repo-list branch: its path
  // (/pullrequests/{id}/diffstat) still matches the pullrequests regex, so without
  // this it would be served a PR-list body. `diffstat-net` drops only the diffstat
  // call, so a repo whose LIST and COMMENTS succeed still exercises "keep the PR's
  // previous diffstat summary" (DESIGN 2.4).
  if (/\/pullrequests\/\d+\/diffstat/.test(req.url)) {
    if (m === "net" || m === "diffstat-net") return req.socket.destroy();  // -> transient
    return json(res, 200, DIFFSTAT);
  }
  const repo = decodeURIComponent((req.url.match(/\/repositories\/[^/]+\/([^/]+)\/pullrequests/) || [])[1] || "");
  if (m === "net") return req.socket.destroy();          // dropped socket -> transient
  if (m === "auth") return json(res, 401, { type: "error" });
  if (m === "one-bad" && repo === "bad") return json(res, 500, { type: "error" });  // -> transient
  if (m === "slow") return setTimeout(() => json(res, 200, PRS), 2000);
  if (m === "two-prs") return json(res, 200, PRS2);
  if (m === "many") return json(res, 200, MANY);
  json(res, 200, PRS);
});
server.listen(0, "127.0.0.1", () => console.log(`PORT ${server.address().port}`));
BBSTUB
node "$T/bbstub.mjs" "$BBMODE" "$BBHITS" > "$T/bbstub.out" 2>&1 &
BBPID=$!
for _ in $(seq 1 60); do grep -q '^PORT ' "$T/bbstub.out" 2>/dev/null && break; sleep 0.1; done
BBPORT="$(sed -n 's/^PORT //p' "$T/bbstub.out" | head -1)"
BBORIGIN="http://127.0.0.1:$BBPORT"
same "the fake BitBucket is listening on loopback" "$([ -n "$BBPORT" ] && echo yes || echo no)" "yes"

# Read one value out of a bitbucket-cache.json; `c` is the parsed cache.
bq() {  # bq <state-dir> <expression over c>
  node -e 'const fs=require("fs");let c={meUuid:null,repos:{}};try{c=JSON.parse(fs.readFileSync(process.argv[1]+"/bitbucket-cache.json","utf8"));}catch{}let v;try{v=eval(process.argv[2]);}catch(e){v="<error>";}process.stdout.write(String(v===undefined?"undefined":v));' "$1" "$2"
}
# bqtrue <state-dir> <expression over c>: exit 0 when it is true. For waituntil:
# the cache is written ONCE, at the END of a pass, after the per-repo log lines,
# so a wait on a log line can still read the previous pass's cache -- poll the
# cache itself for the state the checks after it read.
bqtrue() { [ "$(bq "$1" "$2")" = true ]; }
# The four config settings are plain files under COCKPIT_DIR (DESIGN 3.5); `config`
# writes them, and readSetting/readConfig read them, so a test writes them directly.
bbconf() {  # bbconf <state-dir> <repos-csv>   (workspace/key fixed; team left empty)
  printf 'me@x:tok' > "$1/bitbucket-key"
  printf 'testws'   > "$1/bitbucket-workspace"
  printf '%s' "$2"  > "$1/bitbucket-repos"
}

# --- D4: the tick ----------------------------------------------------------
A4="$T/bb4"; S4="$A4/state"
mkdir -p "$A4" "$S4"
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$S4/panes.json"
: > "$S4/fleet.log"
printf '10 0 sh\n20 0 sh\n30 0 sh\n' > "$A4/panestate"
echo 31 > "$A4/nextpane"; echo 1 > "$A4/nexttab"
echo list > "$A4/fleetstate"
for f in editing titlelag active panecwd psbusy calls.log; do : > "$A4/$f"; done

d4env() {
  HOME="$T/home" SHELL=/bin/zsh TZ=Europe/Warsaw COCKPIT_OWNER_PID="$$" \
  COCKPIT_DIR="$S4" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$A4/calls.log" FLEETSTATE="$A4/fleetstate" PANESTATE="$A4/panestate" \
  NEXTPANE="$A4/nextpane" NEXTTAB="$A4/nexttab" EDITING="$A4/editing" \
  TITLELAG="$A4/titlelag" ACTIVE="$A4/active" PANECWD="$A4/panecwd" \
  PSBUSY="$A4/psbusy" AGENTS_JSON="$SIDE_AGENTS" \
  BITBUCKET_ORIGIN="$BBORIGIN" COCKPIT_BITBUCKET_TICK_MS="$BB_TICK_MS" \
  "$@"
}
d4env node "$ROOT/bin/cockpitd.mjs" > "$A4/daemon.log" 2>&1 &
D4PID=$!
waitfor "cockpitd up" "$A4/daemon.log" 10 "D4 to start"
# Window: an unconfigured daemon ticking for 2.5 ticks (BB_TICK_MS) must call nothing.
nap 2

# Nothing configured: the feature costs nothing until it is used (DESIGN 2.5, 2.n).
same "no config: nothing was requested"     "$(wc -l < "$BBHITS" | tr -d ' ')" "0"
same "no config: no cache file was written" "$([ -e "$S4/bitbucket-cache.json" ] && echo yes || echo no)" "no"

# getUser AUTH first, before meUuid is ever cached: the token is bad for EVERYTHING,
# so the whole dashboard is the "sign-in expired" signal (DESIGN 2.n). refreshPRs
# records it on every watched repo, keeps meUuid unset (so getUser is retried), and
# fetches no repo -- a dead token would only repeat the 401.
echo user-auth > "$BBMODE"
bbconf "$S4" "bad,alpha"
# refreshPRs writes the auth signal to the cache BEFORE it logs the failure.
waitfor "bitbucket tick: getUser failed, auth" "$A4/daemon.log" 10 "the getUser auth failure"
check "a bad token on /user is logged as an auth failure" "bitbucket tick: getUser failed, auth" "$A4/daemon.log"
same  "...and meUuid is left unset so it is retried"       "$(bq "$S4" 'c.meUuid')" "null"
same  "...the whole-dashboard auth signal is on every repo" "$(bq "$S4" 'c.repos.alpha.error.kind')" "auth"
same  "...and no repo pullrequests call was made"          "$(grep -c '/pullrequests' "$BBHITS")" "0"

# Recover: a good token now identifies the user ONCE and fetches every repo. The raw
# PRs pass through untouched (DESIGN 3.1); the model normalises them later (T06).
echo ok > "$BBMODE"
waituntil 10 "a pass that resolves 'me' and clears alpha's auth error" \
  bqtrue "$S4" 'c.meUuid==="ME-UUID" && !!c.repos.alpha && c.repos.alpha.error===null'
same "a good token resolves 'me' once, cached"   "$(bq "$S4" 'c.meUuid')" "ME-UUID"
check "each repo's PRs are fetched"               "/repositories/testws/alpha/pullrequests" "$BBHITS"
check "...with the field expansion for approvals" "fields=+values.participants,+values.reviewers" "$BBHITS"
same  "a repo's raw PRs land in the cache"        "$(bq "$S4" 'c.repos.alpha.prs.length')" "1"
same  "...untouched -- the raw title, not a normalised row" "$(bq "$S4" 'c.repos.alpha.prs[0].title')" "SECRET-PR-TITLE"
same  "...with a fresh fetchedAt"                 "$(bq "$S4" 'c.repos.alpha.fetchedAt > 0')" "true"
same  "...and the auth error cleared entirely"    "$(bq "$S4" 'c.repos.alpha.error')" "null"

# Each open PR also costs one comments GET (decision A, DESIGN 2.9), attached to the
# raw PR as `.comments` for the unresolved-thread sort (DESIGN 2.3). The store passes
# it through untouched, so it is in the cache.
check "the concerning PR's comments are fetched"   "/pullrequests/7/comments" "$BBHITS"
same  "...and attached to the raw PR for the sort" "$(bq "$S4" 'c.repos.alpha.prs[0].comments.length')" "1"
check "...the log counts the comment fetches"      "alpha ok, 1 prs, 1 comment fetches" "$A4/daemon.log"

# The same shown PR also costs one diffstat GET (DESIGN 2.4), summed by the pure
# summarizeDiffstat and cached as the { files, added, removed } triple on the raw PR.
# Only the triple is stored, never the per-file list, so the repaint never re-sums.
check "the concerning PR's diffstat is fetched"    "/pullrequests/7/diffstat" "$BBHITS"
same  "...and the summed triple is cached: files"  "$(bq "$S4" 'c.repos.alpha.prs[0].diffstatSummary.files')" "2"
same  "...added"                                    "$(bq "$S4" 'c.repos.alpha.prs[0].diffstatSummary.added')" "10"
same  "...removed"                                  "$(bq "$S4" 'c.repos.alpha.prs[0].diffstatSummary.removed')" "3"
same  "...only the triple, not the per-file list"  "$(bq "$S4" 'c.repos.alpha.prs[0].diffstatSummary.values')" "undefined"
check "...the log counts the diffstat fetches"      "1 comment fetches, 1 diffstat fetches" "$A4/daemon.log"

# Only PRs that concern me cost a comment read (DESIGN 2.3, 2.9; FINDINGS 2026-09-05).
# two-prs adds #8, which I neither review nor authored: it is cached raw but must NOT
# trigger a comment GET, so a repo with hundreds of open PRs still costs a read only
# for the handful shown.
: > "$BBHITS"
echo two-prs > "$BBMODE"
waituntil 10 "a two-prs pass in the cache" bqtrue "$S4" 'c.repos.alpha.prs.length===2'
same  "both raw PRs are cached"                    "$(bq "$S4" 'c.repos.alpha.prs.length')" "2"
check "the PR I review still gets a comment read"  "/pullrequests/7/comments" "$BBHITS"
same  "...the PR that concerns nobody does NOT"    "$(grep -c '/pullrequests/8/comments' "$BBHITS")" "0"
same  "...and it carries an empty comments array"  "$(bq "$S4" 'c.repos.alpha.prs.find(function(p){return p.id===8}).comments.length')" "0"
# A non-concerning PR costs no diffstat call either, and carries NO summary at all --
# not a zeroed one -- so the pure model can tell "not fetched" from "0 files" (DESIGN 2.4).
check "the PR I review still gets a diffstat read" "/pullrequests/7/diffstat" "$BBHITS"
same  "...the PR that concerns nobody does NOT"    "$(grep -c '/pullrequests/8/diffstat' "$BBHITS")" "0"
same  "...and it carries no diffstatSummary"       "$(bq "$S4" 'c.repos.alpha.prs.find(function(p){return p.id===8}).diffstatSummary')" "undefined"
check "...the log counts one read for two PRs"     "alpha ok, 2 prs, 1 comment fetches, 1 diffstat fetches" "$A4/daemon.log"
echo ok > "$BBMODE"
waituntil 10 "an ok pass back in the cache" bqtrue "$S4" 'c.repos.alpha.prs.length===1'
same  "back to one PR when the extra one closes"   "$(bq "$S4" 'c.repos.alpha.prs.length')" "1"

# meUuid is fetched ONCE and reused (DESIGN 2.6): over the next several ticks the
# repos are re-fetched but /2.0/user is not called again.
: > "$BBHITS"
# Two list calls for alpha is at least one whole pass since the clear (a pass
# lists bad, then alpha), so /2.0/user had a full tick in which to be called.
hits_at_least() { [ "$(grep -cF -- "$1" "$BBHITS")" -ge "$2" ]; }   # re-counted on every poll
waituntil 10 "two more passes' alpha list calls" hits_at_least '/alpha/pullrequests?' 2
same "meUuid is not re-fetched every tick" "$(grep -c '/2.0/user' "$BBHITS")" "0"
same "...while the repos still are"        "$([ "$(grep -c '/pullrequests' "$BBHITS")" -gt 0 ] && echo yes || echo no)" "yes"

# One repo failing transiently keeps its previous PRs and records the error; a repo
# BEFORE it in the pass (bad) failing must not stop the one after it (alpha). Each
# repo is cached independently (DESIGN 2.n).
echo one-bad > "$BBMODE"
waituntil 10 "a one-bad pass in the cache" \
  bqtrue "$S4" '!!c.repos.bad.error && c.repos.bad.error.kind==="transient"'
same "a transient repo failure keeps its previous PRs" "$(bq "$S4" 'c.repos.bad.prs.length')" "1"
same "...and records a transient error"                "$(bq "$S4" 'c.repos.bad.error.kind')" "transient"
same "...while the repo after it still refreshes"      "$(bq "$S4" 'c.repos.alpha.error')" "null"
same "...with a fresh fetchedAt of its own"            "$(bq "$S4" 'c.repos.alpha.fetchedAt > 0')" "true"

# A repo-level auth (the token expired mid-life) is the whole-dashboard signal too,
# recorded per repo, previous PRs kept (DESIGN 2.7/2.n).
echo auth > "$BBMODE"
waituntil 10 "an auth pass in the cache" \
  bqtrue "$S4" '!!c.repos.alpha.error && c.repos.alpha.error.kind==="auth"'
same "a repo auth failure classifies as auth"     "$(bq "$S4" 'c.repos.alpha.error.kind')" "auth"
same "...and still keeps the previous PRs"         "$(bq "$S4" 'c.repos.alpha.prs.length')" "1"

echo ok > "$BBMODE"
waituntil 10 "an ok pass clearing the auth error" bqtrue "$S4" 'c.repos.alpha.error===null'
same "a success after a failure clears the error" "$(bq "$S4" 'c.repos.alpha.error')" "null"
# A later tick ran and wrote after passes that threw nothing but returned errors --
# the daemon is still alive behind its window.
same "...which is a later tick running"           "$(bq "$S4" 'c.repos.alpha.fetchedAt > 0')" "true"

# A comment fetch that fails while its PR LIST succeeds keeps that PR's previous
# comments (the same "keep last" the repo level uses), so a blip does not zero a PR's
# thread count and reshuffle the sort for a tick (DESIGN 2.3, 2.n). alpha's list still
# succeeds, so the repo itself is not an error.
echo comment-net > "$BBMODE"
# The cache already reads what the checks want (1 comment, no error), so only the
# log can say a comment-net pass happened -- and it logs before it writes the
# cache. A SECOND such line means the first pass's write is done (one pass at a
# time), and every pass since has been comment-net too.
waitmore "alpha ok, 1 prs, 0 comment fetches" "$A4/daemon.log" 1 10 "two comment-net passes"
same "a dropped comment fetch keeps the PR's previous comments" "$(bq "$S4" 'c.repos.alpha.prs[0].comments.length')" "1"
same "...and the repo itself stays a success"                   "$(bq "$S4" 'c.repos.alpha.error')" "null"
echo ok > "$BBMODE"

# A diffstat fetch that fails while its PR LIST succeeds keeps that PR's previous
# summary triple (the same "keep last", DESIGN 2.4), so a blip does not blink the
# file/line counts out and back. The prior tick cached { files:2, added:10, removed:3 };
# a dropped diffstat call this tick must leave that triple intact, not zero or drop it.
echo diffstat-net > "$BBMODE"
# As for comment-net: the cache already holds the triple, so wait for two passes.
waitmore "alpha ok, 1 prs, 1 comment fetches, 0 diffstat fetches" "$A4/daemon.log" 1 10 "two diffstat-net passes"
same "a dropped diffstat fetch keeps the PR's previous summary: files"   "$(bq "$S4" 'c.repos.alpha.prs[0].diffstatSummary.files')" "2"
same "...added"                                                          "$(bq "$S4" 'c.repos.alpha.prs[0].diffstatSummary.added')" "10"
same "...removed"                                                        "$(bq "$S4" 'c.repos.alpha.prs[0].diffstatSummary.removed')" "3"
same "...and the repo itself stays a success"                            "$(bq "$S4" 'c.repos.alpha.error')" "null"
echo ok > "$BBMODE"

# The in-flight guard (DESIGN 2.9): a second pass entered while one is running starts
# nothing. Unconfiguring drains any pass and gives a clean edge (no staleness window
# to age), then `slow` holds the first repo open while ~3 ticks fire behind it.
# Unconfigured while still `ok`, so a pass caught in flight is a loopback one that
# ends in milliseconds: the drain is a 1s window, where unconfiguring AFTER `slow`
# had to outwait a whole held pass (~4s). Stub hold times are real seconds, so
# neither window is scaled by SPEED.
printf '' > "$S4/bitbucket-repos"    # unconfigure -> passes no-op; any in-flight one drains
sleep 1                              # window: an ok pass in flight ends well inside it
echo slow > "$BBMODE"
: > "$BBHITS"                        # cleared while nothing is fetching
ALPHA_OK="$(countof "alpha ok" "$A4/daemon.log")"
printf 'bad,alpha' > "$S4/bitbucket-repos"   # the next tick starts exactly one pass
sleep 1.5                            # window: under slow's 2s hold, only the FIRST repo is requested
same "a pass entered while one is in flight starts nothing" "$(grep -c '/pullrequests' "$BBHITS")" "1"
echo ok > "$BBMODE"
# The held pass ends when alpha's (still slow) list call returns and it logs alpha.
waitmore "alpha ok" "$A4/daemon.log" "$ALPHA_OK" 10 "the held slow pass to finish"

# daemon.log gets pasted into conversations (DESIGN 2.9).
refute "no PR title ever reaches the log"   "SECRET-PR-TITLE" "$A4/daemon.log"
refute "no credential ever reaches the log" "me@x:tok"        "$A4/daemon.log"

daemon_stop $D4PID; D4PID=""   # waits for death, or it out-ticks D5 below
fi

if section 14d "the dashboard reacts to clicks (tabs, paging, Open)"; then
# bitbucket-dashboard T08. A click in the welcome pane becomes a fixed verb on the cmd
# channel (cockpit-welcome maps the click to a hit-zone; only the verb reaches here,
# so the mouse coordinates themselves stay a hand-check, DESIGN 5.1). The DAEMON owns
# every consequence: a tab switch and a page change rewrite bitbucket-view.json; Open
# spawns the browser via the BITBUCKET_BROWSER seam (DESIGN 2.7, 5.2). Review/Address
# spawn a running agent in the PR's repo (T09, tested below). Reuses the still-running
# BB stub above.
echo ok > "$BBMODE"; : > "$BBHITS"
A6="$T/bb6"; S6="$A6/state"
mkdir -p "$A6" "$S6"
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$S6/panes.json"
: > "$S6/fleet.log"; : > "$S6/cmd"
printf '10 0 sh\n20 0 sh\n30 0 sh\n' > "$A6/panestate"
echo 31 > "$A6/nextpane"; echo 1 > "$A6/nexttab"
echo list > "$A6/fleetstate"
for f in editing titlelag active panecwd psbusy calls.log; do : > "$A6/$f"; done
bbconf "$S6" "alpha"

# The Open button's opener, pointed at a recorder so no real browser launches. It
# records the URL it was handed, which is what the daemon must pull from the cache.
OPENLOG="$A6/opened.log"; : > "$OPENLOG"
cat > "$A6/opener.sh" <<OPENER
#!/bin/sh
printf '%s\n' "\$1" >> "$OPENLOG"
OPENER
chmod +x "$A6/opener.sh"

# Read one value out of bitbucket-view.json; `v` is the parsed view.
vq() {  # vq <state-dir> <expression over v>
  node -e 'const fs=require("fs");let v={};try{v=JSON.parse(fs.readFileSync(process.argv[1]+"/bitbucket-view.json","utf8"));}catch{}let r;try{r=eval(process.argv[2]);}catch(e){r="<error>";}process.stdout.write(String(r===undefined?"undefined":r));' "$1" "$2"
}
vqtrue() { [ "$(vq "$1" "$2")" = true ]; }   # for waituntil, like bqtrue
# bbverb <verb> <what> <condition...>: append a click verb and wait for its effect.
# The daemon handles the cmd channel one line at a time, in order, so a verb whose
# only effect is to do NOTHING (a clamp) is followed by `bb-sync-<n>`, an unknown
# verb the daemon logs and otherwise ignores: once that line is logged, every verb
# before it has been handled.
BBSYNC=0
bbverb() { local v=$1 what=$2; shift 2; echo "$v" >> "$S6/cmd"; waituntil 10 "$what" "$@"; }
bbsync() {
  BBSYNC=$((BBSYNC + 1)); echo "bb-sync-$BBSYNC" >> "$S6/cmd"
  waitfor "unknown verb bb-sync-$BBSYNC" "$A6/daemon.log" 10 "the cmd channel to reach bb-sync-$BBSYNC"
}

d6env() {
  HOME="$T/home" SHELL=/bin/zsh TZ=Europe/Warsaw COCKPIT_OWNER_PID="$$" \
  COCKPIT_DIR="$S6" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$A6/calls.log" FLEETSTATE="$A6/fleetstate" PANESTATE="$A6/panestate" \
  NEXTPANE="$A6/nextpane" NEXTTAB="$A6/nexttab" EDITING="$A6/editing" \
  TITLELAG="$A6/titlelag" ACTIVE="$A6/active" PANECWD="$A6/panecwd" \
  PSBUSY="$A6/psbusy" AGENTS_JSON="$SIDE_AGENTS" \
  BITBUCKET_ORIGIN="$BBORIGIN" COCKPIT_BITBUCKET_TICK_MS="$BB_TICK_MS" \
  BITBUCKET_BROWSER="$A6/opener.sh" \
  "$@"
}
d6env node "$ROOT/bin/cockpitd.mjs" > "$A6/daemon.log" 2>&1 &
D6PID=$!
waituntil 10 "D6's first pass in the cache" bqtrue "$S6" '!!c.repos.alpha && c.repos.alpha.prs.length===1'
# The one PR (id 7) concerns me as a reviewer, so it is on the To-review tab.
same "the dashboard's PR is cached before any click" "$(bq "$S6" 'c.repos.alpha.prs.length')" "1"

# --- tabs: a bb-tab verb rewrites the active tab in the view file (DESIGN 2.8) ---
bbverb bb-tab:mine "the view's tab to be mine" vqtrue "$S6" 'v.tab==="mine"'
same "clicking the Mine tab rewrites the view's active tab" "$(vq "$S6" 'v.tab')" "mine"
bbverb bb-tab:toReview "the view's tab back to toReview" vqtrue "$S6" 'v.tab==="toReview"'
same "clicking To-review switches the active tab back"      "$(vq "$S6" 'v.tab')" "toReview"

# --- Open: the daemon hands the cached PR's htmlUrl to the fake opener (DESIGN 2.7) ---
bbverb bb-open:alpha/7 "the opener to record PR 7's url" grep -qF "https://bitbucket.org/ws/pr/7" "$OPENLOG"
check "clicking Open launches the browser at the PR's htmlUrl" "https://bitbucket.org/ws/pr/7" "$OPENLOG"
# An id not in the cache (a stale click after a refetch) is a safe no-op, not a crash.
CNT_BEFORE="$(wc -l < "$OPENLOG" | tr -d ' ')"
# The no-op's own log line marks it handled: it never spawns, so nothing can follow.
bbverb bb-open:alpha/999 "Open's no-op on alpha/999" grep -qF "bitbucket open: no cached PR alpha/999" "$A6/daemon.log"
same "Open on an absent PR id launches nothing"               "$(wc -l < "$OPENLOG" | tr -d ' ')" "$CNT_BEFORE"
check "...and says so rather than crashing"                   "no cached PR alpha/999" "$A6/daemon.log"
same  "...the daemon is still alive after the no-op"          "$(kill -0 "$D6PID" 2>/dev/null && echo yes || echo no)" "yes"

# --- Review/Address spawn a running agent in the PR's repo (bitbucket-dashboard T09,
# DESIGN 2.8). The daemon types `@{slug} {directive+url}` into the fleet new-session box
# (pane 20 here) and sends a REAL Enter (\r) to submit -- the deliberate inversion of the
# injectReview rule, which swaps \r for \n to leave a review unsent. The PR url is resolved
# from the cache by slug/id, exactly as Open is; an absent id is the same safe no-op.
CR="$(printf '\r')"
: > "$A6/calls.log"
# spawnAgent logs AFTER both sends (text, then Enter).
SPAWNED="$(countof "spawned agent in alpha" "$A6/daemon.log")"
echo bb-review:alpha/7 >> "$S6/cmd"
waitmore "spawned agent in alpha" "$A6/daemon.log" "$SPAWNED" 10 "the Review spawn"
check "a Review click types the review directive + url to the fleet box" \
      "STDIN:@alpha Review Bitbucket PR https://bitbucket.org/ws/pr/7" "$A6/calls.log"
same  "...to the fleet pane (pane 20), twice: the text then the Enter" \
      "$(grep -c -- 'send-text --pane-id 20 --no-paste' "$A6/calls.log")" "2"
same  "...the second send IS a real Enter (a carriage return)" \
      "$(grep -cF -- "STDIN:${CR}" "$A6/calls.log")" "1"
refute "...NOT the \\n an unsent review uses (spawn inverts injectReview)" \
      'STDIN:\n' "$A6/calls.log"
refute "no PR url reaches the log via a spawn (DESIGN 2.9)" \
      "bitbucket.org/ws/pr/7" "$A6/daemon.log"

: > "$A6/calls.log"
SPAWNED="$(countof "spawned agent in alpha" "$A6/daemon.log")"
echo bb-address:alpha/7 >> "$S6/cmd"
waitmore "spawned agent in alpha" "$A6/daemon.log" "$SPAWNED" 10 "the Address spawn"
check "an Address click types the address directive + url to the fleet box" \
      "STDIN:@alpha Address the review comments on Bitbucket PR https://bitbucket.org/ws/pr/7" "$A6/calls.log"
same  "...also submitted with a real Enter (text + Enter = two sends)" \
      "$(grep -c -- 'send-text --pane-id 20 --no-paste' "$A6/calls.log")" "2"

# A stale click (the id refetched away) resolves no url, so it spawns nothing -- the same
# safe no-op Open has, never a crash.
: > "$A6/calls.log"
bbverb bb-review:alpha/999 "Review's no-op on alpha/999" \
  grep -qF "bitbucket review: no cached PR alpha/999" "$A6/daemon.log"
same  "a Review click on an absent PR id types nothing to the fleet box" \
      "$(grep -c -- 'send-text --pane-id 20' "$A6/calls.log")" "0"
# Named by its `review:` prefix: Open's no-op above already logged "no cached PR
# alpha/999", so the bare phrase passed whatever Review did (DESIGN 3.3).
check "...and says so rather than crashing"        "bitbucket review: no cached PR alpha/999" "$A6/daemon.log"
same  "...the daemon is still alive after the no-op" \
      "$(kill -0 "$D6PID" 2>/dev/null && echo yes || echo no)" "yes"

# --- paging: many PRs overflow one page; next walks to the last and clamps (DESIGN 2.5) ---
# 20 PRs at the pane's 40x10 geometry is 10 pages now: each PR is TWO lines PLUS a
# dedicated `────` rule BETWEEN PRs (bitbucket-dashboard-ux T03/DESIGN 2.6 revised). The
# budget: 10 rows, less tabs+header (2) and the pager (1) -> avail 8 -> 2 PRs a page
# (k PRs cost 3k-1 lines; 3k-1 <= 7 -> k=2) -> ceil(20/2)=10. The daemon reads `pages`
# from the model at the live geometry and clamps a click to [1, pages], so a next past
# the end never writes an out-of-range page (the model's own shrink->page-1 reset is separate).
echo many > "$BBMODE"
waituntil 10 "the 20-PR pass in the cache" bqtrue "$S6" 'c.repos.alpha.prs.length===20'
same "the overflowing tab is cached (20 PRs)" "$(bq "$S6" 'c.repos.alpha.prs.length')" "20"
bbverb bb-page:next "page 2" vqtrue "$S6" 'v.page.toReview===2'
same "bb-page:next advances to page 2"        "$(vq "$S6" 'v.page.toReview')" "2"
# Walk the rest of the way to the last page (10).
for n in 3 4 5 6 7 8 9 10; do bbverb bb-page:next "page $n" vqtrue "$S6" "v.page.toReview===$n"; done
same "bb-page:next reaches the last page (10)"  "$(vq "$S6" 'v.page.toReview')" "10"
echo bb-page:next >> "$S6/cmd"; bbsync   # a clamp writes nothing: sync past it
same "bb-page:next past the last page is clamped (stays 10)" "$(vq "$S6" 'v.page.toReview')" "10"
bbverb bb-page:prev "page 9" vqtrue "$S6" 'v.page.toReview===9'
same "bb-page:prev steps back to page 9"      "$(vq "$S6" 'v.page.toReview')" "9"

# Switching tabs lands on page 1 (DESIGN 2.5, user 2026-09-05). To-review is deep in the
# list now, so a hop to Mine and back must reset To-review to page 1 -- not drop you back
# in the middle of a list you switched away from.
bbverb bb-tab:mine "the view's tab to be mine" vqtrue "$S6" 'v.tab==="mine"'
bbverb bb-tab:toReview "the view's tab back to toReview" vqtrue "$S6" 'v.tab==="toReview"'
same "switching away and back resets the tab to page 1" "$(vq "$S6" 'v.page.toReview')" "1"

# daemon.log gets pasted into conversations (DESIGN 2.9): a click path logs no title.
refute "no PR title reaches the log via a click" "PAGED-PR" "$A6/daemon.log"

echo ok > "$BBMODE"
daemon_stop $D6PID; D6PID=""
fi

if section 14b "the bitbucket dashboard: start fills the cache, return refreshes it"; then
: > "$BBHITS"
echo ok > "$BBMODE"
A5="$T/bb5"; S5="$A5/state"
mkdir -p "$A5" "$S5"
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$S5/panes.json"
: > "$S5/fleet.log"
printf '10 0 sh\n20 0 sh\n30 0 sh\n' > "$A5/panestate"
echo 31 > "$A5/nextpane"; echo 1 > "$A5/nexttab"
echo list > "$A5/fleetstate"
for f in editing titlelag active panecwd psbusy calls.log; do : > "$A5/$f"; done
# Configured BEFORE boot, so the one refresh at start-up has work to do and the
# hour-long tick can never be what filled the cache.
bbconf "$S5" "bad,alpha"

d5env() {
  HOME="$T/home" SHELL=/bin/zsh TZ=Europe/Warsaw COCKPIT_OWNER_PID="$$" \
  COCKPIT_DIR="$S5" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$A5/calls.log" FLEETSTATE="$A5/fleetstate" PANESTATE="$A5/panestate" \
  NEXTPANE="$A5/nextpane" NEXTTAB="$A5/nexttab" EDITING="$A5/editing" \
  TITLELAG="$A5/titlelag" ACTIVE="$A5/active" PANECWD="$A5/panecwd" \
  PSBUSY="$A5/psbusy" AGENTS_JSON="$SIDE_AGENTS" \
  BITBUCKET_ORIGIN="$BBORIGIN" COCKPIT_BITBUCKET_TICK_MS=3600000 \
  "$@"
}
d5env node "$ROOT/bin/cockpitd.mjs" > "$A5/daemon.log" 2>&1 &
D5PID=$!
waituntil 10 "the start-up pass in the cache" \
  bqtrue "$S5" '!!c.repos.alpha && c.repos.alpha.fetchedAt>0 && c.meUuid==="ME-UUID"'
check "the start-up trigger fetched a configured repo" "bitbucket start: alpha ok" "$A5/daemon.log"
same  "...and filled the cache"                        "$(bq "$S5" 'c.repos.alpha.fetchedAt > 0')" "true"
same  "...resolving 'me' at start"                     "$(bq "$S5" 'c.meUuid')" "ME-UUID"

# An hour-long tick fetches nothing on its own. Window: 2.5 of the ticks D4 and D6
# run on (BB_TICK_MS), so a tick at the test cadence would have fetched twice.
: > "$BBHITS"
nap 2
same "an hour-long tick has fetched nothing on its own" "$(grep -c '/pullrequests' "$BBHITS")" "0"

# The return to the fleet LIST is the trigger (DESIGN 2.9) -- attach, then step back
# out, which is what makes reconcile call onExit.
# The return's pass must REWRITE the cache: fetchedAt was already > 0 from the start,
# so the check compares against the start pass's stamp (DESIGN 3.3).
FETCHED_START="$(bq "$S5" 'c.repos.alpha.fetchedAt')"
echo "test agent" > "$A5/fleetstate"
waitfor "enter abc12345" "$A5/daemon.log" 10 "D5 to attach the agent"
echo list > "$A5/fleetstate"
waituntil 10 "the return's pass in the cache" bqtrue "$S5" "c.repos.alpha.fetchedAt > $FETCHED_START"
check "the return to the fleet list refreshed the repos" "bitbucket returned: alpha ok" "$A5/daemon.log"
same  "...and the cache was rewritten"                   "$(bq "$S5" "c.repos.alpha.fetchedAt > $FETCHED_START")" "true"

daemon_stop $D5PID; D5PID=""
kill $BBPID 2>/dev/null; BBPID=""
fi

if section 14c "the new bitbucket seams are fenced"; then
# FINDINGS 2026-08-28 (agenda): every test seam gets a guard, or a later edit points
# the real daemon at the real BitBucket and the suite still passes on a connected
# machine. `grep -v grep` drops the guard lines themselves.
same "every cockpitd in this suite is pointed at loopback (bitbucket)" \
     "$(grep -F 'BITBUCKET_ORIGIN=' "$HERE/run.sh" | grep -v grep | grep -vcE 'BITBUCKET_ORIGIN="(\$BBORIGIN|http://127\.0\.0\.1)')" "0"
same "no line in this suite names the real bitbucket host" \
     "$(grep -E 'api\.bitbucket\.org' "$HERE/run.sh" | grep -vc grep)" "0"
# The tick seam is test-only. Unset, the daemon must be on the number DESIGN 2.9
# states -- so the default is asserted in the source, not trusted.
same "the bitbucket tick defaults to 60s" \
     "$(grep -c 'COCKPIT_BITBUCKET_TICK_MS) || 60_000' "$ROOT/bin/cockpitd.mjs")" "1"
fi
}  # run_dashboard

run_usage() {
late_same
# --- the usage chain (15): the pir usage feed, pir-usage-reader T03 ------------
# Modelled on the agenda chain: its own daemon, its own state dir and wezterm-stub
# files, a loopback stand-in for pir's service printing `PORT n`, a mode file and a
# hits file. The daemon's PIR_HOME is the chain's own scratch home; the api.json in
# it is the only thing that names the stand-in (DESIGN 2.1).
U="$T/usage"; US="$U/state"; UPH="$U/pir-home"
mkdir -p "$US" "$UPH/.pir"
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$US/panes.json"
: > "$US/fleet.log"
printf '10 0 sh\n20 0 sh\n30 0 sh\n' > "$U/panestate"
echo 31 > "$U/nextpane"; echo 1 > "$U/nexttab"
echo list > "$U/fleetstate"
for f in editing titlelag active panecwd psbusy calls.log; do : > "$U/$f"; done
UHITS="$U/hits.log"; : > "$UHITS"
UMODE="$U/mode"; echo ok > "$UMODE"
UREADING="$U/reading.json"
ULOG="$U/daemon.log"
# The usage tick has its own env seam, not scaled by COCKPIT_TIME_SCALE, so it is
# scaled here exactly as the agenda's is: `nap 0.8` is one tick at any SPEED.
USAGE_TICK_MS="$(awk -v s="$SPEED" 'BEGIN{ v=800*s; if (v<50) v=50; printf "%d", v }')"

cat > "$U/pirstub.mjs" <<'PSTUB'
import http from "node:http";
import fs from "node:fs";
// argv: mode file, hits file, reading file. The mode is read per request, so one
// long-lived daemon is walked through every state in turn.
const [, , MODE, HITS, READING] = process.argv;
const mode = () => { try { return fs.readFileSync(MODE, "utf8").trim(); } catch { return "ok"; } };
const server = http.createServer((req, res) => {
  fs.appendFileSync(HITS, `${req.method} ${req.url}\n`);
  const m = mode();
  if (m === "hang") return;                       // never answers: the 2 s limit's case
  res.setHeader("content-type", "application/json");
  if (m === "500") { res.statusCode = 500; return res.end('{"error":"boom"}'); }
  if (m === "nulls") return res.end('{"version":1,"observed_at":null,"rate_limits":null}');
  res.end(fs.readFileSync(READING, "utf8"));
});
server.listen(0, "127.0.0.1", () => console.log(`PORT ${server.address().port}`));
PSTUB
ustub_start() {   # start the stand-in; sets USPID and UPORT
  : > "$U/pirstub.out"
  node "$U/pirstub.mjs" "$UMODE" "$UHITS" "$UREADING" > "$U/pirstub.out" 2>&1 &
  USPID=$!
  waituntil 10 "the pir stand-in to listen" grep -q '^PORT ' "$U/pirstub.out"
  UPORT="$(sed -n 's/^PORT //p' "$U/pirstub.out" | head -1)"
}
# api.json as pir writes it: temp-then-rename, so the daemon never reads half a file.
uapi() {  # uapi <pid>
  printf '{"version":1,"url":"http://127.0.0.1:%s","pid":%s}\n' "$UPORT" "$1" > "$UPH/.pir/api.json.tmp"
  mv "$UPH/.pir/api.json.tmp" "$UPH/.pir/api.json"
}
ureading() {  # ureading <observed_at ms> <5h %> <7d %>
  printf '{"version":1,"observed_at":%s,"rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":%s},"seven_day":{"used_percentage":%s,"resets_at":%s}}}\n' \
    "$1" "$2" "$UR5" "$3" "$UR7" > "$UREADING.tmp"
  mv "$UREADING.tmp" "$UREADING"
}
# One value out of usage-cache.json; `c` is the parsed file, null when absent.
ucq() {
  node -e 'let c=null;try{c=JSON.parse(require("fs").readFileSync(process.argv[1]+"/usage-cache.json","utf8"));}catch{}let v;try{v=eval(process.argv[2]);}catch{v="<error>";}process.stdout.write(String(v))' "$US" "$1"
}
# inode and mtime in ms: "the daemon did not touch the file" is both unchanged.
ustat() { node -e 'try{const s=require("fs").statSync(process.argv[1]);process.stdout.write(s.ino+" "+s.mtimeMs)}catch{process.stdout.write("none")}' "$US/usage-cache.json"; }
uhits() { grep -c . "$UHITS"; }
uhits_ge() { [ "$(uhits)" -ge "$1" ]; }
ulines() { grep -cxE '.* usage: pir service '"$1" "$ULOG"; }
ulines_ge() { [ "$(ulines "$1")" -ge "$2" ]; }   # a poll condition: re-counted every try
ucache_at() { [ "$(ucq 'c&&c.writtenAt')" = "$1" ]; }

uenv() {
  HOME="$T/home" PIR_HOME="$UPH" SHELL=/bin/zsh COCKPIT_OWNER_PID="$$" \
  COCKPIT_DIR="$US" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$U/calls.log" FLEETSTATE="$U/fleetstate" PANESTATE="$U/panestate" \
  NEXTPANE="$U/nextpane" NEXTTAB="$U/nexttab" EDITING="$U/editing" \
  TITLELAG="$U/titlelag" ACTIVE="$U/active" PANECWD="$U/panecwd" \
  PSBUSY="$U/psbusy" AGENTS_JSON="$SIDE_AGENTS" \
  AGENDA_ORIGIN="http://127.0.0.1:9" COCKPIT_USAGE_TICK_MS="$USAGE_TICK_MS" \
  "$@"
}

# The footer, rendered once on the daemon's own state dir (section 12b's capture,
# its helpers being the footer chain's and so not visible here).
UMOUSE_ON=$'\033[?1006h'
UCAP="$U/strip-cap"; UPLAIN="$U/strip-plain"
ustrip() {  # ustrip <cols>
  local p
  : > "$UCAP"
  ( COCKPIT_DIR="$US" COLUMNS="$1" node "$ROOT/bin/cockpit-strip.mjs" footer > "$UCAP" 2>&1 ) &
  p=$!
  waituntil 10 "the footer to draw a frame" grep -qF -- "$UMOUSE_ON" "$UCAP"
  kill "$p" 2>/dev/null; wait "$p" 2>/dev/null
  node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,""))' "$UCAP" > "$UPLAIN"
}

if section 15 "the pir usage feed: the daemon polls pir's service into the cache"; then
NOWMS=$(node -e 'process.stdout.write(String(Date.now()))')
UR5=$(( NOWMS / 1000 + 3600 )); UR7=$(( NOWMS / 1000 + 3 * 86400 ))
R1=$(( NOWMS - 60000 )); SEED=$(( NOWMS - 40000 )); R2=$(( NOWMS - 20000 ))
ustub_start
uenv node "$ROOT/bin/cockpitd.mjs" > "$ULOG" 2>&1 &
DUPID=$!
waituntil 10 "the usage daemon to boot" test -s "$U/calls.log"
# No api.json: two and a half ticks, and the feature is invisible.
nap 2
same "no api.json: no usage: line in the log"     "$(grep -c 'usage:' "$ULOG")" "0"
same "...and no usage-cache.json"                 "$([ -e "$US/usage-cache.json" ] && echo yes || echo no)" "no"
same "...and nothing asked the stand-in"          "$(uhits)" "0"

# A reading appears: written with observed_at as writtenAt, one ok line.
ureading "$R1" 50 60
uapi $$
waituntil 10 "the daemon to write the stand-in's reading" ucache_at "$R1"
same "the cache holds the reading at writtenAt = observed_at" "$(ucq 'c.writtenAt')" "$R1"
same "...with its numbers"                        "$(ucq 'c.fiveHour.usedPct+"/"+c.sevenDay.usedPct')" "50/60"
same "...and the log says ok once"                "$(ulines ok)" "1"

# The same reading three more ticks: polled, never rewritten, never re-logged.
ST=$(ustat); H=$(uhits)
waituntil 10 "three more polls of the same reading" uhits_ge $(( H + 3 ))
same "the same reading leaves the file alone (inode, mtime)" "$(ustat)" "$ST"
same "...still one ok line"                       "$(ulines ok)" "1"

# A newer tap write survives the older pir reading (newest wins, DESIGN 2.3).
printf '{"writtenAt":%s,"fiveHour":{"usedPct":11,"resetsAt":%s},"sevenDay":{"usedPct":22,"resetsAt":%s}}\n' \
  "$SEED" "$UR5" "$UR7" > "$US/usage-cache.json.seed"
mv "$US/usage-cache.json.seed" "$US/usage-cache.json"
H=$(uhits)
waituntil 10 "three polls against the seeded cache" uhits_ge $(( H + 3 ))
same "a newer tap reading survives three polls"   "$(ucq 'c.writtenAt+" "+c.fiveHour.usedPct')" "$SEED 11"

# The stand-in moves on: the cache follows within a tick.
ureading "$R2" 97 77
waituntil 5 "the cache to follow the newer reading" ucache_at "$R2"
same "a newer pir reading replaces the cache"     "$(ucq 'c.writtenAt+" "+c.fiveHour.usedPct+"/"+c.sevenDay.usedPct')" "$R2 97/77"

# End to end: the real footer draws the pir-fed reading, fresh.
ustrip 200
check  "the footer draws the pir reading's 5h"    "5h 97%" "$UPLAIN"
check  "...and its 7d"                            "7d 77%" "$UPLAIN"
refute "...not dimmed"                            "$(printf '\033[2m5h')" "$UCAP"
refute "...with no as-of stamp"                   "as of" "$UPLAIN"

# 500 for three ticks: one line, cache untouched.
ST=$(ustat); H=$(uhits)
echo 500 > "$UMODE"
waituntil 10 "three polls answered 500" uhits_ge $(( H + 3 ))
same "a 500 logs http 500 once"                   "$(ulines 'http 500')" "1"
same "...and leaves the cache alone"              "$(ustat)" "$ST"

# The stand-in stops: unreachable, once.
daemon_stop $USPID; USPID=""
waituntil 10 "the daemon to log unreachable" grep -qF 'usage: pir service unreachable' "$ULOG"
nap 2
same "a stopped service logs unreachable once"    "$(ulines unreachable)" "1"

# A stale api.json naming a dead pid: no request at all.
ustub_start
( : ) & DEADPID=$!; wait "$DEADPID" 2>/dev/null
echo ok > "$UMODE"
H=$(uhits)
uapi "$DEADPID"
waituntil 10 "the daemon to log dead" grep -qF 'usage: pir service dead' "$ULOG"
nap 2
same "a dead pid logs dead once"                  "$(ulines dead)" "1"
same "...and sends nothing to the port"           "$(uhits)" "$H"

# Service up with nothing to report: empty, cache untouched.
ST=$(ustat)
echo nulls > "$UMODE"
uapi $$
waituntil 10 "the daemon to log empty" grep -qF 'usage: pir service empty' "$ULOG"
H=$(uhits); waituntil 10 "two more polls of the nulls" uhits_ge $(( H + 2 ))
same "a nulls body logs empty once"               "$(ulines empty)" "1"
same "...and leaves the cache alone"              "$(ustat)" "$ST"

# Back to a reading: the feed's return is logged too.
echo ok > "$UMODE"
waituntil 10 "the daemon to log ok again" ulines_ge ok 2
H=$(uhits); waituntil 10 "two more polls" uhits_ge $(( H + 2 ))
same "the feed coming back logs one more ok"      "$(ulines ok)" "2"

# A service that never answers holds neither the daemon nor the next poll.
echo hang > "$UMODE"
H=$(uhits)
waituntil 10 "the hung request to arrive" uhits_ge $(( H + 1 ))
C=$(countof "ARGV:" "$U/calls.log")
# One unscaled second: the reader's 2 s limit is fixed, so the window that proves
# no second request is sent must sit inside it at any SPEED.
sleep 1
grew "the daemon keeps reconciling while a poll hangs" "ARGV:" "$U/calls.log" "$C"
same "...one poll in flight, not one per tick"    "$(uhits)" "$(( H + 1 ))"
waituntil 10 "the next tick to poll again after the 2 s limit" uhits_ge $(( H + 2 ))
waituntil 5 "the limit to log unreachable" ulines_ge unreachable 2
same "the limit reads as unreachable"             "$(ulines unreachable)" "2"

# End to end, stale: a reading 20 minutes old into an empty cache draws dim.
OLD=$(( $(node -e 'process.stdout.write(String(Date.now()))') - 1200000 ))
rm -f "$US/usage-cache.json"
ureading "$OLD" 97 77
echo ok > "$UMODE"
waituntil 10 "the daemon to write the old reading" ucache_at "$OLD"
ustrip 200
check  "an old pir reading draws dim"             "$(printf '\033[2m5h')" "$UCAP"
check  "...stamped as of"                         "as of" "$UPLAIN"

# Nothing but the state reaches daemon.log (DESIGN 2.5): no url, port or body.
same "the log names no host"                      "$(grep -cE '127\.0\.0\.1|localhost' "$ULOG")" "0"
same "...and no port of the stand-in's"           "$(grep -cF ":$UPORT" "$ULOG")" "0"
same "...and nothing from a body"                 "$(grep -cE 'used_percentage|rate_limits|observed_at|97%|77%' "$ULOG")" "0"
same "every usage line is a bare state"           "$(grep 'usage:' "$ULOG" | grep -vcE 'usage: pir service (ok|empty|dead|unreachable|http 500)$')" "0"

# The fence (DESIGN 5.2): both suites export a scratch PIR_HOME before any daemon.
fence_before() {  # fence_before <file>: the export's line precedes the first daemon start
  local e d
  e=$(grep -nE '^export PIR_HOME="\$T[A-Z0-9]*/' "$1" | head -1 | cut -d: -f1)
  d=$(grep -nF 'cockpitd.mjs" >' "$1" | head -1 | cut -d: -f1)
  [ -n "$e" ] && [ -n "$d" ] && [ "$e" -lt "$d" ] && echo yes || echo no
}
same "cockpit-test exports a scratch PIR_HOME before any daemon" "$(fence_before "$HERE/run.sh")" "yes"
same "daemon-leak-test does too" "$(fence_before "$ROOT/spikes/daemon-leak-test/run.sh")" "yes"
same "the main chain's daemon logs no usage: line" "$(grep -c 'usage:' "$T/daemon.log")" "0"
same "the usage tick defaults to 30s" \
     "$(grep -c 'COCKPIT_USAGE_TICK_MS) || 30_000' "$ROOT/bin/cockpitd.mjs")" "1"

daemon_stop $DUPID $USPID; DUPID=""; USPID=""
fi
}  # run_usage

# --- the dispatch (plans/test-suite-speed DESIGN 3.6, T08) --------------------
#   CONCURRENT=0   run the four chains one after another in this shell, as the
#                  suite always did: for watching a side chain's output live
# By default the footer, agenda and dashboard chains each run in a background
# subshell alongside the main chain. They share nothing with it but the setup
# above (DESIGN 4.1; the fleet they read is $SIDE_AGENTS, a snapshot). Each writes
# its output to $T/chain-<name>.out and, when it finishes, "<pass> <fail>" to
# .count and its section times to .times; the parent prints them in chain order
# after main, so the output reads exactly as a serial run's. A partial run forks
# only the side chains it selected (chain_runs).
side_chain() {   # side_chain <name>: the body of one side chain's subshell
  local c=$1
  pass=0; fail=0; SEC_TIMES=(); SEC_CUR=""
  # Its own daemons AND its own children, stopped however the subshell ends. It
  # does not inherit the parent's EXIT trap, and must not: that one removes $T.
  # The children matter on a Ctrl-C: SIGINT reaches the whole group, this
  # subshell dies of it, but a renderer it backgrounded (strip_frame's) ignores
  # SIGINT as every `&` job does, and once this shell is gone it is reparented to
  # pid 1 where the parent's tree walk over $SIDE_PIDS can no longer find it
  # (measured: 2 of 4 interrupts early in 12c left one running).
  # SIDE_SELF, not $BASHPID in the trap: inside $(...) that names the substitution.
  SIDE_SELF=$BASHPID
  trap 'daemon_stop $(/usr/bin/pgrep -P $SIDE_SELF) $D2PID $D3PID $GPID $D4PID $D5PID $D6PID $BBPID $DUPID $USPID' EXIT
  "run_$c"
  section_close
  printf '%s\n' "${SEC_TIMES[@]}" > "$T/chain-$c.times"
  printf '%s %s\n' "$pass" "$fail" > "$T/chain-$c.count"
}
if [ "${CONCURRENT:-1}" = 0 ]; then
  run_main; run_footer; run_agenda; run_dashboard; run_usage
  section_close
else
  SIDE=()
  for c in footer agenda dashboard usage; do
    chain_runs "$c" || continue
    ( side_chain "$c" ) > "$T/chain-$c.out" 2>&1 &
    SIDE_PIDS="$SIDE_PIDS $!"; SIDE+=("$c")
  done
  run_main
  section_close
  for p in $SIDE_PIDS; do wait "$p"; done
  SIDE_PIDS=""
  for c in "${SIDE[@]}"; do
    cat "$T/chain-$c.out"
    if read -r sp sf < "$T/chain-$c.count" 2>/dev/null; then
      pass=$((pass + sp)); [ "$sf" != 0 ] && fail=1
      while IFS= read -r l; do [ -n "$l" ] && SEC_TIMES+=("$l"); done < "$T/chain-$c.times"
    else
      echo "  FAIL the $c chain did not finish (no $T/chain-$c.count)"; fail=1
    fi
  done
fi

# Every daemon a section started must be gone by now. The main one is otherwise
# stopped only by the EXIT trap, so stop it (and anything still set) first, or the
# tripwire would report it on every run (DESIGN §2.5).
daemon_stop $DPID $D2PID $D3PID $D4PID $D5PID $D6PID; DPID=""; D2PID=""; D3PID=""; D4PID=""; D5PID=""; D6PID=""
if daemon_tripwire "$T"; then okline "no cockpitd of this run is left running"; else fail=1; fi

echo
if [ "$fail" != 0 ]; then echo "FAILURES"; sed -n '1,40p' "$T/daemon.log"
elif [ -n "$PARTIAL" ]; then
  echo "PARTIAL RUN (ONLY=$ONLY): $pass checks passed, ${#SEC_TIMES[@]} sections run. Not the test command."
else echo "ALL PASS ($pass checks)"; fi
if [ -n "${TIMINGS:-}" ]; then
  printf '%s\n' "${SEC_TIMES[@]}"
  awk -v a="$T_START" -v b="${EPOCHREALTIME/,/.}" 'BEGIN{ printf "%7.1fs  total\n", b - a }'
fi
exit $fail
