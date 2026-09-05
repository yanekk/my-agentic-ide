#!/usr/bin/env bash
# HOW A MICRO PANE IS RECOGNISED. What does WezTerm report as the title of a pane
# running micro, and how long does it take to say so?
#
#   spikes/browse-mode/probe-title.sh          (no arguments; exit 0 == green)
#
# Promoted from plans/browse-mode/probes/title.sh. It matters because the daemon
# heals a diff pane that has dropped to a bare shell (`healQuitDiff`, a 1 s tick),
# and a live micro must never be mistaken for one -- typing a command line into
# the viewer is exactly what that mistake looks like.
#
# revdiff's title lags its launch by ~1 s, which is why `diffPaneStatus` needs two
# signals. micro's does not lag -- but a probe is not a promise, so T06 should
# still tolerate a lag rather than assume none.
set -uo pipefail
cd "$(dirname "$0")" || exit 2
. ./common.sh

need micro
mux_start browsetitle 100 24

echo 'x' > "$T/f.txt"
SHELL_PANE="$ROOT_PANE"
VIEWER=$(cli split-pane --pane-id "$SHELL_PANE" -- micro -readonly true "$T/f.txt")

SEEN_AT=""
for s in 1 2 4 7; do
  sleep 1
  S=$(snapshot)
  TITLE=$(p_title "$S" "$VIEWER")
  printf '  t=%ss  micro pane title=%s\n' "$s" "${TITLE:-<empty>}"
  if [ -z "$SEEN_AT" ] && [ "$TITLE" = micro ]; then SEEN_AT="$s"; fi
done
eq 1 "${SEEN_AT:-never}" "WezTerm titles a micro pane 'micro', and does so from t=1s"

S=$(snapshot)
SH_TITLE=$(p_title "$S" "$SHELL_PANE")
echo "  a shell pane, for comparison: title=${SH_TITLE:-<empty>}"
assert "$([ "$SH_TITLE" != micro ] && echo 0 || echo 1)" \
  "a bare shell is not titled 'micro' -- the two are told apart"

# The other half of the same question, and the reason T06 exists: the daemon's
# framed-screen signal does NOT fire for micro. Measured here so the number in
# FINDINGS can be re-run rather than believed.
FRAMED=$(cli get-text --pane-id "$VIEWER" | grep -c '^│')
echo "  framed lines (^│) in a live micro: $FRAMED  (diffPaneStatus needs >= 5)"
assert "$([ "$FRAMED" -lt 5 ] && echo 0 || echo 1)" \
  "a live micro draws no revdiff-style frame, so the title is the ONLY signal"

finish
