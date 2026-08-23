#!/usr/bin/env bash
# Build the cockpit layout in WezTerm and start the follow daemon.
#
#   ┌──────────────────────────────────────────────┐
#   │  revdiff  (diff pane)                        │  55%
#   ├──────────────────────┬───────────────────────┤
#   │ claude agents        │ shell @ worktree      │  45%
#   └──────────────────────┴───────────────────────┘
#
# Run this from inside a WezTerm pane. That pane becomes the fleet pane, so the
# script ends by exec'ing `claude agents` into it.
#
#   ./bin/cockpit-layout.sh [repo-path]
#
# WezTerm panes die with the window, so re-running this is the normal way to get
# the cockpit back -- it is meant to be cheap, not precious.
set -euo pipefail

REPO="${1:-$PWD}"
DIR="$HOME/.claude/cockpit"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${WEZTERM_PANE:-}" ]; then
    echo "error: not inside a WezTerm pane (WEZTERM_PANE unset)." >&2
    echo "       open WezTerm and run this there." >&2
    exit 1
fi
command -v wezterm >/dev/null || { echo "error: wezterm cli not on PATH" >&2; exit 1; }
command -v revdiff >/dev/null || { echo "error: revdiff not on PATH" >&2; exit 1; }
command -v node    >/dev/null || { echo "error: node not on PATH" >&2; exit 1; }

mkdir -p "$DIR"
FLEET="$WEZTERM_PANE"

# Top pane, full width, for revdiff. Splitting from the fleet pane leaves the
# fleet pane as the bottom 45%.
DIFF=$(wezterm cli split-pane --top --percent 55 --pane-id "$FLEET" --cwd "$REPO")

# Bottom-right shell, scoped to the repo until an agent is entered.
SHELL_PANE=$(wezterm cli split-pane --right --percent 50 --pane-id "$FLEET" --cwd "$REPO")

printf '{"diff":%s,"fleet":%s,"shell":%s,"repo":"%s"}\n' \
    "$DIFF" "$FLEET" "$SHELL_PANE" "$REPO" > "$DIR/panes.json"

# The diff pane shows something useful before any agent is entered.
wezterm cli send-text --pane-id "$DIFF" --no-paste \
    $'clear \&\& echo "cockpit ready — enter an agent in the fleet view"\n'

: > "$DIR/fleet.log"
nohup node "$HERE/cockpitd.mjs" >"$DIR/daemon.log" 2>&1 &
echo "cockpit: daemon pid $! · panes diff=$DIFF fleet=$FLEET shell=$SHELL_PANE"

wezterm cli activate-pane --pane-id "$FLEET" 2>/dev/null || true
exec claude agents --debug-file "$DIR/fleet.log"
