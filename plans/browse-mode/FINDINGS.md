# Findings log

**What the build taught, especially where reality contradicted the design.**

**Read this before touching a task**, and read it whole before anything that only a person can
verify. It is the only place a hand-verification is written down: the test command is the only
evidence a session can produce on its own, so a ✅ line here is the *entire* record that
something was seen working for real.

**Newest first. About forty words a row.**

Legend: 🐞 a defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | Finding | Consequence |
|---|---|---|
| 2026-08-29 | ✅ **Verified by hand with the user:** on a real WezTerm fleet list, ⌥t *and* a click on `[+ add]` each open a shell, and it comes up in the agentic-ide checkout — not a worktree. | The stubbed suite drives the `cmd` verbs directly, so it can never prove the real key or pointer still delivers them. This is that half. |
| 2026-08-29 | 🐞 *(outside this plan — a direct fix)* **The fleet list's terminal gestures were dead.** `terminalCommand` bailed unless an agent was attached, so ⌥t/⌥w/⌥[/⌥], `[+ add]`, `[x]` and `select-<n>` did nothing there while the strip kept drawing them. | The list's shells are a normal terminal set; the guard bought nothing. Also: unattached, ⌥[/⌥] now always mean terminals — the top pane is the notes display, not a diff. Commit `terminal gestures work at the fleet list`. |
| 2026-08-29 | 📌 **Enter is `\r`; `\n` does nothing.** Sending `\n` to submit micro's command bar silently fails — no error, no tab, nothing. Cost a full failed run during planning. | The project's `\r`→`\n` rule applied in reverse: the cockpit strips `\r` so reviews arrive unsent, but here submission is the point. DESIGN §2.4. |
| 2026-08-29 | 📌 micro survives park/restore intact: `move-pane-to-new-tab` then `split-pane --move-pane-id` back returned **all 4 tabs**, cursor still on line 55, `[ro]` still set, geometry identical. Visible redraw on return. | Makes DESIGN §2.6 (park, don't kill) buildable. Still does not prove the slot holds *two* panes per agent — that is T00. |
| 2026-08-29 | 📌 **Focus is never stolen** by a push. The browser pane stayed active through four consecutive pushes and kept its filter text. | The whole gesture works without leaving broot. Assert it in T00. |
| 2026-08-29 | 📌 WezTerm titles a micro pane **`micro`**, stable from t=1s — no lag. revdiff's title lags ~1s, which is why `diffPaneStatus` needs two signals. | Viewer detection can be simpler than revdiff's, but T06 should still tolerate a lag rather than assume none. |
| 2026-08-29 | 📌 broot `--conf a;b;c` **layers** configs, it does not replace. Verified: the user's own `alt-o` and the cockpit's Enter verb both appeared in the same help table. | The cockpit ships its own verb file and never writes to `~/.config/broot/`. DESIGN §7. |
| 2026-08-29 | 📌 broot is comfortably usable at **47 columns** — the attached agent's terminal width. Tree, folders and `c/` snippets all readable. | Confirms the browser can live in the terminal slot (DESIGN §3.1). "Comfortable" is still a human judgement — T07. |
| 2026-08-29 | 📌 **`timeout(1)` does not exist on this machine.** Two planning probes died on `command not found`. | Spike scripts must background-and-kill, never `timeout`. DESIGN §5. |
| 2026-08-29 | 📌 micro started with no file leaves a permanent empty `No name` first tab. | First push uses `open`, later ones `tab`. DESIGN §2.2. |
| 2026-08-29 | 📌 Re-pushing an open file creates a **duplicate tab**; micro cannot be asked what it has open. | The glue must remember what it sent and use `tabswitch <n>`. DESIGN §2.5. |
| 2026-08-29 | 📌 macOS reserves **ctrl-← / ctrl-→** for Mission Control desktop switching (verified enabled on this machine), so broot's own preview keys never reach the terminal. `⌥p`/`⌥o` were bound in the user's `verbs.hjson` instead. | Not part of this plan — already done — but any doc telling the user to press ctrl-→ is wrong on this machine. |
| 2026-08-29 | 📌 broot's `:panel_right` shows **only the matching lines with real line numbers** ("lines: 3/467") when a `c/` search is active; `:toggle_preview` opens the file at line 1 and loses that. | The cockpit's verb layer must use `:panel_right`. The difference is the entire value of the content search. |
| 2026-08-29 | 📌 `ff` and `fp` in `~/.claude/cockpit/bin` are **dangling symlinks** into a deleted job directory — they are broken commands in every cockpit terminal today. Durable source is in `ideas/terminal-find-in-files.md`. | Out of scope here (DESIGN §8), but noticed and left alone under the scope rule. The user has not decided whether broot replaces them. |
