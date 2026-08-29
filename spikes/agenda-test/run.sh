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
# Names for the whole directory, plus name+size+mtime for the files that hold the
# SIGN-INS. Names alone would miss a test that rewrote your real agenda.json in
# place, which is the one accident this check exists to catch -- but stat'ing the
# WHOLE dir would fail for reasons nothing to do with these tests, because a live
# cockpit rewrites terminals.json every couple of seconds while the window is open.
# Sizes and mtimes, never contents: this must not read a refresh token to prove it
# did not write one.
#
# agenda-cache.json is deliberately NOT stat'd, only listed. Measured 2026-08-29
# (T08): once a calendar is attached the DAEMON rewrites that file on every 60s
# tick -- ticks logged 60.0s apart, a new inode each time -- so including its mtime
# made this guard fail on any run that straddled a tick, with no test having touched
# anything. A guard that cries wolf is a guard nobody believes, and this is the one
# that must never be a false alarm. It stays in the `ls` line, so a test that
# CREATES or DELETES it is still caught; what is no longer caught is a test that
# overwrites the real cache in place. That is an acceptable residual: a leak has to
# add a calendar before it can cache one, and adding writes agenda.json, which is
# still watched to the byte-count and the second.
real_snapshot() {
  if [ -d "$REAL_DIR" ]; then
    ls -A "$REAL_DIR" | sort
    find "$REAL_DIR" -maxdepth 1 -name 'agenda*' ! -name 'agenda-cache.json' \
      -exec stat -f '%N %z %m' {} \; 2>/dev/null | sort
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

# DESIGN 5 again, for the one module that is ALLOWED to reach the network: it may
# use node: builtins and the built-in fetch, and nothing else. Same extraction as
# above, so a new import of a library fails here rather than at run time on a
# freshly cloned machine.
GOOGLE="$ROOT/bin/cockpit-agenda-google.mjs"
if [ -f "$GOOGLE" ]; then
  gforeign="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$GOOGLE" \
    | grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" \
    | grep -oE "[\"'][^\"']+[\"']" | grep -vcE "^[\"']node:")"
  same "the google client imports nothing outside node:*" "$gforeign" "0"

  # The seatbelt that matters for THIS module (DESIGN 5.2): every test points it at
  # a loopback stub. A test that quietly aimed at Google would open a real socket,
  # burn a real quota and fail on a train -- and would be invisible in a green run,
  # because a passing network call looks exactly like a passing stub call.
  # Case-insensitive, so the CLI's AGENDA_ORIGIN env seam is covered by the same
  # net as the module's own `origin:` argument -- otherwise a suite that drives the
  # command rather than the module could point it at Google and slip past.
  offbox="$(grep -oiE "(agenda_)?origin: *[^,)}]+" "$HERE"/*.test.mjs 2>/dev/null \
    | grep -viE "origin: *(stub\.origin|\`http://127\.0\.0\.1)" | wc -l | tr -d ' ')"
  same "no test points the client anywhere but loopback" "$offbox" "0"

  # Two more of the same kind, for the CLI's other two seams. A browser is the one
  # side effect a test cannot take back, and a prompt read from the REAL terminal
  # would block the suite forever on a machine with a person at it.
  browsers="$(grep -oE "AGENDA_BROWSER: *[^,)}]+" "$HERE"/*.test.mjs 2>/dev/null \
    | grep -vE "AGENDA_BROWSER: *FAKE_BROWSER" | wc -l | tr -d ' ')"
  same "no test can open a real browser"                 "$browsers" "0"
  same "no test reads the real terminal"                 "$(grep -lF '/dev/tty' "$HERE"/*.test.mjs 2>/dev/null | wc -l | tr -d ' ')" "0"
fi

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
echo "== 12. the agenda command exists inside the cockpit and nowhere else =="
# Published exactly the way `note` is, and asserted through the REAL line out of
# bin/cockpit-layout.sh rather than a copy of it: a copy drifts, and the drift
# would be a command that quietly stopped existing after a rebuild.
LINK_LINE="$(grep -F 'ln -sf "$HERE/cockpit-agenda.mjs"' "$ROOT/bin/cockpit-layout.sh" | head -1)"
same "cockpit-layout.sh publishes it"  "$([ -n "$LINK_LINE" ] && echo yes || echo no)" "yes"

S="$T/publish"; mkdir -p "$S/bin"
HERE_BIN="$ROOT/bin"
( HERE="$HERE_BIN" COCKPIT_BIN="$S/bin"; eval "$LINK_LINE" )
same "...as a symlink to the CLI"      "$(readlink "$S/bin/agenda")" "$ROOT/bin/cockpit-agenda.mjs"

# On PATH the way a cockpit shell gets it, and answering: the symlink is the whole
# of "available inside the cockpit", so a broken one is a missing feature.
help_out="$(PATH="$S/bin:$PATH" COCKPIT_DIR="$S" agenda help 2>&1)"
same "...and it answers from PATH" "$(printf '%s' "$help_out" | grep -c 'agenda add <slug>')" "1"

# And nowhere else: no wrapper, no shell function, no edit to anyone's ~/.zshrc.
same "...while it is not a command outside one" \
     "$(PATH="/usr/bin:/bin" command -v agenda >/dev/null 2>&1 && echo found || echo absent)" "absent"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit "$fail"
