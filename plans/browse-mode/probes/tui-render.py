#!/usr/bin/env python3
"""Run a TUI in a real pty of a chosen size, answer its terminal queries,
send scripted keys, and print the rendered screen."""
import os, pty, sys, time, select, fcntl, termios, struct, argparse, re
import pyte

ap = argparse.ArgumentParser()
ap.add_argument("--cols", type=int, default=120)
ap.add_argument("--rows", type=int, default=36)
ap.add_argument("--cwd", default=os.getcwd())
ap.add_argument("--wait", type=float, default=4.0, help="seconds before first key")
ap.add_argument("--keys", default="", help="semicolon-separated: text or \\e etc, each followed by pause")
ap.add_argument("--keypause", type=float, default=1.5)
ap.add_argument("--tail", type=float, default=2.0, help="settle time after last key")
ap.add_argument("--raw", default="")
ap.add_argument("cmd", nargs=argparse.REMAINDER)
a = ap.parse_args()
cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd

pid, fd = pty.fork()
if pid == 0:
    os.chdir(a.cwd)
    env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor",
               LINES=str(a.rows), COLUMNS=str(a.cols))
    os.execvpe(cmd[0], cmd, env)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", a.rows, a.cols, 0, 0))
screen = pyte.Screen(a.cols, a.rows)
stream = pyte.ByteStream(screen)

keys = [k for k in a.keys.split(";")] if a.keys else []
keys = [k.encode().decode("unicode_escape").encode() for k in keys]
schedule = [(a.wait + i * a.keypause, k) for i, k in enumerate(keys)]
end = (schedule[-1][0] if schedule else a.wait) + a.tail

start = time.time()
buf = b""
while True:
    now = time.time() - start
    if now > end:
        break
    while schedule and now >= schedule[0][0]:
        _, k = schedule.pop(0)
        try: os.write(fd, k)
        except OSError: pass
    r, _, _ = select.select([fd], [], [], 0.05)
    if fd in r:
        try: data = os.read(fd, 65536)
        except OSError: break
        if not data: break
        buf += data
        try:
            stream.feed(data)
        except Exception:
            pass
        # answer terminal queries so the app stops waiting on us
        if b"\x1b[6n" in data:
            os.write(fd, b"\x1b[1;1R")
        if b"\x1b]11;?" in data:
            os.write(fd, b"\x1b]11;rgb:1c1c/1c1c/1c1c\x1b\\")
        if b"\x1b[>0q" in data or b"\x1b[>q" in data:
            os.write(fd, b"\x1bP>|harness\x1b\\")

try:
    os.kill(pid, 9); os.waitpid(pid, 0)
except Exception:
    pass

print("=" * a.cols)
for i, line in enumerate(screen.display):
    print("%2d|%s|" % (i, line.rstrip()))
print("=" * a.cols)
print("[raw bytes: %d]" % len(buf))
if a.raw: open(a.raw,"wb").write(buf)
