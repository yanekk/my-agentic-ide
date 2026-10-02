// The footer's Aperture budget: the pure normalise + render, the store's cache and
// settings readers, and one refresh pass against a loopback stub of GetMyQuotas.
// Nothing here reaches the real gateway: every pass is handed a 127.0.0.1 origin
// or a settings file without Bedrock.
process.env.TZ = "UTC";

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { section, ok, eq, done } from "./harness.mjs";
import { normalizeQuotas, renderAperture, STALE_MS } from "../../bin/cockpit-usage-model.mjs";
import { readApertureCache, writeApertureCache, bedrockGatewayOrigin } from "../../bin/cockpit-usage-store.mjs";
import { getMyQuotas, refreshApertureCache } from "../../bin/cockpit-aperture-client.mjs";

const NOW = Date.UTC(2026, 9, 2, 5, 43, 30);
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "usage-aperture-"));

// The shape GetMyQuotas returned on 2026-10-02 (modelIds trimmed): a default
// bucket at $64.19 of $100 with a Power User overdraft, effective $128.44 of $200.
const LIVE = {
  buckets: [{
    name: "Default Bucket:someone@example.com",
    currentNanodollars: "64194627634",
    capacityNanodollars: "100000000000",
    rate: "$100/day",
    scope: "user",
    overdrafts: ["Power User Bucket:someone@example.com"],
    effectiveBalanceNanodollars: "128436628079",
    effectiveCapacityNanodollars: "200000000000",
    status: "QUOTA_STATUS_AVAILABLE",
  }],
};

section("normalizeQuotas");
{
  eq("the live shape uses the effective (overdraft-inclusive) figures",
    normalizeQuotas(LIVE, NOW), { writtenAt: NOW, usedPct: 36 });
  eq("a bucket without effective figures falls back to its own",
    normalizeQuotas({ buckets: [{ currentNanodollars: "25000000000", capacityNanodollars: "100000000000" }] }, NOW),
    { writtenAt: NOW, usedPct: 75 });
  eq("several buckets: the most-used one is shown",
    normalizeQuotas({ buckets: [
      { currentNanodollars: "90", capacityNanodollars: "100" },
      { currentNanodollars: "5", capacityNanodollars: "100" },
    ] }, NOW).usedPct, 95);
  eq("a full bucket is 0% used", normalizeQuotas({ buckets: [{ currentNanodollars: "100", capacityNanodollars: "100" }] }, NOW).usedPct, 0);
  eq("a balance over capacity never reads negative",
    normalizeQuotas({ buckets: [{ currentNanodollars: "150", capacityNanodollars: "100" }] }, NOW).usedPct, 0);
  eq("a zero capacity is undrawable", normalizeQuotas({ buckets: [{ currentNanodollars: "0", capacityNanodollars: "0" }] }, NOW), null);
  eq("no buckets is null", normalizeQuotas({ buckets: [] }, NOW), null);
  eq("junk is null", normalizeQuotas("nope", NOW), null);
  eq("non-numeric figures are null", normalizeQuotas({ buckets: [{ currentNanodollars: "x", capacityNanodollars: "y" }] }, NOW), null);
}

section("renderAperture");
{
  const r = (usedPct, writtenAt = NOW) => renderAperture({ writtenAt, usedPct }, NOW);
  eq("one window, no reset, fresh", r(36),
    { stale: false, asOf: null, windows: [{ key: "aperture", pct: 36, role: "ok", reset: null }] });
  eq("70% is warn, as the Claude windows", r(70).windows[0].role, "warn");
  eq("90% is crit", r(90).windows[0].role, "crit");
  eq("69% is ok", r(69).windows[0].role, "ok");
  const stale = r(36, NOW - STALE_MS - 1);
  eq("a reading older than STALE_MS is stale", stale.stale, true);
  eq("...stamped with its write time", stale.asOf, "05:28");
  eq("exactly STALE_MS old is still fresh", r(36, NOW - STALE_MS).stale, false);
  eq("no cache is null", renderAperture(null, NOW), null);
  eq("a cache without a percentage is null", renderAperture({ writtenAt: NOW }, NOW), null);
}

