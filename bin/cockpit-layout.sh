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

# Everything here runs through `wezterm cli`, which reaches the GUI through a
# socket symlinked at default-org.wezfurlong.wezterm. If WezTerm was killed rather
# than quit, that symlink is left pointing at a dead instance and every cli call
# fails with "failed to connect". Repair it rather than failing three commands
# later with something unhelpful.
if ! wezterm cli list >/dev/null 2>&1; then
    SOCK_DIR="$HOME/.local/share/wezterm"
    LIVE=$(ls -t "$SOCK_DIR"/gui-sock-* 2>/dev/null | head -1)
    if [ -n "$LIVE" ]; then
        ln -sf "$LIVE" "$SOCK_DIR/default-org.wezfurlong.wezterm"
        echo "cockpit: repaired stale wezterm socket → $(basename "$LIVE")" >&2
    fi
    wezterm cli list >/dev/null 2>&1 || {
        echo "error: cannot reach the wezterm mux via 'wezterm cli'." >&2
        exit 1
    }
fi

# Both splits name their program explicitly. When this script is wired up as
# WezTerm's `default_prog` (see wezterm/cockpit.lua), a split that inherited the
# default would re-run this script and recurse without end.
LOGIN_SHELL="${SHELL:-/bin/zsh}"

# Top pane, full width, for revdiff. Splitting from the fleet pane leaves the
# fleet pane as the bottom 45%.
DIFF=$(wezterm cli split-pane --top --percent 55 --pane-id "$FLEET" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -l)

# Bottom-right shell, scoped to the repo until an agent is entered.
SHELL_PANE=$(wezterm cli split-pane --right --percent 50 --pane-id "$FLEET" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -l)

printf '{"diff":%s,"fleet":%s,"shell":%s,"repo":"%s"}\n' \
    "$DIFF" "$FLEET" "$SHELL_PANE" "$REPO" > "$DIR/panes.json"

# The diff pane shows something useful before any agent is entered.
wezterm cli send-text --pane-id "$DIFF" --no-paste \
    $'clear \&\& echo "cockpit ready — enter an agent in the fleet view"\n'

# Exactly one daemon, whichever window started it. Re-running this script is the
# normal way to rebuild the cockpit, so a stale daemon holding stale pane ids
# would otherwise type into panes that no longer exist.
pkill -f "cockpitd.mjs" 2>/dev/null || true

: > "$DIR/fleet.log"
nohup node "$HERE/cockpitd.mjs" >"$DIR/daemon.log" 2>&1 &
echo "cockpit: daemon pid $! · panes diff=$DIFF fleet=$FLEET shell=$SHELL_PANE"

wezterm cli activate-pane --pane-id "$FLEET" 2>/dev/null || true

# The cockpit is scoped to one repo, so its fleet view is too -- otherwise you can
# attach to an agent from an unrelated repo and the diff pane follows it out of
# the project. `--cwd` matches the REPO ROOT (worktrees normalise to their main
# repo), so passing $REPO is correct even when agents live in worktrees under it.
# Set COCKPIT_ALL_AGENTS=1 for the unfiltered fleet.
FLEET_ARGS=(--debug-file "$DIR/fleet.log")
[ -n "${COCKPIT_ALL_AGENTS:-}" ] || FLEET_ARGS+=(--cwd "$REPO")
exec claude agents "${FLEET_ARGS[@]}"
