# Tool selection — where should the review cockpit live?

Companion to `requirements.md`. Researched 2026-08-23.
Verified against Claude Code **2.1.241**.

---

## 0. A correction to the earlier research

`docs/research/claude-agents-watching.md` §4 resolves job id → worktree path by globbing
`~/.claude/sessions/*.json`. That works, but it is undocumented internals. There is a
**supported** interface that does the same job:

```console
$ claude agents --json
[
  {"pid":5084,"id":"b76b8397","cwd":".../skaut/.claude/worktrees/show-text-speaker",
   "kind":"background","sessionId":"b76b8397-…","name":"op_show_text y argument",
   "status":"idle","state":"done"},
  …
]
```

Fields: `pid, id, cwd, kind, sessionId, name, startedAt, status, state`. Crucially the
`cwd` is the **live** cwd — for the very agent §4 used as its worked example it returns the
worktree, not the repo root. So `--json` reproduces the correct answer through a documented
flag.

`--cwd <path>` filters the list, but note the asymmetry (measured, see
`spikes/pty-inject/RESULTS.md`): the **filter** matches the *repo root*, while the **`cwd`
field** reports the *live worktree*. Passing a worktree path to `--cwd` returns `[]` even
when agents are demonstrably inside it. Filter by repo root; read location from the field.

**Consequence:** only *one* undocumented dependency remains — knowing **which** agent is
currently attached, which still requires tailing `--debug-file` for `[FV-attach]`. Everything
else (enumeration, names, live cwd, status) is supported CLI. That materially lowers the
risk of the whole project. `fleet-focus.py`'s `resolve()` should be rewritten against
`claude agents --json`.

There is **no** CLI for injecting a message into a running background agent (checked the
full `claude --help` surface). So R5 must be satisfied by writing to the PTY of the fleet
TUI — which means the host app has to own that PTY.

---

## 1. The fork in the road

Every candidate falls on one side of a single question:

> **Does `claude agents` stay the thing that drives navigation, or does something replace it?**

**Path A — replace the fleet.** Adopt an orchestrator (Conductor, Superset, …). It creates
the worktrees, launches `claude` per workspace, and its own sidebar is the agent list.
R2 ("auto-follow on attach") dissolves — clicking its list *is* the switch. Zero build.
Cost: you give up `claude agents` and everything daemon-side it gives you; agents started
outside the orchestrator are invisible to it.

**Path B — keep the fleet, build the cockpit around it.** `claude agents` stays permanent
and authoritative; a host app follows it. Every requirement as written is satisfiable.
Cost: days of build, and one undocumented log-format dependency.

Your stated premise ("`claude agents` terminal session is the one that's permanent") and
R2 both live on Path B. But Path A deserves an hour of your time before committing, because
Conductor already ships the single hardest requirement.

---

## 2. Candidate landscape

Scored against the requirements. ● = native, ◐ = partial/needs work, ○ = no, — = N/A.

| | R1 layout | R2 auto-follow | R3 merge-base | R4 live | R5 comment→unsent prompt | R7 no vim/tmux | Build |
|---|---|---|---|---|---|---|---|
| **VSCode + extension** | ● | ◐ build | ◐ build | ◐ build | ● `sendText(…,false)` | ● | days |
| **Conductor** | ◐ | — own list | ? | ? | ● composer attachment | ● | none |
| **Superset** | ● | — own list | ? | ? | ◐ comment+edit | ● | none / fork |
| **Zed** | ◐ | ○ | ◐ | ● | ○ *proposed, unimplemented* | ● | blocked |
| **Purpose-built app** | ● | ● | ● | ● | ● | ● | weeks |
| **Zellij + diffx** | ◐ | ◐ | ● | ? | ◐ `write-chars` | ◐ | days |
| **Neovim stack** | ◐ | ◐ | ● | ● | ◐ | ○ | days + learning |

### Why the losers lose

