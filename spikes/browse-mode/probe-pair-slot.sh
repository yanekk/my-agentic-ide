#!/usr/bin/env bash
# Can the diff slot -- which has always held exactly ONE pane per agent -- hold
# the browse-mode PAIR (browser left, viewer right), park it as a unit, and give
# it back at identical geometry?
#
#   spikes/browse-mode/probe-pair-slot.sh          (no arguments; exit 0 == green)
#
# Nothing in the browse-mode plan is safe until this is true, so the assertions
# below ARE the deliverable. Runs against a headless `wezterm-mux-server` with
# its own socket and pid file: no cockpit window is disturbed (DESIGN §5.2).
#
# What it drives, in the daemon's own idiom (bin/cockpitd.mjs showDiff/parkPane):
#
#   the slot is swapped in the OPPOSITE order to the terminal slot. The diff pane
#   spans the window, so its geometry IS the slot: park it first and the only
#   thing left to split is the fleet pane's half-width region. The incoming
#   occupant is split INTO the outgoing one, and the outgoing one is parked
#   afterwards. With a PAIR, the browser is what gets split into the outgoing
#   occupant and the viewer is split off the browser after.
#
# Results are written up in RESULTS.md.
set -uo pipefail
cd "$(dirname "$0")" || exit 2
. ./common.sh

need broot micro revdiff git
mux_start browsepair 120 40

SH="bash --norc"

mkrepo "$T/wtA"
mkrepo "$T/wtB"

# --- the cockpit-shaped layout, in bin/cockpit-layout.sh's own order ---------
FLEET="$ROOT_PANE"
FOOTER=$(cli split-pane --bottom --cells 1 --pane-id "$FLEET" -- $SH)
DIFFA=$(cli split-pane  --top --percent 42 --pane-id "$FLEET" --cwd "$T/wtA" -- $SH)
TERM_=$(cli split-pane  --right --percent 50 --pane-id "$FLEET" -- $SH)
STRIP=$(cli split-pane  --right --percent 20 --pane-id "$TERM_" -- $SH)
sleep 1
S=$(snapshot)
COCKPIT_TAB=$(p_tab "$S" "$FLEET")
echo "layout: fleet=$FLEET diff=$DIFFA term=$TERM_ strip=$STRIP footer=$FOOTER (tab $COCKPIT_TAB)"
show "$S"

# --- the daemon's moves, one function each ----------------------------------

park() {                       # park <pane> <label>
  cli move-pane-to-new-tab --pane-id "$1" >/dev/null
  cli set-tab-title --pane-id "$1" "cockpit: $2" >/dev/null
  cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
}

# Leave browse: park the pair as a unit, bring a single diff pane back.
#   1. park the browser            -> the viewer inherits the whole slot
#   2. split the incoming diff INTO the viewer (the outgoing occupant)
#   3. move the viewer into the browser's park tab -> the split collapses and the
#      incoming pane inherits the slot exactly, and the pair is in ONE tab
pair_out_single_in() {         # <browser> <viewer> <incoming>
  cli move-pane-to-new-tab --pane-id "$1" >/dev/null
  cli split-pane --top   --percent 50 --pane-id "$2" --move-pane-id "$3" >/dev/null
  cli split-pane --right --percent 60 --pane-id "$1" --move-pane-id "$2" >/dev/null
  cli set-tab-title --pane-id "$1" "cockpit: browse pair" >/dev/null
  cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
}

# Enter browse: the mirror. Browser splits INTO the outgoing pane, the outgoing
# pane is parked, then the viewer is split off the browser's right at 60%.
single_out_pair_in() {         # <outgoing> <browser> <viewer> [kill|park]
  cli split-pane --top --percent 50 --pane-id "$1" --move-pane-id "$2" >/dev/null
  if [ "${4:-park}" = kill ]; then cli kill-pane --pane-id "$1" >/dev/null
  else cli move-pane-to-new-tab --pane-id "$1" >/dev/null; fi
  cli split-pane --right --percent 60 --pane-id "$2" --move-pane-id "$3" >/dev/null
  cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
}

