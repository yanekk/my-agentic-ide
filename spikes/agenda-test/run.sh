#!/usr/bin/env bash
# Tests for the cockpit agenda.
#
# The agenda is a column drawn inside the fleet view's welcome pane, not a pane of
# its own, so nothing here needs WezTerm -- this runs standalone, like
# spikes/notes-test, rather than through the mux stub in spikes/cockpit-test.
#
# Every suite runs against a THROWAWAY COCKPIT_DIR. That is the seatbelt that
# matters here (DESIGN 5.2): the real ~/.claude/cockpit holds live refresh tokens,
# and no test may ever read or write one. run.sh checks that afterwards rather
# than trusting it.
#
#   spikes/agenda-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

REAL_DIR="${HOME}/.claude/cockpit"
# Names for the whole directory, plus name+size+mtime for the agenda's own files.
# Names alone would miss a test that rewrote your real agenda.json in place, which
# is the one accident this check exists to catch -- but stat'ing the WHOLE dir would
# fail for reasons nothing to do with these tests, because a live cockpit rewrites
# terminals.json every couple of seconds while the window is open. Nothing but the
# agenda code writes agenda*, and no test may point that code at the real dir, so
# those are the files worth watching closely. Sizes and mtimes, never contents: this
# must not read a refresh token to prove it did not write one.
real_snapshot() {
  if [ -d "$REAL_DIR" ]; then
    ls -A "$REAL_DIR" | sort
    find "$REAL_DIR" -maxdepth 1 -name 'agenda*' -exec stat -f '%N %z %m' {} \; 2>/dev/null | sort
  else
    echo "(absent)"
  fi
}
BEFORE_REAL="$(real_snapshot)"

fail=0
check()  { if grep -qF -- "$2" "$3"; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       expected: $2"; fail=1; fi; }
same()   { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

# --- the node suites -------------------------------------------------------
# One fresh state dir each, so a suite can never inherit another's files. Later
# tasks add <name>.test.mjs beside this script and it is picked up here.
for suite in "$HERE"/*.test.mjs; do
  [ -e "$suite" ] || continue
  d="$T/$(basename "$suite" .test.mjs)"
  mkdir -p "$d"
  COCKPIT_DIR="$d" node "$suite" || fail=1
done

echo
echo "== 9. two writers at once =="
# You in one terminal, an agent in another, and the daemon in the background all
# write these files. Two read-modify-writes landing together would otherwise lose
# one, exactly as they would in notes.json.
C="$T/concurrent"; mkdir -p "$C"
cat > "$T/writer.mjs" <<'WRITER'
const store = await import(`${process.argv[2]}/bin/cockpit-agenda-store.mjs`);
store.putCalendar({ slug: process.argv[3], account: "a@b.c", calendarId: "c", title: "T", colour: 1 }, 1756200000000);
WRITER
for i in $(seq 1 10); do COCKPIT_DIR="$C" node "$T/writer.mjs" "$ROOT" "cal-$i" & done
wait
n="$(COCKPIT_DIR="$C" node -e 'import(process.argv[1]+"/bin/cockpit-agenda-store.mjs").then(s=>process.stdout.write(String(s.readState().calendars.length)))' "$ROOT")"
same "all 10 concurrent writes survived"          "$n" "10"
same "no temp file left behind"                   "$(ls -A "$C" | grep -cF '.tmp')" "0"
same "no lock left behind"                        "$(ls -A "$C" | grep -cF 'agenda.lock')" "0"

echo
echo "== 10. nothing leaks into the repo, or into your real sign-ins =="
# A state file checked into the repo would appear in `revdiff --untracked HEAD` --
# the very diff an agent is reviewed on -- and would put refresh tokens in git.
stray="$(find "$ROOT" -path "$ROOT/.git" -prune -o -path "$ROOT/.claude/worktrees" -prune -o \
         \( -name 'agenda*.json' -o -name '*.lock' -o -name '*.json.tmp' \) -print 2>/dev/null | wc -l | tr -d ' ')"
same "no agenda state anywhere in the checkout"   "$stray" "0"
same "the real cockpit dir is untouched"          "$(real_snapshot)" "$BEFORE_REAL"

echo
echo "== 11. the module keeps its side of the boundary =="
# DESIGN 5: this repository has zero dependencies and no package manifest, and
# that is a property worth keeping -- it must survive being cloned onto a machine
# with nothing but node and wezterm.
# Every quoted module specifier, however it is written -- `import x from "y"`,
# `export … from 'y'`, `await import('y')` -- and then everything that is not a
# node: builtin. Comment lines are dropped first: prose says "from" too, and the
# store's own header ("...`from "there and broken"`...") tripped the narrower
# pattern this replaced. Relative imports count as foreign here on purpose: the
# store is the base layer and the task requires it to stand on node: alone.
foreign="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$ROOT/bin/cockpit-agenda-store.mjs" \
  | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
  | grep -oE "[\"'][^\"']+[\"']" | grep -vcE "^[\"']node:")"
same "the store imports nothing outside node:*"   "$foreign" "0"

# DESIGN 3.1: the pure module may not touch the world. It arrives with T02 --
# until then this says so out loud rather than passing silently.
MODEL="$ROOT/bin/cockpit-agenda-model.mjs"
if [ -f "$MODEL" ]; then
  impure="$(grep -nE 'node:fs|node:http|node:https|node:child_process|fetch\(|Date\.now\(|new Date\(\)|process\.env' "$MODEL" | wc -l | tr -d ' ')"
  same "the model reaches for nothing impure"     "$impure" "0"
  # If this fails the fix is to MOVE THE CODE, never to relax the check: every
  # rule that leaks across this line becomes a rule only a person can verify.
else
  echo "  --   the pure model does not exist yet (T02 adds it); its boundary check is skipped"
fi

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit "$fail"
