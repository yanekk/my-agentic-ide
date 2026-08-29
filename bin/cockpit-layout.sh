#!/usr/bin/env bash
# Build the cockpit layout in WezTerm and start the follow daemon.
#
#   ┌──────────────────────────────────────────────┐
#   │  revdiff  (diff pane)                        │  42%
#   │  ...or, with no agent attached, the welcome  │
#   │  screen and the NOTES column beside it       │
#   ├──────────────────────┬───────────────────────┤
#   │ claude agents        │ shell @ worktree      │  58%
#   ├──────────────────────┴───────────────────────┤
#   │  key legend (footer)                         │  1 row
#   └──────────────────────────────────────────────┘
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
# Browse mode's two halves (DESIGN 2.3). Guarded here as well as in install.sh
# because the installer runs once and this runs on every window: a Homebrew
# upgrade that removed either one would otherwise show up as half the top pane
# failing a command once a second, with nothing saying why.
command -v micro   >/dev/null || die "micro not on PATH (brew install micro)"
command -v broot   >/dev/null || die "broot not on PATH (brew install broot)"

mkdir -p "$DIR"
FLEET="$WEZTERM_PANE"

# --- the `note` and `agenda` commands ----------------------------------------
# Both are used from any cockpit terminal and from nowhere else. There is no
# install step and nothing lands on your normal PATH: each command is a symlink in
# a directory only the cockpit's own shells ever see. Re-linked on every rebuild,
# which is also how a moved or renamed checkout repairs itself.
#
# `agenda`, not `cal`: /usr/bin/cal already exists, this directory is PREPENDED to
# PATH, and the agents inherit it -- so a `cal` symlink would shadow the month grid
# in every cockpit terminal and in every agent (DESIGN 2.2).
COCKPIT_BIN="$DIR/bin"
mkdir -p "$COCKPIT_BIN"
ln -sf "$HERE/cockpit-note.mjs" "$COCKPIT_BIN/note"
ln -sf "$HERE/cockpit-agenda.mjs" "$COCKPIT_BIN/agenda"
# Not a command anyone types: broot's Enter verb runs `cockpit-open {file} {line}`
# (bin/cockpit-browse-verbs.hjson), and a verb naming a command that is not on the
# browser's PATH fails silently -- broot with `leave_broot: false` shows no output.
# It lives here because this is the directory the daemon already names on a split's
# command line, splits inheriting no environment of their own.
ln -sf "$HERE/cockpit-open.mjs" "$COCKPIT_BIN/cockpit-open"

# Exported HERE, before anything is spawned, so it reaches (a) the daemon started
# below, which passes it on to every terminal it opens, and (b) `claude agents` at
# the foot of this script -- so the AGENTS inherit it too and can leave notes of
# their own, which is the point of letting them have it.
#
# Panes split by `wezterm cli` do NOT inherit any of this: they are spawned by the
# mux SERVER, which has its own environment from whenever WezTerm started, not by
# this script. So every split that needs the command names the env explicitly (see
# the shell split below, and insertIntoSlot in cockpitd.mjs).
export COCKPIT_BIN COCKPIT_REPO="$REPO"
export PATH="$COCKPIT_BIN:$PATH"

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
#
# Sized in CELLS, not percent: the legend is a single line, so a percentage grows
# it to 3-4 rows of dead space on a tall window. `--cells 1` starts it at one
# row -- but it does not KEEP it there. WezTerm has no fixed-size pane: the split
# is stored as a share of the window and re-applied on every resize and font-size
# change, so the bar drifts taller again. cockpit-strip.mjs pins itself back
# whenever it notices; see the note there.
FOOTER=$(wezterm cli split-pane --bottom --cells 1 --pane-id "$FLEET" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -lc "exec node '$HERE/cockpit-strip.mjs' footer")

# Top pane, full width. While no agent is attached it shows the welcome screen
# (cockpit-welcome.mjs); entering an agent parks it and swaps in that agent's
# revdiff. Run through a login shell so it inherits Homebrew's PATH and finds
# node, then exec the renderer so no shell lingers under it -- the same recipe
# as the strip and footer, which lets the daemon own this as the REPO_KEY diff
# pane without ever launching revdiff into it.
DIFF=$(wezterm cli split-pane --top --percent 42 --pane-id "$FLEET" --cwd "$REPO" \
       -- "$LOGIN_SHELL" -lc "exec node '$HERE/cockpit-welcome.mjs'")

# Bottom-right shell, scoped to the repo until an agent is entered. Spawned
# through `env` because the mux server, not this script, is its parent -- that is
# what puts the cockpit's `note` on its PATH (see the export above).
SHELL_PANE=$(wezterm cli split-pane --right --percent 50 --pane-id "$FLEET" --cwd "$REPO" \
       -- /usr/bin/env "COCKPIT_REPO=$REPO" "PATH=$PATH" "$LOGIN_SHELL" -l)

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

# The diff pane runs the welcome renderer (see the split above), so nothing is
# typed into it here.

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

# `Esc` in the fleet view quits `claude agents`. If this were `exec claude agents`
# that exit would end the fleet pane's process and, since it is a pane in a larger
# tab, close the pane -- the whole cockpit layout breaks and the daemon is left
# targeting a pane id that no longer exists. So DON'T exec: run it in a loop that
# relaunches on every exit, keeping this same pane (and its id) alive so a stray
# `Esc` just puts the fleet list right back. Quitting the cockpit is done by
# closing the window (agents die with it), not by exiting the fleet view.
#
# Guard against a tight spin: if `claude agents` keeps dying immediately (e.g. a
# broken binary), stop relaunching after a few fast exits and drop to a shell so
# the failure is visible on screen rather than a pane that flickers forever.
fast_exits=0
while true; do
    start=$SECONDS
    claude agents "${FLEET_ARGS[@]}"
    if [ $(( SECONDS - start )) -lt 2 ]; then
        fast_exits=$(( fast_exits + 1 ))
        [ "$fast_exits" -ge 5 ] && die "claude agents exited immediately 5 times in a row"
    else
        fast_exits=0
    fi
done
