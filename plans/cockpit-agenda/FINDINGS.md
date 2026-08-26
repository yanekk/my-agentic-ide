# Findings log

**What the build taught, especially where reality contradicted the design.**

**Read this before touching a task**, and read it whole before anything that only a person can
verify. It is the only place a hand-verification is written down: the test command is the only
evidence a session can produce on its own, so a ✅ line here is the *entire* record that
something was seen working for real.

**Newest first. About forty words a row.** The long version belongs in the commit message that
carried the fix; this is the index, not the account.

Legend: 🐞 a defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | Finding | Consequence |
|---|---|---|
| 2026-08-26 | 📌 **The plan was written against `c9e4592`; six commits landed on `origin/main` mid-session** (reflog-watch diff reload, parked-worktree following, a Cmd+C change). `cockpitd.mjs` grew ~185 lines and `cockpit-test` grew 82 → 108 assertions. | T07's hook was re-checked against the new code: `onExit()` still exists and is still called from `reconcile()` on the list transition. Baselines above are re-measured, not inherited. |
| 2026-08-26 | 📌 **Refresh-token expiry is believed, not verified.** A Google client left in *Testing* status is thought to expire refresh tokens after ~7 days; *In production* is thought to fix it, at the cost of an "unverified app" warning. From memory, not measured. | T00 must confirm which publishing status works and record it here. If weekly re-auth is unavoidable, DESIGN §2.7's loud `sign-in expired` line already covers it — no redesign. |
| 2026-08-26 | 📌 **Google's OAuth endpoints verified live** from `accounts.google.com/.well-known/openid-configuration`: auth `.../o/oauth2/v2/auth`, token `oauth2.googleapis.com/token`, revoke `.../revoke`, and `S256` is in `code_challenge_methods_supported`. | PKCE loopback is confirmed available. T04 hard-codes these rather than fetching discovery at runtime. |
| 2026-08-26 | 📌 **Node v24.2.0 has everything needed built in** — `fetch`, `node:http.createServer`, `webcrypto.subtle.digest`, `crypto.randomBytes` — all confirmed on this machine. `Intl` reports `Europe/Warsaw`. | The zero-dependency rule (DESIGN §5) holds. No task should reach for a library; if one seems to, that is a question for the user. |
| 2026-08-26 | 📌 **`/usr/bin/cal` exists and the cockpit *prepends* its bin dir to PATH** (`bin/cockpit-layout.sh:77`), so a `cal` symlink would shadow the month grid in every cockpit terminal **and in every agent**, which inherits that PATH. | 🔄 The user renamed the command to `agenda`. DESIGN §2.2. |
| 2026-08-26 | 📌 **Baseline test measurement**: `spikes/notes-test/run.sh` 39 assertions ALL PASS, `spikes/cockpit-test/run.sh` 108 assertions ALL PASS, on a clean `main` at `da587b2`. | Any session that reddens either has broken something it did not mean to touch. Both are part of the test command (DESIGN §5). |
| 2026-08-26 | 📌 **`cockpitd.mjs` already detects the return to the fleet list** — `onExit()`, called from `reconcile()` on the list→agent transition, at an 800ms poll. | T07's "refresh when I come back" hook exists; it does not need a new detector. |
