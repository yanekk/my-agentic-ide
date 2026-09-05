# BitBucket dashboard — two-line rows and reacting buttons

This plan extends the existing BitBucket dashboard (`plans/bitbucket-dashboard/`, complete
2026-09-05). It changes only how a PR row is drawn and how its buttons react to the mouse. It
adds no network calls, no config, no new tools, and touches neither the client, the store, nor
the daemon's fetch. Read the parent plan's DESIGN for how the dashboard as a whole works; this
document covers only what changes.

## 1. Purpose

The dashboard lists the PRs that concern you, one per row, with `[Review]`/`[Address]` and
`[Open]` buttons. Two gaps, both raised by the user:

1. A single line per PR wastes the room a PR row could use. Extend each row to **two lines** so a
   PR can also show **how old it is** and **whether it is new or busy right now**.
2. The buttons are drawn once and never react to the pointer. Give them a **hover** and a
   **press** appearance so a click has visible feedback before the agent spawns.

Success: every shown PR carries an age and, when they apply, activity tags; the buttons visibly
respond to hover (if the terminal allows it — §4) and to a press; the automated suite stays green;
and it is confirmed by hand in a live cockpit that the rows read well and the buttons react.

## 2. What each row shows

A PR is now **two lines**. Line one is unchanged from the parent plan: repository, `#id`, title,
author (To review only), the ✓/✎ counts, and the two buttons. Line two is new, indented under the
title, and holds the age and any activity tags. The buttons stay on line one, so a click's target
is still the row's first line and the hit-zone math changes only in which line number it stamps.

Two lines per PR halves how many PRs fit a page; the pager (parent §2.5) absorbs the rest. This is
the cost the user accepted for the extra room.

### 2.1 Age

The time since the PR was **opened** (`created_on`), because "how old is this PR" is what the user
asked for and what "introduced" in the `[NEW]` rule below means. Format, chosen for a glance:

- under an hour → `Nm` (minutes), so a just-opened PR does not read as `0h`
- under a day → `Nh`
- under a week → `Nd`
- a week or more → a calendar date, `Mon DD` (e.g. `Aug 20`)

The date form for old PRs is deliberate: past a week the exact day count stops meaning anything and
a date is what you actually reason about. All of this is a pure function of `created_on` and the
single `now` the pane already reads once per paint (parent §3.4), so it is tested in milliseconds.

### 2.2 The activity tags

Zero or more small tags after the age, each a pure function of the PR and `now`:

- **`[NEW]`** — opened within the last 24 hours (`now - created_on < 24h`). The PR that just landed
  and you have not seen.
- **`[ACTIVE]`** — **3 or more** comments in the last 24 hours. A live discussion is happening now.
  "3 or more" was the user's choice (2026-09-05) over 2 (too sensitive) and 5 (too rare): a real
  back-and-forth, not a single reply. **Any** comment counts, inline or general — the tag is about
  activity, not about the unresolved-thread sort, so it does not reuse that filter.
- **`[STALE]`** — no activity for **more than 14 days** (`now - updated_on > 14d`). Proposed by the
  session and accepted by the user (2026-09-05) to complete the trio: `[NEW]` just arrived,
  `[ACTIVE]` is busy now, `[STALE]` has gone quiet and is easy to forget. It reads `updated_on`
  (last activity), not `created_on`, because staleness is about silence, not birth.

A PR may carry more than one tag; in practice only `[NEW]` and `[ACTIVE]` can co-occur (a brand-new
PR already buzzing). `[STALE]` excludes the other two by construction — a PR touched in the last day
is neither silent for two weeks nor, if `[ACTIVE]`, quiet at all. Tags are drawn in the order NEW,
ACTIVE, STALE. When a tag applies, it is drawn; there is no configuration to turn one off.

The comment timestamps `[ACTIVE]` needs are already fetched: the daemon reads each shown PR's
comments for the unresolved-thread sort (parent §2.3), and every comment carries `created_on`. So
`[ACTIVE]` costs no extra call — it reduces data already in the cache. A PR whose comments were not
fetched (it does not concern you, so it is never shown) simply reads as not active.

### 2.3 What line two does not hold

The author stays on line one, where it already is. Moving it to line two to widen the title was
considered and left out: it is a larger change to line one's column logic for a cosmetic gain, and
the user's ask was the age and tags, not a re-layout. Noted as a possible later refinement, not
built here. The prototype also showed a source→dest branch on line two as an exploration; it was
not opted into and is not built.

## 3. The buttons reacting

Two visual states beyond the resting button, each a pure rendering variant so the appearance is
tested without a live pane, and each wired to the mouse in the pane (impure) separately:

- **Press** — on a left-button press over a button, that button inverts for a beat (reverse video:
  solid fill, text knocked out), confirming the click registered. This is certain to be buildable:
  the pane already receives the press that fires the verb, so the flash is one extra repaint. It is
  a fixed short flash rather than press-until-release, because a `[Review]`/`[Address]` press
  spawns an agent and the exact release may not arrive at this pane cleanly.
- **Hover** — while the pointer rests over a button, that button brightens and fills faintly, so the
  target is unmistakable. Whether this can work at all is an open technical question (§4).

The pure renderer gains one optional input, the emphasis `{ verb, state }` where state is `hover`
or `press`; the button whose hit-zone verb matches is drawn in that state, every other button at
rest. The pane decides the emphasis from the mouse and repaints. Keeping the *appearance* in the
pure model and only the *mouse reading* in the pane means every look is a millisecond test and only
the "does the terminal deliver the events" question is left for a person.

## 4. The hover question — a spike gates it

