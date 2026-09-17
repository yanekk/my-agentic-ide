# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the *entire* record that something was seen
working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-16 | 📌 | T05: `cockpit-strip.mjs` imports its usage siblings by relative path. The cockpit-test §12 click test runs a COPY of the strip in a temp dir, so it must copy `cockpit-usage-store.mjs`/`-model.mjs` beside it or node dies on the missing import before reading a click. |
| 2026-09-16 | 📌 | T03 review clean. Tap's main-module guard uses `new URL(import.meta.url).pathname` (copied from `cockpit-auto-name.mjs`, not `fileURLToPath`): a checkout path with a space/unicode would silently disable the hook. Pre-existing, controlled path, left alone. |
| 2026-09-16 | ✅ | Machine: T00 captured 49 live renders, `rate_limits` on every one from the first — `five_hour`/`seven_day` each `{used_percentage` float 0–100, `resets_at` epoch **seconds**`}`. Person: user confirmed personal Pro/Max; live usage UI (62%/93%) matched the sample. |
| 2026-09-16 | 📌 | Footer already runs ~150 cols before usage (keys 95 + diff 53); attached with agent name + usage reaches ~237. Usage sits far-right, so it clips first — hence the one-row drop-order rule (DESIGN §2.2): key hints yield, usage kept. |
| 2026-09-16 | 📌 | Machine re-checked at plan review: Claude Code 2.1.273, node v24.2.0, no `statusLine` in settings.json (clean add), hooks present are `Stop` + `UserPromptSubmit` (both must survive the merge). |
| 2026-09-16 | 📌 | Subscription session/weekly limits have no public API, no local file, no non-interactive command. The only supported read is Claude Code's statusline `rate_limits` stdin object (v2.1.251+, Pro/Max only). This machine is 2.1.273. |
| 2026-09-16 | 📌 | Raw endpoint `GET api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/<ver>` or it 429s) returns the same numbers with `utilization`/ISO timestamps. Deferred as Method 2 (DESIGN §8), not used. |
| 2026-09-16 | 📌 | statusline stdin field names differ from the raw endpoint: `used_percentage` (0–100) and `resets_at` (epoch seconds), under `rate_limits.five_hour`/`.seven_day`. Confirmed live by T00 (see ✅ row); `used_percentage` is a float, not an int. |
| 2026-09-16 | 📌 | No `statusLine` in `~/.claude/settings.json` today, so registration is a clean add. The auto-name UserPromptSubmit hook and a Stop sound hook are present and must survive the merge. |
