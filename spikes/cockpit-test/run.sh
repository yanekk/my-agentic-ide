#!/usr/bin/env bash
# Integration test for cockpitd, with WezTerm stubbed out.
#
# Replaces `wezterm` on PATH with a shim that records every invocation (argv plus
# stdin) so the daemon's actual output can be asserted on without a real terminal.
# Drives a fake fleet log through a full attach -> review -> detach cycle.
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
# terminals: `get-text` renders a fake fleet pane from $FLEETSTATE (which is how
# the daemon decides what is attached), and `list`/`split-pane`/
# `move-pane-to-new-tab`/`kill-pane` operate on a tiny pane table in $PANESTATE
# (lines: "<pane-id> <tab-id>"). Pane ids are handed out in order, so the
# assertions below can name them.
export CALLS="$T/calls.log"
export FLEETSTATE="$T/fleetstate"
export PANESTATE="$T/panestate"
export NEXTPANE="$T/nextpane"
export NEXTTAB="$T/nexttab"
: > "$CALLS"
echo list > "$FLEETSTATE"
printf '10 0\n20 0\n30 0\n' > "$PANESTATE"   # diff, fleet, repo shell
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
  if [ "$sub" = "send-text" ] && [ ! -t 0 ]; then printf 'STDIN:%s\n' "$(cat | sed -e 's/$/\\n/' | tr -d '\n')"; fi
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

case "$sub" in
  get-text)
    s=$(cat "$FLEETSTATE")
    if [ "$s" = "list" ]; then
        printf '  enter to collapse\n❯ describe a task for a new session\n'
    else
        printf -- '──────────────────────────── %s ─\n❯ \n' "$s"
    fi
    ;;
  list)
    awk 'BEGIN{printf "["}
         { printf "%s{\"window_id\":0,\"tab_id\":%s,\"pane_id\":%s,\"workspace\":\"default\",\"size\":{\"rows\":10,\"cols\":40},\"title\":\"sh\",\"cwd\":\"file:///tmp\",\"is_active\":false}", (NR>1 ? "," : ""), $2, $1 }
         END{printf "]\n"}' "$PANESTATE"
    ;;
  split-pane)
    moved=$(flag --move-pane-id "$@")
    if [ -n "$moved" ]; then                       # bring a parked pane back
      awk -v p="$moved" '{ if ($1 == p) print $1, 0; else print }' "$PANESTATE" > "$PANESTATE.tmp"
      rewrite
      printf '%s\n' "$moved"
    else
      id=$(cat "$NEXTPANE"); echo $((id + 1)) > "$NEXTPANE"
      printf '%s 0\n' "$id" >> "$PANESTATE"
      printf '%s\n' "$id"
    fi
    ;;
  move-pane-to-new-tab)                            # park
    pane=$(flag --pane-id "$@")
    tab=$(cat "$NEXTTAB"); echo $((tab + 1)) > "$NEXTTAB"
    awk -v p="$pane" -v t="$tab" '{ if ($1 == p) print $1, t; else print }' "$PANESTATE" > "$PANESTATE.tmp"
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
HOME="$T/home" COCKPIT_DIR="$T/state" COCKPIT_REAP_MS=700 \
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

MB=$(git -C "$WT" merge-base main HEAD)
check "diff pane told to cd to the worktree"     "cd \"$WT\"" "$CALLS"
check "revdiff invoked with --untracked"         "revdiff --untracked" "$CALLS"
check "diff range is the merge-base commit"      "$MB" "$CALLS"
check "annotations routed to a per-job file"     "review-abc12345.md" "$CALLS"
check "diff pane addressed"                      "--pane-id 10" "$CALLS"
check "repo shell parked, not reused"            "move-pane-to-new-tab --pane-id 30" "$CALLS"
check "a terminal opened in the agent worktree"  "--cwd $WT --" "$CALLS"
check "opened terminal is pane 31"               "opened terminal pane 31" "$T/daemon.log"
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
check "first agent's terminal parked, not killed" "move-pane-to-new-tab --pane-id 31" "$CALLS"
check "second agent got its own terminal"        "--cwd $WT2 --" "$CALLS"
refute "nothing was killed on a switch"          "kill-pane" "$CALLS"

echo
echo "== 5. switching BACK restores the same terminal (the whole point) =="
# The pane is moved, never respawned: whatever was running in it is still
# running, and its scrollback comes back with it.
: > "$CALLS"
echo "test agent" > "$FLEETSTATE"
sleep 3

check "the original pane is moved back in"       "--move-pane-id 31" "$CALLS"
check "daemon says restored, not opened"         "restored terminal pane 31" "$T/daemon.log"
refute "no second shell spawned for that agent"  "--cwd $WT --" "$CALLS"
check "second agent's terminal parked in turn"   "move-pane-to-new-tab --pane-id 32" "$CALLS"

echo
echo "== 6. back to the list: the repo shell returns, agents keep running =="
: > "$CALLS"
echo list > "$FLEETSTATE"
sleep 3

check "repo shell moved back into the slot"      "--move-pane-id 30" "$CALLS"
refute "no agent terminal was killed on detach"  "kill-pane" "$CALLS"

echo
echo "== 7. an agent that leaves the fleet has its terminal reaped =="
# Two consecutive misses are required, so one bad read cannot kill a shell.
: > "$CALLS"
cat > "$AGENTS_JSON" <<JSON
[{"pid":1,"id":"abc12345","cwd":"$WT","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"}]
JSON
sleep 3

check "the vanished agent's pane was killed"     "kill-pane --pane-id 32" "$CALLS"
check "reaping was logged with the job id"       "agent def67890 is gone" "$T/daemon.log"
refute "the surviving agent kept its terminal"   "kill-pane --pane-id 31" "$CALLS"
refute "the repo shell is never reaped"          "kill-pane --pane-id 30" "$CALLS"

echo
if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; sed -n '1,40p' "$T/daemon.log"; fi
exit $fail
