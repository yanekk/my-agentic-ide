# Spike: can we type into the agent's prompt box without submitting?

**Verdict: GO.** Every variant lands unsent, including through the real fleet TUI.

Run 2026-08-23 against Claude Code **2.1.241**, macOS, via `probe.py` — a PTY
harness that renders the TUI with a real terminal emulator (pyte) so the
observations are what a human would see, not guesses from the escape stream.
`terminal.sendText(text, false)` is exactly a raw PTY write with no trailing
newline, so the harness reproduces VSCode's behaviour faithfully.

```
spikes/pty-inject/probe.py list        # scenarios
spikes/pty-inject/probe.py dump        # spawn, settle, print the screen
spikes/pty-inject/probe.py <scenario> [-- cmd...]
```

## Results

| Scenario | Sent | Result |
|---|---|---|
| `single-line` | `text` | ✅ in box, unsent |
| `multiline-raw` | `a\nb\nc` | ✅ in box as 3 lines, **unsent** |
| `bracketed-paste` | `ESC[200~ a\nb\nc ESC[201~` | ✅ in box, unsent, markers consumed |
| `bracketed-paste-large` | 9-line markdown + code fence | ✅ collapses to `[Pasted text #1 +9 lines]`, unsent |
| `special-raw` | leading `/`, two `@path`, backticks | ✅ verbatim, no menu corruption |
| `carriage-return` | `a\rb` | ❌ **submits `a`**, leaves `b` |
| `crlf` | `a\r\nb` | ❌ **submits `a`**, leaves `b` |
| `sanitized` | CRLF+CR normalised to `\n` | ✅ 4 lines in box, unsent |
| `fleet` | navigate list → attach → 3-line inject | ✅ **unsent in the attached agent's box** |

## The correction that matters

The risk was written up as *"a newline inside a multi-line payload would submit
early."* **That is wrong, and the distinction is the whole finding:**

- `\n` (0x0A, LF / Ctrl+J) → **inserts a newline.** Does not submit.
- `\r` (0x0D, CR) → **submits.** This is what the Enter key actually sends.

So multi-line review comments are safe by default, and the danger is narrower and
easier to defend than assumed: **strip carriage returns.** One line of code:

```ts
const safe = payload.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
terminal.sendText(safe, false)
```

CRLF is the realistic way this bites — a comment quoting a file with Windows line
endings would submit at the first line without the normalisation.

## Two presentation modes, both unsent

Worth treating as a deliberate design lever rather than an accident:

- **Raw `\n`** → lines render expanded in the prompt box. Directly editable before
  you press Enter, which is what R5 asks for. Best for short reviews.
- **Bracketed paste** (`ESC[200~ … ESC[201~`) → anything long collapses to a
  `[Pasted text #1 +N lines]` chip ("paste again to expand"). Tidier for a long
  review, but editing means expanding it first.

Recommendation: raw `\n` below ~10 lines, bracketed paste above.

## Hazards found

1. **The fleet list has its own prompt box.** When *not* attached, the bottom of
   the fleet view reads `❯ describe a task for a new session` — injecting there
   **dispatches a new agent** instead of commenting on the current one. The
   extension must only ever type while attached. The footer is the tell: it reads
   `← for agents` when attached, and `enter to collapse · ctrl+x to delete all`
   when in the list. `probe.py`'s `fleet` scenario guards on exactly this and
   refuses to type if it can't confirm the target.

2. **Pending text may be submitted when the client dies.** Observed once: a
   payload left in the box by an earlier probe appeared as a *submitted* turn in
   the transcript after that probe was SIGKILLed. Mechanism not established. Don't
   leave a composed review sitting in the box across a window reload.

3. `/` and `@` open menus while typing but settle correctly once the token no
   longer matches — final text was verbatim in every trial. Not a blocker, but
   worth a regression test if the composer ever sends character-by-character.

## Incidental findings

- **`claude attach <id>`, `claude logs <id>`, `claude stop <id>` exist** but are
  **not listed** in `claude --help`'s command list. `claude attach` proxies a
  single agent's PTY directly, and injection works identically through it. This is
  a viable alternative to fleet-list navigation: the extension could attach to a
  chosen agent directly rather than driving the list.
- **`claude agents --cwd <path>` matches the *repo root*, not the live cwd.**
  Filtering on a worktree path returns `[]` even when agents are demonstrably in
  it; filtering on the main repo returns them. The `cwd` *field*, by contrast,
  reports the live worktree. Two different keys — don't conflate them.
- **Live cwd confirmed empirically.** The agent that ran this spike entered a
  worktree mid-session, and `claude agents --json` immediately reported the new
  path — reinforcing that the `CwdChanged` hook is needed to stay in sync.
