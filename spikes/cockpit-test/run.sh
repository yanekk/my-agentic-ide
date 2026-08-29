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
    # Launching revdiff makes it the pane's foreground process, so WezTerm
    # retitles the pane -- which is the signal the daemon reads back.
    case "$payload" in *revdiff*) retitle "$(flag --pane-id "$@")" revdiff ;; esac
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
    if [ -n "$moved" ]; then                       # bring a parked pane back
      awk -v p="$moved" '{ if ($1 == p) print $1, 0, $3; else print }' "$PANESTATE" > "$PANESTATE.tmp"
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
cat > "$T/bin/ps" <<'PS'
#!/usr/bin/env bash
if [ -s "$PSBUSY" ]; then printf 'R+ %s\n' "$(cat "$PSBUSY")"; else printf 'Ss+ zsh\n'; fi
PS
chmod +x "$T/bin/ps"
export PANECWD="$T/panecwd"; : > "$PANECWD"
export PSBUSY="$T/psbusy"; : > "$PSBUSY"

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
# AGENDA_ORIGIN points at a port nothing listens on. This daemon never has a
# calendar configured so it never fetches at all -- but a later edit that gave it
# one must fail loudly here rather than open a real socket to Google on whatever
# machine happens to be running the suite (DESIGN 5.2).
HOME="$T/home" COCKPIT_DIR="$T/state" COCKPIT_REAP_MS="$REAP_MS" \
    COCKPIT_TIME_SCALE="$SPEED" SHELL=/bin/zsh \
    AGENDA_ORIGIN="http://127.0.0.1:9" \
    node "$ROOT/bin/cockpitd.mjs" > "$T/daemon.log" 2>&1 &
DPID=$!
trap 'kill $DPID 2>/dev/null; rm -rf "$T"' EXIT
sleep 1   # node startup is fixed overhead -- not scaled by SPEED

fail=0
check() {  # check <description> <pattern> <file>
  if grep -qF -- "$2" "$3"; then
    echo "  ok   $1"
  else
    echo "  FAIL $1"
    echo "       expected to find: $2"
    fail=1
  fi
}
refute() {
  if grep -qF -- "$2" "$3"; then echo "  FAIL $1"; fail=1; else echo "  ok   $1"; fi
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
: > "$CALLS"
echo 31 > "$ACTIVE"                       # focus the diff pane
echo prev >> "$T/state/cmd"               # uncommitted -> custom (custom is last in the cycle)
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
# Leave custom (now the mode is uncommitted), then cycle back in so the prompt
# opens with uncommitted as the mode to fall back to, and answer with a cancel.
echo next >> "$T/state/cmd"               # custom -> uncommitted
nap 2
: > "$CALLS"
echo prev >> "$T/state/cmd"               # uncommitted -> custom, opens the prompt again
nap 2
check "the prompt opened again"                   "cockpit-custom-prompt.mjs" "$CALLS"
: > "$CALLS"
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
echo custom-cancel >> "$T/state/cmd"
nap 2
check "cancel reverted to the prior mode"         '"diffMode":"uncommitted"' "$T/state/terminals.json"
check "and revdiff came back in that range"       "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"

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

echo
echo "== 11. the agenda: the daemon keeps the event cache current =="
# T07. THE DAEMON FETCHES AND THE PANE ONLY DRAWS (DESIGN 2.5), so the refresh is
# cockpitd's and is tested here rather than in agenda-test.
#
# Two more daemons, each with its own state dir AND its own copy of every file the
# wezterm stub reads ($CALLS/$PANESTATE/$FLEETSTATE/...), so neither can disturb
# the pane table the sections above assert on. The stub takes those paths from the
# environment, which is what makes the isolation a matter of env vars alone.
#
#   D2  a 400ms tick: everything the tick itself does.
#   D3  a tick an hour long, so it can never fire in-test: whatever D3 refreshes
#       is the ON-RETURN trigger and cannot be confused for a tick.
#
# AGENDA_STALE_MS is 60s in both -- longer than this section runs -- so nothing is
# ever re-fetched by accident. A calendar goes stale only when a line below zeroes
# its fetchedAt, and that is what makes every assertion here deterministic.
D2PID=""; D3PID=""; GPID=""

same() {  # same <description> <actual> <expected>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FAIL $1"; echo "       expected: $3"; echo "       actual:   $2"; fail=1
  fi
}

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
const [, , MODE, HITS] = process.argv;
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
  if (m === "slow") return setTimeout(() => json(res, 200, EVENTS), 2000);
  json(res, 200, EVENTS);
});
server.listen(0, "127.0.0.1", () => console.log(`PORT ${server.address().port}`));
GSTUB
node "$T/gstub.mjs" "$GMODE" "$GHITS" > "$T/gstub.out" 2>&1 &
GPID=$!
for _ in $(seq 1 60); do grep -q '^PORT ' "$T/gstub.out" 2>/dev/null && break; sleep 0.1; done
GPORT="$(sed -n 's/^PORT //p' "$T/gstub.out" | head -1)"
ORIGIN="http://127.0.0.1:$GPORT"
same "the fake Google is listening on loopback" "$([ -n "$GPORT" ] && echo yes || echo no)" "yes"

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
  HOME="$T/home" SHELL=/bin/zsh TZ=Europe/Warsaw \
  COCKPIT_DIR="$S2" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$A2/calls.log" FLEETSTATE="$A2/fleetstate" PANESTATE="$A2/panestate" \
  NEXTPANE="$A2/nextpane" NEXTTAB="$A2/nexttab" EDITING="$A2/editing" \
  TITLELAG="$A2/titlelag" ACTIVE="$A2/active" PANECWD="$A2/panecwd" \
  PSBUSY="$A2/psbusy" AGENTS_JSON="$AGENTS_JSON" \
  AGENDA_ORIGIN="$ORIGIN" COCKPIT_AGENDA_TICK_MS=400 COCKPIT_AGENDA_STALE_MS=60000 \
  "$@"
}
d2env node "$ROOT/bin/cockpitd.mjs" > "$A2/daemon.log" 2>&1 &
D2PID=$!
trap 'kill $DPID $D2PID $D3PID $GPID 2>/dev/null; rm -rf "$T"' EXIT
sleep 2

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
sleep 2

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
sleep 2
same "a fresh calendar is not re-fetched" "$(grep -c '/events' "$GHITS")" "0"

