"""Drive bin/cockpit-fleet-picker.sh under a real pseudo-terminal (plans/fleet-picker T02).

    python3 -I pty-drive.py <wrapper> <cmd-file> <shown> <cols> <rows> '<steps json>'

Spawns the wrapper as the session leader of a fresh pty of the given size, feeds its output
to a minimal screen model, and runs the steps in order:

    ["wait", "<text>"]        until the screen shows <text> (5s)
    ["send", "<bytes>"]       write <bytes> to the pty, as a key would arrive
    ["sleep", <seconds>]
    ["resize", cols, rows]    TIOCSWINSZ on the pty; the kernel signals the foreground group
    ["snap", "<name>"]        keep the screen's rows under <name>
    ["wait-cmd", <n>]         until the cmd file has <n> lines (5s)
    ["term-node"]             SIGTERM the wrapper's node child, and only it

Prints one JSON object: the cmd file's lines, whether the wrapper is still alive, the snaps,
and every place a printable landed past the right edge (a line wider than the pane). Always
tears the whole process group down before printing, and says whether it is gone.
"""

import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time


class Screen:
    def __init__(self, cols, rows):
        self.resize(cols, rows)
        self.overflow = []
        self.epoch = 0

    def resize(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.grid = [[" "] * cols for _ in range(rows)]
        self.r = self.c = 0
        self.pending = False

    def text(self):
        return ["".join(row).rstrip() for row in self.grid]

    def _newline(self):
        self.r += 1
        if self.r >= self.rows:
            self.grid.pop(0)
            self.grid.append([" "] * self.cols)
            self.r = self.rows - 1

    def _put(self, ch):
        if self.pending:
            # A printable with the cursor already past the last column: the line is wider
            # than the pane, and a real terminal would wrap it onto the next row.
            self.overflow.append({"epoch": self.epoch, "row": self.r, "line": "".join(self.grid[self.r]).rstrip() + ch})
            self.pending = False
            self.c = 0
            self._newline()
        self.grid[self.r][self.c] = ch
        if self.c == self.cols - 1:
            self.pending = True
        else:
            self.c += 1

    def feed(self, s):
        i = 0
        while i < len(s):
            ch = s[i]
            if ch == "\x1b":
                if i + 1 < len(s) and s[i + 1] == "[":
                    j = i + 2
                    while j < len(s) and not ("\x40" <= s[j] <= "\x7e"):
                        j += 1
                    if j >= len(s):
                        return s[i:]  # incomplete; keep for the next read
                    self._csi(s[i + 2:j], s[j])
                    i = j + 1
                    continue
                if i + 1 >= len(s):
                    return s[i:]
                i += 2
                continue
            if ch == "\r":
                self.c = 0
                self.pending = False
            elif ch == "\n":
                self.pending = False
                self._newline()
            elif ch >= " ":
                self._put(ch)
            i += 1
        return ""

    def _csi(self, params, final):
        self.pending = False
        nums = [int(p) if p.isdigit() else 0 for p in params.lstrip("?<>").split(";")] if params else []
        if final in "Hf":
            r = (nums[0] if nums and nums[0] else 1) - 1
            c = (nums[1] if len(nums) > 1 and nums[1] else 1) - 1
            self.r, self.c = min(r, self.rows - 1), min(c, self.cols - 1)
        elif final == "K":
            for k in range(self.c, self.cols):
                self.grid[self.r][k] = " "
        elif final == "J":
            mode = nums[0] if nums else 0
            if mode == 2:
                self.grid = [[" "] * self.cols for _ in range(self.rows)]
            elif mode == 0:
                for k in range(self.c, self.cols):
                    self.grid[self.r][k] = " "
                for rr in range(self.r + 1, self.rows):
                    self.grid[rr] = [" "] * self.cols


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    wrapper, cmd_file, shown, cols, rows, steps = sys.argv[1:7]
    cols, rows, steps = int(cols), int(rows), json.loads(steps)

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("bash", ["bash", wrapper, cmd_file, shown])
    set_size(fd, cols, rows)

    screen = Screen(cols, rows)
    rest = ""
    snaps = {}
    errors = []

    def pump(timeout):
        nonlocal rest
        end = time.time() + timeout
        while True:
            left = end - time.time()
            if left <= 0:
                return
            ready, _, _ = select.select([fd], [], [], left)
            if not ready:
                return
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if not data:
                return
            rest = screen.feed(rest + data.decode("utf-8", "replace"))

    def cmd_lines():
        try:
            with open(cmd_file) as f:
                return f.read().splitlines()
        except FileNotFoundError:
            return []

    def alive():
        try:
            return os.waitpid(pid, os.WNOHANG) == (0, 0)
        except ChildProcessError:
            return False

    try:
        for step in steps:
            kind = step[0]
            if kind == "wait":
                end = time.time() + 5
                while not any(step[1] in line for line in screen.text()) and time.time() < end:
                    pump(0.05)
                if not any(step[1] in line for line in screen.text()):
                    errors.append("never saw %r" % step[1])
            elif kind == "send":
                os.write(fd, step[1].encode())
                pump(0.05)
            elif kind == "sleep":
                pump(step[1])
            elif kind == "resize":
                screen.epoch += 1
                screen.resize(step[1], step[2])
                set_size(fd, step[1], step[2])
                pump(0.3)
            elif kind == "snap":
                pump(0.1)
                snaps[step[1]] = screen.text()
            elif kind == "wait-cmd":
                end = time.time() + 5
                while len(cmd_lines()) < step[1] and time.time() < end:
                    pump(0.05)
            elif kind == "term-node":
                kids = subprocess.run(["/usr/bin/pgrep", "-P", str(pid), "node"],
                                      capture_output=True, text=True).stdout.split()
                if len(kids) != 1:
                    errors.append("expected one node child, found %r" % kids)
                for k in kids:
                    os.kill(int(k), signal.SIGTERM)
                pump(0.1)
        pump(0.3)
        result = {"cmd": cmd_lines(), "alive": alive(), "snaps": snaps,
                  "overflow": screen.overflow, "screen": screen.text(), "errors": errors}
    finally:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
        os.close(fd)
    left = subprocess.run(["/usr/bin/pgrep", "-g", str(pid)], capture_output=True, text=True).stdout.split()
    result["leftover"] = left
    print(json.dumps(result))


main()
