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
#
# An optional 5th argument FREEZES the clock. The agenda draws a wall clock, a
# `NOW` row and the word TODAY, none of which is the same string twice on a real
# clock -- and paired with a fixed TZ it makes "14:20 on a busy Wednesday" a
# millisecond assertion. The seam is in THIS HARNESS, not in the pane: the pane
# reads Date.now() exactly once per paint and has no test hook of its own.
cat > "$T/render.mjs" <<'HARNESS'
const [cols, rows] = [Number(process.argv[2]), Number(process.argv[3])];
Object.defineProperty(process.stdout, "columns", { value: cols, configurable: true });
Object.defineProperty(process.stdout, "rows",    { value: rows, configurable: true });
const frozen = Number(process.argv[5]);
if (Number.isFinite(frozen) && frozen > 0) Date.now = () => frozen;
let buf = "";
const real = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { buf += s; return true; };
await import(process.argv[4]);
process.stdout.write = real;
// The class carries a `;` so 256-colour codes (`38;5;37`, a calendar's bar) are
// stripped whole rather than leaving their tail in the frame.
real(buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") + "\n");
process.exit(0);
HARNESS
render() { node "$T/render.mjs" "$1" "$2" "$ROOT/bin/cockpit-welcome.mjs"; }
# The same frame with a state dir, a fixed zone and a fixed instant of its own.
arender() { COCKPIT_DIR="$1" TZ="Europe/Warsaw" node "$T/render.mjs" "$2" "$3" "$ROOT/bin/cockpit-welcome.mjs" "$NOW"; }
# Which line something landed on -- the two sections are stacked, so their ORDER
# and the budget between them are what most of section 9 is about.
lineno() { grep -nF -- "$2" "$1" | head -1 | cut -d: -f1; }
# The left half of every row, for "the greeting did not move".
leftof() { node -e 'const fs=require("node:fs");process.stdout.write(fs.readFileSync(process.argv[1],"utf8").split("\n").map((l)=>l.split("\u2502")[0]).join("\n"))' "$1"; }

fail=0
check()  { if grep -qF -- "$2" "$3"; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       expected: $2"; fail=1; fi; }
refute() { if grep -qF -- "$2" "$3"; then echo "  FAIL $1"; echo "       did not expect: $2"; fail=1; else echo "  ok   $1"; fi; }
same()   { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       want [$3] got [$2]"; fail=1; fi; }
gt()     { if [ "${2:-0}" -gt "${3:-0}" ] 2>/dev/null; then echo "  ok   $1"; else echo "  FAIL $1"; echo "       want [$2] > [$3]"; fail=1; fi; }

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
# 24 rows, not 16: the agenda now takes the bottom of this column, and at 16 the
# last of the ten concurrent notes falls below the fold -- which one is a
# scheduling accident, so the assertion below it would be a coin toss.
render 140 24 > "$T/frame"
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
echo "== 9. the agenda under the notes =="
# 14:20 on Wednesday 26 August 2026, Warsaw. Frozen so `NOW`, `until 15:00` and
# the wall clock in the heading are the same string on every machine at any hour;
# with a real clock an event three hours out crosses midnight for anyone running
# the suite in the evening and the frame changes under the test.
NOW=1787746800000

A="$T/agenda"; mkdir -p "$A"
for i in $(seq 1 12); do COCKPIT_DIR="$A" note "agenda-pane note $i" > /dev/null; done

# The cache holds ALREADY-NORMALISED events -- { title, start, end, allDay, reply }
# -- which is the shape cockpitd stores and renderAgenda reads.
cat > "$T/fixture.mjs" <<'FIXTURE'
import fs from "node:fs";
const [dir, nowArg, kind] = process.argv.slice(2);
const now = Number(nowArg), m = 60000, h = 60 * m;
const cal = (slug, colour) =>
  ({ slug, account: "you@example.com", calendarId: `${slug}@example.com`, title: slug, colour, addedAt: 1 });
fs.writeFileSync(`${dir}/agenda.json`, JSON.stringify(
  { version: 1, accounts: {}, calendars: [cal("work", "teal"), cal("home", "amber")] }, null, 2));
const ev = (id, title, start, end) => ({ id, title, start, end, allDay: false, reply: "n/a" });
const cals = kind === "long"
  // Fourteen rows is more than half of any pane this suite draws, so the cap is
  // what decides the height rather than the content.
  ? { work: Array.from({ length: 14 }, (_, i) =>
        ev(`w${i}`, `meeting number ${i}`, now + (i + 1) * 10 * m, now + (i + 1) * 10 * m + 5 * m)),
      home: [] }
  : { work: [ev("w1", "sprint review", now - 20 * m, now + 40 * m)],
      home: [ev("h1", "pick up kids", now + 3 * h + 10 * m, now + 4 * h)] };
fs.writeFileSync(`${dir}/agenda-cache.json`, JSON.stringify({ version: 1, calendars: {
  work: { fetchedAt: now, events: cals.work, error: null },
  home: { fetchedAt: now, events: cals.home, error: null },
} }, null, 2));
FIXTURE
node "$T/fixture.mjs" "$A" "$NOW" short

arender "$A" 140 24 > "$T/frame"
check "the notes are still headed"               "NOTES" "$T/frame"
check "and the agenda under them"                "AGENDA" "$T/frame"
gt "the agenda sits BELOW the notes"             "$(lineno "$T/frame" AGENDA)" "$(lineno "$T/frame" NOTES)"
sed -n "$(( $(lineno "$T/frame" AGENDA) - 1 ))p" "$T/frame" > "$T/rule"
check "a rule divides the two sections"          "──────────" "$T/rule"
check "the day is named, both scopes labelled"   "TODAY · Wed 26 Aug" "$T/frame"
check "with the wall clock"                      "14:20" "$T/frame"
check "the event you are in is pinned"           "NOW" "$T/frame"
check "...and says when it lets you go"          "└ until 15:00" "$T/frame"
check "a later event follows it"                 "pick up kids" "$T/frame"
check "each row names its calendar"              "work" "$T/frame"
gt "events are drawn below the notes, never above" \
   "$(lineno "$T/frame" 'sprint review')" "$(lineno "$T/frame" 'agenda-pane note 12')"

# The column is drawn even with nothing attached: a blank region with no
# explanation reads as a bug (DESIGN 2.6).
render 140 24 > "$T/frame"
check "with no calendars it says so"             "no calendars" "$T/frame"
check "...and how to attach one"                 "agenda add home" "$T/frame"
check "and the notes are untouched by that"      "concurrent note 1" "$T/frame"

# Content-driven, not a fixed half: a short agenda hands its slack back to the
# notes, which is the whole reason the split is computed rather than hard-coded.
arender "$A" 140 16 > "$T/short"
same "a short agenda leaves the notes more room" \
  "$(grep -oE '\+[0-9]+ more' "$T/short" | head -1)" "+5 more"
node "$T/fixture.mjs" "$A" "$NOW" long
arender "$A" 140 16 > "$T/long"
same "a long one takes it back"                  "$(grep -oE '\+[0-9]+ more' "$T/long" | head -1)" "+7 more"
same "the long agenda is capped at half the column" "$(lineno "$T/long" AGENDA)" "10"
same "the short one took only what it wanted"    "$(lineno "$T/short" AGENDA)" "12"
check "a capped agenda still says what it hid"   "more · agenda" "$T/long"

# The agenda is anchored to the BOTTOM of the column: the notes are padded out to
# their whole budget, so the rule does not ride up and down the pane every time a
# note is added or ages off the list.
node "$T/fixture.mjs" "$A" "$NOW" short
same "the rule sits at the foot of the notes' budget, not under the last note" \
  "$(arender "$A" 140 24 > "$T/frame"; lineno "$T/frame" AGENDA)" "20"

# The notes' EMPTY state draws four lines whatever room it was given, so a small
# pane with no notes yet would push the bottom of the agenda off the screen.
B="$T/agenda-nonotes"; mkdir -p "$B"
cp "$A/agenda.json" "$A/agenda-cache.json" "$B/"
arender "$B" 140 9 > "$T/frame"
check "an empty notes list still says so"        "no notes yet" "$T/frame"
check "...without pushing the agenda off the bottom" "more · agenda" "$T/frame"

# Three rows is the least that still reads as a list; below that the notes would
# be a label with nothing under it, so the agenda gives way instead.
arender "$A" 140 6 > "$T/frame"
same "the notes never fall below three rows"     "$(lineno "$T/frame" AGENDA)" "5"
arender "$A" 140 4 > "$T/frame"
refute "a pane too short drops the agenda entirely" "AGENDA" "$T/frame"
check "...and keeps the notes"                   "NOTES" "$T/frame"

# Returning one line too many pushes the pane's own bottom row off the screen and
# scrolls it; one too few leaves the previous paint showing through.
for size in "140 24" "140 16" "140 6" "140 4" "100 30"; do
  set -- $size
  same "the frame is exactly $2 rows at ${1}x$2" \
    "$(arender "$A" "$1" "$2" | wc -l | tr -d ' ')" "$2"
done
same "...and with no agenda configured at 140x24" \
  "$(render 140 24 | wc -l | tr -d ' ')" "24"

# Colour codes are not columns: a bar or a slug must not push a row past the pane
# edge, where it would wrap and shove everything below it down a line.
same "no line is wider than the pane" \
  "$(arender "$A" 140 24 | node -e 'let b="";process.stdin.on("data",(d)=>b+=d).on("end",()=>process.stdout.write(String(b.split("\n").filter((l)=>[...l.replace(/\r/g,"")].length>140).length)))')" "0"

# The left half is not this task's business and must not have moved.
arender "$A" 140 24 > "$T/withagenda"; render 140 24 > "$T/without"
same "the greeting is unchanged by the agenda" \
  "$(leftof "$T/withagenda" | md5)" "$(leftof "$T/without" | md5)"
arender "$A" 100 30 > "$T/withagenda"; render 100 30 > "$T/without"
same "...at another size too" \
  "$(leftof "$T/withagenda" | md5)" "$(leftof "$T/without" | md5)"

# Half of a small window is a few characters wide: the pane already drops back to
# one centred greeting there, and the agenda is not drawn either.
arender "$A" 44 10 > "$T/frame"
refute "a narrow pane draws no agenda"           "AGENDA" "$T/frame"
refute "...and stays one column"                 "│" "$T/frame"
check "...keeping the greeting"                  "agentic-ide cockpit" "$T/frame"

# A cockpit that will not paint because a JSON file lost a brace is worse than one
# that has forgotten a calendar (DESIGN 2.7).
printf '{ this is not json' > "$A/agenda-cache.json"
arender "$A" 140 24 > "$T/frame"
check "a corrupt cache still draws the pane"     "agentic-ide cockpit" "$T/frame"
check "...with the notes intact"                 "agenda-pane note 12" "$T/frame"
check "...and the agenda saying it has nothing"  "nothing today or tomorrow" "$T/frame"
printf '{ nor is this' > "$A/agenda.json"
arender "$A" 140 24 > "$T/frame"
check "a corrupt agenda.json draws too"          "no calendars" "$T/frame"
check "...notes still intact"                    "agenda-pane note 12" "$T/frame"
# And it is left exactly where it is. This pane repaints every two seconds, so it
# would always be the one to move the sign-ins aside -- and it has nobody to tell,
# where `agenda` names the rescued file and says the calendars need adding again
# (DESIGN 2.7). Reading is the pane's job; rescuing is the command's.
same "...and the pane did not move the sign-ins aside" \
  "$(cat "$A/agenda.json")" "{ nor is this"
same "...nor left a corrupt-<ts> file behind" \
  "$(ls "$A" | grep -c 'agenda.json.corrupt-')" "0"

echo
echo "== 10. the pane is still pure display =="
# cockpitd owns this pane as the repo's diff slot on exactly that basis: it draws
# what it reads and does nothing else. A shell command or a pane move in here
# would be run by whichever agent's slot the pane happens to be in.
W="$ROOT/bin/cockpit-welcome.mjs"
code() { grep -vE '^[[:space:]]*(//|\*|/\*)' "$W"; }
same "it starts no process"        "$(code | grep -cE 'child_process|execSync|execFileSync|spawn\(')" "0"
same "it opens no socket"          "$(code | grep -cE 'node:net|node:http|node:https|fetch\(|Socket')" "0"
same "it never drives wezterm"     "$(code | grep -ciE 'wezterm')" "0"
# The agenda arrived by importing two modules; anything else new is a way back in.
same "and imports only the model, the store and the notes" \
  "$(code | grep -oE '(from|import)[[:space:]]*\(?[[:space:]]*"[^"]+"' | grep -oE '"[^"]+"' \
     | grep -vcE '^"(node:fs|\./cockpit-(notes|agenda-model|agenda-store)\.mjs)"$')" "0"

echo
echo "== 11. a new cache repaints the pane, with no restart =="
# The daemon rewrites agenda-cache.json every five minutes and `agenda add` writes
# it immediately; neither restarts this pane. It watches the state DIRECTORY
# rather than the file because every write is temp-plus-rename, so a file watch
# would go deaf on the new inode after the first one.
cat > "$T/watch.mjs" <<'WATCH'
// Drives the real pane as a child with a pipe for a screen, replaces the cache
// the way the store does, and times how long the new title takes to appear.
import { spawn } from "node:child_process";
import fs from "node:fs";
const [welcome, dir, repo] = process.argv.slice(2);
const cache = `${dir}/agenda-cache.json`;
const write = (title) => {
  const now = Date.now(), h = 3600000;
  fs.writeFileSync(`${cache}.tmp`, JSON.stringify({ version: 1, calendars: { w: {
    fetchedAt: now, error: null,
    // All-day, so it is on screen whatever the hour the suite runs at.
    events: [{ id: "x", title, start: now - 12 * h, end: now + 12 * h, allDay: true, reply: "n/a" }],
  } } }));
  fs.renameSync(`${cache}.tmp`, cache);
};
write("before-the-write");
const kid = spawn(process.execPath, [welcome], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, COCKPIT_DIR: dir, COCKPIT_REPO: repo },
  stdio: ["ignore", "pipe", "ignore"],
});
let buf = "", started = 0, done = false;
const finish = (word) => { if (done) return; done = true; console.log(word); kid.kill("SIGKILL"); };
kid.stdout.on("data", (d) => {
  buf += d;
  if (!started && buf.includes("before-the-write")) {
    // Immediately, so the 2s fallback repaint is ~2s away and cannot be what
    // answers inside the deadline below.
    started = Date.now(); buf = ""; write("after-the-write"); return;
  }
  if (started && buf.includes("after-the-write")) finish(`repainted in ${Date.now() - started}ms`);
});
setTimeout(() => finish(started ? "NO REPAINT" : "NEVER PAINTED"), 1200);
WATCH
V="$T/watched"; mkdir -p "$V"
printf '{"version":1,"accounts":{},"calendars":[{"slug":"w","account":"a@b","calendarId":"c","title":"w","colour":"teal","addedAt":1}]}\n' > "$V/agenda.json"
COCKPIT_DIR="$V" note "a note in the watched pane" > /dev/null
out="$(node "$T/watch.mjs" "$ROOT/bin/cockpit-welcome.mjs" "$V" "$T/repo")"
printf '%s\n' "$out" > "$T/out"
# Under 1200ms with the fallback repaint 2s out: only the directory watch can
# have done this.
refute "a replaced cache is on screen without a restart" "NO REPAINT" "$T/out"
refute "...and the pane painted at all"                  "NEVER PAINTED" "$T/out"
check "...from the watch, not the 2s repaint"            "repainted in" "$T/out"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "FAILURES"; fi
exit "$fail"
