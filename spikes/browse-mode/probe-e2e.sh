#!/usr/bin/env bash
# END TO END. broot in one pane, micro in another. Pressing Enter on a file in
# broot pushes it into the running micro as a tab -- and a `c/` content search
# followed by Enter lands on the MATCHING LINE, which is the whole value of
# searching across files.
#
#   spikes/browse-mode/probe-e2e.sh          (no arguments; exit 0 == green)
#
# Promoted from plans/browse-mode/probes/e2e.sh, the run behind DESIGN §3.4.
#
# THE VERB HERE IS NOT THE VERB THE COCKPIT WILL SHIP. This one passes
# `{file:path-from-directory}`; the shipped one (T03) passes plain `{file}` and
# relativises on the PURE side, in `planPush` (T01), against the agent's
# worktree. Do not "fix" either to match the other -- this probe is evidence that
# the push works, not evidence about the shipped verb's arguments.
#
# AND `{file:path-from-directory}` DOES NOT RELATIVISE ANYTHING, measured here:
# with broot launched on an absolute root it hands back the ABSOLUTE path. That
# is why the glue below relativises it a second time in python, which looked like
# redundancy in the planning script and is not. Dropping that step is what a
# truncated, unreadable tab bar looks like -- exactly the failure DESIGN §2.2
# exists to prevent. So both the probe and the shipped verb relativise OUTSIDE
# broot; they differ only in where.
set -uo pipefail
cd "$(dirname "$0")" || exit 2
. ./common.sh

need broot micro
mux_start browsee2e 110 26

R="$T/r"; mkdir -p "$R/lib"
printf 'const alpha = 1;\n'                     > "$R/alpha.js"
printf 'const beta = 2;\nlet marker = "HIT";\n' > "$R/beta.js"
printf 'export const gamma = 3;\n'              > "$R/lib/gamma.js"

# The glue broot calls. It reads the viewer's pane id from a FILE, because a
# wezterm split inherits none of its launcher's environment -- the mux server's
# env dates from whenever WezTerm started. That is the same reason the real thing
# publishes `viewer` into panes.json rather than exporting it (DESIGN §3.4).
cat > "$T/openit" <<EOF
#!/usr/bin/env bash
# broot swallows an external command's output, so the glue keeps its own log --
# without it a push that fails fails invisibly, which is exactly what happened
# the first time this probe was run.
exec >>"$T/openit.log" 2>&1
set -x
export WEZTERM_UNIX_SOCKET="$T/sock"
W(){ wezterm --config-file "$T/wezterm.lua" cli --no-auto-start "\$@"; }
VIEW="\$(cat "$T/viewer")"
# broot hands back an absolute path even from {file:path-from-directory}, and an
# absolute tab label fills micro's bar with /private/var/... and truncates away
# the filename. Relativise before sending -- and realpath BOTH sides first: broot
# resolves symlinks and the root here does not (/var -> /private/var on macOS),
# and relativising a resolved path against an unresolved root yields
# ../../../../../../../private/var/... , which is worse than the absolute path.
FILE="\$(python3 -c 'import os,sys; print(os.path.relpath(os.path.realpath(sys.argv[1]), os.path.realpath(sys.argv[2])))' "\$1" "$R")"
LINE="\${2:-}"
W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\x05')"; sleep 0.3
W send-text --pane-id "\$VIEW" --no-paste "tab \$FILE";        sleep 0.3
W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\r')";   sleep 0.6
if [ -n "\$LINE" ] && [ "\$LINE" != "0" ]; then
  W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\x05')"; sleep 0.3
  W send-text --pane-id "\$VIEW" --no-paste "goto \$LINE";       sleep 0.3
  W send-text --pane-id "\$VIEW" --no-paste "\$(printf '\r')";   sleep 0.4
fi
EOF
chmod +x "$T/openit"

cat > "$T/broot.hjson" <<EOF
{
    verbs: [
        {
            key: enter
            apply_to: text_file
            external: "$T/openit {file:path-from-directory} {line}"
            leave_broot: false
        }
    ]
}
EOF

bar()    { micro_tabbar "$1"; }
status() { micro_status "$1"; }

BROWSER="$ROOT_PANE"
VIEWER=$(cli split-pane --right --percent 60 --cwd "$R" --pane-id "$BROWSER" -- micro -readonly true alpha.js)
echo "$VIEWER" > "$T/viewer"
sleep 2
cli activate-pane --pane-id "$BROWSER" >/dev/null; sleep 0.4
send "$BROWSER" "broot --conf $T/broot.hjson $R$(printf '\r')" 2.5

echo "viewer at start: $(bar "$VIEWER")"

echo
echo ">>> filter to beta.js in the browser, press Enter"
send "$BROWSER" "beta" 1.2
send "$BROWSER" "$(printf '\r')" 3.0
B=$(bar "$VIEWER"); echo "  viewer tabs: $B"
has "$B" "beta.js" "Enter in the browser opened the file as a tab in the viewer"

echo
echo ">>> clear, content-search c/HIT, press Enter (must land ON the matching line)"
send "$BROWSER" "$(printf '\x1b')" 0.6
send "$BROWSER" "c/HIT" 1.5
send "$BROWSER" "$(printf '\r')" 3.0
ST=$(status "$VIEWER"); echo "  viewer status: $ST"
has "$ST" "(2," "a content-search hit jumps the viewer to the matching line, not line 1"

echo
echo ">>> open the nested lib/gamma.js"
send "$BROWSER" "$(printf '\x1b')" 0.6
send "$BROWSER" "gamma" 1.5
send "$BROWSER" "$(printf '\r')" 3.0
B=$(bar "$VIEWER"); echo "  viewer tabs: $B"
has "$B" "gamma.js" "a nested file opens too"
has "$B" "lib/"     "and its tab label is repo-relative, not absolute"

S=$(snapshot)
show "$S"
if [ "$PROBE_FAILURES" -gt 0 ]; then
  echo
  echo "--- the glue's own log (broot hides an external command's output) ---"
  sed 's/^/  /' "$T/openit.log" 2>/dev/null | tail -40 || echo "  the verb never ran"
fi
eq 1 "$(p_active "$S" "$BROWSER")" "focus never left the browser through three pushes"
assert "$([ "$(broot_drawing "$BROWSER")" -ge 1 ] && echo 0 || echo 1)" \
  "the browser is still drawing at the end (leave_broot: false)"

finish
