#!/usr/bin/env bash
# Install the cockpit on this machine.
#
#   bin/install.sh [--start-dir PATH] [--check] [--force] [--no-link]
#
# Three idempotent steps:
#   1. check the tools the cockpit shells out to, through a LOGIN shell
#   2. write ~/.claude/cockpit/config.lua -- where this checkout lives, and which
#      directory the fleet view opens in ($HOME/src on one machine, $HOME/git on
#      another)
#   3. point ~/.wezterm.lua at wezterm/cockpit.lua in this checkout
#
# Step 2 is what makes the checkout location-agnostic. A symlinked ~/.wezterm.lua
# makes `wezterm.config_file` report the SYMLINK rather than its target, so the
# config cannot find its own directory and used to fall back to a hardcoded
# $HOME/src/agentic-ide -- which broke for any other clone name or projects root.
# The installer knows both paths for certain, so it records them.
#
#   --start-dir PATH  projects root the fleet view opens in. Remembered, so later
#                     runs need it only when it changes. Falls back to whichever
#                     of ~/src or ~/git exists.
#   --check           report prerequisites and planned changes, write nothing.
#   --force           replace an existing ~/.wezterm.lua that is not ours (a copy
#                     is kept alongside it).
#   --no-link         leave ~/.wezterm.lua alone; launch with
#                     `wezterm --config-file <repo>/wezterm/cockpit.lua start`.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "$HERE/.." && pwd -P)"
DIR="$HOME/.claude/cockpit"
CONFIG="$DIR/config.lua"
LINK="$HOME/.wezterm.lua"
TARGET="$REPO/wezterm/cockpit.lua"

CHECK_ONLY=0
FORCE=0
DO_LINK=1
START_DIR="${COCKPIT_START_DIR:-}"

# Only when stdout is a terminal -- piped into a file or a CI log, escape codes
# are noise, and this script is exactly the thing someone pipes to a colleague.
if [ -t 1 ]; then
    bold=$(tput bold 2>/dev/null || true)
    dim=$(tput dim 2>/dev/null || true)
    off=$(tput sgr0 2>/dev/null || true)
else
    bold=""; dim=""; off=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  warn  %s\n' "$*"; }
bad()  { printf '  MISS  %s\n' "$*"; }
die()  { printf '\ninstall: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --start-dir) [ $# -ge 2 ] || die "--start-dir needs a path"; START_DIR="$2"; shift 2 ;;
        --start-dir=*) START_DIR="${1#*=}"; shift ;;
        --check)   CHECK_ONLY=1; shift ;;
        --force)   FORCE=1; shift ;;
        --no-link) DO_LINK=0; shift ;;
        -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1 (try --help)" ;;
    esac
done

[ -f "$TARGET" ] || die "$TARGET is missing -- is $REPO a complete checkout?"

say "${bold}cockpit installer${off}"
say "  checkout   $REPO"

# --- 1. prerequisites ------------------------------------------------------
#
# Checked through a LOGIN shell on purpose, and in a SANITIZED environment.
# Launched from Finder or Spotlight, WezTerm inherits launchd's minimal PATH
# (/usr/bin:/bin:/usr/sbin:/sbin) and sources the login profile to recover the
# rest -- that login-shell PATH is what the cockpit actually runs with. Checking
# through the *current* shell's inherited PATH would hide exactly the failure
# this is meant to catch: a tool that lives only on the interactive PATH -- an
# nvm-managed `node`, say, whose setup is in ~/.zshrc, which a non-interactive
# login shell never sources -- would pass here and then be missing when the
# window opens. So reset PATH to launchd's minimum first, then reproduce the same
# prepends bin/cockpit-layout.sh applies, and only then look.
LOGIN_SHELL="${SHELL:-/bin/zsh}"
LAUNCHD_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
# Mirror the safety-net PATH prepend in bin/cockpit-layout.sh -- keep in sync.
PREPEND='for p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do case ":$PATH:" in *":$p:"*) ;; *) [ -d "$p" ] && PATH="$p:$PATH";; esac; done; export PATH; '
# Resolve $1 the way the cockpit will: print its path, or nothing if missing.
resolve() {
    env -i HOME="$HOME" USER="${USER:-}" SHELL="$LOGIN_SHELL" TERM="${TERM:-xterm}" \
        PATH="$LAUNCHD_PATH" "$LOGIN_SHELL" -lc "${PREPEND}command -v -- $1" 2>/dev/null
}

