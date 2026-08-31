# smart-agent-names — Design

## 1. Purpose

The fleet list names every agent `<repo> / <topic>`. The repo half is already good.
The topic half is today the opening words of the first message, upgraded once Claude
writes its own one-line summary. In a list of several agents that reads poorly: the
opening words are not a summary, and the summary is a phrase rather than a label. This
feature replaces the topic with a one-to-three-word dash-delimited label that Claude
Haiku 4.5 infers from the first message, set once and then owned by the person, not the
machine.

It is for the one person whose development environment this is, looking at their own
fleet list and wanting each agent to say what it is at a glance.

### Success criteria

- An ordinary first message yields a 1-3 word kebab topic in the fleet list within about
  two seconds of sending it (`implement the OAuth loopback flow` -> `oauth-loopback`).
- A content-free or greeting first message never produces a junk name.
- With no key configured the naming behaves exactly as it does today, with no error.
- The API key is never an environment variable and never reaches an agent's context.

### Stance

- The label is set once, from the first message, and thereafter only the person changes
  it. The machine does not move labels around underneath them.
- Zero external dependencies. The web call to Haiku uses Node built-ins and nothing else,
  because the repository has no package manifest and must stay installable with only node
  and wezterm present.
- The key lives inside the cockpit and is never a global variable that another process
  could read from its environment.

---

## 2. Behaviour specification

### 2.1 The name and where the topic comes from

The name is `<repo> / <topic>`. The repo is the basename of the main checkout, computed
as today by `repoContext`. The topic is chosen from the strongest signal available at the
moment the session is first named, in this order of authority:

1. a name the person typed (`/rename` or the fleet list) — wins forever, as today
2. a `/pir-work <slug>` at the start of the first message — the slug
3. the worktree name, when the first prompt's cwd is already inside a worktree
4. the Haiku topic, for an ordinary first message when a key is configured
5. the opening words of the first message — the placeholder, a stand-in only

The slug and the worktree name are explicit deterministic facts about the session, so
they outrank the Haiku topic, which is an inference. The placeholder is never a settled
name; it only holds the slot until a real one is reached (2.2).

### 2.2 Named once, then frozen

The first time a real name is available — a slug, a worktree name, a Haiku topic, or, when
there is no key, Claude's own summary — it is set and the session is marked frozen. The
machine never renames a frozen session. Only a person renames it after that, detected
exactly as today (the live title no longer matches what we last set), which sets
`backedOff` and wins for good.

The old behaviour where the label followed the work — a session renamed when it later ran
`/pir-work` or moved into a worktree — is retired. That re-naming existed because the old
first-message label was weak, so upgrading to a later slug or worktree was an improvement.
A good Haiku label makes the same re-naming just the machine shuffling the person's labels,
which is the thing they do not want.

The placeholder is the only non-frozen state. While a session still wears the opening-words
placeholder (because Haiku was unavailable at the first prompt), later prompts keep trying
to reach a real name: retry Haiku, take a slug or worktree the agent has since entered, or
accept Claude's summary when there is no key. The first real name freezes it.

This retires renaming of the label only. The daemon's `followWorktreeMigration`, which
re-points the diff, the watches and the terminal when an agent moves into a worktree, is
untouched. The panes still follow the work; only the fleet-list label stays put. They are
different concerns and conflating them would break the pane migration the cockpit relies on.

### 2.3 The hold

On the first prompt of a not-yet-named cockpit session whose first message is ordinary
prose, the hook calls Haiku synchronously and returns the topic, so the prompt is held for
up to the timeout and released with the correct name already set. The call is skipped
entirely — no hold, no spend — when the session is already named by a stronger deterministic
signal at that first prompt: a `/pir-work` slug (2.1 rank 2) or a worktree cwd (rank 3). The
order of authority (2.1) means Haiku's topic would lose to either anyway, so calling it would
hold the prompt ~2s and spend a call only to discard the result. This matters because agents
dispatched into a worktree are the common cockpit case; without the short-circuit they would
be held on every first prompt for a name they already have. The fleet-list name can
only be written at the instant a prompt is submitted, because the `UserPromptSubmit` hook's
stdout is the only channel that sets a session title. An instant correct name therefore
requires doing the naming before that stdout is written. There is no way to show an interim
`starting…` during the hold and swap it for the real name later without a second prompt, so
the hold is the only route to an instant correct name.

