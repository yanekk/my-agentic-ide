#!/usr/bin/env bash
# Test for the cockpit's notes: the `note` command and the column the fleet view
# renders it in.
#
# Neither needs WezTerm -- the notes column is drawn INSIDE the welcome pane
# rather than being a pane of its own -- so this runs standalone rather than
# through the mux stub in spikes/cockpit-test. The renderer is driven through a
# tiny harness that fakes a pane size and captures one frame.
#
#   spikes/notes-test/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

REPO="$T/repo"
mkdir -p "$REPO" "$T/state/bin"
# Exactly how bin/cockpit-layout.sh publishes the command: a symlink in a
# directory that only cockpit-spawned shells have on PATH.
ln -sf "$ROOT/bin/cockpit-note.mjs" "$T/state/bin/note"

export COCKPIT_DIR="$T/state"
export COCKPIT_REPO="$REPO"
export PATH="$T/state/bin:$PATH"
# Inherited from whatever runs this: it decides whether a note is attributed to
# you or to an agent, so each test states which it wants.
unset CLAUDECODE

# Render one frame of the welcome pane at a given size, escapes stripped.
cat > "$T/render.mjs" <<'HARNESS'
const [cols, rows] = [Number(process.argv[2]), Number(process.argv[3])];
Object.defineProperty(process.stdout, "columns", { value: cols, configurable: true });
Object.defineProperty(process.stdout, "rows",    { value: rows, configurable: true });
let buf = "";
const real = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { buf += s; return true; };
await import(process.argv[4]);
process.stdout.write = real;
real(buf.replace(/\x1b\[[0-9?]*[A-Za-z]/g, "") + "\n");
process.exit(0);
HARNESS
render() { node "$T/render.mjs" "$1" "$2" "$ROOT/bin/cockpit-welcome.mjs"; }

fail=0
check()  { if grep -qF -- "$2" "$3"; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       expected: $2"; fail=1; fi; }
refute() { if grep -qF -- "$2" "$3"; then echo "  FAIL $1"; echo "       did not expect: $2"; fail=1; else echo "  ok   $1"; fi; }
same()   { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }

echo
echo "== 1. the command exists only inside a cockpit =="
out="$(env -u COCKPIT_REPO COCKPIT_DIR="$T/nowhere" note ls 2>&1)"; rc=$?
same "refuses outside a cockpit"                 "$rc" "1"
printf '%s\n' "$out" > "$T/out"
check "...and says why"                          "not inside a cockpit" "$T/out"
# Refusing to explain itself is the one unhelpful failure: `note help` is how you
# find out what the command even is.
env -u COCKPIT_REPO COCKPIT_DIR="$T/nowhere" note help > "$T/out" 2>&1
check "but help still answers"                   "add a note" "$T/out"

echo
echo "== 2. adding, listing, and the short form =="
note "rebase before opening the PR" > "$T/out"
check "bare text adds a note"                    "added" "$T/out"
note add flaky test in run.sh:212 > /dev/null
note ls > "$T/out"
check "the note is listed"                       "rebase before opening the PR" "$T/out"
check "so is the unquoted one"                   "flaky test in run.sh:212" "$T/out"
same "newest first" \
  "$(note ls | head -1 | sed 's/.*  //')" "flaky test in run.sh:212"
note add $'two\nlines' > /dev/null
# JSON would carry a surviving newline as a literal \n inside the string.
refute "a pasted newline never splits a note"    'two\nlines' "$COCKPIT_DIR/notes.json"
check "...it is collapsed to one line"           '"text": "two lines"' "$COCKPIT_DIR/notes.json"

echo
echo "== 3. notes never touch the repo being reviewed =="
# A checked-in notes file would appear in `revdiff --untracked HEAD` -- the very
# diff the agent is reviewed on -- so every note would read as a change to explain.
same "nothing was written into the repo"         "$(ls -A "$REPO" | wc -l | tr -d ' ')" "0"
check "they live in the cockpit's state dir"     "rebase before opening the PR" "$COCKPIT_DIR/notes.json"
refute "no temp file is left behind"             "x" <(ls "$COCKPIT_DIR" | grep -F 'notes.json.tmp' || true)
refute "no lock file is left behind"             "x" <(ls "$COCKPIT_DIR" | grep -F 'notes.lock' || true)

echo
echo "== 4. ids are a stable handle, and take any unique prefix =="
id="$(note ls | head -1 | awk '{print $1}')"
note edit "${id:0:2}" now says something else > "$T/out"
check "a 2-char prefix resolved"                 "edited" "$T/out"
same "the id did NOT change under the edit" \
  "$(note ls | head -1 | awk '{print $1}')" "$id"
check "the text did"                             "now says something else" "$T/out"
note show "$id" > "$T/out"
check "show prints it in full"                   "now says something else" "$T/out"
note rm zzzz > "$T/out" 2>&1; same "an unknown id is refused" "$?" "1"
check "...by name"                               "no note 'zzzz'" "$T/out"
note rm "$id" > /dev/null
refute "removed for good"                        "now says something else" "$COCKPIT_DIR/notes.json"

echo
echo "== 5. a note you were handed reads differently from one you wrote =="
printf '{"agent":"tidy-the-footer","terminals":[]}\n' > "$COCKPIT_DIR/terminals.json"
CLAUDECODE=1 note "skipped the flaky test" > /dev/null
note ls > "$T/out"
check "an agent's note carries its name"         "skipped the flaky test — tidy-the-footer" "$T/out"
refute "yours carries no byline"                 "flaky test in run.sh:212 —" "$T/out"
# At the fleet LIST no agent is attached, so terminals.json says "repo" -- which
# is not a name to sign a note with.
printf '{"agent":"repo","terminals":[]}\n' > "$COCKPIT_DIR/terminals.json"
CLAUDECODE=1 note "written with nothing attached" > /dev/null
note ls > "$T/out"
check "an unattached agent still reads as an agent" "written with nothing attached — claude" "$T/out"

echo
echo "== 6. one list per repo =="
COCKPIT_REPO="$T/other" note "a note about a different project" > /dev/null
note ls > "$T/out"
refute "the other repo's notes stay out of this list" "different project" "$T/out"
COCKPIT_REPO="$T/other" note ls > "$T/out"
check "and are there in their own"                "different project" "$T/out"
refute "which does not see this repo's"           "skipped the flaky test" "$T/out"

echo
echo "== 7. you and the agents write to the same file at once =="
# Agents share this file with you, so every write is read-modify-write under a
# lock. Without it two adds landing together both read the same list and the
# second writes the first one away.
before="$(note ls | wc -l | tr -d ' ')"
for i in $(seq 1 10); do note "concurrent note $i" > /dev/null & done
wait
same "all 10 concurrent adds survived" \
  "$(note ls | wc -l | tr -d ' ')" "$(( before + 10 ))"

echo
echo "== 8. the fleet view's notes column =="
render 140 16 > "$T/frame"
check "the column is headed"                     "NOTES" "$T/frame"
check "the greeting keeps the left half"         "agentic-ide cockpit" "$T/frame"
check "the halves are divided"                   "│" "$T/frame"
check "a note is shown"                          "concurrent note 10" "$T/frame"
check "with its id"                              "$(note ls | head -1 | awk '{print $1}')" "$T/frame"
check "and its age"                              "now" "$T/frame"

# The column is a SUMMARY. Running out of rows must say so rather than stop at
# the fold and look like the whole list.
render 140 8 > "$T/frame"
check "an overrun says how much is hidden"       "more · note ls" "$T/frame"

render 140 60 > "$T/frame"
refute "a tall pane hides nothing"               "more · note ls" "$T/frame"

E="$T/empty"; mkdir -p "$E"
COCKPIT_DIR="$E" render 140 16 > "$T/frame"
check "an empty list says so"                    "no notes yet" "$T/frame"
check "...and how to add one"                    "in any cockpit terminal" "$T/frame"

# Half of a small window is a few characters wide, where the column would be
# unreadable and the greeting would clip mid-word.
render 44 10 > "$T/frame"
refute "a narrow pane drops back to one column"  "│" "$T/frame"
check "...keeping the greeting"                  "agentic-ide cockpit" "$T/frame"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit "$fail"
