# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify.

**Newest first. Forty words a row.**

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-08-31 | ✅ | Planning probe (the spike). A live `curl` to `{ANTHROPIC_BEDROCK_BASE_URL}/model/{model}/invoke` with only a content-type header and a 16-token body returned `200` + `ok`. The company gateway authorizes on Tailscale network identity alone — no key, no SigV4. |
| 2026-08-31 | 📌 | The model id from `ANTHROPIC_DEFAULT_HAIKU_MODEL` worked verbatim in the URL path (no `:0` suffix, no encoding). Use it raw; encoding could break the gateway's routing. Body uses `anthropic_version: "bedrock-2023-05-31"` and no `model` field. |
| 2026-08-31 | 📌 | `aws` CLI v2 is installed with `bedrock-runtime` (~0.2s cold start), but the shipped code needs none of it — the gateway route is a plain `fetch`. The CLI would only matter for the out-of-scope direct-AWS path (DESIGN 8). |
| 2026-08-31 | 📌 | Response from the gateway's `/invoke` is the Anthropic message shape (`content[0].text`), so `fetchTopic`'s existing label extraction is unchanged across both routes. |
