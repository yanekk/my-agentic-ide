#!/usr/bin/env bash
# Shared scaffolding for the browse-mode pane probes. SOURCED, never run.
#
# Every probe in this directory drives its own headless `wezterm-mux-server`
# with its own socket and pid file, so no cockpit window is ever disturbed
# (DESIGN §5.2 -- "never ask the user to run a probe against their live cockpit
# window to find something out, and never do it yourself").
#
# Five probes needed the same mux boot, the same live-cockpit seatbelt, the same
# geometry reader and the same assertion counter. This file is that, once.

# --- the seatbelt ----------------------------------------------------------
#
# WEZTERM_UNIX_SOCKET beats the config file. A probe run from inside a cockpit
# terminal inherits it pointing at the LIVE cockpit's mux, and every `wezterm
# cli` call below would then split, park and kill panes in the user's real
# window. Unsetting it here is the whole seatbelt; `mux_start` afterwards points
# it at the probe's own socket and refuses to continue unless what answers is a
# mux it just created (exactly one pane, exactly one tab).
#
# WEZTERM_PANE is unset for the same reason: it is the other way a wezterm client
# infers "you mean this pane".
unset WEZTERM_UNIX_SOCKET WEZTERM_PANE

set -uo pipefail

PROBE_FAILURES=0
PROBE_CHECKS=0

# --- assertions ------------------------------------------------------------

ok()   { PROBE_CHECKS=$((PROBE_CHECKS + 1)); printf '  ok    %s\n' "$1"; }
bad()  { PROBE_CHECKS=$((PROBE_CHECKS + 1)); PROBE_FAILURES=$((PROBE_FAILURES + 1))
         printf '  FAIL  %s\n' "$1"; }

# assert <condition-result:0|1> <label>
assert() { if [ "$1" = 0 ]; then ok "$2"; else bad "$2"; fi; }

# eq <expected> <actual> <label>
eq() {
  if [ "$1" = "$2" ]; then ok "$3 ($2)"
  else bad "$3 -- expected [$1], got [$2]"; fi
}

# has <haystack> <needle> <label>
has() {
  case "$1" in
    *"$2"*) ok "$3" ;;
    *)      bad "$3 -- [$2] not in [$(printf '%s' "$1" | tr '\n' ' ' | cut -c1-120)]" ;;
  esac
}

# hasnt <haystack> <needle> <label>
hasnt() {
  case "$1" in
    *"$2"*) bad "$3 -- [$2] unexpectedly present" ;;
    *)      ok "$3" ;;
  esac
}

# Call as the last line of every probe. Exit status IS the probe's verdict, so
# `probe-*.sh` with no arguments is a test a later session can re-run rather
# than believe.
finish() {
  echo
  if [ "$PROBE_FAILURES" -eq 0 ]; then
    printf 'PASS -- %s checks\n' "$PROBE_CHECKS"; exit 0
  fi
  printf 'FAIL -- %s of %s checks failed\n' "$PROBE_FAILURES" "$PROBE_CHECKS"; exit 1
}

die() { printf 'probe aborted: %s\n' "$1" >&2; exit 2; }

# --- prerequisites ---------------------------------------------------------

need() {
  for c in "$@"; do
    command -v "$c" >/dev/null || die "$c is not on PATH"
  done
}

# --- the headless mux ------------------------------------------------------

# mux_start <name> <cols> <rows>
# Sets: T (scratch dir, removed on exit), ROOT_PANE (the mux's only pane).
mux_start() {
  local name="$1" cols="$2" rows="$3"
  need wezterm wezterm-mux-server python3

  T="$(mktemp -d)"
  cat > "$T/wezterm.lua" <<LUA
return {
  initial_cols = $cols, initial_rows = $rows,
  unix_domains = { { name = '$name', socket_path = '$T/sock' } },
  daemon_options = { pid_file = '$T/pid', stdout = '$T/out', stderr = '$T/err' },
}
LUA
  trap mux_stop EXIT INT TERM

  wezterm-mux-server --config-file "$T/wezterm.lua" --daemonize || die "mux server would not start"
  export WEZTERM_UNIX_SOCKET="$T/sock"
  local tries=0
  until cli list --format json >/dev/null 2>&1; do
    tries=$((tries + 1)); [ "$tries" -gt 50 ] && die "mux server never answered"
    sleep 0.2
  done

  # The seatbelt's second half: a mux we just created has exactly one pane in
  # exactly one tab. Anything else means WEZTERM_UNIX_SOCKET found somebody
  # else's server -- refuse before splitting, parking or killing a single pane.
  local n_panes n_tabs
  n_panes=$(snapshot | wc -l | tr -d ' ')
  n_tabs=$(snapshot | cut -f2 | sort -u | wc -l | tr -d ' ')
  [ "$n_panes" = 1 ] && [ "$n_tabs" = 1 ] \
    || die "refusing to touch a mux that is not freshly ours ($n_panes panes in $n_tabs tabs) -- is WEZTERM_UNIX_SOCKET pointing at a live cockpit?"

  ROOT_PANE=$(snapshot | cut -f1)
}

# Leaves no pane, tab, socket, pid file or temp directory behind.
mux_stop() {
  local pid
  pid="$(cat "$T/pid" 2>/dev/null)"
  if [ -n "${pid:-}" ]; then
    kill "$pid" 2>/dev/null
    local n=0
    while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 40 ]; do sleep 0.1; n=$((n + 1)); done
    kill -9 "$pid" 2>/dev/null
  fi
  rm -rf "$T"
}

