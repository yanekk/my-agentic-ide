# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify. A ✅ row is the entire record that something was seen
working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Before adding a row, if this file is over 60 rows or 15 KB, shrink it first: merge rows that are
one lesson twice, drop a row now enforced by code or a test. Never drop a ✅ row or its date, or
a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-30 | 📌 | Planning ran with `PIR_RUN=1` in the environment and no `PIR_HOME`. Test daemons get `HOME=$T/home` but inherit any `PIR_HOME` the caller exports, so the suites must export a scratch `PIR_HOME` themselves (DESIGN §5.2). |
| 2026-09-30 | 📌 | Installed pir (`~/.local/bin/pir`) knows only `plan`, `start`, `notify`; no `service` command, and `~/.pir/` has no `api.json`. pir's `plans/api-service` is on branch `pir/api-service` (dab1019), not on its main. |
| 2026-09-30 | 📌 | Node v24.2.0 probe: `fetch("http://127.0.0.1:PORT/…")` sends `Host: 127.0.0.1:PORT`; `AbortSignal.timeout(300)` on a hung server rejects with `TimeoutError` at 304 ms; a refused port rejects with `TypeError`. |
| 2026-09-30 | 📌 | `cockpit-usage-tap.mjs` writes unconditionally with `Date.now()` as `writtenAt`. Newest-wins is therefore enforced only on the daemon's side; the tap is out of scope. |
| 2026-09-30 | 📌 | `plans/usage-limits/PROGRESS.md` Status line says T03/T04 not started while its table marks them ✅. Left alone: another plan's file. |
| 2026-09-30 | 📌 | `pirBase` was not recorded on branch `pir/plan-36d4`; the branch sat on main's head (53d40ea) and the person confirmed main as base. |
