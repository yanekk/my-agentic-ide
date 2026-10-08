#!/usr/bin/env bash
# Tests for the fleet-picker ← decision and its binding (plans/fleet-picker T01, DESIGN §2.1,
# §2.2, §3.1, §3.3, §4).
#
# There is no standalone Lua here, so the pure decide() runs inside WezTerm's own Lua: decide.lua
# is evaluated as a config by `wezterm show-keys`, which opens no window (~45ms). The binding is
# checked the same way, on a scratch copy of the checkout with a scratch HOME, so neither the
# person's config.lua nor their terminals.json is read. Prints failures in full and then one
# line, `fleet-picker-keys-test: ALL PASS (N checks)` or `fleet-picker-keys-test: FAILURES (...)`.
# No colour.
#
#   bash spikes/fleet-picker-keys-test/run.sh          VERBOSE=1 lists every check
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MODULE="$ROOT/wezterm/fleet-picker.lua"
COCKPIT_LUA="$ROOT/wezterm/cockpit.lua"

pass=0
fail=0
check() { # $1 name, $2 0/1 ok, $3 detail on failure
  if [ "$2" -eq 1 ]; then pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && echo "  ok   $1"
  else echo "  FAIL $1${3:+: $3}"; fail=$((fail + 1)); fi
  return 0
}

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/fleet-picker-keys.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/home/.claude/cockpit"

# Runs one harness ($2) as a config under `wezterm show-keys` and counts its ok/FAIL lines,
# prefixed $1. Extra `VAR=value` arguments are passed into its environment.
run_harness() { # $1 prefix, $2 harness, $3... env assignments
  local prefix="$1" harness="$2"; shift 2
  local out="$SCRATCH/$prefix.out" log="$SCRATCH/$prefix.log" line
  rm -f "$out"
  if env HOME="$SCRATCH/home" FPK_OUT="$out" "$@" \
       wezterm --config-file "$harness" show-keys >"$log" 2>&1 && [ -s "$out" ]; then
    while IFS= read -r line; do
      case "$line" in
        "ok "*)   check "$prefix: ${line#ok }" 1 ;;
        "FAIL "*) check "$prefix: ${line#FAIL }" 0 ;;
        "")       ;;
        *)        check "$prefix: unrecognised result line" 0 "$line" ;;
      esac
    done <"$out"
  else
    check "$prefix: $(basename "$harness") ran under wezterm show-keys" 0 "$(tail -5 "$log")"
  fi
}

# --- decide(), every case, in WezTerm's Lua ----------------------------------------
run_harness decide "$HERE/decide.lua" FPK_MODULE="$MODULE"

# --- the module keeps its side of the boundary (DESIGN §3.1) -------------------------
# If this fails, move the code into cockpit.lua; never relax the pattern.
if [ -f "$MODULE" ]; then
  impure="$(grep -nE 'io\.|os\.|wezterm\.|require' "$MODULE")"
  check "fleet-picker.lua touches no io., os., wezterm. or require" \
        "$([ -z "$impure" ] && echo 1 || echo 0)" "$impure"
else
  check "wezterm/fleet-picker.lua exists" 0
fi

# --- the claude marker contains cockpitd's LIST_MARKER (DESIGN §2.2) ------------------
# Both strings read from the real files, so a reworded marker on either side fails here.
list_marker="$(sed -n 's/^const LIST_MARKER = "\(.*\)";$/\1/p' "$ROOT/bin/cockpitd.mjs" | head -1)"
claude_empty="$(sed -n 's/^M\.CLAUDE_EMPTY = "\(.*\)"$/\1/p' "$MODULE" | head -1)"
check "LIST_MARKER found in bin/cockpitd.mjs" "$([ -n "$list_marker" ] && echo 1 || echo 0)"
check "M.CLAUDE_EMPTY found in wezterm/fleet-picker.lua" "$([ -n "$claude_empty" ] && echo 1 || echo 0)"
case "$claude_empty" in
  *"$list_marker"*) ok=1 ;;
  *) ok=0 ;;
esac
[ -z "$list_marker" ] && ok=0
check "M.CLAUDE_EMPTY contains LIST_MARKER" "$ok" "'$claude_empty' vs '$list_marker'"

