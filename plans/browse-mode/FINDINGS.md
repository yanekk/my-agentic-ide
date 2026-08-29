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
| 2026-08-29 | 🔄 **The diff slot CAN hold a pair, and the user chose it.** Probed on a headless mux: broot 47x18 + micro 72x18 in the slot, parked as a unit (`move-pane-to-new-tab`, then `split-pane --move-pane-id`), restored to **identical** geometry; micro still held its file with `[ro]`, broot still drew. | Reverses DESIGN §3.1 — the old "it breaks the park-exactly-one invariant" was asserted, never measured. Real cost: one extra `wezterm cli` call each way. Deletes the `browse` command entirely. |
| 2026-08-29 | 📌 **`--percent 60` to the viewer gives broot 47 columns** on a 120-column window — the exact width broot was already measured usable at during planning. | The split ratio is chosen to land on a known-good number, not guessed. Comfort is still T07's to confirm. |
| 2026-08-29 | 🐞 **`cockpit-notes.mjs`'s lock can write unguarded.** It waits 40 × 25 ms = 1 s against a 5 s stale window, then leaves the loop with `fd === null` and runs the write anyway. `cockpit-agenda-store.mjs` already fixes this (`LOCK_TRIES = ceil(STALE/WAIT)`). | Out of scope here — notes belong to another feature. Browse mode reuses the agenda's `withLock` rather than copying the broken one (T02). Worth its own task some day. |
| 2026-08-29 | 🐞 **A running micro reads as a bare `shell` to `diffPaneStatus`.** Measured on a headless mux: **0** lines start with `│` (the check needs ≥5) and the title is `micro`, which does not match `/revdiff/`. | `healQuitDiff` (1 s tick, 3 s cooldown) would type a whole command line into the live viewer. T06 fixes detection but lands two tasks after browse becomes reachable — see the plan review. |
| 2026-08-29 | 🐞 **Two `panes.json`/`terminals.json` fields do not mean what T02 assumed.** `panes.json.repo` is the **projects root** the cockpit was opened in (measured: `/Users/jan.krolikowski/src`), not a repo root; `terminals.json.agent` is the agent's **display name**, not a jobId. | The daemon now publishes `viewerAgent` (jobId) and `viewerRoot` (worktree) beside `viewer`. DESIGN §3.4. Without it, tab labels were wrong and no reap could ever drop a tab list. |
| 2026-08-29 | 📌 **revdiff's own browse still cannot do the two things browse mode is for.** `--dump-keys` on v1.12.0 shows only `f filter` (file list) and `/ search` (current file): no directory folding, no cross-file content search. `-A/--all-files` does exist. | Confirms DESIGN §7's broot+micro choice independently of the 6–12 s timing, which this review did not re-run. |
| 2026-08-29 | 📌 **Environment re-verified, every row of DESIGN §5 holds.** micro 2.0.15, broot 1.59.0, node v24.2.0, wezterm 20240203-110809-5046fc22, git 2.50.1, revdiff v1.12.0, macOS 26.5.1 (25F80), `timeout` still absent. `micro -readonly` and broot's `{file}`/`{line}` both exist. | Phase 1 and 2 build against a machine that still matches the plan. Seatbelts in §5.2 are real, not assumed. |
| 2026-08-29 | 📌 **The footer already needs ~184 columns** with three mode labels, a short agent name and no custom ref; a fourth label adds ~11, and `Custom: <branch>` adds more. | Whether `browse` gets a clickable footer label is a width decision, not a free one. DESIGN §2.7. |
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