# Two calendars, both stale, one pass.
d2env node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>{s.putCalendar({slug:"home",account:"me@x.test",calendarId:"home-cal",title:"Home",colour:2},1);});' "$ROOT"
sleep 2                       # let the new calendar's first fetch land and settle
makestale "$S2" work home     # ...so this pass is the one being asserted on
: > "$GHITS"
sleep 2
check "two calendars are both refreshed in one pass" "/calendars/work-cal/events" "$GHITS"
check "...the second one too"                        "/calendars/home-cal/events" "$GHITS"

# A failing calendar must not stop the ones after it in the same pass, so `late`
# is added AFTER `bad` and asserted on.
echo one-bad > "$GMODE"       # before the add: a new calendar is stale at once
d2env node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>{s.putCalendar({slug:"bad",account:"me@x.test",calendarId:"bad-cal",title:"Bad",colour:3},1);s.putCalendar({slug:"late",account:"me@x.test",calendarId:"late-cal",title:"Late",colour:4},1);});' "$ROOT"
sleep 3
same "a failing calendar records its error"                 "$(cq "$S2" 'c.calendars.bad.error.kind')" "gone"
same "...and does not stop the NEXT one being refreshed"    "$(cq "$S2" 'c.calendars.late.fetchedAt > 0')" "true"
same "...which has no error of its own"                     "$(cq "$S2" 'c.calendars.late.error')" "null"

# A wifi blip must not empty the agenda (DESIGN 2.7): the events stay, only the
# error is added.
echo net > "$GMODE"
makestale "$S2" work
sleep 3
same "a network failure keeps the previous events" "$(cq "$S2" 'c.calendars.work.events.length')" "1"
same "...and sets error.kind = network"            "$(cq "$S2" 'c.calendars.work.error.kind')" "network"
SINCE1="$(cq "$S2" 'c.calendars.work.error.since')"
same "...and stamps when it broke"                 "$([ "${SINCE1:-0}" -gt 0 ] 2>/dev/null && echo yes || echo no)" "yes"
# A failure keeps the previous fetchedAt, so `work` is still stale and retries on
# every tick -- which is exactly the repeat this asserts `since` survives.
sleep 2
same "error.since is preserved across repeats"     "$(cq "$S2" 'c.calendars.work.error.since')" "$SINCE1"

echo auth > "$GMODE"
sleep 3
same "an auth failure classifies as auth"          "$(cq "$S2" 'c.calendars.work.error.kind')" "auth"
same "...and still keeps the previous events"      "$(cq "$S2" 'c.calendars.work.events.length')" "1"

