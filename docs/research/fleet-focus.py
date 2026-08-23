#!/usr/bin/env python3
"""Tail a `claude agents --debug-file <path>` log and emit focus events with the
agent's folder (worktree) resolved.

  claude agents --debug-file ~/.claude/fleet.log
  ~/.claude/tools/fleet-focus.py ~/.claude/fleet.log

Emits one JSON line per navigation:
  {"event":"enter","jobId":"0b039bf8","cwd":"/path/to/worktree","name":"..."}
  {"event":"exit","attachMs":1234}
"""
import json, os, re, sys, time, glob

ENTER = re.compile(r"\[FV-attach\] respawnJob (\S+?):")
EXIT  = re.compile(r"\[FV-attach\] attachJob returned after (\d+)ms")

def resolve(job_id):
    """job id -> the folder that agent is running in RIGHT NOW.

    ~/.claude/sessions/<pid>.json tracks the agent's *live* cwd, so it follows an
    agent that entered a worktree after launch. roster.json only records the
    *launch* cwd (the repo root) and is wrong for such agents -- it is a
    last-resort fallback and is labelled as approximate.
    Session files are keyed by pid, and pids change when an agent respawns, so
    match on jobId and prefer the most recently updated file.
    """
    best = None
    for p in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
        try:
            d = json.load(open(p))
        except Exception:
            continue
        if d.get("jobId") != job_id:
            continue
        if best is None or (d.get("updatedAt") or 0) > (best.get("updatedAt") or 0):
            best = d
    if best is not None:
        return best.get("cwd"), best.get("name"), best.get("sessionId"), "session"
    try:
        r = json.load(open(os.path.expanduser("~/.claude/daemon/roster.json")))
        w = r.get("workers", {}).get(job_id)
        if w:
            return w.get("cwd"), None, w.get("sessionId"), "roster-launch"
    except Exception:
        pass
    return None, None, None, None

def emit(obj):
    print(json.dumps(obj), flush=True)

def tail(path):
    while not os.path.exists(path):
        time.sleep(0.2)
    f = open(path, "r", errors="replace")
    f.seek(0, os.SEEK_END)
    inode = os.fstat(f.fileno()).st_ino
    while True:
        line = f.readline()
        if not line:
            try:                                    # handle rotation/truncation
                if os.stat(path).st_ino != inode or os.stat(path).st_size < f.tell():
                    f.close(); f = open(path, "r", errors="replace")
                    inode = os.fstat(f.fileno()).st_ino
                    continue
            except FileNotFoundError:
                pass
            time.sleep(0.1)
            continue
        m = ENTER.search(line)
        if m:
            job = m.group(1)
            cwd, name, sid, src = resolve(job)
            emit({"event": "enter", "jobId": job, "cwd": cwd, "cwdSource": src,
                  "name": name, "sessionId": sid, "ts": time.time()})
            continue
        m = EXIT.search(line)
        if m:
            emit({"event": "exit", "attachMs": int(m.group(1)), "ts": time.time()})

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: fleet-focus.py <debug-log-path>")
    try:
        tail(sys.argv[1])
    except KeyboardInterrupt:
        pass