# Switch agents with BOTH in browse: four calls, and the slot is never empty.
pair_out_pair_in() {           # <outB> <outV> <inB> <inV>
  cli move-pane-to-new-tab --pane-id "$1" >/dev/null
  cli split-pane --top   --percent 50 --pane-id "$2" --move-pane-id "$3" >/dev/null
  cli split-pane --right --percent 60 --pane-id "$1" --move-pane-id "$2" >/dev/null
  cli split-pane --right --percent 60 --pane-id "$3" --move-pane-id "$4" >/dev/null
  cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
}

# The classic single-pane agent switch, for the timing comparison.
single_out_single_in() {       # <outgoing> <incoming>
  cli split-pane --top --percent 50 --pane-id "$1" --move-pane-id "$2" >/dev/null
  cli move-pane-to-new-tab --pane-id "$1" >/dev/null
  cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
}

# bin/cockpitd.mjs rebuildDiffSlot: with the slot EMPTY, park the terminal and
# the strip so the full-width split can come off the fleet pane alone, then move
# both back to their edges. Prints a throwaway placeholder holding the slot.
rebuild_slot() {
  park "$TERM_" rebuilding
  park "$STRIP" strip
  local ph
  ph=$(cli split-pane --top --percent 42 --pane-id "$FLEET" -- $SH)
  cli split-pane --right --percent 50 --pane-id "$FLEET"  --move-pane-id "$TERM_" >/dev/null
  cli split-pane --right --percent 20 --pane-id "$TERM_"  --move-pane-id "$STRIP" >/dev/null
  cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
  echo "$ph"
}

# The slot's extent, whether one pane holds it or two share it.
slot_extent() {                # slot_extent <snapshot> <pane>...
  local snap="$1"; shift
  local c=0 r="" n=0 p pr
  for p in "$@"; do
    c=$(( c + $(p_cols "$snap" "$p") ))
    pr=$(p_rows "$snap" "$p")
    # Every pane sharing the slot must be the SAME height. Taking the last
    # one's rows and moving on would let a mis-stacked pair compare equal to a
    # correct one -- and the claim this probe exists to make is "identical, not
    # merely similar". A mismatch poisons the value so every eq() using it fails.
    if [ -n "$r" ] && [ "$pr" != "$r" ]; then echo "MIXED-HEIGHTS($r/$pr)"; return; fi
    r="$pr"
    n=$((n + 1))
  done
  # n-1 one-column dividers between n side-by-side panes
  echo "$(( c + n - 1 ))x$r"
}

cockpit_panes() {              # how many panes are in the cockpit tab
  awk -F'\t' -v t="$COCKPIT_TAB" '$2==t' <<<"$1" | wc -l | tr -d ' '
}

# See micro_tabbar in common.sh for why this is not `head -1`; it cost six
# spurious failures on the first run of this probe. With only ONE file open micro
# hides the tab bar entirely, which is why every viewer here is given two.
viewer_tabbar() { micro_tabbar "$1"; }

open_tab() {                   # open_tab <viewer> <cmd> <relpath>
  send "$1" "$(printf '\x05')" 0.4
  send "$1" "$2 $3" 0.4
  send "$1" "$(printf '\r')" 1.0
}

# =============================================================================
echo
echo "### 1. revdiff alone in the slot (agent A, the mode every agent starts in)"
run_in "$DIFFA" "cd $T/wtA && revdiff --wrap --no-confirm-discard --untracked HEAD" 4
S=$(snapshot)
SLOT_REVDIFF=$(slot_extent "$S" "$DIFFA")
show "$S"
echo "  slot: $SLOT_REVDIFF   revdiff: $(revdiff_running "$S" "$DIFFA")"
eq "running" "$(revdiff_running "$S" "$DIFFA" | cut -d'(' -f1)" "revdiff is up in the slot"
eq 5 "$(cockpit_panes "$S")" "the cockpit tab holds 5 panes (fleet diff term strip footer)"

