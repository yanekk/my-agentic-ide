#!/usr/bin/env python3
"""PTY injection probe for the Claude Code TUI.

Answers the go/no-go question behind the whole cockpit design:

    Can a host app write text into the Claude Code prompt box *without*
    submitting it, the way VSCode's `terminal.sendText(text, false)` would?

`sendText(text, false)` is nothing more than a raw write to the terminal's PTY
stdin with no trailing newline, so this harness reproduces it exactly: fork a
PTY, run the TUI in it, write bytes, and render the resulting screen with a real
terminal emulator (pyte) so we see what a human would see rather than guessing
from the raw escape-sequence stream.

Usage:
    probe.py dump  [-- cmd...]      spawn, settle, print the screen
    probe.py <scenario> [-- cmd...] run one injection scenario
    probe.py list                   list scenarios
"""
import os, pty, re, select, signal, sys, termios, struct, fcntl, time

COLS, ROWS = 120, 40
SETTLE = float(os.environ.get("PROBE_SETTLE", 2.5))   # wait for the TUI to paint
OBSERVE = float(os.environ.get("PROBE_OBSERVE", 3.0))  # watch after injecting


class Term:
    """A command running in a PTY, with its screen rendered by pyte."""

    def __init__(self, argv, cwd=None, cols=COLS, rows=ROWS):
        import pyte
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.ByteStream(self.screen)
        self.pid, self.fd = pty.fork()
        if self.pid == 0:                      # child
            if cwd:
                os.chdir(cwd)
            os.environ["TERM"] = "xterm-256color"
            os.environ["COLUMNS"], os.environ["LINES"] = str(cols), str(rows)
            os.environ.pop("CLAUDE_CODE_ENTRYPOINT", None)
            os.execvp(argv[0], argv)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ,
                    struct.pack("HHHH", rows, cols, 0, 0))

    def pump(self, seconds):
        """Read and render for `seconds`, returning True if the child is alive."""
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], min(0.1, max(0, end - time.time())))
            if not r:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return False
            if not data:
                return False
            self.stream.feed(data)
        return True

    def send(self, data):
        if isinstance(data, str):
            data = data.encode()
        os.write(self.fd, data)

    def text(self):
        return "\n".join(self.screen.display)

    def screen_trimmed(self):
        lines = [l.rstrip() for l in self.screen.display]
        while lines and not lines[0]:
            lines.pop(0)
        while lines and not lines[-1]:
            lines.pop()
        return "\n".join(lines)

    def close(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        except OSError:
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass


def banner(s):
    print("\n" + "=" * 72 + f"\n{s}\n" + "=" * 72)


def show(t, label):
    print(f"\n--- {label} " + "-" * (68 - len(label)))
    print(t.screen_trimmed())


# --------------------------------------------------------------------------
# Scenarios. Each returns a dict of observations.
# --------------------------------------------------------------------------

MARKER = "ZZPROBEZZ"


def _prep(argv, cwd):
    t = Term(argv, cwd=cwd)
    t.pump(SETTLE)
    # A fresh worktree is untrusted, so the first thing painted is the trust
    # gate. Accept it and wait for the real prompt box.
    if "trust this folder" in t.text():
        t.send("\r")
        t.pump(SETTLE)
    return t


def scenario_single_line(t):
    """A single line with no newline -- the simplest sendText(text, false)."""
    t.send(f"{MARKER} single line payload")
    t.pump(OBSERVE)
    return t


def scenario_multiline_raw(t):
    """Multi-line with bare \\n. Expected failure mode: submits at the newline."""
    t.send(f"{MARKER} first line\nsecond line\nthird line")
    t.pump(OBSERVE)
    return t


def scenario_bracketed_paste(t):
    """Multi-line wrapped in bracketed-paste markers (ESC[200~ ... ESC[201~).

    This is how a terminal tells an application "the following bytes are a paste,
    not typing". If the TUI honours it, newlines inside should not submit.
    """
    body = f"{MARKER} first line\nsecond line\nthird line"
    t.send("\x1b[200~" + body + "\x1b[201~")
    t.pump(OBSERVE)
    return t


def scenario_bracketed_paste_large(t):
    """A realistic review payload: many lines, markdown, code fences."""
    body = (f"{MARKER} Review comments:\n\n"
            "- `src/app.ts:42` this allocates inside the loop\n"
            "- `src/app.ts:88` missing null check\n\n"
            "```ts\nconst x = 1\n```\n\nPlease fix both.")
    t.send("\x1b[200~" + body + "\x1b[201~")
    t.pump(OBSERVE)
    return t


def scenario_carriage_return(t):
    """Negative control: a bare \\r is what the Enter key sends. Must submit."""
    t.send(f"{MARKER} before CR\rafter CR")
    t.pump(OBSERVE)
    return t


def scenario_crlf(t):
    """The real hazard: CRLF line endings. The \\r submits before the \\n lands."""
    t.send(f"{MARKER} first line\r\nsecond line")
    t.pump(OBSERVE)
    return t


def scenario_sanitized(t):
    """The proposed fix: normalise every \\r\\n and bare \\r to \\n before sending."""
    payload = f"{MARKER} first line\r\nsecond line\rthird line\nfourth line"
    safe = payload.replace("\r\n", "\n").replace("\r", "\n")
    t.send(safe)
    t.pump(OBSERVE)
    return t


SPECIAL = ("/review the @src/app.ts changes -- `foo()` at src/app.ts:42 "
           "and the @docs/readme.md note")


def scenario_special_raw(t):
    """Leading `/` opens the slash menu and `@` opens file autocomplete.

    Review text naturally contains both, so this is a real corruption risk on
    the raw path.
    """
    t.send(SPECIAL)
    t.pump(OBSERVE)
    return t


def scenario_special_paste(t):
    """Same payload, but declared as a paste. Does that suppress the triggers?"""
    t.send("\x1b[200~" + SPECIAL + "\x1b[201~")
    t.pump(OBSERVE)
    return t


SCENARIOS = {
    "special-raw": scenario_special_raw,
    "special-paste": scenario_special_paste,
    "single-line": scenario_single_line,
    "multiline-raw": scenario_multiline_raw,
    "bracketed-paste": scenario_bracketed_paste,
    "bracketed-paste-large": scenario_bracketed_paste_large,
    "carriage-return": scenario_carriage_return,
    "crlf": scenario_crlf,
    "sanitized": scenario_sanitized,
}


def scenario_fleet(t):
    """The real target: navigate the fleet list, attach, then inject.

    Guarded -- refuses to type unless the attached agent is the throwaway
    probe-target, because the fleet list's own prompt box dispatches a NEW
    session and injecting there would spawn an agent instead of commenting.
    """
    want = os.environ.get("PROBE_AGENT", "probe-target")

    for attempt in range(1, 8):
        t.send("\x1b[B")                       # Down
        t.pump(0.4)
        t.send("\r")                           # Enter -> attach
        t.pump(SETTLE)
        screen = t.text()
        attached = "for agents" in screen      # footer only shown when attached
        if attached and want in screen:
            print(f"[ok] attached to {want!r} after {attempt} Down press(es)")
            break
        if attached:
            print(f"[--] attached to the wrong agent, backing out")
            t.send("\x1b[D")                   # Left -> back to list
            t.pump(1.0)
    else:
        print(f"[ABORT] never landed on {want!r}; not injecting")
        return t

    show(t, "attached, before injection")
    payload = f"{MARKER} fleet review:\nsecond line\nthird line"
    t.send(payload.replace("\r\n", "\n").replace("\r", "\n"))
    t.pump(OBSERVE)
    return t


SCENARIOS["fleet"] = scenario_fleet


KEYNAMES = {
    "<cr>": "\r", "<lf>": "\n", "<esc>": "\x1b", "<tab>": "\t",
    "<up>": "\x1b[A", "<down>": "\x1b[B", "<right>": "\x1b[C", "<left>": "\x1b[D",
    "<space>": " ", "<bs>": "\x7f",
}


def scenario_keys(t):
    """Drive any TUI from PROBE_KEYS: a ;-separated script of literals and keys.

        PROBE_KEYS='<down>;<cr>;a;looks wrong;<cr>;@'

    Each step is sent, then the screen is dumped, so the UI can be learned
    incrementally instead of guessed at.
    """
    script = os.environ.get("PROBE_KEYS", "")
    for i, step in enumerate(s for s in script.split(";") if s):
        keys = KEYNAMES.get(step.lower(), step)
        t.send(keys)
        t.pump(float(os.environ.get("PROBE_STEP", 1.2)))
        show(t, f"step {i + 1}: {step!r}")
    return t


SCENARIOS["keys"] = scenario_keys


def main():
    args = sys.argv[1:]
    if not args or args[0] == "list":
        print("scenarios:", ", ".join(SCENARIOS))
        print("plus: dump")
        return 0

    what, argv = args[0], ["claude"]
    if "--" in args:
        argv = args[args.index("--") + 1:]

    cwd = os.environ.get("PROBE_CWD") or os.getcwd()
    banner(f"{what}   cmd={' '.join(argv)}   cwd={cwd}")

    t = _prep(argv, cwd)
    if what == "dump":
        show(t, "after settle")
        t.close()
        return 0

    if what not in SCENARIOS:
        print(f"unknown scenario {what!r}", file=sys.stderr)
        return 2

    show(t, "before injection")
    SCENARIOS[what](t)
    show(t, "after injection")
    t.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
