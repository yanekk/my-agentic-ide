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
#   spikes/cockpit-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# The reader's launch line, in ONE place: the scheme name is asserted in four
# sections (the browse launch, two heals and the worktree rebuild) and a change of
# scheme has to stay a single edit here and a single edit in `viewerCommand`.
MICRO_SCHEME="one-dark"
MICRO_LAUNCH="micro -readonly true -colorscheme $MICRO_SCHEME"

mkdir -p "$T/bin" "$T/state"
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
printf '10 0 sh\n20 0 sh\n30 0 sh\n' > "$PANESTATE"   # diff, fleet, repo shell
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
cat > "$T/bin/ps" <<'PS'
#!/usr/bin/env bash
tty=""
while [ $# -gt 0 ]; do [ "$1" = "-t" ] && { tty="${2:-}"; shift; }; shift; done
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
# 1.0 is the original timing (~119s). The default 0.5 was chosen by sweeping down
# and measuring pass-rate: 0.5 passed every repeat with a steady ~69s (a ~1.7x
# speedup) and kept margin on the timing-sensitive worktree-migration checks
# (section 9c). The speedup is sublinear because fixed costs (node startup,
# subprocess spawns) and a few detach/re-attach waits do NOT scale -- which is what
# protects those checks from going flaky. Re-run the sweep any time with e.g.
# `COCKPIT_TEST_SPEED=0.3 bash run.sh`; go lower and section 9c starts to flake.
SPEED="${COCKPIT_TEST_SPEED:-0.5}"
# nap N: sleep N seconds scaled by SPEED, with a small floor so it never hits zero.
nap() { sleep "$(awk -v b="$1" -v s="$SPEED" 'BEGIN{ v=b*s; if (v<0.05) v=0.05; printf "%.3f", v }')"; }

# --- state -----------------------------------------------------------------
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$T/state/panes.json"
: > "$T/state/fleet.log"

# HOME is redirected so the daemon's stale-socket repair looks for wezterm
# sockets under $T and finds none, rather than relinking the real one.
mkdir -p "$T/home"
# SHELL is pinned so LOGIN_SHELL's basename ("zsh") matches what the ps stub
# reports as an idle terminal's foreground process. COCKPIT_REAP_MS is scaled by
# SPEED like everything else (never below 50ms); COCKPIT_TIME_SCALE scales the
# daemon's own poll/debounce/settle constants to match the naps below.
REAP_MS="$(awk -v s="$SPEED" 'BEGIN{ v=700*s; if (v<50) v=50; printf "%d", v }')"
HOME="$T/home" COCKPIT_DIR="$T/state" COCKPIT_REAP_MS="$REAP_MS" \
    COCKPIT_TIME_SCALE="$SPEED" SHELL=/bin/zsh \
    node "$ROOT/bin/cockpitd.mjs" > "$T/daemon.log" 2>&1 &
DPID=$!
trap 'kill $DPID 2>/dev/null; rm -rf "$T"' EXIT
sleep 1   # node startup is fixed overhead -- not scaled by SPEED

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
# waitfor <pattern> <file> <seconds>: poll until it shows up. Where the daemon
# announces what it did, waiting for the announcement beats sleeping a guess --
# and a wait that ENDS at a known moment is what makes the cooldown checks below
# measure a window rather than a race.
waitfor() {
  local i=0 lim
  lim=$(awk -v s="$3" 'BEGIN{ printf "%d", s * 10 }')
  while [ "$i" -lt "$lim" ]; do
    grep -qF -- "$1" "$2" && return 0
    sleep 0.1; i=$((i + 1))
  done
  return 1
}
# The daemon's log is cumulative, so a heal that has happened once already makes
# `check` pass without the daemon doing anything at all. Where the same line is
# expected AGAIN, the assertion is on its COUNT against a baseline taken first.
countof() { grep -cF -- "$1" "$2"; }
grew() {     # grew <description> <pattern> <file> <baseline>
  local n; n=$(countof "$2" "$3")
  if [ "${n:-0}" -gt "$4" ]; then okline "$1"
  else echo "  FAIL $1"; echo "       [$2] appears $n times, expected more than $4"; fail=1; fi
}
waitmore() { # waitmore <pattern> <file> <baseline> <seconds>
  local i=0 lim n
  lim=$(awk -v s="$4" 'BEGIN{ printf "%d", s * 10 }')
  while [ "$i" -lt "$lim" ]; do
    n=$(countof "$1" "$2")
    [ "${n:-0}" -gt "$3" ] && return 0
    sleep 0.1; i=$((i + 1))
  done
  return 1
}

echo
echo "== 1. attach: panes retargeted =="
# The pane now shows an agent; the log line is only a nudge to reconcile sooner.
echo "test agent" > "$FLEETSTATE"
echo '[DEBUG] [FV-attach] respawnJob abc12345: ok=false alive=true' >> "$T/state/fleet.log"
nap 3

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

echo
echo "== 2. review flushed: typed into the fleet pane, unsent =="
: > "$CALLS"
printf '## tracked.txt:2 (+)\nthis allocates in a loop\n' > "$T/state/review-abc12345.md"
nap 1.5

check "sent to the FLEET pane"                   "--pane-id 20" "$CALLS"
check "annotation text present"                  "this allocates in a loop" "$CALLS"
check "sent raw (editable), not as a chip"       "--no-paste" "$CALLS"
refute "no carriage return in payload"           '\r' "$CALLS"

echo
echo "== 3. detach: injection refused while the fleet list is showing =="
echo list > "$FLEETSTATE"
echo '[DEBUG] [FV-attach] attachJob returned after 2020ms — remounting list' >> "$T/state/fleet.log"
nap 2
: > "$CALLS"
printf '## tracked.txt:9 (+)\nSHOULD NOT BE SENT\n' >> "$T/state/review-abc12345.md"
nap 1.5

# Nothing reaches the fleet pane once the list is showing. Two independent
# mechanisms enforce this and only the first is exercised here: watchers are torn
# down on detach, so injectReview is never called. The `attached` guard inside
# injectReview is deliberate belt-and-braces for any path that slips past that.
refute "nothing typed after detach"              "SHOULD NOT BE SENT" "$CALLS"
check  "detach was processed"                    "exit abc12345" "$T/daemon.log"
refute "no stray git errors in the log"          "fatal:" "$T/daemon.log"

echo
echo "== 3b. a SECOND flush injects too (atomic rename must not kill the watch) =="
# revdiff flushes by writing a temp file and renaming it over the target, so the
# path gets a new inode each time. Watching the file rather than its directory
# fired once and then watched a deleted inode forever -- the second O did nothing.
echo "test agent" > "$FLEETSTATE"          # re-attach
nap 2
: > "$CALLS"
printf '## a.txt:1 (+)\nfirst flush\n' > "$T/state/tmp.$$" \
    && mv "$T/state/tmp.$$" "$T/state/review-abc12345.md"
nap 1.5
check "first flush injected"                     "first flush" "$CALLS"

: > "$CALLS"
printf '## a.txt:1 (+)\nfirst flush\n## b.txt:2 (+)\nsecond flush\n' > "$T/state/tmp2.$$" \
    && mv "$T/state/tmp2.$$" "$T/state/review-abc12345.md"
nap 1.5
check "second flush injected after rename"       "second flush" "$CALLS"

: > "$CALLS"
touch "$T/state/review-abc12345.md"        # same content, new mtime = new gesture
nap 1.5
check "re-flushing identical content injects"    "second flush" "$CALLS"

echo
echo "== 4. switch A→B with NO log line: the pane itself is the signal =="
: > "$CALLS"
echo "second agent" > "$FLEETSTATE"     # nothing appended to fleet.log
nap 3

check "followed to the second agent's worktree"  "cd \"$WT2\"" "$CALLS"
check "resolved it by the name in the header"    "enter def67890" "$T/daemon.log"
check "review file re-keyed to the new job"      "review-def67890.md" "$CALLS"
refute "did not stay on the first worktree"      "cd \"$WT\" " "$CALLS"
check "first agent's diff parked, not killed"    "move-pane-to-new-tab --pane-id 31" "$CALLS"
check "first agent's terminal parked, not killed" "move-pane-to-new-tab --pane-id 32" "$CALLS"
check "second agent got its own diff pane"       "opened diff pane 33" "$T/daemon.log"
check "second agent got its own terminal"        "--cwd $WT2 --" "$CALLS"
refute "nothing was killed on a switch"          "kill-pane" "$CALLS"

echo
echo "== 4b. the PARKED agent's diff keeps following its worktree =="
# This is what stops a restored pane from being a snapshot of whenever you last
# looked at it: the first agent's watcher is still running, so its revdiff
# reloads while it sits in a background tab.
: > "$CALLS"
: > "$T/state/review-abc12345.md"          # nothing flushed, so reloading is allowed
echo "more work by the agent" >> "$WT/tracked.txt"
nap 3

check "a reload was sent"                        'STDIN:R\n' "$CALLS"
check "...to the first agent's PARKED pane"      "send-text --pane-id 31 --no-paste" "$CALLS"
refute "...and not to the visible one"           "send-text --pane-id 33 --no-paste" "$CALLS"

echo
echo "== 4c. nothing is typed into a pane whose annotation editor is open =="
# revdiff reads every keystroke as comment text while the editor is up, so an
# auto-reload R would be typed INTO the comment -- unseen, in a parked pane.
: > "$CALLS"
echo 31 > "$EDITING"
echo "yet more work" >> "$WT/tracked.txt"
nap 3

refute "no reload while a comment is half-typed" "send-text --pane-id 31 --no-paste" "$CALLS"
check  "and the daemon said why"                 "annotation editor is open" "$T/daemon.log"
: > "$EDITING"

echo
echo "== 5. switching BACK restores both panes (the whole point) =="
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
nap 3

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

echo
echo "== 5b. ⌥] with the diff pane focused switches the diff MODE, not a terminal =="
# The same keys cycle terminals when a terminal is focused and diff modes when the
# diff pane is. Focus is read from the cockpit tab's active pane (is_active).
: > "$CALLS"
echo 31 > "$ACTIVE"                       # focus the agent's diff pane (31)
echo next >> "$T/state/cmd"
nap 2

check "the running revdiff was quit first"       "STDIN:q\n" "$CALLS"
check "revdiff relaunched in the last-commit range" "revdiff --wrap --no-confirm-discard -o \"$T/state/review-abc12345.md\" HEAD~1 HEAD" "$CALLS"
check "...in the agent's OWN diff pane"           "send-text --pane-id 31" "$CALLS"
check "this agent's mode is now last-commit"      '"diffMode":"lastcommit"' "$T/state/terminals.json"
check "the switch was logged"                     "relaunched diff pane 31 for abc12345 in lastcommit" "$T/daemon.log"

echo
echo "== 5b'. toggling again returns to the uncommitted range =="
: > "$CALLS"
echo prev >> "$T/state/cmd"
nap 2
check "back to HEAD -> working tree"              "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"
check "this agent's mode is back to uncommitted"  '"diffMode":"uncommitted"' "$T/state/terminals.json"

echo
echo "== 5c. ⌥] with a TERMINAL focused leaves the diff mode alone =="
# Focus routing must not fire the diff switch when the reviewer is in a terminal.
: > "$CALLS"
echo 32 > "$ACTIVE"                       # focus the agent's terminal, not the diff
echo next >> "$T/state/cmd"
nap 2
refute "the diff was not relaunched"              "HEAD~1 HEAD" "$CALLS"
check  "the mode is untouched"                    '"diffMode":"uncommitted"' "$T/state/terminals.json"

echo
echo "== 5c'. a revdiff flush (O) jumps focus to the agent's Claude pane =="
# revdiff's flush key IS O, so it can no longer be a WezTerm binding (that stole
# the key and stopped the flush). Instead --post-flush-command appends focus-claude
# after a successful flush, and the daemon activates the fleet/Claude pane (20) --
# where injectReview has just typed the review. No focus gate: only a real flush
# emits this.
: > "$CALLS"
echo 32 > "$ACTIVE"                       # even from the terminal (the verb only ever comes from revdiff)
echo focus-claude >> "$T/state/cmd"
nap 2
check "focus moved to the Claude (fleet) pane"    "activate-pane --pane-id 20" "$CALLS"
refute "did NOT focus the shell pane"             "activate-pane --pane-id 32" "$CALLS"

echo
echo "== 5c''. revdiff is launched with the focus-claude post-flush command =="
# The flush->focus jump rides on revdiff's own --post-flush-command, not a keybind.
: > "$CALLS"
echo 31 > "$ACTIVE"                       # focus the diff pane
echo next >> "$T/state/cmd"               # uncommitted -> last-commit forces a relaunch
nap 2
check "revdiff carries the post-flush hook"       "--post-flush-command \"echo focus-claude >> $T/state/cmd\"" "$CALLS"
echo prev >> "$T/state/cmd"               # back to uncommitted, restoring state for later sections
nap 2
: > "$ACTIVE"                             # unfocus for the remaining sections

echo
echo "== 5d. cycling into Custom opens the ASCII prompt, unset revdiff until answered =="
# Custom asks for a branch/SHA every time you cycle in (pre-filled per agent).
# The daemon quits revdiff and types the prompt script into the SAME pane; it
# does NOT launch revdiff until the answer comes back through the cmd channel.
# Two steps forward, because BROWSE is now the fourth stop and sits between
# custom and uncommitted -- one `prev` from uncommitted lands on browse (11 below).
echo 31 > "$ACTIVE"                       # focus the diff pane
echo next >> "$T/state/cmd"               # uncommitted -> lastcommit
nap 2
: > "$CALLS"
echo next >> "$T/state/cmd"               # lastcommit -> custom
nap 2
check "the running revdiff was quit first"        "STDIN:q\n" "$CALLS"
check "the custom-range prompt was launched"      "cockpit-custom-prompt.mjs" "$CALLS"
check "...in the agent's OWN diff pane"           "send-text --pane-id 31" "$CALLS"
check "this agent's mode is now custom"           '"diffMode":"custom"' "$T/state/terminals.json"
refute "revdiff is NOT relaunched yet"            "revdiff --wrap" "$CALLS"

echo
echo "== 5d'. answering the prompt launches revdiff against that ref, persisted per agent =="
# The prompt writes the chosen ref + a custom-ok verb (here we stand in for it).
: > "$CALLS"
printf '{"jobId":"abc12345","ref":"main"}' > "$T/state/custom-ref-pending"
echo custom-ok >> "$T/state/cmd"
nap 2
check "revdiff diffs the given ref -> working tree" "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" \"main\"" "$CALLS"
check "...in the agent's OWN diff pane"            "send-text --pane-id 31" "$CALLS"
check "the per-agent ref was persisted"           "\"abc12345\":\"main\"" "$T/state/custom-refs.json"
check "the base was set was logged"               "custom range set for abc12345: main" "$T/daemon.log"

echo
echo "== 5d''. cancelling the prompt reverts to the previous mode =="
# Leave custom (backwards, to last-commit -- forwards is browse now), then cycle
# back in so the prompt opens with last-commit as the mode to fall back to, and
# answer with a cancel.
echo prev >> "$T/state/cmd"               # custom -> lastcommit
nap 2
: > "$CALLS"
echo next >> "$T/state/cmd"               # lastcommit -> custom, opens the prompt again
nap 2
check "the prompt opened again"                   "cockpit-custom-prompt.mjs" "$CALLS"
: > "$CALLS"
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
echo custom-cancel >> "$T/state/cmd"
nap 2
check "cancel reverted to the prior mode"         '"diffMode":"lastcommit"' "$T/state/terminals.json"
check "and revdiff came back in that range"       "revdiff --wrap --no-confirm-discard -o \"$T/state/review-abc12345.md\" HEAD~1 HEAD" "$CALLS"
echo prev >> "$T/state/cmd"               # back to the uncommitted default for 5e
nap 2

echo
echo "== 5e. the diff mode is PER AGENT: a new agent is never carried into another's mode =="
# Put this agent in last-commit, switch to the OTHER agent, and it must come up
# in the uncommitted default -- not inherit last-commit. (Its parked revdiff was
# launched uncommitted and comes back untouched.)
echo 31 > "$ACTIVE"                       # focus abc12345's diff pane
echo next >> "$T/state/cmd"               # uncommitted -> last-commit for abc12345 only
nap 2
check "this agent went to last-commit"            '"diffMode":"lastcommit"' "$T/state/terminals.json"
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"       # switch to def67890
nap 3
check "the OTHER agent shows the uncommitted default" '"diffMode":"uncommitted"' "$T/state/terminals.json"
refute "it did NOT inherit last-commit"           "HEAD~1 HEAD" "$CALLS"

echo
echo "== 5e'. switching back leaves abc12345 in its own last-commit, then reset =="
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"         # back to abc12345
nap 3
check "abc12345 kept its own last-commit mode"    '"diffMode":"lastcommit"' "$T/state/terminals.json"
# Reset to the uncommitted default so the later sections see the default range.
echo 31 > "$ACTIVE"
echo prev >> "$T/state/cmd"               # last-commit -> uncommitted
nap 2
check "reset to the uncommitted default"          '"diffMode":"uncommitted"' "$T/state/terminals.json"
: > "$ACTIVE"                             # unfocus for the remaining sections; back at the uncommitted default

echo
echo "== 5f. clicking a diff-mode label switches the mode regardless of focus =="
# The footer appends `diff-<mode>` to the cmd channel when a label is clicked.
# Unlike ⌥[/⌥], a click names the mode outright and must NOT depend on which pane
# is focused -- the click landed on the footer, not the diff pane. $ACTIVE is left
# empty so no pane reads as the focused diff pane, proving focus-independence.
: > "$CALLS"; : > "$ACTIVE"
echo diff-lastcommit >> "$T/state/cmd"
nap 2
check "clicked label switched to last-commit while unfocused" "revdiff --wrap --no-confirm-discard -o \"$T/state/review-abc12345.md\" HEAD~1 HEAD" "$CALLS"
check "the mode reflects the clicked label"       '"diffMode":"lastcommit"' "$T/state/terminals.json"

: > "$CALLS"
echo diff-uncommitted >> "$T/state/cmd"
nap 2
check "clicking Uncommitted returns to that range" "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"
check "the mode is back to uncommitted"           '"diffMode":"uncommitted"' "$T/state/terminals.json"

: > "$CALLS"
echo diff-uncommitted >> "$T/state/cmd"           # clicking the ALREADY-active label
nap 2
refute "clicking the active label relaunches nothing" "revdiff --wrap" "$CALLS"

echo
echo "== 5f'. clicking Custom always (re)opens the ref prompt =="
# Matches "cycling into custom always re-prompts": a click on Custom pops the
# prompt so the base ref can be entered (or changed), and revdiff is not
# relaunched until the answer comes back.
: > "$CALLS"
echo diff-custom >> "$T/state/cmd"
nap 2
check "clicking Custom opened the ref prompt"     "cockpit-custom-prompt.mjs" "$CALLS"
check "the mode is now custom"                    '"diffMode":"custom"' "$T/state/terminals.json"
refute "revdiff is NOT relaunched until answered" "revdiff --wrap" "$CALLS"
# Cancel so state is clean and later sections see the uncommitted default again.
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
echo custom-cancel >> "$T/state/cmd"
nap 2
check "cancel reverted to the uncommitted default" '"diffMode":"uncommitted"' "$T/state/terminals.json"

echo
echo "== 5g. the strip's [+ add] and [x] buttons manage terminals by number =="
# The strip appends `new` ([+ add]) and `close-<n>` (a terminal's [x]) to the cmd
# channel; like 5f these name the action outright, so they are driven here by
# writing the verb directly (the click->verb mapping itself needs a real WezTerm
# pointer and is verified by hand). abc12345 is attached with its one terminal.
# Every open/close below is of a FRESH pane -- the agent's original terminal (32,
# leaned on by later sections) is never the one killed -- so the section nets to
# zero and leaves that one terminal exactly as it found it.
: > "$CALLS"
echo new >> "$T/state/cmd"                        # [+ add]
nap 2
check "[+ add] opened a second terminal"          '"n":2' "$T/state/terminals.json"
check "opening a terminal was logged"             "opened terminal pane" "$T/daemon.log"

# close-2 targets the terminal ON SCREEN (the one just added, now current): the
# slot-dance path brings the original sibling back before killing the new one.
: > "$CALLS"
echo close-2 >> "$T/state/cmd"
nap 2
check "[x] on the on-screen terminal closed it"   "closed terminal pane" "$T/daemon.log"
refute "one terminal left after closing #2"       '"n":2' "$T/state/terminals.json"

# Add another, switch BACK to #1, then close-2 -- terminal #2 is now PARKED (not on
# screen), so the no-slot-dance path just kills it and keeps #1 shown. ($ACTIVE is
# empty, so `prev` cycles terminals, not the diff mode.)
: > "$CALLS"
echo new >> "$T/state/cmd"
nap 2
check "a second terminal is open again"           '"n":2' "$T/state/terminals.json"
echo prev >> "$T/state/cmd"                        # show terminal #1, parking #2
nap 2
: > "$CALLS"
echo close-2 >> "$T/state/cmd"
nap 2
check "[x] on a PARKED terminal closed it"        "closed parked terminal pane" "$T/daemon.log"
refute "back to one terminal"                     '"n":2' "$T/state/terminals.json"

# The last terminal has no [x] in the strip, but a stray close-<n> must still be
# refused -- the slot must always hold a terminal (mirrors ⌥w).
: > "$CALLS"
echo close-1 >> "$T/state/cmd"
nap 2
refute "closing the last terminal killed nothing" "kill-pane" "$CALLS"
check "refusing to close the last was logged"     "refusing to close the last terminal" "$T/daemon.log"

echo
echo "== 5g'. clicking a terminal's label selects it (select-<n>) =="
# The strip appends `select-<n>` when a terminal's label area (not its [x]) is
# clicked -- it shows that terminal outright rather than cycling to it. Driven here
# by the verb directly, like 5g; the pointer->verb mapping needs a real WezTerm and
# is verified by hand. Nets to zero: the fresh pane opened here is closed again, so
# the agent's original terminal (32) is left exactly as found.
: > "$CALLS"
echo new >> "$T/state/cmd"                        # a second terminal, now on screen (#2)
nap 2
check "a second terminal is open"                 '"n":2' "$T/state/terminals.json"

: > "$CALLS"
echo select-1 >> "$T/state/cmd"                   # click terminal #1's label
nap 2
check "selecting #1 was logged"                   "selected terminal pane" "$T/daemon.log"
check "terminal #1 is now active"                 '"n":1,"active":true' "$T/state/terminals.json"
check "terminal #2 is now parked"                 '"n":2,"active":false' "$T/state/terminals.json"

# Selecting the terminal already on screen is a no-op: no slot swap, nothing moves.
: > "$CALLS"
echo select-1 >> "$T/state/cmd"
nap 2
refute "re-selecting the active terminal moved nothing" "move-pane-id" "$CALLS"

# An out-of-range number names no terminal and is refused, not guessed.
: > "$CALLS"
echo select-9 >> "$T/state/cmd"
nap 2
check "an out-of-range select is refused"         "no terminal #9" "$T/daemon.log"
refute "an out-of-range select moved nothing"     "move-pane-id" "$CALLS"

# Bring #2 back and close it, netting the section to zero (leaves terminal 32).
echo select-2 >> "$T/state/cmd"
nap 2
: > "$CALLS"
echo close-2 >> "$T/state/cmd"
nap 2
refute "back to one terminal after 5g'"           '"n":2' "$T/state/terminals.json"

echo
echo "== 6. back to the list: the repo shell returns, agents keep running =="
: > "$CALLS"
echo list > "$FLEETSTATE"
nap 3

check "repo diff pane moved back into the slot"  "--move-pane-id 10" "$CALLS"
check "repo shell moved back into the slot"      "--move-pane-id 30" "$CALLS"
refute "no agent pane was killed on detach"      "kill-pane" "$CALLS"

echo
echo "== 7. an agent that leaves the fleet has BOTH its panes reaped =="
# Two consecutive misses are required, so one bad read cannot kill a shell.
: > "$CALLS"
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$WT","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
nap 3

check "the vanished agent's terminal was killed" "kill-pane --pane-id 34" "$CALLS"
check "the vanished agent's diff pane too"       "kill-pane --pane-id 33" "$CALLS"
check "reaping was logged with the job id"       "agent def67890 is gone" "$T/daemon.log"
refute "the surviving agent kept its terminal"   "kill-pane --pane-id 32" "$CALLS"
refute "the surviving agent kept its diff pane"  "kill-pane --pane-id 31" "$CALLS"
refute "the repo shell is never reaped"          "kill-pane --pane-id 30" "$CALLS"
refute "the repo diff pane is never reaped"      "kill-pane --pane-id 10" "$CALLS"

echo
echo "== 8. a diff pane that dies is rebuilt, at full width =="
# Quit revdiff with `q`, exit the shell, and the pane is gone. Nothing else
# repairs it: the reconcile poll returns early while the same agent is still
# showing, so the slot would sit empty until the next switch.
echo "test agent" > "$FLEETSTATE"
nap 3
: > "$CALLS"
awk '$1 != 31' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
nap 4

check "the loss was noticed"                     "diff pane for abc12345 is gone" "$T/daemon.log"
check "the slot was rebuilt"                     "rebuilt the diff slot" "$T/daemon.log"
# Full width is only possible with the fleet pane alone in the tab, so the
# terminal has to step out of the way and come back.
check "the terminal stepped aside for the rebuild" "move-pane-to-new-tab --pane-id 32" "$CALLS"
check "and was moved back, not respawned"        "--move-pane-id 32" "$CALLS"
check "the full-width split came off the fleet pane" "--top --percent 42 --pane-id 20" "$CALLS"
check "the placeholder was killed, not parked"   "kill-pane" "$CALLS"
check "a fresh diff pane took the slot"          "opened diff pane" "$T/daemon.log"
check "revdiff started in it"                    "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"

echo
echo "== 9. an agent that changed directory drags its idle, untouched terminal along =="
# `claude agents` reports an agent's LIVE cwd, and that migrates: an agent can
# start in the checkout and later create and enter a worktree. A terminal is
# spawned once and only moved between tabs after that, so without help it stays
# frozen at the old directory. On re-attach the daemon cd's the shell forward --
# but only when it is idle AND still sitting where it was spawned (untouched).
echo list > "$FLEETSTATE"; sleep 2

MOVED="$T/moved"; mkrepo "$MOVED"       # where the agent went (its new worktree)
echo "32 file://$WT" > "$PANECWD"         # its terminal (pane 32) is still at $WT
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"; sleep 3

check "the stale idle terminal was cd'd forward"  "cd terminal 32" "$T/daemon.log"
check "logged as an agent directory move"         "agent moved from" "$T/daemon.log"
# The terminal's cd is standalone (`cd "X"` then newline); the diff pane's, when
# revdiff is relaunched, is `cd "X" && revdiff ...`. The trailing \n distinguishes
# the shell being followed from the diff being reloaded.
check "the new dir was typed into the terminal"   'cd "'"$MOVED"'"\n' "$CALLS"

echo
echo "== 9b. a BUSY terminal is left where it is (a cd must not land mid-command) =="
echo list > "$FLEETSTATE"; sleep 2
MOVED2="$T/moved2"; mkrepo "$MOVED2"
echo "32 file://$MOVED" > "$PANECWD"       # 32 is now at $MOVED (untouched), still
echo node > "$PSBUSY"                      # ...but a job is running in it now
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED2","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"; sleep 3

check  "the daemon refused because it was busy"   "busy at" "$T/daemon.log"
refute "the busy shell was NOT cd'd"              'cd "'"$MOVED2"'"\n' "$CALLS"
: > "$PSBUSY"

echo
echo "== 9c. an agent that moves WHILE ATTACHED drags its revdiff along, no re-attach =="
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
# NOT scaled: followWorktreeMigration re-reads the cwd only once per
# MIGRATION_CHECK_MS and spawns `claude` each time, so this wait must clear that
# throttle plus the spawn with margin. Scaled down it shrinks below the throttle
# and the relaunch is missed (measured: flaky at SPEED 0.5). Fixed 3s is cheap.
sleep 3

check  "the mid-attach move was noticed"          "moved worktree" "$T/daemon.log"
check  "revdiff was re-pointed at the new dir"    'cd "'"$MOVED3"'" && revdiff' "$CALLS"
refute "revdiff did not stay on the old dir"      'cd "'"$MOVED2"'" && revdiff' "$CALLS"

echo
echo "== 9d. an agent that moves WHILE PARKED is caught on return, not left stale =="
# followWorktreeMigration only follows the ATTACHED agent. An agent you switched
# AWAY from keeps working and can enter a worktree while its diff pane is parked --
# so its stored launch cwd is compared on return and the parked revdiff (and its
# watch) is relaunched in the new worktree. Here: detach to the list, move the
# agent while it is parked, then re-attach.
MOVED4="$T/moved4"; mkrepo "$MOVED4"     # the watch is re-pointed on return, so it must exist
echo list > "$FLEETSTATE"; sleep 2         # park abc12345's diff (last launched at $MOVED3)
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED4","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"; sleep 3  # re-attach: onEnter sees the parked pane moved

check  "the parked pane was relaunched on return" "relaunched diff pane" "$T/daemon.log"
check  "revdiff came back on the new worktree"    'cd "'"$MOVED4"'" && revdiff' "$CALLS"
refute "revdiff did not come back on the old one" 'cd "'"$MOVED3"'" && revdiff' "$CALLS"

echo
echo "== 10. quitting revdiff is reinstated, never left as a bare shell =="
# Shift+Q discards every annotation and quits (no confirm, thanks to
# --no-confirm-discard); lowercase q just quits. Either way the daemon brings
# revdiff back on the same diff so the top pane is not left at an empty shell.
DP=$(grep -oE '"diff":[0-9]+' "$T/state/panes.json" | grep -oE '[0-9]+')
: > "$CALLS"
# Simulate the quit: the pane falls back to a shell prompt (title no longer
# revdiff), exactly what the daemon sees the moment revdiff exits.
awk -v p="$DP" '{ if ($1 == p) print $1, $2, "sh"; else print }' "$PANESTATE" > "$PANESTATE.q" \
    && mv "$PANESTATE.q" "$PANESTATE"
# NOT scaled: healQuitDiff must fire (its own interval), clear the relaunch
# cooldown, and relaunch. Scaled down this margin got thin and the reinstate was
# occasionally missed. Fixed 3s keeps it reliable at any SPEED.
sleep 3

check "the quit was noticed and revdiff reinstated" "reinstated it" "$T/daemon.log"
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

echo
echo "== 11. ⌥[ from uncommitted lands on BROWSE and launches both halves =="
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
echo prev >> "$T/state/cmd"
nap 3
check  "browse is refused while the annotation editor is open" \
                                                  "not entering browse for abc12345" "$T/daemon.log"
check  "...so the mode is untouched"              '"diffMode":"uncommitted"' "$T/state/terminals.json"
refute "...and nothing was split off the slot"    "split-pane" "$CALLS"
: > "$EDITING"

: > "$CALLS"
echo prev >> "$T/state/cmd"
nap 3

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
                                                  "broot --conf \"$ROOT/bin/cockpit-browse-verbs.hjson" "$CALLS"
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

echo
echo "== 11a. nothing revdiff-shaped is aimed at a browse pane =="
# The worktree watch is still running (it belongs to the agent, not the mode), and
# `R` in broot is a character typed into its filter box, not a reload.
: > "$CALLS"
echo "the agent keeps working" >> "$MOVED4/file.txt"
nap 3
refute "an agent write sends no reload to the browser" "STDIN:R\n" "$CALLS"
refute "nothing at all was typed into the browser"     "send-text --pane-id $BR" "$CALLS"
refute "nor into the viewer"                           "send-text --pane-id $VW" "$CALLS"

echo
echo "== 11b. the 1s healer leaves a HEALTHY pair alone =="
# The whole reason detection lands with the mode: neither broot nor micro draws a
# framed line, so without this both halves read as a quit revdiff and the healer
# types a command line into two live programs, once a second. Not scaled: the
# relaunch cooldown has to expire first.
: > "$CALLS"
sleep 5
check  "the browser is seen as RUNNING, not a bare shell" \
                                                  "browse browser pane $BR for abc12345: running" "$T/daemon.log"
check  "the viewer is seen as RUNNING too"        "browse viewer pane $VW for abc12345: running" "$T/daemon.log"
refute "nothing was typed into the browser"       "send-text --pane-id $BR" "$CALLS"
refute "nothing was typed into the viewer"        "send-text --pane-id $VW" "$CALLS"
refute "no revdiff was reinstated over either half" "revdiff --wrap" "$CALLS"

echo
echo "== 11b'. a healthy pair whose TITLE LIES is still left alone =="
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
sleep 5
same   "the browser was never called a shell"     "$(countof "browse browser pane $BR for abc12345: shell" "$T/daemon.log")" "$SHELLB"
same   "...nor was the viewer"                    "$(countof "browse viewer pane $VW for abc12345: shell" "$T/daemon.log")" "$SHELLV"
refute "nothing was typed into the browser"       "send-text --pane-id $BR" "$CALLS"
refute "...nor into the viewer"                   "send-text --pane-id $VW" "$CALLS"
refute "broot was NOT retyped into its own filter box" "broot --conf" "$CALLS"
refute "...nor micro over a live one"             "micro -readonly" "$CALLS"
: > "$T/psfg"                             # back to the stub's default for what follows
retitle "$BR" broot
retitle "$VW" micro

echo
echo "== 11b''. a browser that wanders OUT of the worktree is put back =="
# broot cannot be confined -- checked, not assumed: v1.59 has no jail option, and a
# verb of ours named `parent` does not shadow the built-in `:parent` (it still moved
# the root, with our file loaded cleanly and FIRST in the chain). So the fence
# checks where broot ENDED UP rather than how it got there, which closes every
# route at once instead of the ones somebody thought to block.
mkdir -p "$MOVED4/sub"                    # a real dir: the fence realpaths both sides
printf '%s\n' "$T" > "$BROOTROOT"         # the parent of the worktree -- one `:parent` away
: > "$CALLS"
sleep 3
check  "the daemon asked broot where it was"     "BROOT: --send cockpit-abc12345 --get-root" "$CALLS"
check  "...and sent it back to the worktree"     "--cmd :focus $MOVED4" "$CALLS"
check  "...and said so"                          "wandered to $T; put it back in $MOVED4" "$T/daemon.log"
same   "broot's root is the worktree again"      "$(cat "$BROOTROOT")" "$MOVED4"
# Descending is not wandering: a root BELOW the worktree is what browsing a
# subdirectory looks like, and yanking that back would make the tree unusable in
# the other direction.
printf '%s\n' "$MOVED4/sub" > "$BROOTROOT"
: > "$CALLS"
sleep 3
refute "a root INSIDE the worktree is left alone" "--cmd :focus" "$CALLS"
same   "...and broot was not moved"              "$(cat "$BROOTROOT")" "$MOVED4/sub"
printf '%s\n' "$MOVED4" > "$BROOTROOT"    # back at the worktree for what follows

echo
echo "== 11c. a quit VIEWER is healed in its own half, and nothing else is touched =="
# micro quit with Ctrl+Q: the pane falls back to a shell prompt and its title with
# it. The whole of T06 is that the answer is micro in THAT pane -- not a rebuilt
# pair, which would throw away broot's place in the tree to fix a half that was
# never broken. The stub retitles the pane back to `micro` when the command lands,
# so a successful heal closes its own loop.
printf '{"abc12345":["bin/kept-across-the-heal.mjs"]}\n' > "$T/state/viewer-tabs.json"
: > "$CALLS"
retitle "$VW" sh
# NOT scaled, same reasoning as section 10: the healer's own interval plus the
# relaunch cooldown have to pass, and a scaled-down margin made the reinstate flaky.
sleep 5
check  "the quit half is reported as a shell"     "browse viewer pane $VW for abc12345: shell" "$T/daemon.log"
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

echo
echo "== 11c'. a quit BROWSER is healed the same way, and the viewer's tabs survive =="
# The mirror image, and the half where the difference shows: relaunching broot must
# NOT reset the tab list -- those tabs belong to a micro that never stopped running.
printf '{"abc12345":["bin/still-open.mjs"]}\n' > "$T/state/viewer-tabs.json"
: > "$CALLS"
retitle "$BR" sh
sleep 5
check  "the quit browser is reported as a shell"  "browse browser pane $BR for abc12345: shell" "$T/daemon.log"
check  "...and broot was reinstated in that pane" "the browse browser was quit in abc12345; reinstated it in pane $BR" "$T/daemon.log"
check  "...typed into the browser's own pane"     "send-text --pane-id $BR" "$CALLS"
check  "...with the cockpit's verb file first in the --conf chain" \
                                                  "broot --conf \"$ROOT/bin/cockpit-browse-verbs.hjson" "$CALLS"
refute "the healthy viewer was not typed into"    "send-text --pane-id $VW" "$CALLS"
check  "...and its tab list is untouched"         "bin/still-open.mjs" "$T/state/viewer-tabs.json"
refute "no pane was killed"                       "kill-pane" "$CALLS"
refute "...and the slot was not re-split"         "split-pane" "$CALLS"
same   "the viewer keeps its pane id"             "$(pane_key viewer)" "$VW"
same   "...and the browser its own"               "$(pane_key diff)" "$BR"

echo
echo "== 11c''. BOTH halves quit at once: both come back, in the same pass =="
# The reason the relaunch cooldown is per PANE and not per agent. A single
# per-agent stamp is set by the first heal, which then reads as "something was just
# launched for this agent" and silences the second half for the whole cooldown.
#
# SAME PASS is the assertion, and it has to be: waiting a flat 5s for both would
# pass under a per-agent clock too -- the second half is merely held for three
# seconds and then healed, not abandoned (measured: keyed per agent, this section
# went green). So the wait ENDS at the browser's heal, and the viewer's is required
# a second later -- comfortably longer than the two log writes of one pass, and
# comfortably shorter than the 3s a per-agent stamp would impose.
HEALB="$(countof "reinstated it in pane $BR" "$T/daemon.log")"
HEALV="$(countof "reinstated it in pane $VW" "$T/daemon.log")"
: > "$CALLS"
retitle "$BR" sh
retitle "$VW" sh
waitmore "reinstated it in pane $BR" "$T/daemon.log" "$HEALB" 8 \
  || { echo "  FAIL the browser was never healed, so the pass cannot be timed"; fail=1; }
sleep 1
grew   "the browser came back"                    "reinstated it in pane $BR" "$T/daemon.log" "$HEALB"
grew   "...and the viewer in the SAME pass, not a cooldown later" \
                                                  "reinstated it in pane $VW" "$T/daemon.log" "$HEALV"
sleep 4                                   # the section's original 5s of settling, so what follows is unchanged
check  "broot was typed into the browser half"    "send-text --pane-id $BR" "$CALLS"
check  "micro into the viewer half"               "send-text --pane-id $VW" "$CALLS"
refute "neither heal killed the other half"       "kill-pane" "$CALLS"
refute "...nor re-split the slot"                 "split-pane" "$CALLS"
in_slot "the browser is still in the slot"        "$BR"
in_slot "...and the viewer beside it"             "$VW"

echo
echo "== 11c'''. no heal fires inside the cooldown window =="
# broot and micro each look like a bare shell for a moment while they start, so a
# heal that fired straight away would type a command line into a live program --
# where every character is a keybinding. The window is measured from the heal just
# performed: quit the same half again the moment the daemon says it healed it.
HEALV="$(countof "reinstated it in pane $VW" "$T/daemon.log")"
retitle "$VW" sh
waitmore "reinstated it in pane $VW" "$T/daemon.log" "$HEALV" 8 \
  || { echo "  FAIL the cooldown window could not be measured -- no heal to start it"; fail=1; }
# The clock starts HERE, at the moment the daemon says it launched micro.
: > "$CALLS"
retitle "$VW" sh
nap 1.5                                   # well inside the 3s cooldown just armed
refute "nothing typed into the half that was just launched" "send-text --pane-id $VW" "$CALLS"
sleep 5                                   # ...and once it expires, the heal happens
check  "...and it is healed once the cooldown expires" "send-text --pane-id $VW" "$CALLS"

echo
echo "== 11c''''. the fence only questions a browser that is UP =="
# fenceBrowseRoot asks a LIVE broot where it is. A half sitting at a shell has
# nothing listening on its socket, and one still painting has not opened it yet:
# either way the query is a `broot --send` spawned once a second only to be
# refused -- and a refused query is INVISIBLE in its effects, so without this
# section the guard could be deleted and every other check would stay green.
# Three bounded windows rather than one long refute, because the fence is
# SUPPOSED to resume the moment the grace expires.
HEALB="$(countof "reinstated it in pane $BR" "$T/daemon.log")"
retitle "$BR" sh                          # broot quit: the title and `ps` both say shell
: > "$CALLS"                              # truncated AFTER the retitle, so a healer tick
                                          # landing in between cannot leave a stale query
waitmore "reinstated it in pane $BR" "$T/daemon.log" "$HEALB" 8 \
  || { echo "  FAIL the browser was never healed, so the window cannot be timed"; fail=1; }
refute "a browser sitting at a shell is never questioned" "BROOT: --send" "$CALLS"
# The clock starts HERE, at the moment the daemon says it launched broot.
: > "$CALLS"
nap 1.5                                   # well inside the 3s grace that heal just armed
refute "...nor is one that is still starting" "BROOT: --send" "$CALLS"
sleep 5                                   # ...and once the grace expires, the fence resumes
check  "...and one that is up is asked again"     "BROOT: --send cockpit-abc12345 --get-root" "$CALLS"

echo
echo "== 11c'''''. (five primes) a half is running if ANY of its foreground group is =="
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
# 11b') the 1s healer typed `cd <wt> && broot --conf ...` into the running broot.
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
sleep 5
same   "a broot with a child in its group is not a shell" \
                                                  "$(countof "browse browser pane $BR for abc12345: shell" "$T/daemon.log")" "$SHELLB"
same   "...nor is a micro with one"               "$(countof "browse viewer pane $VW for abc12345: shell" "$T/daemon.log")" "$SHELLV"
refute "nothing was typed into the browser mid-push" "send-text --pane-id $BR" "$CALLS"
refute "...nor into the viewer"                   "send-text --pane-id $VW" "$CALLS"
refute "broot's launch command never reached its own filter box" "broot --conf" "$CALLS"
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

echo
echo "== 11d. ⌥] out of browse, from the BROWSER half -- the trap case =="
# Focus starts in the browser, so if ⌥[/⌥] only answered to the single slot pane
# there would be no way out of browse mode without clicking the other half first.
: > "$CALLS"
echo "$BR" > "$ACTIVE"                    # the browser holds focus
echo next >> "$T/state/cmd"               # browse -> uncommitted (browse is last)
nap 3
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
check  "...it simply came back from its park"     "came back from its park in uncommitted mode" "$T/daemon.log"
check  "all three viewer keys were cleared together" \
                                                  '"viewer":null,"viewerAgent":null,"viewerRoot":null' "$T/state/panes.json"

echo
echo "== 11d'. a PARKED half is never healed; the slot's revdiff still is =="
# Both halves are parked now, in a tab of their own, and the healer's business is
# the SLOT. A parked pane sitting at a prompt is not a broken cockpit -- nobody can
# see it -- and typing into one would fight whatever the user does with it next.
# Meanwhile the ordinary revdiff heal has to go on working exactly as it did.
: > "$CALLS"
retitle "$BR" sh
retitle "$VW" sh
retitle "$DP" sh                          # ...and quit the revdiff that holds the slot
sleep 5
refute "nothing was typed into the parked browser" "send-text --pane-id $BR" "$CALLS"
refute "...nor into the parked viewer"             "send-text --pane-id $VW" "$CALLS"
check  "the SLOT's revdiff was reinstated as ever" "send-text --pane-id $DP" "$CALLS"
check  "...on this agent's own uncommitted range"  "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"
parked "the browser is still parked, untouched"    "$BR"
parked "...and the viewer with it"                 "$VW"
# Put the pair back as it was, so the restore below sees two running programs.
retitle "$BR" broot
retitle "$VW" micro

echo
echo "== 11e. ⌥[/⌥] cycle modes from the VIEWER half as well =="
: > "$CALLS"
echo "$(pane_key diff)" > "$ACTIVE"
echo prev >> "$T/state/cmd"               # uncommitted -> browse again
nap 3
BR2="$(pane_key diff)"; VW2="$(pane_key viewer)"
check "back in browse"                            '"diffMode":"browse"' "$T/state/terminals.json"
# The round trip, and the reason tabs are worth having: browse is one stop in a
# four-way cycle, so it is passed through constantly. Two new panes here would mean
# an empty tab bar and broot back at the top of the tree every time.
same   "the SAME browser came back, not a new one" "$BR2" "$BR"
same   "...and the same viewer beside it"          "$VW2" "$VW"
refute "broot was not relaunched"                  "broot --conf" "$CALLS"
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
echo next >> "$T/state/cmd"
nap 3
check "the keys cycled the MODE with the viewer focused" \
                                                  '"diffMode":"uncommitted"' "$T/state/terminals.json"

echo
echo "== 11f. a TERMINAL focused still cycles terminals, in browse mode too =="
: > "$CALLS"
echo "$(pane_key diff)" > "$ACTIVE"
echo prev >> "$T/state/cmd"               # back into browse
nap 3
BR3="$(pane_key diff)"
: > "$CALLS"
echo 32 > "$ACTIVE"                       # focus the agent's terminal
echo next >> "$T/state/cmd"
nap 2
check  "the mode is untouched"                    '"diffMode":"browse"' "$T/state/terminals.json"
refute "no half was disposed of"                  "kill-pane" "$CALLS"
refute "and no revdiff was launched"              "revdiff --wrap" "$CALLS"

# ⌥t/⌥w are always terminals, from either half. Nets to zero: the fresh terminal
# opened here is closed again, leaving the agent's original terminal 32.
: > "$CALLS"
echo "$BR3" > "$ACTIVE"                   # from the BROWSER half
echo new >> "$T/state/cmd"
nap 2
check "⌥t opened a terminal from the browser half" '"n":2' "$T/state/terminals.json"
echo close-2 >> "$T/state/cmd"
nap 2
refute "⌥w closed it again"                        '"n":2' "$T/state/terminals.json"

echo
echo "== 11g. the mode is PER AGENT: browse is never inherited =="
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
nap 4
check  "the other agent opens in the uncommitted default" \
                                                  '"diffMode":"uncommitted"' "$T/state/terminals.json"
refute "no browser was launched for it"           "broot --conf" "$CALLS"
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
nap 4
check "the browsing agent kept its OWN browse mode" '"diffMode":"browse"' "$T/state/terminals.json"
same  "the same browser came back to the slot"      "$(pane_key diff)" "$BRS"
same  "...and the same viewer"                      "$(pane_key viewer)" "$VWS"
check "...moved, not respawned"                     "--move-pane-id $BRS" "$CALLS"
check "...with the viewer split off it at 80%"      "--right --percent 80 --pane-id $BRS --move-pane-id $VWS" "$CALLS"
refute "neither half was relaunched"                "broot --conf" "$CALLS"
refute "...nor micro"                               "micro -readonly true" "$CALLS"
check "panes.json names a viewer again"             '"viewerAgent":"abc12345"' "$T/state/panes.json"

echo
echo "== 11h. detaching to the fleet list clears all three keys =="
: > "$CALLS"
echo list > "$FLEETSTATE"
nap 3
check "the viewer keys are cleared on detach"     '"viewer":null,"viewerAgent":null,"viewerRoot":null' "$T/state/panes.json"

echo
echo "== 11i. clicking the footer's Browse label =="
# The footer appends `diff-browse`; like the other labels it names the mode outright
# and must not depend on which pane is focused.
echo "test agent" > "$FLEETSTATE"
nap 4
BRC="$(pane_key diff)"; VWC="$(pane_key viewer)"
: > "$CALLS"; : > "$ACTIVE"
echo diff-uncommitted >> "$T/state/cmd"   # leave browse by clicking, not by key
nap 3
check "clicking Uncommitted left browse"          '"diffMode":"uncommitted"' "$T/state/terminals.json"
check "...and the pair went with it"              "left browse for abc12345" "$T/daemon.log"
# How you left browse must not decide whether the tabs survive it: the click path
# is a different function from the key path and would happily kill what the keys
# park.
refute "...parked, not killed -- the browser"     "kill-pane --pane-id $BRC" "$CALLS"
refute "...nor the viewer"                        "kill-pane --pane-id $VWC" "$CALLS"
parked "the clicked-away browser is still alive"  "$BRC"
parked "...and its viewer"                        "$VWC"

: > "$CALLS"
echo diff-browse >> "$T/state/cmd"
nap 3
check "clicking Browse switched, unfocused"       '"diffMode":"browse"' "$T/state/terminals.json"
same  "...and brought the SAME browser back"      "$(pane_key diff)" "$BRC"
same  "...and the same viewer"                    "$(pane_key viewer)" "$VWC"
refute "...without relaunching broot"             "broot --conf" "$CALLS"
check "...publishing the viewer with it"          '"viewerAgent":"abc12345"' "$T/state/panes.json"

: > "$CALLS"
echo diff-browse >> "$T/state/cmd"        # the ALREADY-active label
nap 3
refute "clicking Browse again launches nothing"   "broot --conf" "$CALLS"
refute "...and disposes of nothing"               "kill-pane" "$CALLS"

echo
echo "== 11j. ⌥[ out of browse lands on CUSTOM and opens the ref prompt =="
# The one transition the mode cycle makes that is neither "launch revdiff" nor
# "launch the pair": leaveBrowse hands the slot to a fresh shell and the PROMPT is
# typed into that, not into a browse half that no longer exists.
BR4="$(pane_key diff)"; VW4="$(pane_key viewer)"
: > "$CALLS"
echo "$BR4" > "$ACTIVE"                   # the browser holds focus
echo prev >> "$T/state/cmd"               # browse -> custom (browse is the fourth stop)
nap 3
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
sleep 5
refute "no heal fires while the ref prompt owns the pane" "send-text --pane-id $SLOT4" "$CALLS"
refute "...so no revdiff was typed over it"              "revdiff --wrap" "$CALLS"

# Cancelling reverts to browse -- which is not a revdiff range at all, so the pair
# has to come back rather than diffCommand picking something for it.
: > "$CALLS"
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
echo custom-cancel >> "$T/state/cmd"
nap 3
check  "cancel reverted to browse"                '"diffMode":"browse"' "$T/state/terminals.json"
same   "...and brought the same browser back"     "$(pane_key diff)" "$BR4"
same   "...and the same viewer"                   "$(pane_key viewer)" "$VW4"
refute "...without relaunching broot"             "broot --conf" "$CALLS"
check  "...publishing the viewer again"           '"viewerAgent":"abc12345"' "$T/state/panes.json"
refute "...rather than putting a diff in the slot" "revdiff --wrap" "$CALLS"

echo
echo "== 11k. a worktree migration in browse mode FOLLOWS focus, never takes it =="
# followWorktreeMigration fires on the AGENT's schedule -- it created a worktree and
# moved into it -- so it can land while you are typing into the Claude pane. The
# revdiff branch moves focus nowhere; the browse branch rebuilds two panes and must
# not take the keyboard with them, or the rest of your sentence goes into broot's
# filter box. NOT scaled: the relaunch cooldown must expire before the check runs at
# all, and the throttle after it (same reasoning as 9c).
MOVED5="$T/moved5"; mkrepo "$MOVED5"
echo 32 > "$ACTIVE"                       # focus is on the agent's TERMINAL, not the slot
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED5","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
sleep 6
BR5="$(pane_key diff)"
check  "the pair followed the agent into the new worktree" "--cwd $MOVED5 --" "$CALLS"
check  "...and broot was relaunched there"        "broot --conf" "$CALLS"
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
sleep 6
BR6="$(pane_key diff)"
check "the pair moved again"                      "--cwd $MOVED6 --" "$CALLS"
check "...and focus came with it, since it was in the slot" \
                                                  "activate-pane --pane-id $BR6" "$CALLS"

echo
echo "== 11l. two agents BOTH in browse: the right pair in the slot, four panes parked =="
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
nap 4
DPB="$(pane_key diff)"                    # the second agent's revdiff, before it browses
: > "$CALLS"
echo diff-browse >> "$T/state/cmd"
nap 3
BRB="$(pane_key diff)"; VWB="$(pane_key viewer)"
check  "the second agent got a pair of ITS OWN"        "broot --conf" "$CALLS"
same   "...a different browser from the first agent's" \
       "$([ "$BRB" = "$BRA" ] && echo shared || echo separate)" "separate"
parked "...and its own revdiff parked behind it"       "$DPB"
# Long enough for several 1s healer ticks and a reap round: a parked half is alive
# and off screen, and nothing may reach for it. NOT scaled -- the point is the
# healer's own cadence.
sleep 4
parked "the first agent's browser is untouched, parked" "$BRA"
parked "...and its viewer"                             "$VWA"
parked "...and its revdiff, parked behind its pair"    "$DPA"
refute "nothing was typed into the parked browser"     "send-text --pane-id $BRA" "$CALLS"
refute "...nor into the parked viewer"                 "send-text --pane-id $VWA" "$CALLS"

: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
nap 4
same   "the first agent's own browser is back in the slot" "$(pane_key diff)" "$BRA"
same   "...beside its own viewer, not the other agent's"   "$(pane_key viewer)" "$VWA"
check  "the second agent's browser parked"                 "move-pane-to-new-tab --pane-id $BRB" "$CALLS"
check  "...with its viewer beside it"                      "--right --percent 80 --pane-id $BRB --move-pane-id $VWB" "$CALLS"
refute "no pane was killed switching between two pairs"    "kill-pane" "$CALLS"
parked "the second agent's browser is alive, parked"       "$BRB"
parked "...and its viewer"                                 "$VWB"
parked "...and its revdiff"                                "$DPB"
check  "the viewer keys name the FIRST agent again"        '"viewerAgent":"abc12345"' "$T/state/panes.json"

echo
echo "== 11m. an EMPTY slot is rebuilt full width, then handed a whole pair =="
# The slot's pane can die under us (exit the shell revdiff is in). Rebuilding it
# needs the fleet pane alone in its row, so the terminal steps aside and comes
# back -- and what is put into the placeholder afterwards is now TWO panes.
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"
nap 4
echo diff-uncommitted >> "$T/state/cmd"   # the second agent stops browsing
nap 3
DEAD="$(pane_key diff)"
: > "$CALLS"
awk -v p="$DEAD" '$1 != p' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
echo "test agent" > "$FLEETSTATE"         # ...and its slot pane dies as we leave it
nap 6
check  "the slot was rebuilt"                     "rebuilt the diff slot" "$T/daemon.log"
check  "the full-width split came off the fleet pane" "--top --percent 42 --pane-id 20" "$CALLS"
same   "the browsing agent's browser took the placeholder" "$(pane_key diff)" "$BRA"
same   "...and its viewer came back beside it"             "$(pane_key viewer)" "$VWA"
refute "neither half was relaunched into the rebuilt slot"  "broot --conf" "$CALLS"
refute "...nor micro"                                       "micro -readonly true" "$CALLS"

echo
echo "== 11n. the viewer tab list: kept across a park, reset by a fresh launch =="
# The list is the only record of what micro has open -- it cannot be asked. A
# restored viewer still has every tab, so the list must survive with it; a viewer
# started from scratch has none, so a leftover list would make the next push a
# `tabswitch` onto a tab that is not there and jump to the wrong file silently.
printf '{"abc12345":["bin/a.mjs"]}\n' > "$T/state/viewer-tabs.json"
: > "$CALLS"; : > "$ACTIVE"
echo diff-uncommitted >> "$T/state/cmd"
nap 3
echo diff-browse >> "$T/state/cmd"
nap 3
same  "the same viewer came back from the park"   "$(pane_key viewer)" "$VWA"
check "...so the list of what was pushed into it is untouched" \
                                                  "bin/a.mjs" "$T/state/viewer-tabs.json"

# A worktree migration is the one thing that REPLACES the pair: broot would
# otherwise be rooted in a directory the agent has left. Not scaled -- the
# migration cooldown and throttle have to expire (same reasoning as 9c).
MOVED7="$T/moved7"; mkrepo "$MOVED7"
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED7","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":2,"id":"def67890","cwd":"$WT2","kind":"background",
  "sessionId":"s2","name":"second agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
sleep 6
check  "the pair was rebuilt in the new worktree"  "--cwd $MOVED7 --" "$CALLS"
check  "...micro started fresh with it"            "$MICRO_LAUNCH" "$CALLS"
check  "...so that agent's tab list was reset"     "reset the viewer tab list for abc12345" "$T/daemon.log"
refute "...and the stale tabs are gone"            "bin/a.mjs" "$T/state/viewer-tabs.json"

echo
echo "== 11o. the park's saving SURVIVES the next agent switch =="
# What a parked revdiff was last launched with is recorded per agent, and entering
# browse overwrites that record with `browse` -- correctly, while the pair is up.
# Handing the revdiff back without relaunching it therefore has to put the record
# straight again: left saying `browse`, the next attach reads a mode that does not
# match the agent's and quits and relaunches the very revdiff the park just saved,
# losing the selected file, the scroll position and any unflushed annotations.
: > "$CALLS"; : > "$ACTIVE"
echo diff-uncommitted >> "$T/state/cmd"   # out of browse (stale: the agent moved in 11n)
nap 3
echo diff-browse >> "$T/state/cmd"        # in again -- the revdiff parks in uncommitted
nap 3
: > "$CALLS"
echo diff-uncommitted >> "$T/state/cmd"   # and out: nothing to relaunch
nap 3
DPARK="$(pane_key diff)"
refute "the revdiff came back from its park untouched" "revdiff --wrap" "$CALLS"
check  "...and the daemon said so"                     "came back from its park in uncommitted mode" "$T/daemon.log"

: > "$CALLS"
echo "second agent" > "$FLEETSTATE"
nap 4
: > "$CALLS"                              # the other agent's own launch is not ours
echo "test agent" > "$FLEETSTATE"
nap 4
same   "the same revdiff pane came back to the slot"   "$(pane_key diff)" "$DPARK"
refute "...and it was NOT relaunched on the way in"    "revdiff --wrap" "$CALLS"
refute "...nor quit to be relaunched"                  'STDIN:q\n' "$CALLS"

echo
echo "== 11p. reaping an agent takes its WHOLE pair, and its tab list with it =="
# An agent can now own four panes: a terminal, a browser, a viewer and the revdiff
# parked while the pair browses. Every one of them has to go when the agent leaves
# the fleet, or it lives on -- unreachable, since its agent is no longer in the list
# -- for the whole life of the window. And the record of what its viewer had open
# goes with it: job ids are not reused, so an entry left behind is never read again.
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"
nap 4
TRMD="$(grep -oE '(opened|restored) terminal pane [0-9]+' "$T/daemon.log" | tail -1 | grep -oE '[0-9]+$')"
DPD="$(pane_key diff)"                    # its revdiff, about to be parked
echo diff-browse >> "$T/state/cmd"
nap 4
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
sleep 5
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
sleep 1                                   # let the rest of the disposal land

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

echo
echo "== 12. the footer draws -- and clicks -- a fourth label =="
# The strip renderer is a separate process reading terminals.json, so this section
# runs it directly rather than through the daemon. It never exits on its own (it
# watches the state dir), so every run is backgrounded and killed.
SD="$T/strip"; mkdir -p "$SD"
# The capture goes OUTSIDE the state dir: the renderer watches that directory, so a
# capture file written into it makes the renderer repaint on its own output for ever.
RAW="$T/strip-cap"; PLAIN="$T/strip-plain"
# Escapes take no columns, so a click column is measured on the STRIPPED frame --
# and stripped by node, in utf8: the legend is full of multi-byte characters (⌥, ·,
# ←↑↓→) that a byte-oriented reader counts several times over, which lands the
# click ~35 columns to the right of the label it was aimed at.
STRIP_ANSI='const s=require("fs").readFileSync(process.argv[1],"utf8").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,"");process.stdout.write(process.argv[2] ? String(s.indexOf(process.argv[2]) + 1) : s)'

footer() {   # footer <diffMode>: render one frame with that mode into $RAW/$PLAIN
  printf '{"agent":"test agent","diffMode":"%s","customRef":null,"terminals":[{"n":1,"active":true,"tty":null}]}\n' \
      "$1" > "$SD/terminals.json"
  ( COCKPIT_DIR="$SD" node "$ROOT/bin/cockpit-strip.mjs" footer > "$RAW" 2>&1 ) &
  local p=$!
  sleep 0.8
  kill "$p" 2>/dev/null; wait "$p" 2>/dev/null
  node -e "$STRIP_ANSI" "$RAW" > "$PLAIN"
}

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

footer uncommitted                        # Browse drawn plain, as it would be clicked
click() {  # click <label>: send a left-click at that label's column, echo the verb
  local col p i=0
  col=$(node -e "$STRIP_ANSI" "$RAW" "$1")
  : > "$SD/cmd"
  ( sleep 1; printf '\033[<0;%d;1M' "$col"; sleep 0.8 ) \
  | ( COCKPIT_DIR="$SD" script -q /dev/null node "$CLICKER" footer >/dev/null 2>&1 ) &
  p=$!
  while kill -0 "$p" 2>/dev/null && [ "$i" -lt 40 ]; do sleep 0.1; i=$((i + 1)); done
  kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
  wait "$p" 2>/dev/null
  pkill -f "$CLICKER" 2>/dev/null
  tr -d '\n' < "$SD/cmd"
}

same "clicking Browse appends diff-browse"        "$(click Browse)" "diff-browse"
# The three that were already there must keep their columns and their hit zones: a
# fourth label inserted anywhere but the end would silently move them.
same "clicking Custom still appends diff-custom"  "$(click Custom)" "diff-custom"
same "clicking Last Commit still appends diff-lastcommit" \
                                                  "$(click 'Last Commit')" "diff-lastcommit"
same "clicking Uncommitted Changes still appends diff-uncommitted" \
                                                  "$(click 'Uncommitted Changes')" "diff-uncommitted"
fi

echo
if [ "$fail" = 0 ]; then echo "ALL PASS ($pass checks)"; else echo "FAILURES"; sed -n '1,40p' "$T/daemon.log"; fi
exit $fail