# =============================================================================
echo
echo "### 2. enter browse: broot splits INTO revdiff, revdiff parks, micro joins at 60%"
BROOTA=$(cli split-pane --top --percent 50 --pane-id "$DIFFA" --cwd "$T/wtA" -- $SH)
cli move-pane-to-new-tab --pane-id "$DIFFA" >/dev/null
cli set-tab-title --pane-id "$DIFFA" "cockpit: diff A" >/dev/null
MICROA=$(cli split-pane --right --percent 60 --pane-id "$BROOTA" --cwd "$T/wtA" -- $SH)
cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
sleep 0.8
run_in "$BROOTA" "broot $T/wtA" 3
run_in "$MICROA" "micro -readonly true" 3
S=$(snapshot)
SLOT_PAIR=$(slot_extent "$S" "$BROOTA" "$MICROA")
show "$S"
echo "  slot: $SLOT_PAIR   browser $(p_cols "$S" "$BROOTA") cols, viewer $(p_cols "$S" "$MICROA") cols"
eq "$SLOT_REVDIFF" "$SLOT_PAIR" "the pair fills exactly the slot revdiff had"
eq 47 "$(p_cols "$S" "$BROOTA")" "browser is 47 columns of 120"
eq 72 "$(p_cols "$S" "$MICROA")" "viewer is 72 columns of 120"
eq "$(p_rows "$S" "$BROOTA")" "$(p_rows "$S" "$MICROA")" "both halves are the same height"
eq 6 "$(cockpit_panes "$S")" "the cockpit tab now holds 6 panes"
assert "$([ "$(p_tab "$S" "$DIFFA")" != "$COCKPIT_TAB" ] && echo 0 || echo 1)" \
  "agent A's revdiff is parked outside the cockpit tab, not killed"
assert "$([ "$(broot_drawing "$BROOTA")" -ge 1 ] && echo 0 || echo 1)" \
  "the browser is drawing its tree"

# =============================================================================
echo
echo "### 3. push two files into the viewer so it has tabs to lose"
open_tab "$MICROA" open f1.txt
open_tab "$MICROA" tab  lib/gamma.js
BAR_BEFORE=$(viewer_tabbar "$MICROA")
echo "  tab bar: $BAR_BEFORE"
has "$BAR_BEFORE" "f1.txt"       "the viewer has f1.txt open"
has "$BAR_BEFORE" "gamma.js"     "the viewer has lib/gamma.js open"
hasnt "$BAR_BEFORE" "No name"    "no leftover empty first tab (open, then tab)"

# =============================================================================
echo
echo "### 4. leave browse: the pair parks as a UNIT, revdiff comes back"
pair_out_single_in "$BROOTA" "$MICROA" "$DIFFA"
sleep 1.5
S=$(snapshot)
show "$S"
SLOT_BACK=$(slot_extent "$S" "$DIFFA")
eq "$SLOT_REVDIFF" "$SLOT_BACK" "revdiff is back at exactly the slot's geometry"
eq 5 "$(cockpit_panes "$S")" "the cockpit tab is back to 5 panes"
eq "$(p_tab "$S" "$BROOTA")" "$(p_tab "$S" "$MICROA")" "browser and viewer parked in ONE tab"
assert "$([ "$(p_tab "$S" "$BROOTA")" != "$COCKPIT_TAB" ] && echo 0 || echo 1)" \
  "...and that tab is not the cockpit tab"
eq "running" "$(revdiff_running "$S" "$DIFFA" | cut -d'(' -f1)" \
  "revdiff survived its round trip (two-signal check, as the daemon does it)"