# --- cockpit.lua binds ← through the module, and not without it ------------------------
# A scratch copy of the checkout's shape: cockpit.lua finds the layout script at
# wezterm/../bin/ (the "config read from the repo" candidate, since the scratch HOME has no
# config.lua) and loads the module from that checkout. Only the default key table is read:
# copy_mode has its own unmodified `LeftArrow -> CopyMode(MoveLeft)`.
mkdir -p "$SCRATCH/repo/wezterm" "$SCRATCH/repo/bin"
cp "$COCKPIT_LUA" "$MODULE" "$SCRATCH/repo/wezterm/"
: >"$SCRATCH/repo/bin/cockpit-layout.sh"
plain_left() { # $1 show-keys output: the default table's unmodified LeftArrow lines
  awk '/^Key Table:/{exit} {print}' "$1" | grep -E '^[[:space:]]+LeftArrow[[:space:]]+->'
}

keys="$SCRATCH/keys.out"
HOME="$SCRATCH/home" wezterm --config-file "$SCRATCH/repo/wezterm/cockpit.lua" show-keys >"$keys" 2>&1
status=$?
check "cockpit.lua loads with a scratch HOME (show-keys exit 0)" "$([ $status -eq 0 ] && echo 1 || echo 0)" \
      "exit $status: $(tail -3 "$keys")"
bound="$(plain_left "$keys")"
check "the default table binds LeftArrow with no modifier to a callback" \
      "$(printf '%s' "$bound" | grep -q 'EmitEvent' && echo 1 || echo 0)" "got: ${bound:-nothing}"
check "exactly one unmodified LeftArrow in the default table" \
      "$([ "$(printf '%s\n' "$bound" | grep -c LeftArrow)" -eq 1 ] && echo 1 || echo 0)"
check "show-keys logged no error" "$(grep -qi 'error' "$keys" && echo 0 || echo 1)" \
      "$(grep -i error "$keys" | head -3)"

# The callback itself, with a fake window and pane, against real files in the scratch HOME:
# every error path must forward ← (DESIGN §2.9). Under a harness `wezterm.config_file` names
# the harness, so the checkout is found the installed way, through config.lua's `repo`.
printf 'return { repo = "%s" }\n' "$SCRATCH/repo" >"$SCRATCH/home/.claude/cockpit/config.lua"
run_harness binding "$HERE/binding.lua" FPK_COCKPIT="$SCRATCH/repo/wezterm/cockpit.lua"
rm -f "$SCRATCH/home/.claude/cockpit/config.lua"

mv "$SCRATCH/repo/wezterm/fleet-picker.lua" "$SCRATCH/repo/wezterm/fleet-picker.lua.away"
HOME="$SCRATCH/home" wezterm --config-file "$SCRATCH/repo/wezterm/cockpit.lua" show-keys >"$keys" 2>&1
status=$?
check "without the module, cockpit.lua still loads (exit 0)" "$([ $status -eq 0 ] && echo 1 || echo 0)" \
      "exit $status: $(tail -3 "$keys")"
check "without the module, no unmodified LeftArrow in the default table" \
      "$([ -z "$(plain_left "$keys")" ] && echo 1 || echo 0)" "$(plain_left "$keys")"

# A module that loads but raises is the same as a missing one: no binding, config intact.
printf 'error("broken on purpose")\n' >"$SCRATCH/repo/wezterm/fleet-picker.lua"
HOME="$SCRATCH/home" wezterm --config-file "$SCRATCH/repo/wezterm/cockpit.lua" show-keys >"$keys" 2>&1
status=$?
check "with a module that raises, cockpit.lua still loads (exit 0)" "$([ $status -eq 0 ] && echo 1 || echo 0)" \
      "exit $status: $(tail -3 "$keys")"
check "with a module that raises, no unmodified LeftArrow in the default table" \
      "$([ -z "$(plain_left "$keys")" ] && echo 1 || echo 0)" "$(plain_left "$keys")"

if [ "$fail" -eq 0 ]; then
  echo "fleet-picker-keys-test: ALL PASS ($pass checks)"
  exit 0
fi
echo "fleet-picker-keys-test: FAILURES ($fail failed, $pass passed)"
exit 1
