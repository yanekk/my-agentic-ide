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

# --- state -----------------------------------------------------------------
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$T/state/panes.json"
: > "$T/state/fleet.log"

# HOME is redirected so the daemon's stale-socket repair looks for wezterm
# sockets under $T and finds none, rather than relinking the real one.
mkdir -p "$T/home"
# SHELL is pinned so LOGIN_SHELL's basename ("zsh") matches what the ps stub
# reports as an idle terminal's foreground process.
HOME="$T/home" COCKPIT_DIR="$T/state" COCKPIT_REAP_MS=700 SHELL=/bin/zsh \
    node "$ROOT/bin/cockpitd.mjs" > "$T/daemon.log" 2>&1 &
DPID=$!
trap 'kill $DPID 2>/dev/null; rm -rf "$T"' EXIT
sleep 1

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
sleep 3

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
sleep 1.5

check "sent to the FLEET pane"                   "--pane-id 20" "$CALLS"
check "annotation text present"                  "this allocates in a loop" "$CALLS"
check "sent raw (editable), not as a chip"       "--no-paste" "$CALLS"
refute "no carriage return in payload"           '\r' "$CALLS"

echo
echo "== 3. detach: injection refused while the fleet list is showing =="
echo list > "$FLEETSTATE"
echo '[DEBUG] [FV-attach] attachJob returned after 2020ms — remounting list' >> "$T/state/fleet.log"
sleep 2
: > "$CALLS"
printf '## tracked.txt:9 (+)\nSHOULD NOT BE SENT\n' >> "$T/state/review-abc12345.md"
sleep 1.5

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
sleep 2
: > "$CALLS"
printf '## a.txt:1 (+)\nfirst flush\n' > "$T/state/tmp.$$" \
    && mv "$T/state/tmp.$$" "$T/state/review-abc12345.md"
sleep 1.5
check "first flush injected"                     "first flush" "$CALLS"

: > "$CALLS"
printf '## a.txt:1 (+)\nfirst flush\n## b.txt:2 (+)\nsecond flush\n' > "$T/state/tmp2.$$" \
    && mv "$T/state/tmp2.$$" "$T/state/review-abc12345.md"
sleep 1.5
check "second flush injected after rename"       "second flush" "$CALLS"

: > "$CALLS"
touch "$T/state/review-abc12345.md"        # same content, new mtime = new gesture
sleep 1.5
check "re-flushing identical content injects"    "second flush" "$CALLS"

echo
echo "== 4. switch A→B with NO log line: the pane itself is the signal =="
: > "$CALLS"
echo "second agent" > "$FLEETSTATE"     # nothing appended to fleet.log
sleep 3

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
sleep 3

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
sleep 3

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
sleep 3

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
sleep 2

check "the running revdiff was quit first"       "STDIN:q\n" "$CALLS"
check "revdiff relaunched in the last-commit range" "revdiff --wrap --no-confirm-discard -o \"$T/state/review-abc12345.md\" HEAD~1 HEAD" "$CALLS"
check "...in the agent's OWN diff pane"           "send-text --pane-id 31" "$CALLS"
check "this agent's mode is now last-commit"      '"diffMode":"lastcommit"' "$T/state/terminals.json"
check "the switch was logged"                     "relaunched diff pane 31 for abc12345 in lastcommit" "$T/daemon.log"

echo
echo "== 5b'. toggling again returns to the uncommitted range =="
: > "$CALLS"
echo prev >> "$T/state/cmd"
sleep 2
check "back to HEAD -> working tree"              "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"
check "this agent's mode is back to uncommitted"  '"diffMode":"uncommitted"' "$T/state/terminals.json"

echo
echo "== 5c. ⌥] with a TERMINAL focused leaves the diff mode alone =="
# Focus routing must not fire the diff switch when the reviewer is in a terminal.
: > "$CALLS"
echo 32 > "$ACTIVE"                       # focus the agent's terminal, not the diff
echo next >> "$T/state/cmd"
sleep 2
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
sleep 2
check "focus moved to the Claude (fleet) pane"    "activate-pane --pane-id 20" "$CALLS"
refute "did NOT focus the shell pane"             "activate-pane --pane-id 32" "$CALLS"

echo
echo "== 5c''. revdiff is launched with the focus-claude post-flush command =="
# The flush->focus jump rides on revdiff's own --post-flush-command, not a keybind.
: > "$CALLS"
echo 31 > "$ACTIVE"                       # focus the diff pane
echo next >> "$T/state/cmd"               # uncommitted -> last-commit forces a relaunch
sleep 2
check "revdiff carries the post-flush hook"       "--post-flush-command \"echo focus-claude >> $T/state/cmd\"" "$CALLS"
echo prev >> "$T/state/cmd"               # back to uncommitted, restoring state for later sections
sleep 2
: > "$ACTIVE"                             # unfocus for the remaining sections