The call is bounded at about two seconds. On timeout the prompt releases with the
opening-words placeholder and the session is not frozen, so a later prompt retries. The
hook runs on every prompt and must never wedge the prompt box, so a hard bound plus a
fallback keeps the pause short and self-cancelling.

### 2.4 The gate: cockpit sessions only

The Haiku call, and therefore the hold and any use of the key, happens only for cockpit
sessions, detected by `COCKPIT_REPO` being present in the hook's environment. The naming
hook is registered globally in `~/.claude/settings.json`, so it runs for every claude
session on the machine; without this gate a plain `claude` run in an unrelated terminal
would be held two seconds and would spend the key. Confining the call to cockpit sessions
is the faithful reading of "the key stays in the cockpit". A non-cockpit session degrades
to today's behaviour (2.6).

This rests on the assumption that a hook fired inside an agent dispatched from the fleet
view sees `COCKPIT_REPO`. That is load-bearing and is verified early (5.1); if it proves
false the gate has to change and the plan pauses on it.

### 2.5 The guard

Any Haiku output that is not a clean kebab label is discarded and treated as no answer. The
output is trimmed, lowercased, and accepted only if it matches
`^[a-z0-9]+(?:-[a-z0-9]+){0,3}$` — one to four lowercase alphanumeric words joined by
single dashes. Anything with spaces, punctuation, or a sentence in it is rejected, then
clipped to `MAX_RIGHT`. The spike measured this: a content-free first message ("hey") makes
the model return a clarifying sentence rather than a label, and the guard is what keeps that
out of the fleet list. A rejected answer is treated exactly like no answer (placeholder now,
retry later).

### 2.6 No key configured

If no key file is present the Haiku call is never made and naming degrades to exactly
today's behaviour: the opening-words placeholder, upgraded to Claude's own summary when it
appears, then frozen. The feature is inert for anyone who has not run `config`, with no
error and no broken state. The same degradation covers a present-but-rejected key (2.n).

### 2.7 The config command

`config anthropic-api-key <key>` writes the key to the cockpit secret file, owner-only and
atomically. `config anthropic-api-key` with no value prints a masked status — `set · …1234`
or `not set` — never the key. `config` with no arguments lists the known settings and their
masked status. `config anthropic-api-key --unset` removes the key, which returns naming to
today's behaviour.

It is a cockpit-only command, published as a PATH symlink alongside `note` and `agenda`.
Setting the key by hand-editing a file is error-prone, and this is the git-config-shaped
front door. The read path masks the key because agents inherit the cockpit PATH and so have
this command too; it must never become a way to print the secret.

### 2.n The unhappy paths

- Offline, network error, non-2xx, or malformed JSON from the API: treated as no answer.
  The placeholder is used and a later prompt retries. A naming call must never surface an
  error into the prompt box, so all of these are silent and the hook exits 0.
- Timeout: as 2.3 — release with the placeholder, retry later.
- Junk or non-label output: as 2.5.
- A key that is present but rejected by the API (401): treated as no answer, so naming
  falls back and retries; the failure is not shown in the fleet list. The person sees that
  names are not improving and checks with `config`, whose masked status confirms a key is
  set. The hook stays silent.
- Corrupt or empty key file: treated as no key (2.6).
- Concurrent prompts and concurrent config writes: session state is one file per session as
  today, needing no lock. The key file is only read by the hook and only written by the
  config command, which writes atomically (temp then rename), so a read that races a write
  sees either the whole old key or the whole new one, never a torn file.

---

## 3. Architecture

### 3.1 The boundary

The rule this feature adds to the boundary is that the network call stays out of the
decision. `decide()` is a function of its arguments (plus the transcript file and git,
which it already reads through helpers); it never makes the web call. The impure
`runHook()` makes the call, applies the guard, and passes the resulting topic — a string
or null — into `decide()` as data.

Two checks enforce it. `naming.test.mjs` drives `decide()` with the candidate supplied as
an argument and makes no network call of its own, and it exercises `fetchTopic` only with
an injected fake fetch. The existing `run.sh` check that `bin/cockpit-auto-name.mjs`
imports nothing outside `node:*` keeps the whole file dependency-free; the web call needs
no import because `fetch` is a Node global. If either check fails the fix is to move the
code or drop the dependency, never to relax the check. Everything reachable this way is
tested exhaustively in milliseconds; the one thing that cannot be — a real call with a real
key — is verified once with the person (5.1).