# =============================================================================
echo
echo "### 5. re-enter browse: both halves come back, with the tabs still open"
single_out_pair_in "$DIFFA" "$BROOTA" "$MICROA"
sleep 1.5
send "$MICROA" "$(printf '\x1b')" 1.2      # nudge micro to repaint after the resize
S=$(snapshot)
show "$S"
SLOT_PAIR_BACK=$(slot_extent "$S" "$BROOTA" "$MICROA")
eq "$SLOT_PAIR" "$SLOT_PAIR_BACK" "the restored pair fills the slot identically"
eq 47 "$(p_cols "$S" "$BROOTA")" "browser is 47 columns again"
eq 72 "$(p_cols "$S" "$MICROA")" "viewer is 72 columns again"
BAR_AFTER=$(viewer_tabbar "$MICROA")
echo "  tab bar: $BAR_AFTER"
has "$BAR_AFTER" "f1.txt"    "f1.txt is still a tab after the round trip"
has "$BAR_AFTER" "gamma.js"  "lib/gamma.js is still a tab after the round trip"
assert "$([ "$(broot_drawing "$BROOTA")" -ge 1 ] && echo 0 || echo 1)" \
  "the browser is still drawing after the round trip"
assert "$([ "$(p_tab "$S" "$DIFFA")" != "$COCKPIT_TAB" ] && echo 0 || echo 1)" \
  "exactly one of {revdiff, the pair} is in the cockpit tab -- revdiff is parked"

# =============================================================================
echo
echo "### 6. a SECOND agent, also in browse: three parked panes each, alternating"
DIFFB=$(cli split-pane --top --percent 50 --pane-id "$BROOTA" --cwd "$T/wtB" -- $SH)
cli move-pane-to-new-tab --pane-id "$DIFFB" >/dev/null            # park B's revdiff pane
cli set-tab-title --pane-id "$DIFFB" "cockpit: diff B" >/dev/null
cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
sleep 0.6
# B's pair is built in its own parked tab, then swapped in as a unit.
BROOTB=$(cli split-pane --top --percent 50 --pane-id "$DIFFB" --cwd "$T/wtB" -- $SH)
MICROB=$(cli split-pane --right --percent 60 --pane-id "$BROOTB" --cwd "$T/wtB" -- $SH)
sleep 0.8
run_in "$BROOTB" "broot $T/wtB" 3
run_in "$MICROB" "micro -readonly true" 3
open_tab "$MICROB" open f2.txt
open_tab "$MICROB" tab  f3.txt
echo "  agent B's viewer: $(viewer_tabbar "$MICROB")"

echo "  -- switch A -> B, both in browse"
pair_out_pair_in "$BROOTA" "$MICROA" "$BROOTB" "$MICROB"
sleep 1.5
send "$MICROB" "$(printf '\x1b')" 1.0
S=$(snapshot)
show "$S"
eq "$SLOT_PAIR" "$(slot_extent "$S" "$BROOTB" "$MICROB")" "agent B's pair inherits the slot exactly"
eq 47 "$(p_cols "$S" "$BROOTB")" "B's browser is 47 columns"
eq 72 "$(p_cols "$S" "$MICROB")" "B's viewer is 72 columns"
eq 6 "$(cockpit_panes "$S")" "still 6 panes in the cockpit tab -- one pair, never two"
eq "$(p_tab "$S" "$BROOTA")" "$(p_tab "$S" "$MICROA")" "A's pair is parked together"
PARKED_A=$(tabmates "$S" "$BROOTA")
echo "  agent A parked: pair=[$PARKED_A] revdiff=$DIFFA in tab $(p_tab "$S" "$DIFFA")"
assert "$([ "$(p_tab "$S" "$DIFFA")" != "$(p_tab "$S" "$BROOTA")" ] && echo 0 || echo 1)" \
  "A's revdiff parks in its own tab, separate from A's pair"
for p in "$BROOTA" "$MICROA" "$DIFFA" "$DIFFB"; do
  assert "$([ "$(p_tab "$S" "$p")" != "$COCKPIT_TAB" ] && echo 0 || echo 1)" "pane $p is parked, not in the slot"
done

