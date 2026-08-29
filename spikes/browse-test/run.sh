#!/usr/bin/env bash
# Tests for browse mode's glue -- the decision about what to push into the viewer,
# and (from T02) the command that carries it out.
#
# Nothing here needs WezTerm. The whole point of the boundary (DESIGN 3.1) is that
# the decision is a pure function, so this runs standalone like spikes/agenda-test
# and spikes/notes-test rather than through the mux stub in spikes/cockpit-test.
# What only a live pane can show -- that micro actually obeys these keystrokes --
# is T07's, with a person at the screen.
#
# From T03 it does need the `broot` BINARY, for one thing nothing else can show:
# that broot accepts the cockpit's verb file. broot is a hard prerequisite of the
# cockpit now (install.sh refuses without it), so requiring it here costs nothing
# and asserting the file parses by reading it would assert nothing at all -- broot
# rejects configurations that are perfectly good hjson.
#
# Every broot run is backgrounded and killed after 5s, with its stdin, stdout and
# stderr off the terminal: run from an interactive shell it would otherwise take
# the screen. `timeout(1)` does not exist on this machine (DESIGN 5).
#
#   spikes/browse-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

fail=0
same() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

# --- the node suites -------------------------------------------------------
# One fresh state dir each, so a suite can never inherit another's files. T02 adds
# <name>.test.mjs beside this script and it is picked up here without editing this.
for suite in "$HERE"/*.test.mjs; do
  [ -e "$suite" ] || continue
  d="$T/$(basename "$suite" .test.mjs)"
  mkdir -p "$d"
  COCKPIT_DIR="$d" node "$suite" || fail=1
done

echo
echo "== 8. the model keeps its side of the boundary =="
# DESIGN 3.1, and the task doc says it twice: if this fails the fix is to MOVE THE
# CODE, never to relax the test. A filesystem read on the pure side is a rule that
# stops being checkable in milliseconds and starts needing a person with a
# terminal -- and `realpath`, which the caller owes this module, is exactly the
# import that would look most reasonable to add here.
#
# Every quoted module specifier however it is written -- `import x from "y"`,
# `export … from 'y'`, `await import('y')` -- with comment lines dropped first,
# because the prose above says "from" and "node:fs" too.
MODEL="$ROOT/bin/cockpit-open-model.mjs"
specs="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$MODEL" \
  | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
  | grep -oE "[\"'][^\"']+[\"']" | tr -d "\"'")"
same "no import of node:fs"            "$(printf '%s\n' "$specs" | grep -cE '^node:fs')" "0"
same "no import of node:child_process" "$(printf '%s\n' "$specs" | grep -cE '^node:child_process')" "0"
same "no import of node:os"            "$(printf '%s\n' "$specs" | grep -cE '^node:os')" "0"
# The three above are what the task requires. This one is stricter and holds today:
# the module needs nothing at all, and a new import is worth a second look even if
# it is pure -- this repo has zero dependencies and no package manifest (DESIGN 5).
same "in fact it imports nothing"      "$(printf '%s' "$specs" | grep -c .)" "0"

# The other half of "pure": not reading the environment either. cwd is the one
# that would bite silently, because the daemon, a cockpit terminal and this test
# all have different ones -- so the same file would get a different tab label
# depending on who pushed it. `path.resolve`/`path.relative` fall back to cwd,
# which is why the paths here are hand-rolled string arithmetic.
body="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$MODEL")"
same "it never reads process.cwd()"    "$(printf '%s' "$body" | grep -c 'process\.cwd')" "0"
same "it never reads process.env"      "$(printf '%s' "$body" | grep -c 'process\.env')" "0"
same "it never reads the clock"        "$(printf '%s' "$body" | grep -cE 'Date\.now|new Date')" "0"

echo
echo "== 9. nothing leaks into the repo =="
# A state file checked in would appear in `revdiff --untracked HEAD` -- the very
# diff an agent is reviewed on -- so a test that wrote one into the checkout would
# hand every agent a change to explain (the same rule that keeps notes.json out).
stray="$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/.claude/worktrees" -prune -o \
         \( -name 'viewer-tabs*.json' -o -name '*.json.tmp' \) -print 2>/dev/null | wc -l | tr -d ' ')"
same "no viewer state anywhere in the checkout" "$stray" "0"

echo
echo "== 22. broot accepts the cockpit's verb file =="
# The one thing only the binary can answer. `broot --conf X --help` does NOT read
# the config (measured: a truncated file exits 0), so the check runs broot for real
# with its terminal unavailable: it either reports a configuration error -- which is
# the failure being hunted -- or gets as far as failing to open a terminal, which
# means the whole chain parsed and the verbs were accepted.
#
# The two controls below are what make the pass meaningful: this check is proven
# able to fail, on a corrupt file and on a missing one.
VERBS="$ROOT/bin/cockpit-browse-verbs.hjson"
UCONF="$HOME/.config/broot"
UCONF_BEFORE=""
[ -d "$UCONF" ] && UCONF_BEFORE="$(cd "$UCONF" && stat -f '%N %m %z' -- * 2>/dev/null | sort)"
if ! command -v broot >/dev/null; then
  echo "  FAIL broot is not on PATH -- it is a cockpit prerequisite (brew install broot)"
  fail=1
else
mkdir -p "$T/tree/sub"; : > "$T/tree/sub/a.txt"; : > "$T/tree/b.txt"
mkdir -p "$T/fakehome"

# Load a --conf chain and report broot's complaint, or "clean" if it had none.
# Backgrounded and killed at 5s: broot has no non-interactive mode, so what ends
# the process is its own failure to open a terminal.
brootload() {
  local conf="$1" err="$T/broot.err" pid i=0
  : > "$err"
  ( HOME="$T/fakehome" broot --conf "$conf" --cmd ":quit" --height 8 "$T/tree" \
      </dev/null >/dev/null 2>"$err" ) &
  pid=$!
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; echo "HUNG"; return; fi
  wait "$pid" 2>/dev/null
  local msg
  msg="$(tr -d '\033' < "$err" | grep -Eo 'Bad configuration file|Invalid verb configuration|IO Error : [^\n]*' | head -1)"
  [ -n "$msg" ] && echo "$msg" || echo "clean"
}

same "the cockpit's file alone loads"      "$(brootload "$VERBS")" "clean"

# The chain the daemon will really build on this machine, user's own config and all.
CHAIN="$(node -e "import('$ROOT/bin/cockpit-browse-conf.mjs').then(m => process.stdout.write(m.browseConfChain(process.env.HOME, '$ROOT')))")"
same "the whole chain loads, layered over your own config" "$(brootload "$CHAIN")" "clean"
same "...and ours is the last entry in it" "$(printf '%s' "$CHAIN" | awk -F';' '{print $NF}')" "$VERBS"

# Control 1: the check can fail. Hjson broot cannot parse.
printf '{ verbs: [ { key: enter\n' > "$T/broken.hjson"
same "a corrupt file IS caught"             "$(brootload "$T/broken.hjson")" "Bad configuration file"

# Control 2, and the reason cockpit-browse-conf.mjs drops absent entries: broot
# quits outright on a chain naming a file that is not there. A user who has never
# written a verbs.hjson would otherwise be unable to browse at all.
same "a MISSING entry kills broot"          "$(brootload "$VERBS;$T/nope.hjson" | grep -o 'IO Error')" "IO Error"

# Control 3: broot validates the verb itself, not just the syntax -- so "it loads"
# really does mean the key and the file kind were accepted.
sed 's/apply_to: text_file/apply_to: nonsense_kind/' "$VERBS" > "$T/badkind.hjson"
same "an invalid apply_to IS caught"        "$(brootload "$T/badkind.hjson")" "Bad configuration file"

# Nothing of the user's is written, read-only or otherwise -- the cockpit ships its
# own file precisely so it never edits ~/.config/broot (DESIGN 7).
if [ -d "$UCONF" ]; then
  AFTER="$(cd "$UCONF" && stat -f '%N %m %z' -- * 2>/dev/null | sort)"
  same "your own broot config is untouched" "$AFTER" "$UCONF_BEFORE"
fi
fi

echo
echo "== 23. the verb itself: files only, no GUI, stay in the tree =="
# Read off the file rather than described in a comment, because every one of these
# four lines is load-bearing and three of them are one word long.
same "Enter is the key"          "$(grep -cE '^ *key: enter$' "$VERBS")" "1"
same "files only, so Enter still descends into a DIRECTORY" \
                                 "$(grep -cE '^ *apply_to: text_file$' "$VERBS")" "1"
same "it runs cockpit-open with the file and the line" \
                                 "$(grep -cF 'external: "cockpit-open {file} {line}"' "$VERBS")" "1"
same "and does not leave broot"  "$(grep -cE '^ *leave_broot: false$' "$VERBS")" "1"
same "exactly one verb"          "$(grep -cE '^ *key: ' "$VERBS")" "1"
# The stock binding this overrides is `open_stay`, which on macOS hands the file to
# a GUI app: a window over the terminal, which is the whole reason for the file. The
# comments name it, so only the hjson itself is searched.
same "it never falls back to opening the file itself" \
     "$(grep -vE '^[[:space:]]*#' "$VERBS" | grep -cE 'open_stay|internal:')" "0"

echo
echo "== 24. micro and broot are prerequisites, not suggestions =="
# `install.sh --check` writes nothing (asserted below by pointing HOME at a temp
# dir and looking), so running it here is safe.
INST="$ROOT/bin/install.sh"
CHECK="$("$INST" --check --start-dir "$ROOT" 2>&1)"
same "--check finds micro"  "$(printf '%s\n' "$CHECK" | grep -cE '^  ok +micro ')"  "1"
same "--check finds broot"  "$(printf '%s\n' "$CHECK" | grep -cE '^  ok +broot ')"  "1"
same "seven tools, not five" "$(printf '%s\n' "$CHECK" | grep -cE '^  (ok|MISS) +(wezterm|revdiff|node|claude|git|micro|broot) ')" "7"

# The missing branch, on a machine where both are installed: resolve() looks through
# a LOGIN SHELL, so a login shell that answers nothing makes every tool absent. That
# is the only lever here -- the script re-prepends /opt/homebrew/bin itself, so PATH
# alone cannot hide a Homebrew binary (which is exactly what it is for).
printf '#!/bin/sh\nexit 0\n' > "$T/mute-shell"; chmod +x "$T/mute-shell"
mkdir -p "$T/insthome"
MISS="$(HOME="$T/insthome" SHELL="$T/mute-shell" "$INST" --check --start-dir "$T" 2>&1)"
MISS_CODE=$?
same "a missing micro is reported, with the brew hint" \
     "$(printf '%s\n' "$MISS" | grep -cE '^  MISS +micro +brew install micro$')" "1"
same "a missing broot is reported, with the brew hint" \
     "$(printf '%s\n' "$MISS" | grep -cE '^  MISS +broot +brew install broot$')" "1"
same "and --check exits non-zero"  "$MISS_CODE" "1"
same "--check wrote nothing"       "$([ -e "$T/insthome/.claude" ] && echo wrote || echo nothing)" "nothing"

echo
echo "== 25. the layout script refuses to build a cockpit without them =="
# Executed, not grepped: what matters is that it DIES, before any pane exists.
# Making a Homebrew binary absent needs a lever other than PATH (see above), so the
# runner exports a `command` function -- bash resolves functions before builtins and
# passes them to bash children -- and a `wezterm` function that records every call
# and never reaches the real mux. If a guard failed to fire, the recorder is how
# this test says so instead of the live cockpit window paying for it.
cat > "$T/absent.sh" <<'RUNNER'
#!/usr/bin/env bash
command() {
  if [ "${1:-}" = "-v" ] && [ "${2:-}" = "$ABSENT" ]; then return 1; fi
  builtin command "$@"
}
wezterm() { echo "wezterm $*" >> "$WEZTERM_CALLS"; return 0; }
export -f command wezterm
exec "$@"
RUNNER
chmod +x "$T/absent.sh"

layout_without() { # layout_without <tool>: returns the script's stderr
  local tool="$1" pid i=0
  rm -rf "$T/lhome"; mkdir -p "$T/lhome"
  : > "$T/wezterm-calls"
  ( ABSENT="$tool" WEZTERM_CALLS="$T/wezterm-calls" HOME="$T/lhome" \
    WEZTERM_PANE=1 SHELL=/bin/sh \
    "$T/absent.sh" "$ROOT/bin/cockpit-layout.sh" "$ROOT" \
      </dev/null >/dev/null 2>"$T/layout.err" ) &
  pid=$!
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  tr '\n' ' ' < "$T/layout.err"
}

for tool in micro broot; do
  err="$(layout_without "$tool")"
  same "no $tool: it says so, and names the fix" \
       "$(printf '%s' "$err" | grep -cF "cockpit: $tool not on PATH (brew install $tool)")" "1"
  same "no $tool: and drops to a shell rather than closing the window" \
       "$(printf '%s' "$err" | grep -cF 'falling back to a plain shell')" "1"
  same "no $tool: not one wezterm call was made" \
       "$(wc -l < "$T/wezterm-calls" | tr -d ' ')" "0"
  same "no $tool: and no cockpit state directory was created" \
       "$([ -e "$T/lhome/.claude/cockpit" ] && echo built || echo none)" "none"
done

# The control: the same harness against a guard that was already there, so a pass
# above cannot be the harness failing to make anything absent.
same "the harness really does hide a tool (node)" \
     "$(layout_without node | grep -cF 'cockpit: node not on PATH')" "1"

# And they are guarded in the same block as the other five, above everything that
# builds: a guard placed after the first split would refuse a half-built cockpit.
guard_line() { grep -nE "^command -v $1 " "$ROOT/bin/cockpit-layout.sh" | head -1 | cut -d: -f1; }
BUILD_LINE="$(grep -n 'mkdir -p "\$DIR"' "$ROOT/bin/cockpit-layout.sh" | head -1 | cut -d: -f1)"
same "the micro guard comes before anything is built" \
     "$([ "$(guard_line micro)" -lt "$BUILD_LINE" ] && echo before || echo after)" "before"
same "the broot guard comes before anything is built" \
     "$([ "$(guard_line broot)" -lt "$BUILD_LINE" ] && echo before || echo after)" "before"

# broot's Enter verb names `cockpit-open`, so the layout script has to publish that
# name -- the same symlink-in-a-cockpit-only-directory shape as `note` and `agenda`.
# Asserted against the script rather than a copy of the line, so the two cannot drift.
same "cockpit-layout.sh publishes cockpit-open for the verb to find" \
     "$(grep -cF 'ln -sf "$HERE/cockpit-open.mjs" "$COCKPIT_BIN/cockpit-open"' "$ROOT/bin/cockpit-layout.sh")" "1"


echo
echo "== 26. the verb FIRES: a real Enter, a real broot, the real file =="
# Everything above this asserts either "broot did not complain" or a grep over the
# hjson. Neither is enough on its own, because broot IGNORES A FIELD NAME IT DOES
# NOT KNOW: `externol:` instead of `external:` loads perfectly clean (measured),
# binds Enter and then does nothing -- which on macOS means the stock `open_stay`
# hands the file to a GUI app, the one failure this file exists to prevent. The
# control at the end of this section is exactly that mutant, and every other check
# in this suite passes against it.
#
# So Enter is pressed for real. broot needs a terminal to read a key and a test run
# has none, so it gets one from script(1); `cockpit-open` is a recorder on PATH
# that writes down the argv it was handed. What this pins down is the contract T02
# and T04 are built on: the verb fires, {file} is absolute, and {line} is the
# matching line under a `c/` search and `0` otherwise.
if ! command -v script >/dev/null; then
  echo "  FAIL script(1) is missing -- Enter cannot be pressed without a terminal"
  fail=1
else
mkdir -p "$T/vtree/sub" "$T/vhome" "$T/vbin"
printf 'alpha\nbeta\nNEEDLE here\ndelta\n' > "$T/vtree/sub/a.txt"
# Resolved, because broot hands back a path with every symlink resolved and macOS
# puts a mktemp dir behind one (/var -> /private/var). Comparing against the
# unresolved name is the trap FINDINGS records against `planPush`.
VTREE="$(cd "$T/vtree" && pwd -P)"
VARGV="$T/vargv.txt"
# One write, not one per argument: the waiter below polls for this file, and an
# append per argument lets it read a half-recorded call.
cat > "$T/vbin/cockpit-open" <<SH
#!/bin/sh
out=""
for a in "\$@"; do out="\$out[\$a]"; done
printf '%s' "\$out" > "$VARGV"
SH
chmod +x "$T/vbin/cockpit-open"

# Enter, then wait for the recorder rather than for a fixed time, then `q` so broot
# leaves on its own instead of being killed and orphaned. stdin stays open until
# the end: an EOF would quit broot before it could run anything.
vfire() { # vfire <conf> <startdir> <broot --cmd>: echoes the argv, or nothing
  : > "$VARGV"
  ( sleep 1.5; printf '\r'
    j=0; while [ ! -s "$VARGV" ] && [ "$j" -lt 40 ]; do sleep 0.1; j=$((j + 1)); done
    sleep 0.2; printf 'q'; sleep 0.5 ) \
  | ( PATH="$T/vbin:$PATH" HOME="$T/vhome" script -q /dev/null \
        broot --conf "$1" --cmd "$3" --height 20 "$2" >"$T/vcap.txt" 2>&1 ) &
  local pid=$! i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 0.1; i=$((i + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  cat "$VARGV"
}

screen() { tr -d '\r' < "$T/vcap.txt" | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g'; }

# A plain Enter -- the commonest gesture in browse mode. `{line}` is `0` here, not
# empty and not absent: it was assumed to be empty until this check was written.
same "Enter on a file runs cockpit-open with an ABSOLUTE path and line 0" \
     "$(vfire "$VERBS" "$VTREE/sub" ':line_down')" "[$VTREE/sub/a.txt][0]"

# The content search, which is the entire reason browse mode exists over revdiff's
# own file list: the line handed over is the MATCHING line. NEEDLE is on line 3.
same "under a c/ search, {line} is the matching line" \
     "$(vfire "$VERBS" "$VTREE/sub" ':line_down;c/NEEDLE')" "[$VTREE/sub/a.txt][3]"

# `apply_to: text_file` earns its keep here: Enter on a DIRECTORY has to stay
# broot's own navigation, or there is no way to get anywhere in the tree.
same "Enter on a DIRECTORY never pushes" \
     "$(vfire "$VERBS" "$VTREE" ':line_down')" ""
# Not "is a.txt on screen": broot's tree shows nested files whether or not it
# descended, so that check passes against a verb that swallowed the keypress
# (measured against an `apply_to: any` mutant). What actually moves is the ROOT
# broot draws at the top, from <tree> to <tree>/sub.
same "...it descends into it instead" \
     "$(screen | grep -q 'vtree/sub' && echo descended || echo stuck)" "descended"

# The control, and the reason this section exists at all.
sed 's/external:/externol:/' "$VERBS" > "$T/typo.hjson"
same "a typo'd field name IS caught here -- and nowhere else" \
     "$(vfire "$T/typo.hjson" "$VTREE/sub" ':line_down')" ""
fi
echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit "$fail"