Today the dashboard pane asks the terminal to report mouse **presses** only (`?1000h`), and it is
**not the focused pane** — it sits in the fleet list while focus is usually elsewhere. Hover needs
the terminal to report mouse **movement** (`?1003h`, any-motion), and it is unproven that WezTerm
delivers motion to an *unfocused* pane the way it delivers clicks. It might not; and even if it
does, `?1003h` streams an event per pointer move, so a naive repaint-per-event could flicker the
whole pane.

So **T00 is a throwaway spike**: enable motion reporting in a real dashboard-shaped pane, move the
mouse over it without focusing it, and see whether the events arrive and whether a repaint-on-hover
is smooth. Its outcome, plus the user's call, decides T04:

- **Motion is delivered and smooth** → build hover (T04), repainting only when the hovered button
  *changes* (not per pixel), which throttles the redraw to state transitions.
- **Motion is not delivered, or flickers badly** → drop hover. The press feedback (T03) stands as
  the button reaction, which the user pre-accepted as the floor ("decide after the probe").

The press feedback (T03) does not depend on the spike and is built regardless.

## 5. Architecture — nothing crosses the boundary that did not already

The pure/impure split is the parent plan's and is unchanged. Age and the tags are pure functions of
a normalized PR and `now`, living in `cockpit-bitbucket-model.mjs` beside the render code; the
purity grep in `spikes/bitbucket-test/run.sh` already guards that file and keeps guarding it. **If
that grep fails the fix is to move the code, never to relax the grep.** `normalizePR` gains the
parsed `created_on` (as milliseconds) and the list of comment timestamps (as milliseconds); parsing
a timestamp string to a number is not a clock read, so purity holds. `now` is not read in
`normalizePR` — the NEW/ACTIVE/STALE decision is made in the render path where `now` already flows,
so the model never reaches for a clock.

The mouse wiring (press in T03, hover in T04) is impure and lives in `cockpit-welcome.mjs`, the same
file that already reads presses and appends verbs. It starts no process and opens no socket; it only
enables a reporting mode and repaints.

## 6. Environment — read this before running anything

Same as the parent plan. macOS, Node.js ES modules, zero dependencies, no npm, no test framework.
WezTerm is the terminal and multiplexer; `claude agents` is the fleet view.

**The test command** (unchanged from the parent):

```
spikes/agenda-test/run.sh && spikes/notes-test/run.sh && spikes/cockpit-test/run.sh && spikes/bitbucket-test/run.sh
```

Quiet on pass (one `bitbucket-test: N ok` line), no colour, loud on failure with a non-zero exit.
New tests for the age, the tags and the two-line render go in the existing `spikes/bitbucket-test/`
suite; its fixtures currently set only `updated_on`, so they gain `created_on` and comment
timestamps. See the agenda suite for how to turn verbose output back on to debug.

### 6.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| Whether WezTerm reports mouse **motion** to the unfocused dashboard pane, and whether a repaint-on-hover is smooth | Motion delivery and flicker are only real in the running mux at a real width (T00) |
| The two-line rows read well and stay aligned in a live pane | Rendering is only real in WezTerm at a real width (T02) |
| The press flash is visible and lands on the right button when clicked live | Mouse timing and coordinates are only real in the running mux (T03) |
| The hover highlight tracks the pointer and does not flicker | Same — only real in the running mux (T04, if built) |

### 6.2 Seatbelts

| Mechanism | Effect |
|---|---|
| throwaway `COCKPIT_DIR` in every suite | no test reads or writes the real `~/.claude/cockpit`, which holds a live credential (parent §5.2) |
| the spike is read-only observation | T00 only enables a reporting mode and logs what arrives; it mutates nothing and spawns nothing |

The spike and the live hand-checks run in a scratch cockpit pane, never against real agent work.

## 7. Decisions and rationale

All dates 2026-09-05 unless noted.

- **Two lines per PR, line two holds age + tags, line one unchanged.** The user asked to extend a
  row to two lines to fit the age and the tags. Keeping line one exactly as the parent plan drew it
  (including the buttons, so the click math barely moves) is the lowest-risk way to add the second
  line. The density cost — fewer PRs per page — the user accepted.
- **Age is from `created_on`; the `Nm/Nh/Nd/date` scale.** "How old" and "introduced" both mean
  when it was opened. The scale drops to a date past a week because the exact day count stops being
  useful there; minutes under an hour so a fresh PR is not `0h`.
- **`[ACTIVE]` = 3+ comments in 24h, any comment.** User's choice over 2 and 5. Any comment counts,
  not only inline threads, because the tag is an activity signal, separate from the sort's
  unresolved-thread metric.
- **`[STALE]` = no activity in >14 days, from `updated_on`.** Session's proposal, user-accepted, to
  complete the activity trio. Reads last-activity, not creation.
- **Both NEW and ACTIVE may show together; STALE excludes them by construction.** They are
  independent signals; suppressing one when another applies would hide something true.
- **Press feedback is a fixed short flash, built regardless of the spike; hover is spike-gated.**
  The press is certain (the pane already gets the click); hover depends on motion delivery to an
  unfocused pane, which is unproven. The user pre-accepted press-only as the floor.
- **Direction confirmed via a throwaway mock** (2026-09-05), parked at `prototype/`. The user
  reacted to it and refined the tag thresholds; it is a non-binding reference for the real UI, not
  a spec.
- **The prototype's author-on-line-two and branch-on-line-two ideas are not built.** Explorations,
  not opted into.

## 8. Out of scope

- Configuring the tag thresholds. They are fixed constants with their reasons here; a setting is
  cost without a asked-for user.
- Moving the author to line two / widening the title (§2.3).
- A branch line (§2.3).
- Any change to which PRs show or their order — that is the parent plan's classify/sort, untouched.
- Any new BitBucket call, config setting, or tool.