**Zed** — its maintainers converted [discussion #54663](https://github.com/zed-industries/zed/discussions/54663)
into tracking issue #59157 (opened 23 Apr 2026) for *exactly* R5: PR-style comments in the
git diff UI that feed the active agent thread. It is **not implemented**. Zed has the diff
UI and the agent threads but not the bridge. Its extension API also can't add custom panels,
so you can't build it yourself. Revisit in six months; unusable today.

**The terminal-IDE stack** (the Medium article: lazygit, tmux, neovim, yazi, …) — that stack
solves *editing in a terminal*, which is explicitly not your problem. It costs you modal
editing and multiplexer config (R7) to buy capability you said you don't need. Zellij is
the one salvageable piece: declarative KDL layouts draw your exact pane geometry, it is far
more discoverable than tmux, and `zellij action write-chars` injects text into a pane
*without* a newline — a genuine R5 mechanism. But no TUI diff viewer has inline commenting,
so the diff pane would have to be a browser, which breaks the single-window requirement.

**diffx** ([wong2/diffx](https://github.com/wong2/diffx)) — a local server (port 3433) serving
a GitHub-PR-style review UI; comments export as structured XML and agents fetch them via
`/diffx-finish-review`. It is the closest existing thing to your review surface and worth
stealing ideas from. But it's browser-based (breaks R1), pull-based rather than
pre-filled-unsent (breaks R5), and has no live watching.

---

## 3. The three serious contenders

### A. Conductor — the zero-build option

macOS-native (Melty Labs). Worktree per workspace, diff-first review, ⌘⇧D diff viewer.
Its decisive feature: **inline comments become composer attachments that you send back to
the agent** — you click a line, write the comment, and it lands in an editable composer
rather than firing immediately. That is R5 almost to the letter, shipped, today.

Against it: it owns agent lifecycle, so `claude agents` is out; its terminal story is
undocumented; and the diff range and live-refresh behaviour aren't specified anywhere I
could find. It is closed-source, so nothing can be adapted.

**Verdict:** the benchmark for "how good does this feel without building anything". Spend
an hour with it before writing code.

### B. Superset — the fork candidate

Electron/React, **source-available under ELv2**, macOS (Linux experimental). Ships a CLI,
TypeScript SDK and an MCP server. Its layout is already startlingly close to your drawing:
a built-in diff viewer, plus **per-worktree terminals with tabs, infinite splits and
persistent sessions**. That is the bottom-right pane, built and working.

Two things make it interesting beyond "another orchestrator":

1. Its terminals are ordinary terminals — you can very likely just run `claude agents` in
   one and get most of R1 immediately, with its own sidebar as a bonus.
2. ELv2 + Electron + an SDK means **you can fork it** and teach it to follow the fleet
   instead of managing its own agents. Given an unbounded build appetite, that is a far
   shorter path to the exact experience than writing an app from scratch.

**Verdict:** the best starting point if VSCode's constraints turn out to bite.

### C. VSCode + a purpose-built extension — the recommendation

The reason this wins is not familiarity. It is that **the two hardest requirements are
native VSCode features rather than things you'd build**:

- **R5** — `terminal.sendText(text, false)` writes to a terminal's stdin *without* appending
  a newline. Run `claude agents` in an extension-owned terminal and this types your composed
  review into the agent's prompt box and leaves it there, unsent. Exactly the specified
  behaviour, one API call.
- **R1** — the panel already has terminal tabs listed down its right edge with a `+` button,
  and splits horizontally. Editor area on top, panel below, is the default layout. You are
  configuring VSCode, not fighting it.
- **Comment UI** — the `vscode.comments` API is the same machinery GitHub PR extensions use:
  threads anchored to a file and line range, on any URI including virtual ones.

And your explicit non-requirement — *the fleet session need not survive a restart* — deletes
VSCode's one true disqualifier. A window reload kills integrated terminals; you've said
relaunching `claude agents` is fine, and the agents themselves are daemon-backed and survive
regardless.

What actually has to be built is modest:

| Piece | How |
|---|---|
| Follow the attach | Spawn `fleet-focus.py` on the `--debug-file` log; on `enter`, take `jobId` |
| Resolve → worktree | `claude agents --json`, match `id` (supported; replaces §4 scraping) |
| Merge-base diff (R3) | `git merge-base main HEAD` in the worktree; `TextDocumentContentProvider` serving base blobs; `vscode.diff` per changed file |
| Live (R4) | `FileSystemWatcher` on the worktree → debounce → recompute |
| Terminals | `createTerminal({cwd: worktree})`; native tabs give the list and `+` free |
| Comments (R5) | `comments.createCommentController` → threads → "Send to agent" composes markdown → `fleetTerminal.sendText(md, false)` |
| Follow mid-session moves | Register the supported `CwdChanged` hook (research doc §5) |

**Verdict: build this.** It satisfies all seven requirements, costs days rather than weeks,
carries exactly one undocumented dependency, and keeps you on the tool you already know.

---

## 4. Risks, and the spikes that retire them

Ordered by how much damage they do if they turn out badly.

1. ~~**Does `sendText(text, false)` actually land in the fleet TUI's prompt box?**~~
   **RETIRED 2026-08-23 — verdict GO.** Verified end-to-end against 2.1.241: multi-line
   payloads land unsent in an attached agent's prompt box, through the real fleet TUI.
   Full evidence in `spikes/pty-inject/RESULTS.md`.

   The risk as originally stated was **wrong** in a way worth keeping: `\n` does *not*
   submit — it inserts a newline. `\r` submits, because that is what the Enter key sends.
   The mitigation is therefore one line (`payload.replace(/\r\n|\r/g, "\n")`), not a
   redesign. Two new hazards replaced it, both cheap: never type while the fleet view is
   in *list* mode (its prompt box dispatches a **new agent**), and don't leave a composed
   review pending in the box across a reload.

2. **`[FV-attach]` log format changes between releases.** Undocumented, and the only remaining
   one. Mitigation: keep the parser to a single regex, and always ship a manual picker built
   on `claude agents --json` as a fallback path. Also worth filing the upstream feature
   request for a first-class `AgentAttach` hook that the research doc already suggests.

3. **Merge-base ambiguity.** Agents branch from wherever they started; `main` may not be the
   right base. Read the branch's upstream / fork point rather than hardcoding.

4. **Panel geometry drift.** VSCode's terminal tab list belongs to the whole panel, so it
   sits to the right of *both* bottom panes rather than only the right one. Cosmetically
   slightly off your sketch; functionally identical.

---

## 5. Recommended sequence

1. ~~**Spike risk #1.**~~ **Done — GO.** See `spikes/pty-inject/RESULTS.md`. Path B is open.
2. **One hour with Conductor.** Still worth it: it establishes the quality bar for
   comment→agent, and tells you whether losing `claude agents` is a real loss or a
   theoretical one. If theoretical, stop — you're done and you built nothing.
3. Otherwise **build the VSCode extension** as scoped in §3C. The R5 mechanism is proven,
   so the remaining work is ordinary: diff computation, a file watcher, and the comment UI.
4. Fallback if VSCode's constraints bite: **fork Superset** and replace its agent manager
   with a fleet follower.

## Sources

- [wong2/diffx](https://github.com/wong2/diffx) · [zed #54663](https://github.com/zed-industries/zed/discussions/54663)
- [Conductor docs — review & merge](https://www.conductor.build/docs/guides/review-and-merge) · [workflow](https://www.conductor.build/docs/concepts/workflow)
- [superset-sh/superset](https://github.com/superset-sh/superset)
- [Best agent management tools 2026](https://nimbalyst.com/blog/best-agent-management-tools-2026/)
- [VS Code multi-agent development](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)

---

> **Superseded 2026-08-23.** Conductor was tried and rejected, adding R8–R10
> (lightweight, monospaced throughout, keyboard-controlled). R9 disqualifies VSCode,
> and the terminal path unblocked. See `tool-selection-rev2.md`.
