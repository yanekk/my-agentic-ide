# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row.**

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-08-31 | ✅🐞 | T04 verify: gate (check 1) and key-not-a-variable (check 2) PASS in a dispatched agent. But `config` shipped `0644` (T02), so the symlink ran as `zsh: permission denied` — the command never worked. Fixed: `chmod +x`; run.sh now guards all three command targets are executable. |
| 2026-08-31 | 🐞 | T03 review: `decide`'s "title unchanged" early-out returned before persisting `frozen`, so a real name (candidate/summary) whose text equalled the placeholder never froze — endless re-fetch/climb. Fixed: persist the freeze-crossing even when the text is unchanged. |
| 2026-08-31 | 📌 | `candidateTopic` and `decide` each shell `repoContext` on the naming path (two git probes per held prompt). Correct but redundant; watch it when T04 measures the ~2s hold latency. |
| 2026-08-31 | 📌 | "Follows the work" is retired only for a REAL (frozen) name; a placeholder still climbs to a slug/worktree/summary/candidate. In `decide`, `aiTitle` is read whenever `candidate` is null and treated as a real name that freezes — covering the no-key path. |
| 2026-08-31 | 📌 | `runHook` is now async (the Haiku hold is awaited), so the entrypoint had to `await main()` before `process.exit(0)` — a bare `main(); process.exit(0)` would kill the pending fetch. `candidateTopic` mirrors `decide`'s frozen/backedOff/human-rename guards so a settled or person-owned session is never held or charged. |
| 2026-08-31 | 📌 | `cockpit-config.mjs` is both the importable store and the CLI in one file (DESIGN 3.2). A realpath entrypoint guard runs the CLI only when invoked directly or via the PATH symlink, so importing `readApiKey`/`maskedStatus` in tests is side-effect-free. |
| 2026-08-31 | ✅ | Spike, with the user's key. Haiku 4.5 via the Anthropic API named real first messages in ~0.9s (worst 1.5s) with good labels (`oauth-loopback`, `daemon-panes`, `flaky-tests`). `claude -p` was 3.5s floor, 5–10s on real prompts. API chosen. |
| 2026-08-31 | 📌 | The guard is load-bearing: a content-free first message ("hey") made Haiku reply with a clarifying sentence, not a label. `fetchTopic` must reject anything not matching the kebab regex (DESIGN 2.5). |
| 2026-08-31 | 📌 | node 24 has a global `fetch`, so the web call needs no import and the zero-dependency rule and the "imports nothing outside `node:*`" check both hold with the call in `cockpit-auto-name.mjs`. |
| 2026-08-31 | 📌 | Unverified assumption (DESIGN 2.4): a naming hook fired inside a dispatched agent sees `COCKPIT_REPO`. The whole cockpit-only gate rests on it. Verify at the top of T04 before trusting the gate. |
