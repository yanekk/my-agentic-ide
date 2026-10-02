// cockpit-aperture-client -- the one call to the company's Tailscale Aperture
// gateway: GetMyQuotas, the Connect-RPC the gateway's own /quotas page makes (found
// in opencode-aperture-quota). It is a POST only because Connect-RPC is; it reads
// the caller's budget and changes nothing. There is NO credential: the request is
// authorized by the machine's Tailscale identity alone, exactly as the sessions'
// own Bedrock calls are.
//
// Never throws: { json } on success, { error: { kind: "transient" } } otherwise --
// the daemon keeps the last reading and the footer marks it stale after 15 min.

import { normalizeQuotas } from "./cockpit-usage-model.mjs";
import { bedrockConfigured, bedrockGatewayOrigin, writeApertureCache } from "./cockpit-usage-store.mjs";

const PATH = "/aperture.chat.v1.ChatService/GetMyQuotas";
// A hung gateway must not wedge the daemon's one-minute tick.
const HTTP_TIMEOUT_MS = 10_000;

export async function getMyQuotas({ origin, timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  try {
    const res = await fetch(`${String(origin).replace(/\/+$/, "")}${PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { error: { kind: "transient", status: res.status } };
    return { json: await res.json() };
  } catch {
    return { error: { kind: "transient" } };
  }
}

/**
 * One refresh pass, the daemon's whole job here, kept out of cockpitd so a test
 * can drive it against a loopback stub: off Bedrock (settings.json) or with no
 * gateway origin it does nothing at all; otherwise it fetches, normalises and
 * writes aperture-cache.json. A failed or undrawable fetch writes nothing, so the
 * last reading stays. Returns the outcome for the log: "off" | "ok" | an error kind.
 *
 * `origin` overrides the gateway (tests); `settingsFile`/`dir` default as the store
 * resolves them.
 */
export async function refreshApertureCache({ origin, settingsFile, dir, now = () => Date.now(), timeoutMs } = {}) {
  if (!bedrockConfigured(settingsFile)) return "off";
  const target = origin || bedrockGatewayOrigin(settingsFile);
  if (!target) return "off";
  const res = await getMyQuotas({ origin: target, timeoutMs });
  if (res.error) return res.error.kind;
  const cache = normalizeQuotas(res.json, now());
  if (!cache) return "undrawable";
  writeApertureCache(cache, dir);
  return "ok";
}
