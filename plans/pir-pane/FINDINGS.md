# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | T04: showDiff forgets the mode of a key whose parked pane died, so a pir run's start mode is applied after it. A pir move blocked by an open annotation editor is retried only on pir's next file write. |
| 2026-09-27 | 📌 | T03 review, by reading: a pir pane that dies while shown leaves `fleet-claude` splitting into a dead pane id, so claude agents is unreachable until a rebuild. Only closing the pane triggers it; left alone. |
| 2026-09-27 | 🐞 | cockpit-test sections 13 and 13b leave two `cockpitd` daemons (agenda2, agenda3) running after `ALL PASS`: `kill $D2PID`/`$D3PID` hit the wrapper subshell, the stopbb problem of section 14. Found and killed by hand in T03. |
| 2026-09-27 | 📌 | T00 swap in, wezterm 20240203: `split-pane --left --percent 50 --pane-id <fleet> --move-pane-id <pir>` halves the slot (29x22 each at 120x40), then `move-pane-to-new-tab <fleet>`: pir 59x22, sh 47x22, strip 12x22, diff 120x15 unchanged. 80x24: 39x12, 31, 8. |
| 2026-09-27 | 📌 | T00 swap out is the mirror (`--pane-id <pir> --move-pane-id <fleet>`, park pir): fleet back to 59x22 / 39x12. Three round trips per size, sizes identical each time. The moved-in pane becomes the tab's active pane. |
| 2026-09-27 | 📌 | T00 landmark: `panes.foot`'s `tab_id` equalled the cockpit tab after all 15 measured steps per size, parked panes each in their own tab. DESIGN §2.10 holds. |
| 2026-09-27 | 📌 | T00 first spawn: `split-pane --left --percent 50 --pane-id <fleet> -- /usr/bin/env PATH HOME PIR_HOME PIR_DASHBOARD_STATE pir`, then park fleet: pir 59x22 / 39x12, runs list drawn, state file `view: list` written. |
| 2026-09-27 | 📌 | T00 redraw: pir's runs list and a `less` stand-in came back identical over three park/return trips. `get-text --start-line 0` returns rows above the viewport after a resize (14 lines, 12-row pane); compare the last `rows` lines only. |
| 2026-09-27 | 📌 | T00 probe: the probe's zsh caller passing "120 40" as one argument broke the mux config and the server then fought for `~/.local/share/wezterm/pid`. Kill a private mux by its config path (`pkill -f "$T/wezterm.lua"`), not only its pid file. |
| 2026-09-27 | 📌 | pir `d4f2e7e` publishes `PIR_DASHBOARD_STATE` (installed). Driven on its conversation rig: list, run, worker, back twice, quit all match §2.4; file removed on Esc. Back is ←; Esc in a worker view interrupts, not back. |
| 2026-09-27 | 📌 | pir's run key is `{repo}__{record.slug}`, and a planning run's slug is its run id until the rename, so the rename changes the key, not only `cwd` (§2.11). The cockpit sees a new run; the old key is reaped. |
| 2026-09-27 | 📌 | pir moved to `4e209ad` (plan-only: a new-plan box on the runs list); the installed engine matches its source. The engine parser keeps YAML-style quotes on a test line, so a quoted line runs as one command name (exit 127). |
| 2026-09-26 | 📌 | `FORCE_COLOR=3` is set in this machine's session environment, contradicting usage-limits DESIGN §5. cockpit-test and notes-test still printed zero escape bytes. |
| 2026-09-26 | 📌 | cockpit-test takes about 6 minutes (545 checks); notes-test 4s. A fresh clone needs no setup and stays clean. |
| 2026-09-26 | 📌 | revdiff's `O` flush without `-o` writes to stdout and quits, so pir-followed diffs keep `-o review-{key}.md` and the daemon simply does not inject (DESIGN §2.7). |
| 2026-09-26 | 📌 | The pir dashboard exposes nothing outside its screen: no title escape, no state file, headers carry no path. Hence the `PIR_DASHBOARD_STATE` contract (DESIGN §2.4). |
