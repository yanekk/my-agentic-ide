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
CALLS="$T/calls.log"
: > "$CALLS"

# --- stub wezterm ----------------------------------------------------------
# Records every call, and emulates `cli get-text` by rendering a fake fleet pane
# from $T/fleetstate -- which is how the daemon now decides what is attached.
FLEETSTATE="$T/fleetstate"
echo list > "$FLEETSTATE"

cat > "$T/bin/wezterm" <<EOF
#!/usr/bin/env bash
if [ "\${2:-}" = "get-text" ]; then
    s=\$(cat "$FLEETSTATE")
    if [ "\$s" = "list" ]; then
        printf '  enter to collapse\n❯ describe a task for a new session\n'
    else
        printf -- '──────────────────────────── %s ─\n❯ \n' "\$s"
    fi
    exit 0
fi
{
  printf 'ARGV:'
  for a in "\$@"; do printf ' %q' "\$a"; done
  printf '\n'
  if [ ! -t 0 ]; then printf 'STDIN:%s\n' "\$(cat | sed -e 's/\$/\\\\n/' | tr -d '\n')"; fi
  printf 'END\n'
} >> "$CALLS"
EOF
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
cat > "$T/bin/claude" <<EOF
#!/usr/bin/env bash
[ "\$1" = "agents" ] && cat <<'JSON'
[{"pid":1,"id":"abc12345","cwd":"$WT","kind":"background",
  "sessionId":"s","name":"test agent","startedAt":0,"status":"idle","state":"done"},
 {"pid":2,"id":"def67890","cwd":"$WT2","kind":"background",
  "sessionId":"s2","name":"second agent","startedAt":0,"status":"idle","state":"done"}]
JSON
EOF
chmod +x "$T/bin/claude"

# --- state -----------------------------------------------------------------
echo '{"diff":10,"fleet":20,"shell":30,"repo":"'"$WT"'"}' > "$T/state/panes.json"
: > "$T/state/fleet.log"

COCKPIT_DIR="$T/state" node "$ROOT/bin/cockpitd.mjs" > "$T/daemon.log" 2>&1 &
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
check "shell pane retargeted too"                "--pane-id 30" "$CALLS"
check "diff pane addressed"                      "--pane-id 10" "$CALLS"

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
echo "== 4. switch A→B with NO log line: the pane itself is the signal =="
: > "$CALLS"
echo "second agent" > "$FLEETSTATE"     # nothing appended to fleet.log
sleep 3

check "followed to the second agent's worktree"  "cd \"$WT2\"" "$CALLS"
check "resolved it by the name in the header"    "enter def67890" "$T/daemon.log"
check "review file re-keyed to the new job"      "review-def67890.md" "$CALLS"
refute "did not stay on the first worktree"      "cd \"$WT\" " "$CALLS"

echo
if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; sed -n '1,40p' "$T/daemon.log"; fi
exit $fail
