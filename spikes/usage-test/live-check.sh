#!/usr/bin/env bash
# The real-machine check for the pir usage feed (plans/pir-usage-reader, DESIGN 4,
# PLAN § After the merge). NOT run by run.sh: live-check.test.mjs proves it against a
# stand-in; on the real machine a session runs it by hand after the merge.
#
#   live-check.sh           step 1, the contract: pir's service vs what the reader writes
#   live-check.sh follow    step 2, the live cockpit's cache and daemon.log, read-only
#
#   LIVE_COCKPIT_DIR  the cockpit dir step 2 reads; default $HOME/.claude/cockpit
#   LIVE_FOLLOW_SECS  how long step 2 samples; default 1200
#   LIVE_POLL_SECS    seconds between samples; default 30
#
# Exit 0 agree, 1 differ, 2 not checkable. The service is found through
# ${PIR_HOME ?? HOME}/.pir/api.json, exactly as the reader finds it.
#
# Seatbelts: step 1's --once writes only into a mktemp COCKPIT_DIR of its own,
# removed on exit; step 2 never writes anywhere. Output is verdicts, field names,
# counts and times -- NEVER a percentage, because it is pasted into conversations
# and into FINDINGS.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
READER="$ROOT/bin/cockpit-usage-pir.mjs"
# `${PIR_HOME-$HOME}`, not `:-`: the reader uses `??`, so a PIR_HOME set to the empty
# string is still used. The two must name the same file.
API="${PIR_HOME-$HOME}/.pir/api.json"

# observed_at of one GET, as a number, "null", or "" when the GET failed or the body
# was not JSON. The body itself is never printed.
fetch_body() {
  local url
  url="$(jq -r '.url // empty' "$API" 2>/dev/null)" || return 1
  [ -n "$url" ] || return 1
  curl -s --fail --max-time 2 "$url/v1/usage"
}
# Only a number counts as a reading; anything else the reader would call bad-body.
observed_of() {
  jq -r 'if (.observed_at | type) == "number" then .observed_at
         elif .observed_at == null then "null" else "" end' 2>/dev/null <<<"$1"
}

# --- step 1: the contract -------------------------------------------------------
step_contract() {
  local scratch status body body2 once once2 cache field obs obs2 attempt
  scratch="$(mktemp -d "${TMPDIR:-/tmp}/live-check.XXXXXX")" || { echo "no scratch dir"; return 2; }
  # shellcheck disable=SC2064
  trap "rm -rf '$scratch'" EXIT
  export COCKPIT_DIR="$scratch"

  status="$(node "$READER" --status 2>/dev/null)"
  case "$status" in
    running\ *) ;;
    *) echo "${status:-off no-answer}"; return 2 ;;
  esac

  # A reading can arrive between the curl and the --once; then the two describe
  # different readings and a mismatch would be a false "differ". Bracket the --once
  # with two GETs and retry, on a fresh cache, until both name the same reading.
  for attempt in 1 2 3; do
    rm -f "$scratch/usage-cache.json"
    body="$(fetch_body)" || { echo "unreachable"; return 2; }
    obs="$(observed_of "$body")"
    [ -n "$obs" ] || { echo "bad body"; return 2; }
    [ "$obs" != "null" ] || { echo "no reading"; return 2; }
    once="$(node "$READER" --once 2>/dev/null)"
    body2="$(fetch_body)" || { echo "unreachable"; return 2; }
    obs2="$(observed_of "$body2")"
    [ "$obs2" = "$obs" ] && break
    [ "$attempt" = 3 ] && { echo "moving too fast to compare"; return 2; }
  done

  # A dated reading with no drawable window is the reader's "empty": it rightly
  # writes nothing, so there is nothing to compare -- not checkable, not a differ.
  [ "$once" = "empty kept" ] && { echo "no reading"; return 2; }
  [ "$once" = "ok wrote" ] || { echo "differ once: $once"; return 1; }
  cache="$(cat "$scratch/usage-cache.json" 2>/dev/null)" || { echo "differ cache missing"; return 1; }

  # The first field that disagrees, or nothing. A window the reader would not draw
  # (null, or either number missing) must be null in the cache; a drawn one carries
  # the rounded percentage and the same reset.
  field="$(jq -rn --argjson b "$body" --argjson c "$cache" '
    def win($bw; $cw; $name):
      if ($bw | type) != "object" or ($bw.used_percentage | type) != "number"
         or ($bw.resets_at | type) != "number"
      then (if $cw == null then empty else $name end)
      elif $cw == null then $name
      elif $cw.usedPct != ($bw.used_percentage | round) then "\($name).usedPct"
      elif $cw.resetsAt != $bw.resets_at then "\($name).resetsAt"
      else empty end;
    [ (if $c.writtenAt != $b.observed_at then "writtenAt" else empty end),
      win($b.rate_limits.five_hour; $c.fiveHour; "fiveHour"),
      win($b.rate_limits.seven_day; $c.sevenDay; "sevenDay") ] | first // empty
  ' 2>/dev/null)" || { echo "differ cache unreadable"; return 1; }
  [ -z "$field" ] || { echo "differ $field"; return 1; }

  # The same reading polled again must not touch the cache (DESIGN 2.3), unless a
  # new reading arrived in between.
  once2="$(node "$READER" --once 2>/dev/null)"
  if [ "$once2" != "ok kept" ]; then
    body2="$(fetch_body)"; obs2="$(observed_of "$body2")"
    if [ "$once2" != "ok wrote" ] || [ "$obs2" = "$obs" ]; then
      echo "differ second once: $once2"; return 1
    fi
  fi
  echo "agree"
  return 0
}

