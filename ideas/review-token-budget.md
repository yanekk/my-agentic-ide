# Prompt: cut what a session has to read before it can work

Hand this to `/pir-plan`. Written 2026-08-29 after measuring where `/pir-review`'s
token spend actually goes. **Every number below was measured, not estimated — do not
re-derive them, and do not trust a claim here that you can cheaply re-check and find
different.**

---

## The problem

`/pir-review` accounts for 26% of usage on this project. The obvious suspect — a verbose
skill file — is not the cause: `pir-review/SKILL.md` is 4,625 bytes and every line of it
is load-bearing. The cost is the **corpus a session must read**, most of which is paid by
*every* session, not just reviews.

Measured, 2026-08-29:

| What | Size | Paid by |
|---|---|---|
| `CLAUDE.md` | 57,808 B (of which the measured-facts table is **31,047 B / 74 rows**) | every session, automatically |
| `plans/cockpit-agenda/FINDINGS.md` | 45,826 B — **78 rows averaging 578 B (~90 words)** | every session on that plan |
| `plans/cockpit-agenda/DESIGN.md` | 37,444 B | every session on that plan |
| `plans/cockpit-agenda/PROGRESS.md` | 12,097 B — 10 rows averaging 456 B (~70 words) | every session on that plan |
| a task doc | ~6–8 KB | the session doing that task |
| **one full test pass** | **1,169 lines / 47,033 B** | every session that runs the suite |

Per-suite output, all four green at the time of measurement (`ALL PASS` ×4):

```
spikes/agenda-test      735 lines   30,250 B
spikes/cockpit-test     256 lines   10,358 B
spikes/notes-test       114 lines    3,950 B
spikes/auto-name-test    64 lines    2,475 B
```

A review runs the suite **at least twice** — once to confirm green, once after its fix
commit — so ~94 KB of that is pure repetition of the word `ok`.

**The stated goal: cut the reading bill without weakening a review.** Specifically, review
check #4 in `pir-review/SKILL.md` (reading the diff adversarially for what the task doc did
not anticipate) is named there as "the one that pays" and must come out of this untouched.
Running reviews on a cheaper model was considered and **rejected** — it degrades exactly
that check while saving almost nothing, because the spend is corpus volume, not reasoning.

---

## The four changes

The PM has approved all four in principle. Plan them as separate tasks — they have very
different risk profiles and T1 should not be held up by T3.

### 1. Quiet the test runners  *(zero quality cost — do this first)*

Every assertion helper prints a line on **pass**. Failures must keep printing in full,
exactly as now, including their `expected:` / `want [x] got [y]` detail lines. Passes should
collapse to one summary line per suite (`agenda-test: 637 ok`).

The reporting sites, all found:

| File | Helpers |
|---|---|
| `spikes/agenda-test/harness.mjs` | `ok`, `eq`, `section`, `done` — **shared by all 5 `*.test.mjs`**, so one edit covers the biggest suite |
| `spikes/agenda-test/run.sh` :52–53 | `check`, `same` |
| `spikes/notes-test/run.sh` :64–67 | `check`, `refute`, `same`, `gt` |
| `spikes/cockpit-test/run.sh` :259, :269, :893 | `check`, an inverted check, `same` |
| `spikes/auto-name-test/run.sh` :30 | `same` |
| `spikes/auto-name-test/naming.test.mjs` :18 | its own inline `ok` (does **not** use the agenda harness) |
| `spikes/auto-name-test/install.test.mjs` :17 | its own inline `ok` as well, plus a `N passed, N failed` tail at :129 |

**Open question for the PM — recommend an answer in the plan:** should quiet be the
**default**, with `-v`/`VERBOSE=1` restoring today's output, or opt-in via `--quiet`? The
recommendation is **default-quiet**: the dominant caller is an agent session, and an opt-in
flag saves nothing on any run where the flag is forgotten. A human debugging a failure
already gets the full failure detail either way; `-v` is there for the rarer case of wanting
to see what *passed*.

Whatever is chosen, the mode must be visible in the summary line so nobody mistakes a quiet
run for a suite that did not run.

### 2. Bring `FINDINGS.md` back inside its own budget