echo "  -- switch B -> A, both in browse"
pair_out_pair_in "$BROOTB" "$MICROB" "$BROOTA" "$MICROA"
sleep 1.5
send "$MICROA" "$(printf '\x1b')" 1.0
S=$(snapshot)
eq "$SLOT_PAIR" "$(slot_extent "$S" "$BROOTA" "$MICROA")" "A's pair comes back at the same geometry, again"
has "$(viewer_tabbar "$MICROA")" "gamma.js" "A's viewer still holds A's tabs after two agent switches"
has "$(viewer_tabbar "$MICROB")" "f2.txt"   "B's viewer kept its own tab while parked"

# =============================================================================
echo
echo "### 7. a slot resize while the pair is parked, then a restore"
# A real OS window drag is not reachable from a headless mux (wezterm cli has no
# window-resize verb), so what is exercised here is the slot itself changing size
# under a parked pair -- the same SIGWINCH-on-return path, and the one that can
# bring the pair back at the wrong ratio. A window drag is T07's.
pair_out_single_in "$BROOTA" "$MICROA" "$DIFFA"
sleep 1.2
cli activate-pane --pane-id "$DIFFA" >/dev/null
cli adjust-pane-size --pane-id "$DIFFA" --amount 4 Down >/dev/null 2>&1 \
  || cli adjust-pane-size --amount 4 Down >/dev/null 2>&1
sleep 1
S=$(snapshot)
SLOT_RESIZED=$(slot_extent "$S" "$DIFFA")
echo "  slot was $SLOT_REVDIFF, is now $SLOT_RESIZED"
assert "$([ "$SLOT_RESIZED" != "$SLOT_REVDIFF" ] && echo 0 || echo 1)" \
  "the slot really did change size while the pair was parked"
single_out_pair_in "$DIFFA" "$BROOTA" "$MICROA"
sleep 1.5
send "$MICROA" "$(printf '\x1b')" 1.0
S=$(snapshot)
show "$S"
eq "$SLOT_RESIZED" "$(slot_extent "$S" "$BROOTA" "$MICROA")" \
  "the pair returns filling the RESIZED slot, not the old one"
eq 47 "$(p_cols "$S" "$BROOTA")" "the 60/40 ratio held across the resize (browser)"
eq 72 "$(p_cols "$S" "$MICROA")" "the 60/40 ratio held across the resize (viewer)"
has "$(viewer_tabbar "$MICROA")" "gamma.js" "the tabs survived the resize too"
# The slot is deliberately left resized: §8 empties it and rebuilds it with
# `--percent 42` off the fleet pane, which recomputes the original height anyway
# -- and that recomputation is itself worth asserting.

# =============================================================================
echo
echo "### 8. the EMPTY-slot rebuild, with a pair to put back"
# Both halves die outright (someone exits both shells): there is nothing left to
# split into, so the terminal and the strip are parked, a placeholder is split
# full-width off the fleet pane, and the pair is restored into that.
pair_out_single_in "$BROOTA" "$MICROA" "$DIFFA"
sleep 1.2
cli kill-pane --pane-id "$DIFFA" >/dev/null; sleep 0.8
S=$(snapshot)
eq 4 "$(cockpit_panes "$S")" "the slot is empty -- 4 panes left in the cockpit tab"
PH=$(rebuild_slot); sleep 1
S=$(snapshot)
show "$S"
eq "$SLOT_REVDIFF" "$(slot_extent "$S" "$PH")" "the rebuilt slot is full width again"
single_out_pair_in "$PH" "$BROOTA" "$MICROA" kill
sleep 1.5
send "$MICROA" "$(printf '\x1b')" 1.0
S=$(snapshot)
show "$S"
eq "$SLOT_REVDIFF" "$(slot_extent "$S" "$BROOTA" "$MICROA")" "the pair fills the rebuilt slot exactly"
eq 47 "$(p_cols "$S" "$BROOTA")" "browser is 47 columns after a rebuild"
eq 72 "$(p_cols "$S" "$MICROA")" "viewer is 72 columns after a rebuild"
eq 6 "$(cockpit_panes "$S")" "fleet, browser, viewer, terminal, strip, footer"
eq "" "$(p_tab "$S" "$PH")" "the placeholder was disposed of, not left in a tab"
has "$(viewer_tabbar "$MICROA")" "gamma.js" "the tabs survived the rebuild"