say ""
say "${bold}prerequisites${off} ${dim}(as the cockpit window will see them)${off}"
MISSING=0
check_tool() {
    local tool="$1" hint="$2" path
    path="$(resolve "$tool")"
    if [ -n "$path" ]; then
        ok "$(printf '%-8s %s' "$tool" "$path")"
    else
        bad "$(printf '%-8s %s' "$tool" "$hint")"
        MISSING=$((MISSING + 1))
    fi
}
check_tool wezterm "brew install --cask wezterm"
check_tool revdiff "brew tap umputun/apps && brew install revdiff"
check_tool node    "brew install node"
check_tool claude  "https://claude.com/product/claude-code"
check_tool git     "xcode-select --install"
# Browse mode's two halves. Required, not optional: with `micro` absent, entering
# browse mode leaves half the top pane sitting at a failed command, which the 1s
# healer then retries for the life of the window. Both are single Homebrew
# binaries, so "required" costs nothing anyone would notice.
check_tool micro   "brew install micro"
check_tool broot   "brew install broot"

# --- 2. where the fleet view opens ----------------------------------------
#
# Order: what was asked for, then what a previous run recorded, then whichever
# conventional projects root exists. Remembering beats re-detecting -- a machine
# can have both ~/src and ~/git while only one of them is where work lives.
REMEMBERED=""
if [ -f "$CONFIG" ]; then
    REMEMBERED="$(sed -n 's/^[[:space:]]*start_dir = "\(.*\)",*$/\1/p' "$CONFIG" | head -1)"
fi
SOURCE="--start-dir"
if [ -z "$START_DIR" ] && [ -n "$REMEMBERED" ]; then
    START_DIR="$REMEMBERED"; SOURCE="remembered from $CONFIG"
fi
if [ -z "$START_DIR" ]; then
    for candidate in "$HOME/src" "$HOME/git"; do
        [ -d "$candidate" ] && { START_DIR="$candidate"; SOURCE="found on this machine"; break; }
    done
fi
[ -n "$START_DIR" ] || die "no projects root found (looked for ~/src and ~/git).
         Pass one: bin/install.sh --start-dir \"\$HOME/work\""

# Absolute, symlinks resolved -- it is handed to WezTerm as default_cwd and to
# `claude agents --cwd`, neither of which runs from here.
[ -d "$START_DIR" ] || die "projects root does not exist: $START_DIR"
START_DIR="$(cd "$START_DIR" && pwd -P)"