### 3.2 Modules

- `bin/cockpit-auto-name.mjs` (extended): the hook. Owns `decide()` (now taking a candidate
  topic and a frozen flag), `runHook()` (now reads the key, gates on `COCKPIT_REPO`, calls
  `fetchTopic` within the timeout, passes the candidate to `decide`), and a new exported
  `fetchTopic()`. Depends on node built-ins only.
- `bin/cockpit-config.mjs` (new): the `config` command. Owns reading and writing the key
  file and the masked status. Depends on node built-ins only. Not imported by the hook.
- `bin/cockpit-layout.sh` (extended): symlinks `config` into `$COCKPIT_BIN` next to `note`
  and `agenda`, so it is relinked on every rebuild.

The hook does not import the config module. It reads the key file directly, the same way it
already reads its state files, so there is no cross-import to trip the dependency check.

### 3.3 The decision function

`decide(input, state, env, candidate)` returns `{ title, state?, isNew? }`. `candidate` is
the guarded Haiku topic or null. The order inside it:

1. if `state.backedOff` — return null.
2. compute the live title; if it is set and differs from what we last set, a person renamed
   it — record `backedOff` and return null.
3. if `state.frozen` — return null. The machine does not rename a settled session; a human
   rename was already caught in step 2.
4. otherwise pick the strongest available name (2.1). If it is a real name (slug, worktree,
   Haiku candidate, or Claude's summary), set the title and `state.frozen = true`. If only
   the placeholder is available, set the title and leave the session unfrozen.

### 3.4 Data flow

`UserPromptSubmit` fires. `runHook` reads the hook JSON from stdin, the session's state
file, and — if a key is configured and `COCKPIT_REPO` is present and the session has no name
yet and the message is ordinary prose (no `/pir-work` slug) and the cwd is not already inside
a worktree (2.3) — calls `fetchTopic` bounded by the timeout. It then
calls `decide(input, state, env, candidate)`. If `decide` returns a title, `runHook` writes
the state file and emits `{hookSpecificOutput: {hookEventName, sessionTitle}}`. Any failure
anywhere exits 0 with no output.

### 3.5 Storage

The key lives at `~/.claude/cockpit/anthropic-api-key` (overridable by `COCKPIT_DIR`), plain
text, mode 0600, written atomically by the config command as temp-then-rename. A crash
mid-write leaves the old key intact because the rename is atomic. An absent file means the
feature is off.

Session state is unchanged — one small file per session under `auto-names/`, no lock — and
now also carries `frozen`.

---

## 4. Testing

`naming.test.mjs` (extended) covers `decide()`'s freeze semantics, the guard regex, and
`fetchTopic` driven by an injected fake fetch (success, junk, timeout, non-2xx, malformed
JSON), the no-key degradation, and that a human rename still wins over a frozen name. It
makes no network call and needs no real key.

`config.test.mjs` (new, in `spikes/auto-name-test/`) covers the config command: a set writes
a 0600 file, a read masks, `--unset` clears, an unknown setting errors cleanly, and an absent
key reads as null.

`run.sh` (extended) checks that `cockpit-layout.sh` symlinks `config`, that both new files
import nothing outside `node:*`, and that no naming state leaks into the checkout.

None of these can prove the real hold latency, the name landing in the live fleet list, an
agent being unable to read the key, or the `COCKPIT_REPO` gate firing inside a dispatched
agent. Those are 5.1.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5) |
| Language / runtime | node v24.2.0 — has a global `fetch`, which is why no HTTP library is needed |
| Toolchain | wezterm; claude 2.1.251; git |
| **Deliberately absent** | no package manager, `package.json`, or `node_modules` — the repo has zero dependencies and must stay installable with only node and wezterm; no Anthropic SDK |

**The test command.**

```
spikes/auto-name-test/run.sh
```

Quiet by default (a passing check bumps a count; `VERBOSE=1` restores the per-check listing),
no colour, loud on failure, and it prints `ALL PASS (…)` or `FAILURES` with a non-zero exit
on failure. This suite is the one that covers this feature; the other `spikes/*/run.sh` are
unaffected and are not this feature's evidence.