echo
echo "== 5d. cycling into Custom opens the ASCII prompt, unset revdiff until answered =="
# Custom asks for a branch/SHA every time you cycle in (pre-filled per agent).
# The daemon quits revdiff and types the prompt script into the SAME pane; it
# does NOT launch revdiff until the answer comes back through the cmd channel.
: > "$CALLS"
echo 31 > "$ACTIVE"                       # focus the diff pane
echo prev >> "$T/state/cmd"               # uncommitted -> custom (custom is last in the cycle)
sleep 2
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
sleep 2
check "revdiff diffs the given ref -> working tree" "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" \"main\"" "$CALLS"
check "...in the agent's OWN diff pane"            "send-text --pane-id 31" "$CALLS"
check "the per-agent ref was persisted"           "\"abc12345\":\"main\"" "$T/state/custom-refs.json"
check "the base was set was logged"               "custom range set for abc12345: main" "$T/daemon.log"

echo
echo "== 5d''. cancelling the prompt reverts to the previous mode =="
# Leave custom (now the mode is uncommitted), then cycle back in so the prompt
# opens with uncommitted as the mode to fall back to, and answer with a cancel.
echo next >> "$T/state/cmd"               # custom -> uncommitted
sleep 2
: > "$CALLS"
echo prev >> "$T/state/cmd"               # uncommitted -> custom, opens the prompt again
sleep 2
check "the prompt opened again"                   "cockpit-custom-prompt.mjs" "$CALLS"
: > "$CALLS"
printf '{"jobId":"abc12345","cancel":true}' > "$T/state/custom-ref-pending"
echo custom-cancel >> "$T/state/cmd"
sleep 2
check "cancel reverted to the prior mode"         '"diffMode":"uncommitted"' "$T/state/terminals.json"
check "and revdiff came back in that range"       "revdiff --wrap --no-confirm-discard --untracked -o \"$T/state/review-abc12345.md\" HEAD" "$CALLS"

echo
echo "== 5e. the diff mode is PER AGENT: a new agent is never carried into another's mode =="
# Put this agent in last-commit, switch to the OTHER agent, and it must come up
# in the uncommitted default -- not inherit last-commit. (Its parked revdiff was
# launched uncommitted and comes back untouched.)
echo 31 > "$ACTIVE"                       # focus abc12345's diff pane
echo next >> "$T/state/cmd"               # uncommitted -> last-commit for abc12345 only
sleep 2
check "this agent went to last-commit"            '"diffMode":"lastcommit"' "$T/state/terminals.json"
: > "$CALLS"; : > "$ACTIVE"
echo "second agent" > "$FLEETSTATE"       # switch to def67890
sleep 3
check "the OTHER agent shows the uncommitted default" '"diffMode":"uncommitted"' "$T/state/terminals.json"
refute "it did NOT inherit last-commit"           "HEAD~1 HEAD" "$CALLS"

echo
echo "== 5e'. switching back leaves abc12345 in its own last-commit, then reset =="
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"         # back to abc12345
sleep 3
check "abc12345 kept its own last-commit mode"    '"diffMode":"lastcommit"' "$T/state/terminals.json"
# Reset to the uncommitted default so the later sections see the default range.
echo 31 > "$ACTIVE"
echo prev >> "$T/state/cmd"               # last-commit -> uncommitted
sleep 2
check "reset to the uncommitted default"          '"diffMode":"uncommitted"' "$T/state/terminals.json"
: > "$ACTIVE"                             # unfocus for the remaining sections; back at the uncommitted default

echo
echo "== 6. back to the list: the repo shell returns, agents keep running =="
: > "$CALLS"
echo list > "$FLEETSTATE"
sleep 3

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
sleep 3

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
sleep 3
: > "$CALLS"
awk '$1 != 31' "$PANESTATE" > "$PANESTATE.x" && mv "$PANESTATE.x" "$PANESTATE"
sleep 4

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

MOVED="$T/moved"                          # where the agent went (its new worktree)
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
MOVED2="$T/moved2"
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
MOVED3="$T/moved3"; mkdir -p "$MOVED3"     # the watch is re-pointed, so it must exist
echo "32 file://$MOVED2" > "$PANECWD"      # its terminal sits at the previous worktree
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$MOVED3","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
: > "$CALLS"
sleep 3

check  "the mid-attach move was noticed"          "moved worktree" "$T/daemon.log"
check  "revdiff was re-pointed at the new dir"    'cd "'"$MOVED3"'" && revdiff' "$CALLS"
refute "revdiff did not stay on the old dir"      'cd "'"$MOVED2"'" && revdiff' "$CALLS"

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
sleep 3

check "the quit was noticed and revdiff reinstated" "reinstated it" "$T/daemon.log"
check "revdiff relaunched in the same diff pane"     "send-text --pane-id $DP" "$CALLS"
check "...on the current range"                      "revdiff --wrap --no-confirm-discard --untracked" "$CALLS"

echo
if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; sed -n '1,40p' "$T/daemon.log"; fi
exit $fail