say ""
say "${bold}projects root${off}"
ok "$START_DIR  ${dim}($SOURCE)${off}"
case "$REPO" in
    "$START_DIR"/*) ;;
    *) warn "this checkout is outside it; that is fine, the fleet view just starts elsewhere" ;;
esac

# --- 3. plan the ~/.wezterm.lua link ---------------------------------------
#
# The repo's own docs make a point of cockpit.lua being separate from your
# ~/.wezterm.lua so it can be tried without disturbing an existing setup. So a
# real config of your own is never replaced silently: --force copies it aside
# first, and --no-link skips this entirely.
LINK_PLAN="link"
LINK_NOTE=""
if [ "$DO_LINK" -eq 0 ]; then
    LINK_PLAN="skip"; LINK_NOTE="--no-link"
elif [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$TARGET" ]; then
    LINK_PLAN="none"; LINK_NOTE="already points here"
elif [ -L "$LINK" ]; then
    LINK_PLAN="relink"; LINK_NOTE="currently -> $(readlink "$LINK")"
elif [ -e "$LINK" ]; then
    if [ "$FORCE" -eq 1 ]; then
        LINK_PLAN="replace"; LINK_NOTE="a copy is kept"
    else
        LINK_PLAN="blocked"; LINK_NOTE="your own config is there"
    fi
fi

say ""
say "${bold}~/.wezterm.lua${off}"
case "$LINK_PLAN" in
    none)    ok "$LINK -> $TARGET  ${dim}($LINK_NOTE)${off}" ;;
    link)    say "  will link $LINK -> $TARGET" ;;
    relink)  say "  will relink $LINK -> $TARGET  ${dim}($LINK_NOTE)${off}" ;;
    replace) say "  will replace $LINK  ${dim}($LINK_NOTE)${off}" ;;
    skip)    warn "left alone ${dim}($LINK_NOTE)${off}" ;;
    blocked) warn "left alone -- $LINK_NOTE" ;;
esac

# --- 3b. plan the session-naming hook --------------------------------------
#
# Registered in ~/.claude/settings.json rather than published on PATH the way
# `note` and `agenda` are, because it must apply to EVERY claude session -- an
# agent dispatched from the fleet view is an ordinary session, and naming it is
# the whole point. cockpit-auto-name.mjs owns the merge itself (--install), so
# the knowledge of where it hooks lives with the hook and the tests drive the
# same code path this does.
NAMING="$REPO/bin/cockpit-auto-name.mjs"
say ""
say "${bold}session naming${off} ${dim}(~/.claude/settings.json)${off}"
if [ ! -f "$NAMING" ]; then
    warn "cockpit-auto-name.mjs is missing -- skipping"
    NAMING=""
elif ! command -v node >/dev/null 2>&1; then
    warn "no node on this PATH -- skipping (it is checked above)"
    NAMING=""
else
    NAMING_PLAN="$(node "$NAMING" --check 2>&1)" || {
        warn "$NAMING_PLAN"
        NAMING=""
    }
    [ -n "$NAMING" ] && ok "$NAMING_PLAN"
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
    say ""
    say "--check: nothing written."
    [ "$MISSING" -eq 0 ] || exit 1
    exit 0
fi

[ "$MISSING" -eq 0 ] || die "$MISSING prerequisite(s) missing -- install them and re-run."

# --- 4. write ---------------------------------------------------------------
mkdir -p "$DIR" || die "could not create $DIR"

# Lua rather than JSON so wezterm can `dofile` it -- no parsing, and it stays
# hand-editable. cockpit.lua reads it; nothing else does.
cat > "$CONFIG" <<EOF
-- Written by bin/install.sh. Safe to edit by hand, or re-run the installer.
--
-- repo       this checkout, so wezterm/cockpit.lua can find bin/cockpit-layout.sh
--            without guessing (a symlinked ~/.wezterm.lua hides its own location)
-- start_dir  the projects root the fleet view opens in
return {
  repo = "$REPO",
  start_dir = "$START_DIR",
}
EOF
say ""
ok "wrote $CONFIG"

# Idempotent, and re-points itself if this checkout moved -- so a re-run after a
# rename or a re-clone repairs the hook the same way it repairs config.lua.
if [ -n "$NAMING" ]; then
    if OUT="$(node "$NAMING" --install 2>&1)"; then
        ok "$OUT"
    else
        warn "could not register the naming hook: $OUT"
    fi
fi

case "$LINK_PLAN" in
    replace)
        BACKUP="$LINK.before-cockpit"
        [ -e "$BACKUP" ] && BACKUP="$BACKUP.$$"
        cp -p "$LINK" "$BACKUP" || die "could not back up $LINK"
        ln -sfn "$TARGET" "$LINK" || die "could not write $LINK"
        ok "linked $LINK -> $TARGET"
        warn "your previous config: $BACKUP"
        warn "restore with: mv \"$BACKUP\" \"$LINK\""
        ;;
    link|relink)
        ln -sfn "$TARGET" "$LINK" || die "could not write $LINK"
        ok "linked $LINK -> $TARGET"
        ;;
esac

# --- 5. what to do next -----------------------------------------------------
say ""
if [ "$LINK_PLAN" = "blocked" ]; then
    say "${bold}Not finished.${off} $LINK is your own config, so it was not touched."
    say "Either keep it and launch the cockpit explicitly:"
    say "    wezterm --config-file '$TARGET' start"
    say "or hand it over (a copy is kept):"
    say "    '$HERE/install.sh' --force"
elif [ "$LINK_PLAN" = "skip" ]; then
    say "${bold}Installed.${off} Launch it with:"
    say "    wezterm --config-file '$TARGET' start"
else
    say "${bold}Installed.${off} Open WezTerm -- that is all. It builds the panes,"
    say "starts the daemon, and opens the fleet view in $START_DIR."
    say ""
    say "${dim}Already open? Quit and reopen it; that is how the cockpit rebuilds.${off}"
fi