# --- step 2: the live cockpit, read-only ------------------------------------------
step_follow() {
  local dir="${LIVE_COCKPIT_DIR:-$HOME/.claude/cockpit}"
  local follow="${LIVE_FOLLOW_SECS:-1200}" poll="${LIVE_POLL_SECS:-30}"
  local n i body obs last="" moved=0 failed=0 checked=0 unchecked=0 lag logline logstate
  n=$(( follow / poll + 1 ))
  for (( i = 0; i < n; i++ )); do
    (( i > 0 )) && sleep "$poll"
    body="$(fetch_body)" && obs="$(observed_of "$body")" || obs=""
    if [ -z "$obs" ] || [ "$obs" = "null" ]; then
      # Nothing heard from the service this sample: nothing to hold the cache to.
      unchecked=$((unchecked + 1)); continue
    fi
    checked=$((checked + 1))
    [ -n "$last" ] && [ "$obs" != "$last" ] && moved=$((moved + 1))
    last="$obs"
    # A tap write is newer than any pir reading and passes; only a cache more than
    # 35 s behind the service (a poll and a margin) says the daemon is not following.
    # Compared in jq, not (( )): bash arithmetic is integer-only, and a fractional
    # observed_at (the reader accepts one) made (( )) error out and read as a pass.
    # Prints "" for a pass, "nocache", or the lag in whole seconds.
    lag="$(jq -r --argjson o "$obs" '.writtenAt as $w
      | if ($w | type) != "number" then "nocache"
        elif $w < $o - 35000 then (($o - $w) / 1000 | floor | tostring)
        else "" end' "$dir/usage-cache.json" 2>/dev/null)" || lag="nocache"
    if [ "$lag" = "nocache" ]; then
      failed=$((failed + 1)); echo "$(date +%H:%M:%S) fail no cache"
    elif [ -n "$lag" ]; then
      failed=$((failed + 1)); echo "$(date +%H:%M:%S) fail behind ${lag}s"
    fi
  done

  logline="$(grep 'usage: pir service ' "$dir/daemon.log" 2>/dev/null | tail -1)"
  logstate="${logline##*usage: pir service }"
  [ -n "$logline" ] || logstate="none"

  echo "samples $((checked + unchecked)) checked $checked unchecked $unchecked"
  echo "failed $failed"
  echo "moved $moved"
  echo "log $logstate"
  if (( checked == 0 )); then echo "no reading"; return 2; fi
  if (( failed == 0 )) && [ "$logstate" = "ok" ]; then echo "agree"; return 0; fi
  echo "differ"
  return 1
}

case "${1:-}" in
  "")      step_contract ;;
  follow)  step_follow ;;
  *)       echo "usage: live-check.sh [follow]" >&2; exit 2 ;;
esac
exit $?
