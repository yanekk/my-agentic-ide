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
set -uo pipefail

REPO="${1:-$PWD}"
DIR="$HOME/.claude/cockpit"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# This script is WezTerm's `default_prog`, so it is pane 1 of a brand-new window.
# If it exits, the pane closes -- and with one pane, so does the whole window,
# which looks exactly like "WezTerm is broken" with no clue why. So every failure
# path drops into a normal login shell instead, leaving the error on screen.
die() {
    echo "cockpit: $*" >&2
    echo "cockpit: falling back to a plain shell." >&2
    exec "${SHELL:-/bin/zsh}" -l
}

# A GUI app launched from Finder or Spotlight inherits launchd's minimal PATH
# (/usr/bin:/bin:/usr/sbin:/sbin) rather than a shell's, so Homebrew is missing
# and every tool below looks uninstalled. The config launches this through a login
# shell, which normally fixes it; this is the safety net for when it does not.
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
    case ":$PATH:" in
        *":$p:"*) ;;
        *) [ -d "$p" ] && PATH="$p:$PATH" ;;
    esac
done
export PATH

[ -n "${WEZTERM_PANE:-}" ] || die "not inside a WezTerm pane (WEZTERM_PANE unset)"
command -v wezterm >/dev/null || die "wezterm cli not on PATH"
command -v revdiff >/dev/null || die "revdiff not on PATH"
command -v node    >/dev/null || die "node not on PATH"
command -v claude  >/dev/null || die "claude not on PATH"

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
    wezterm cli list >/dev/null 2>&1 || die "cannot reach the wezterm mux via 'wezterm cli'"
fi

# Both splits name their program explicitly. When this script is wired up as
# WezTerm's `default_prog` (see wezterm/cockpit.lua), a split that inherited the
# default would re-run this script and recurse without end.
LOGIN_SHELL="${SHELL:-/bin/zsh}"

# A thin full-width key-legend bar at the very bottom, so the terminal gestures
# are always discoverable. Split FIRST, while the fleet pane still fills the
# window, so it spans the full width; every later split happens in the region
# above it and leaves it untouched (measured). It renders terminals.json in
# `footer` mode -- pure display, so the daemon never parks or manages it.
FOOTER=$(wezterm cli split-pane --bottom --percent 5 --pane-id "$FLEET" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -lc "exec node '$HERE/cockpit-strip.mjs' footer")

# Top pane, full width, for revdiff. Splitting from the fleet pane leaves the
# fleet pane as the bottom 45%.
DIFF=$(wezterm cli split-pane --top --percent 55 --pane-id "$FLEET" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -l)

# Bottom-right shell, scoped to the repo until an agent is entered.
SHELL_PANE=$(wezterm cli split-pane --right --percent 50 --pane-id "$FLEET" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -l)

# The terminal-list strip clings to the right edge of the shell (VSCode's
# terminal-tab list). It is a pure display pane -- cockpitd writes terminals.json
# and this renders it -- so the daemon never parks it. Run through a login shell
# so it inherits Homebrew's PATH and finds node; exec so no shell lingers under
# it. If node is missing the pane just shows the error, which is fine.
STRIP=$(wezterm cli split-pane --right --percent 20 --pane-id "$SHELL_PANE" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -lc "exec node '$HERE/cockpit-strip.mjs'")

# split-pane prints the new pane id; anything else means the layout is not what
# the daemon will assume, so stop before writing a state file that lies.
case "$FOOTER$DIFF$SHELL_PANE$STRIP" in
    *[!0-9]*|"") die "could not split panes (got footer='$FOOTER' diff='$DIFF' shell='$SHELL_PANE' strip='$STRIP')" ;;
esac

# `foot` is recorded for completeness/debugging; the daemon never touches it.
printf '{"diff":%s,"fleet":%s,"shell":%s,"strip":%s,"foot":%s,"repo":"%s"}\n' \
    "$DIFF" "$FLEET" "$SHELL_PANE" "$STRIP" "$FOOTER" "$REPO" > "$DIR/panes.json"

# The diff pane shows something useful before any agent is entered.
wezterm cli send-text --pane-id "$DIFF" --no-paste \
    $'clear \&\& echo "cockpit ready — enter an agent in the fleet view"\n'

# Exactly one daemon, whichever window started it. Re-running this script is the
# normal way to rebuild the cockpit, so a stale daemon holding stale pane ids
# would otherwise type into panes that no longer exist.
pkill -f "cockpitd.mjs" 2>/dev/null || true

: > "$DIR/fleet.log"
# Truncate the terminal-command channel so a keypress from a previous window is
# not replayed into this one.
: > "$DIR/cmd"
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