**Dependencies.** None may be added. The web call uses the global `fetch`. This is a
standing rule of the repository, not a choice of this plan.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| The `COCKPIT_REPO` gate fires inside a dispatched agent | needs a real agent whose naming hook we can observe; load-bearing for 2.4, so verify first |
| The ~2s hold feels right and the name appears in the live fleet list | needs the real claude binary, real API latency, and eyes on the GUI |
| An agent cannot read the key as a variable | needs a live agent terminal; `env \| grep -i anthropic` must be empty |
| `config` works inside a cockpit terminal and nowhere else | needs a real cockpit window versus a plain shell |
| Haiku returns a good label for a real message with the real key | needs the real key and network. The spike proved the *model* is good enough (2026-08-31), but T01 authors a fresh prompt (the spike's exact wording was not kept), so the label quality of *this* prompt is confirmed live in T04, not inherited from the spike |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| A dedicated workspace-scoped API key with a hard low monthly cap ($1–2) | — | a leaked or misused key can cost at most the cap |
| The fetch timeout | ~2000ms | no naming call can hang the prompt box |
| An injected fake fetch in the tests | on in tests | the suite never spends money or touches the network |

Never ask the person to run an uncapped key to find something out, and never do it yourself.
The capped key is what stands between a hands-on check and a surprise bill.

---

## 6. Recovery

Nothing here can lock the person out; the worst case is a poor label, which they fix
themselves. `config anthropic-api-key` shows whether a key is set. `config anthropic-api-key
--unset` (or deleting `~/.claude/cockpit/anthropic-api-key`) returns naming to today's
behaviour. A frozen bad label is fixed by renaming the session by hand, which wins forever.

---

## 7. Decisions and rationale

- Direct Anthropic API with Haiku 4.5, not `claude -p`. The spike on 2026-08-31 measured
  `claude -p` at a 3.5s floor and 5–10s on real prompts (a whole claude session boots per
  call) against about 1s for the API. Only the API is fast enough to hold the first message.
- Global `fetch`, no SDK. The repo forbids dependencies and node 24 has `fetch`.
- Shape 1, the hold, not an interim `starting…`. A session title can only be written at
  prompt-submit, so an interim label cannot be swapped for the real one without a second
  prompt. Holding is the only route to an instant correct name. The person chose Shape 1 on
  2026-08-31.
- Retire "follows the work" for the label. The person's decision on 2026-08-31: the label is
  set once and only they change it. The panes still follow the worktree.
- Gate the Haiku call to cockpit sessions (`COCKPIT_REPO`). The hook is globally registered,
  so without a gate every claude session on the machine would be held two seconds and spend
  the key. Confining it to the cockpit is the honest reading of "the key stays in the
  cockpit".
- The config read masks the key. Agents inherit the cockpit PATH and so have the command;
  it must never print the secret.
- The key is stored in its own file, not in session state and not in a shared config JSON.
  This mirrors the agenda client secret being kept apart, so an unrelated corruption or an
  `--unset` cannot cost anything else, and it is the simplest thing to audit.

---

## 8. Explicitly out of scope

- Hardening the key against a same-user process reading the file off disk. File permissions
  bound other users, not the person's own agents, which run as them; a real wall needs the
  macOS Keychain with a per-application access list, which is brittle for a plain node script
  and fights "keep it small". The capped key is the mitigation, and this residual is the
  known limit written down here so no session mistakes the file for a vault.
- Keeping the key out of shell history. `config anthropic-api-key <key>` takes the key as a
  command argument, so it lands in the shell's history file — a second at-rest copy beside
  the key file. This is accepted (the user's decision, 2026-08-31), not defended: it is no
  weaker than the same-user disk read already conceded above, and a stdin/hidden-input path is
  more surface than the threat model warrants. T04 documents the caveat so it is a known cost,
  not a surprise; a person who minds clears their history or unsets and re-adds out of a
  history-ignored shell.
- Preventing same-name collisions between agents. Short labels collide more readily than full
  sentences, and two agents in one repo can reach the same `<repo> / <topic>`. The cockpit
  already treats ambiguous names as unresolvable and leaves the panes alone (CLAUDE.md, Known
  limits), and the person owns the label and renames one by hand. Auto-disambiguation (a
  machine-chosen suffix on a label meant to be the person's) is more code and more edges for a
  low-frequency case; accepted as-is (the user's decision, 2026-08-31).
- Making the model configurable. Haiku 4.5 is fixed; the spike showed it is ample and a
  setting is complexity nobody asked for.
- Naming non-cockpit sessions with Haiku. They keep today's behaviour by 2.4.
- An interim `starting…` label. It is impossible without a second prompt (2.3).
