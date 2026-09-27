#!/usr/bin/env bash
# The pir pane's program: pir's dashboard in a relaunch loop (pir-pane DESIGN 2.3).
#
#   bin/cockpit-pir.sh <pir-binary> <state-file>
#
# Spawned by cockpitd the first time the footer's PIR label is clicked, through
# /usr/bin/env naming PATH and COCKPIT_REPO (a split inherits nothing from the
# daemon). PIR_DASHBOARD_STATE asks pir to keep <state-file> current with what it
# has open -- the only way the cockpit learns it (DESIGN 2.4).
#
# pir quits on Esc and Ctrl+C, and a pane whose program exits is CLOSED, which would
# leave the daemon holding a pane id that no longer exists. So this never exits and
# never execs away: it relaunches pir, the same fix `claude agents` has in
# cockpit-layout.sh. Five exits in a row, each under two seconds, is a broken pir
# rather than a person pressing Esc; spinning would hide why, so it stops, says so,
# and waits for Enter.
set -u

PIR="${1:?usage: cockpit-pir.sh <pir-binary> <state-file>}"
STATE="${2:?usage: cockpit-pir.sh <pir-binary> <state-file>}"

# A HANDLER, not an ignore: an ignored SIGINT stays ignored across exec, so pir would
# inherit a dead Ctrl+C. A handler is reset to the default in the child, and it keeps
# bash itself from dying when a Ctrl+C reaches the whole foreground group.
trap ':' INT

fast=0
while true; do
    start=$SECONDS
    PIR_DASHBOARD_STATE="$STATE" "$PIR"
    status=$?
    if [ $(( SECONDS - start )) -lt 2 ]; then fast=$(( fast + 1 )); else fast=0; fi
    if [ "$fast" -ge 5 ]; then
        echo
        echo "cockpit: pir exited immediately 5 times in a row (last exit status $status)."
        echo "cockpit: not relaunching it again until you press Enter."
        # `until`, not a single read: EOF (Ctrl+D, or a closed stdin) must not count as
        # Enter, or a pane with no reader would go straight back to spinning.
        until read -r _; do sleep 2; done
        fast=0
    fi
done