section("the aperture cache and the gateway origin");
{
  const dir = scratch();
  eq("absent cache reads null", readApertureCache(dir), null);
  writeApertureCache({ writtenAt: NOW, usedPct: 36 }, dir);
  eq("write then read round-trips", readApertureCache(dir), { writtenAt: NOW, usedPct: 36 });
  eq("...at 0600", fs.statSync(path.join(dir, "aperture-cache.json")).mode & 0o777, 0o600);
  eq("...leaving no temp", fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  fs.writeFileSync(path.join(dir, "aperture-cache.json"), "{ broken");
  eq("a corrupt cache reads null", readApertureCache(dir), null);

  const f = path.join(dir, "settings.json");
  fs.writeFileSync(f, JSON.stringify({ env: { ANTHROPIC_BEDROCK_BASE_URL: "http://ai.tail0.ts.net/bedrock" } }));
  eq("the origin is the base URL's scheme and host", bedrockGatewayOrigin(f), "http://ai.tail0.ts.net");
  fs.writeFileSync(f, JSON.stringify({ env: { ANTHROPIC_BEDROCK_BASE_URL: "not a url" } }));
  eq("a non-URL is null", bedrockGatewayOrigin(f), null);
  fs.writeFileSync(f, "{}");
  eq("no base URL is null", bedrockGatewayOrigin(f), null);
  eq("an absent settings file is null", bedrockGatewayOrigin(path.join(dir, "nope.json")), null);
}

// --- one pass against a loopback stub ---------------------------------------
let mode = "ok";
const hits = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    hits.push({ method: req.method, url: req.url, ct: req.headers["content-type"], cpv: req.headers["connect-protocol-version"], body });
    if (mode === "500") { res.writeHead(500); return res.end(); }
    if (mode === "empty") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"buckets":[]}'); }
    if (mode === "slow") return setTimeout(() => { res.writeHead(200); res.end("{}"); }, 1000);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(LIVE));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

section("getMyQuotas");
{
  const res = await getMyQuotas({ origin: ORIGIN });
  eq("a 200 returns the parsed JSON", res.json?.buckets?.[0]?.rate, "$100/day");
  eq("...posted to the Connect-RPC path", hits.at(-1).url, "/aperture.chat.v1.ChatService/GetMyQuotas");
  eq("...as a POST with an empty JSON body", [hits.at(-1).method, hits.at(-1).body], ["POST", "{}"]);
  eq("...with the Connect headers", [hits.at(-1).ct, hits.at(-1).cpv], ["application/json", "1"]);
  mode = "500";
  eq("a 500 is transient, not a throw", (await getMyQuotas({ origin: ORIGIN })).error?.kind, "transient");
  mode = "slow";
  eq("a hung gateway times out as transient", (await getMyQuotas({ origin: ORIGIN, timeoutMs: 200 })).error?.kind, "transient");
  eq("a dead port is transient", (await getMyQuotas({ origin: "http://127.0.0.1:9" })).error?.kind, "transient");
}

section("refreshApertureCache");
{
  const dir = scratch();
  const settingsFile = path.join(dir, "settings.json");
  const put = (env) => fs.writeFileSync(settingsFile, JSON.stringify({ env }));
  const pass = () => refreshApertureCache({ origin: ORIGIN, settingsFile, dir, now: () => NOW, timeoutMs: 500 });

  mode = "ok";
  hits.length = 0;
  put({ CLAUDE_CODE_USE_BEDROCK: "0" });
  eq("off Bedrock: nothing is fetched", [await pass(), hits.length], ["off", 0]);
  eq("...and no cache is written", readApertureCache(dir), null);

  put({ CLAUDE_CODE_USE_BEDROCK: "1" });
  eq("on Bedrock: one fetch, cache written", [await pass(), hits.length], ["ok", 1]);
  eq("...holding the used percentage", readApertureCache(dir), { writtenAt: NOW, usedPct: 36 });

  mode = "500";
  eq("a failed fetch reports its kind", await refreshApertureCache({ origin: ORIGIN, settingsFile, dir, now: () => NOW + 60_000 }), "transient");
  eq("...and keeps the last reading", readApertureCache(dir), { writtenAt: NOW, usedPct: 36 });
  mode = "empty";
  eq("an undrawable answer writes nothing", [await pass(), readApertureCache(dir).usedPct], ["undrawable", 36]);

  // With no origin override the gateway comes from settings.json; with none there,
  // there is nothing to call.
  hits.length = 0;
  eq("on Bedrock with no gateway URL: nothing to call",
    [await refreshApertureCache({ settingsFile, dir }), hits.length], ["off", 0]);
  mode = "ok";
  put({ CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_BEDROCK_BASE_URL: `${ORIGIN}/bedrock` });
  eq("...and the settings' gateway origin is the one called",
    [await refreshApertureCache({ settingsFile, dir, now: () => NOW }), hits.at(-1)?.url],
    ["ok", "/aperture.chat.v1.ChatService/GetMyQuotas"]);
}

server.close();
done();
