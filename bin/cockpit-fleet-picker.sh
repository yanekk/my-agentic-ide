#!/usr/bin/env bash
# The fleet picker pane's program (plans/fleet-picker DESIGN §2.7).
#
#   bin/cockpit-fleet-picker.sh <cmd-file> <shown>
#
# Spawned by cockpitd through /usr/bin/env naming PATH (a split inherits nothing). Runs the
# picker once. A clean exit has already appended its verb; any other exit (a crash, a kill, a
# missing node) gets one `picker-cancel` here, so the daemon always hears back.
#
# Then it waits for ever and never exits on its own: a pane whose program exits is CLOSED,
# which collapses the fleet slot until a rebuild. The daemon kills this pane once it has
# swapped the chosen program back in.
set -u

CMD="${1:?usage: cockpit-fleet-picker.sh <cmd-file> <claude|pir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A HANDLER, not an ignore: an ignored SIGINT stays ignored across exec, and node would
# inherit a dead one. The handler keeps bash itself alive when a Ctrl+C reaches the group.
trap ':' INT

node "$HERE/cockpit-fleet-picker.mjs" "$@" || echo picker-cancel >> "$CMD"

# `sleep` in a loop rather than `read`: EOF on a closed stdin would end a read at once.
while :; do sleep 86400; done