# =============================================================================
echo
echo "### 9. what the extra park costs: pair swap vs single-pane swap"
# Only the wezterm calls are timed -- the sleeps around them are the probe's, not
# the daemon's -- and each swap is run REPS times, alternating, because a single
# swap is well under 50 ms and pure process-startup noise swamps it.
#
# READ THE DIRECTION, NOT THE FIGURE. REPS was 6 originally, and at six reps the
# two means overlapped: measured runs gave 19/26, 26/25 and 24/27 (single/pair)
# -- on the middle one the SINGLE swap came out the slower of the two, which a
# 5-calls-vs-3 story cannot explain. A single `wezterm cli` invocation is ~6 ms
# here, so a six-rep mean is a handful of process spawns and one scheduler
# hiccup moves it. At REPS=20 the direction is stable (25/31 and 17/28) and the
# pair costs roughly 6-11 ms more. So: the pair IS the slower of the two, both
# are a few tens of milliseconds, and any exact delta quoted off one run is not
# something this probe can defend.
#
# What these numbers ARE: the cost the daemon pays to move the panes. What they
# are NOT: what the user sees. A restored pane takes a SIGWINCH and repaints,
# and that redraw is a judgement, not an assertion (DESIGN §5.1) -- T07's.
REPS=20
t0=$(now_ms)
for i in $(seq 1 $REPS); do
  if [ $((i % 2)) = 1 ]; then pair_out_pair_in "$BROOTA" "$MICROA" "$BROOTB" "$MICROB"
  else                        pair_out_pair_in "$BROOTB" "$MICROB" "$BROOTA" "$MICROA"; fi
done
t1=$(now_ms)
PAIR_MS=$(( (t1 - t0) / REPS ))
# an even count leaves agent A's pair back in the slot
sleep 1.2

# For the single-pane comparison, park the pair out of the way and alternate two
# ordinary diff panes the way the other three modes do.
pair_out_single_in "$BROOTA" "$MICROA" "$DIFFB"
sleep 1.2
DIFFA2=$(cli split-pane --top --percent 50 --pane-id "$DIFFB" --cwd "$T/wtA" -- $SH)
cli move-pane-to-new-tab --pane-id "$DIFFB" >/dev/null
cli activate-tab --tab-id "$COCKPIT_TAB" >/dev/null
sleep 1
t0=$(now_ms)
for i in $(seq 1 $REPS); do
  if [ $((i % 2)) = 1 ]; then single_out_single_in "$DIFFA2" "$DIFFB"
  else                        single_out_single_in "$DIFFB" "$DIFFA2"; fi
done
t1=$(now_ms)
SINGLE_MS=$(( (t1 - t0) / REPS ))
echo "  single-pane swap: ${SINGLE_MS} ms per swap (3 wezterm cli calls, mean of $REPS)"
echo "  pair swap       : ${PAIR_MS} ms per swap (5 wezterm cli calls, mean of $REPS)"
echo "  (the gap between the two is inside this measurement's noise -- see the note above)"
assert "$([ "$PAIR_MS" -lt 1000 ] && echo 0 || echo 1)" \
  "a pair swap stays under a second (${PAIR_MS} ms) -- 'returning is instant' still holds"
assert "$([ "$SINGLE_MS" -lt 1000 ] && echo 0 || echo 1)" \
  "...and so does the single-pane swap it is measured against (${SINGLE_MS} ms)"

echo
echo "geometry summary"
printf '  %-34s %s\n' "revdiff alone in the slot"        "$SLOT_REVDIFF"
printf '  %-34s %s\n' "the pair in the slot"             "$SLOT_PAIR"
printf '  %-34s %s\n' "revdiff back after parking"       "$SLOT_BACK"
printf '  %-34s %s\n' "the pair back after parking"      "$SLOT_PAIR_BACK"
printf '  %-34s %s\n' "the slot resized while parked"    "$SLOT_RESIZED"

finish