cli() { wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "$@"; }

# send <pane> <text> [settle-seconds]
send() { cli send-text --pane-id "$1" --no-paste "$2" >/dev/null; sleep "${3:-0.5}"; }

# Type a command into a pane's shell prompt, the way the daemon's launchInPane
# does: ctrl-U to clear whatever the prompt is holding, then the line.
run_in() { send "$1" "$(printf '\x15')" 0.2; send "$1" "$2$(printf '\r')" "${3:-2.5}"; }

# One tab-separated line per pane: id, tab, cols, rows, title, active.
snapshot() {
  cli list --format json | python3 -c '
import json, sys
for p in sorted(json.load(sys.stdin), key=lambda x: (x["tab_id"], x["pane_id"])):
    print("\t".join(str(x) for x in (
        p["pane_id"], p["tab_id"], p["size"]["cols"], p["size"]["rows"],
        (p.get("title") or "").strip(), "1" if p.get("is_active") else "0")))'
}

# field <snapshot> <pane-id> <n>   (2=tab 3=cols 4=rows 5=title 6=active)
field() { awk -F'\t' -v p="$2" -v n="$3" '$1==p{print $n}' <<<"$1"; }
p_tab()    { field "$1" "$2" 2; }
p_cols()   { field "$1" "$2" 3; }
p_rows()   { field "$1" "$2" 4; }
p_title()  { field "$1" "$2" 5; }
p_active() { field "$1" "$2" 6; }
p_alive()  { [ -n "$(field "$1" "$2" 2)" ] && echo yes || echo no; }

# Every pane sharing a tab with <pane-id>, as ids on one line.
tabmates() {
  local tab; tab=$(p_tab "$1" "$2")
  awk -F'\t' -v t="$tab" '$2==t{printf "%s ", $1}' <<<"$1" | sed 's/ $//'
}

show() { printf '%s\n' "$1" | awk -F'\t' '{printf "    pane %-4s tab %-4s %3sx%-3s %s%s\n", $1,$2,$3,$4,$5,($6=="1"?"  [active]":"")}'; }

# --- the two-signal "is revdiff running" check the daemon uses --------------
#
# Mirrors cockpitd's diffPaneStatus: the pane TITLE lags the launch by ~1s, so a
# framed screen counts as well and either signal is enough.
revdiff_running() {
  local snap="$1" pane="$2" text framed
  text="$(cli get-text --pane-id "$pane" 2>/dev/null)"
  framed=$(printf '%s\n' "$text" | grep -c '^│')
  if [ "$framed" -ge 5 ]; then echo "running(framed:$framed)"; return; fi
  case "$(p_title "$snap" "$pane")" in
    *revdiff*) echo "running(title)"; return ;;
  esac
  echo "shell"
}

# Is broot drawing in this pane, or is it a bare shell?
#
# Not a line count: a small tree is only four or five lines, which is fewer than
# some shell prompts. And not the daemon's framed-screen signal either -- broot
# draws no `│` frame at all, the same blind spot micro has (probe-title.sh). Its
# tree glyph is the signature that is actually there.
broot_drawing() { cli get-text --pane-id "$1" 2>/dev/null | grep -ac '──'; }

# micro's tab bar, wherever on the screen it ended up.
#
# NOT `head -1`, and not "the first non-blank line" either. A restored pane is a
# screen micro repainted INTO, and the rows it does not touch keep whatever was
# there before: blank rows if the pane grew, stale file content if it shrank.
# Both were seen while writing these probes, and both produced spurious failures.
#
# So the bar is found by shape: the one line carrying a bracketed [active tab]
# that is neither a numbered content line nor micro's status line (which also
# brackets `[ro]`, and always carries `ft:`). The fixture files in this directory
# contain no brackets, which is what makes that safe.
micro_tabbar() {
  cli get-text --pane-id "$1" \
    | grep -a '\[[^]]*\]' | grep -av 'ft:' | grep -av '^ *[0-9]' | head -1
}

# micro's status line: `<file> [ro] (55,1) | ft:... `
micro_status() { cli get-text --pane-id "$1" | grep -a 'ft:' | tail -1; }

now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    printf '%s\n' "${EPOCHREALTIME/[.,]/}" | cut -c1-13
  else
    python3 -c 'import time; print(int(time.time()*1000))'
  fi
}

# --- a scratch git repo with a diff worth parsing --------------------------
mkrepo() {
  local R="$1"; mkdir -p "$R"
  (
    cd "$R" || exit 1
    git init -q .
    git config user.email probe@example.invalid
    git config user.name probe
    mkdir -p lib
    for i in 1 2 3; do
      python3 -c "print('\n'.join('f$i line %d' % n for n in range(1, 60)))" > "f$i.txt"
    done
    printf 'export const gamma = 3;\nlet marker = "HIT";\n' > lib/gamma.js
    git add -A
    git commit -qm base
    for i in 1 2 3; do
      python3 -c "print('\n'.join(('F$i CHANGED %d' % n if n%7==0 else 'f$i line %d' % n) for n in range(1, 60)))" > "f$i.txt"
    done
    echo new > untracked.txt
  )
}
