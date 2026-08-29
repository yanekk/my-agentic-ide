# Planning probes — raw, to be promoted by T00

These are the scripts that produced the measurements in `DESIGN.md` and `FINDINGS.md`. They
were written in a Claude job scratch directory during planning, which is **deleted when the job
is** — they are copied here so T00 can promote them rather than reconstruct them.

They are **raw**: no headers, no cleanup guarantees, paths and sleeps tuned by hand. T00 turns
them into `spikes/browse-mode/` proper. Do not treat them as the finished spike.

| File | What it measured | Where the result is used |
|---|---|---|
| `micro-push2.sh` | Ctrl+E → `tab <file>` → `\r` into a running micro; tabs accumulate; `goto` jumps; focus is not stolen | DESIGN §2.4, §2.5 |
| `e2e.sh` | broot's Enter verb → glue script → the running micro, end to end | DESIGN §3.4 |
| `park.sh` | micro survives `move-pane-to-new-tab` + `split-pane --move-pane-id` with tabs, cursor and `[ro]` intact | DESIGN §2.6 |
| `title.sh` | WezTerm reports a micro pane's title as `micro`, stable from t=1s | FINDINGS, T06 |
| `tui-render.py` | Runs a TUI in a pty of a chosen size, answers its terminal queries, sends scripted keys and prints the **rendered** screen via `pyte`. How every layout in this plan was actually looked at. | all of the above |

`tui-render.py` needs `pyte` (`pip install pyte` in a venv); it is a **planning tool**, not part
of the product, and T00 should decide whether it is worth keeping in `spikes/` or dropping.

**Two traps these scripts already fell into**, both recorded in FINDINGS and both easy to
repeat:

- `timeout(1)` **does not exist on this machine**. Background and kill instead.
- Submitting with `\n` sends nothing. It must be `\r`.