echo ok > "$GMODE"
sleep 3
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
sleep 1.5
same "a pass entered while one is in flight starts nothing" "$(grep -c '/events' "$GHITS")" "1"
echo ok > "$GMODE"
sleep 4

# daemon.log gets pasted into conversations.
refute "no access token ever reaches the log"  "TOKEN-MUST-NOT-BE-LOGGED" "$A2/daemon.log"
refute "no meeting title ever reaches the log" "SECRET-MEETING-TITLE"     "$A2/daemon.log"

# FINDINGS 2026-08-29: readState() MOVES a corrupt agenda.json aside, and that
# quarantine is a one-shot event only a caller that can speak to a person may
# consume. This daemon runs every 60 seconds with nobody to tell, so it would
# always win the race and the sign-ins would vanish unannounced. Rescuing is the
# `agenda` command's alone -- the same defect the T06 review fixed in the pane.
printf '{"calendars":[' > "$S2/agenda.json"
sleep 2
same "a corrupt agenda.json is NOT quarantined by the daemon" \
     "$(ls "$S2" | grep -c 'agenda.json.corrupt')" "0"
same "...and the sign-ins are left exactly where they were" \
     "$(cat "$S2/agenda.json")" '{"calendars":['

echo
echo "== 11b. the agenda: coming back to the fleet list refreshes it =="
# D2 is stopped first so nothing it does can land in the shared hit log, and so a
# 60s staleness boundary cannot expire underneath D3.
kill $D2PID 2>/dev/null
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
  HOME="$T/home" SHELL=/bin/zsh TZ=Europe/Warsaw \
  COCKPIT_DIR="$S3" COCKPIT_REAP_MS="$REAP_MS" COCKPIT_TIME_SCALE="$SPEED" \
  CALLS="$A3/calls.log" FLEETSTATE="$A3/fleetstate" PANESTATE="$A3/panestate" \
  NEXTPANE="$A3/nextpane" NEXTTAB="$A3/nexttab" EDITING="$A3/editing" \
  TITLELAG="$A3/titlelag" ACTIVE="$A3/active" PANECWD="$A3/panecwd" \
  PSBUSY="$A3/psbusy" AGENTS_JSON="$AGENTS_JSON" \
  AGENDA_ORIGIN="$ORIGIN" COCKPIT_AGENDA_TICK_MS=3600000 COCKPIT_AGENDA_STALE_MS=60000 \
  "$@"
}
d3env node "$ROOT/bin/cockpitd.mjs" > "$A3/daemon.log" 2>&1 &
D3PID=$!
sleep 2
# Configured only AFTER boot, so the one refresh at start-up finds nothing to do
# and cannot be mistaken for the on-return trigger below.
d3env node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>{s.writeClient({clientId:"cid",clientSecret:"csec"});s.putAccount("me@x.test","REFRESH-TOKEN",1);s.putCalendar({slug:"w3",account:"me@x.test",calendarId:"w3-cal",title:"W3",colour:1},1);});' "$ROOT"
sleep 2
same "an hour-long tick has fetched nothing on its own" "$(grep -c '/events' "$GHITS")" "0"

# The return to the fleet LIST is the trigger (DESIGN 2.5) -- so attach first,
# then step back out, which is what makes reconcile call onExit.
echo "test agent" > "$A3/fleetstate"; sleep 3
echo list > "$A3/fleetstate"; sleep 3
check "the return to the fleet list refreshed a stale calendar" "agenda returned: w3 ok" "$A3/daemon.log"
same  "...and the cache was written"  "$(cq "$S3" 'c.calendars.w3.fetchedAt > 0')" "true"

# The same return, with nothing stale, must fetch nothing at all.
: > "$GHITS"
echo "test agent" > "$A3/fleetstate"; sleep 3
echo list > "$A3/fleetstate"; sleep 3
same "...while a return with nothing stale fetches nothing" "$(grep -c '/events' "$GHITS")" "0"

echo
echo "== 11c. the new seams are fenced =="
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
same "staleness defaults to 5 minutes" "$(grep -c 'COCKPIT_AGENDA_STALE_MS) || 5 \* 60_000' "$ROOT/bin/cockpitd.mjs")" "1"

kill $D3PID 2>/dev/null; D3PID=""
kill $GPID 2>/dev/null;  GPID=""

echo
if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; sed -n '1,40p' "$T/daemon.log"; fi
exit $fail