`CLAUDE.md` sets **about forty words a row**. `plans/cockpit-agenda/FINDINGS.md` runs 78 rows
at ~90 words — more than twice its stated limit, 46 KB. `plans/browse-mode/FINDINGS.md`
(4,812 B) is fine and should be left alone. `PROGRESS.md` at ~70 words against a 60-word
limit is close enough not to be worth churning; confirm that judgement or overrule it.

This is enforcing a rule the project already wrote down, not a new one. The long-form
reasoning behind each row is already in the commit messages, which `CLAUDE.md` says is
exactly where it belongs.

**Two hard constraints.** First: **re-summarise, never delete rows.** `CLAUDE.md` calls
`FINDINGS.md` "the only record that anything was ever seen working for real" — every "verified
by hand with the user" line and its date must survive the trim intact. Second: a trimmed row
must still be *findable*; if a row's value was a term someone would grep for, keep the term.

**Open question for the PM:** should rows belonging to a *finished* plan be archived out of
the live file (e.g. `FINDINGS-archive.md`, unread by default) rather than trimmed? That
would save more and lose less, but it changes what "read at the start of every session"
covers. Bring it as a decision; do not pick one.

### 3. Split `CLAUDE.md`'s measured-facts table

"Things that are true because they were measured" is 31,047 B of the file's 57,808 B — 74
rows — and loads into **every** session, including ones that never go near the daemon.

The shape: **keep all 74 rules as one-liners in `CLAUDE.md`** — the left column, the rule
itself — so a reviewer running check #3 still walks the complete list of traps. Move the
paragraph of *why* behind each into a separate document (`docs/measured.md` is the obvious
home, alongside `docs/cockpit.md`), linked row by row, fetched only for the rows a change
actually touches.

**The risk to manage:** that table is the trap list, and every row cost somebody a day. The
index must stay **complete** — a rule dropped in the split is a day lost again. Whatever
mechanism keeps `CLAUDE.md`'s rule count and `docs/measured.md`'s entry count in step, name
it in the plan; a test asserting the two agree is cheap and worth it.

Note the knock-on: `CLAUDE.md` currently ends that table with a line pointing at
`docs/cockpit.md`, `spikes/pty-inject/RESULTS.md` and `spikes/pane-swap/RESULTS.md` as
sources. Those pointers must survive.

### 4. Scope what a review reads, not how hard it reads

Two wording changes in `pir-review/SKILL.md`:

- check #2 should read the test source **for the files the diff touched** (`git show --stat`
  names them), not whole suites. `spikes/agenda-test/cli.test.mjs` alone is 48,590 B.
- check #3 should fetch trap rationale from `docs/measured.md` only for the rows the diff
  touches — this is the consumer side of change 3 and should land with it or after it.

**A gotcha the plan must confront.** The skills are **not in this repo and not under version
control anywhere**: `~/.claude/skills/pir-{work,plan,review,implement,review-plan}/SKILL.md`
are plain files in the home directory, verified 2026-08-29 (`git rev-parse` there reports no
repository; they are real files, not symlinks into the checkout). So an edit to a skill is
not captured by a commit, cannot be reviewed by the normal mechanism, and is lost with the
machine — which the project's own working agreements call out as the reason to push.

**Bring this to the PM as a decision, with a recommendation.** The obvious candidate: keep
the skills in this repo and publish them to `~/.claude/skills/` by symlink from
`bin/install.sh`, which is precisely the pattern the project already uses for `note` and
`agenda` (`~/.claude/cockpit/bin/note` → `cockpit-note.mjs`, relinked on every rebuild). That
would put the method's own scaffolding under the same review discipline as everything else.
It is also clearly scope beyond "fix the token bill", so it is the PM's call whether it rides
along or becomes its own plan.

---

## Constraints binding all four

- **Work in the main checkout, on `main`, and push.** No worktrees.
- Changes 1 and 2 touch files that live outside any one task's blast radius; keep each task's
  commit matched to its task as `CLAUDE.md` requires.
- Nothing here may weaken review check #4.
- **Verify the saving.** Re-measure the same numbers after the change and record the before
  and after in `FINDINGS.md` — one row, inside the forty-word budget. A token-cost fix that
  nobody measured afterwards is a guess.
- The hands-on half: the PM runs anything needing a real screen or a real cockpit window.
  Changes 1–2 should be fully establishable by the test command; 3–4 may need the PM to
  confirm a session still reads what it needs.
