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
import { normalizeQuotas, renderAperture, appendReading, forecastAperture, STALE_MS, FORECAST_WINDOW_MS } from "../../bin/cockpit-usage-model.mjs";
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
    normalizeQuotas(LIVE, NOW), { writtenAt: NOW, balance: 128436628079, capacity: 200000000000, usedPct: 36 });
  eq("a bucket without effective figures falls back to its own",
    normalizeQuotas({ buckets: [{ currentNanodollars: "25000000000", capacityNanodollars: "100000000000" }] }, NOW),
    { writtenAt: NOW, balance: 25000000000, capacity: 100000000000, usedPct: 75 });
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
  eq("one window, no reset, fresh -- no history yet draws no forecast", r(36),
    { stale: false, asOf: null, windows: [{ key: "aperture", pct: 36, role: "ok", reset: null, eta: null }] });
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

section("appendReading");
{
  const MIN = 60_000;
  const rd = (t, balance, capacity = 200) => ({ writtenAt: t, usedPct: 0, balance, capacity });
  let c = appendReading(null, rd(NOW, 150));
  eq("the first reading starts the history", c.readings, [{ t: NOW, balance: 150 }]);
  c = appendReading(c, rd(NOW + MIN, 149));
  eq("the next is appended", c.readings.length, 2);
  eq("...and the cache carries the newest figures", [c.writtenAt, c.balance], [NOW + MIN, 149]);
  let long = null;
  for (let i = 0; i <= 45; i++) long = appendReading(long, rd(NOW + i * MIN, 150 - i));
  eq("history older than window + gap is trimmed", long.readings[0].t, NOW + 27 * MIN);
  eq("a capacity change (new tier) restarts the history",
    appendReading(c, rd(NOW + 2 * MIN, 400, 500)).readings, [{ t: NOW + 2 * MIN, balance: 400 }]);
}

section("forecastAperture");
{
  const MIN = 60_000;
  // A minute series ending at NOW: balance(i) for i = 0..n-1 minutes ago.
  const series = (n, bal, capacity = 200e9) => ({
    capacity,
    readings: Array.from({ length: n }, (_, k) => ({ t: NOW - (n - 1 - k) * MIN, balance: bal(n - 1 - k) })),
  });
  eq("no readings: no forecast", forecastAperture({ readings: [] }), null);
  eq("under 5 minutes of history: no forecast", forecastAperture(series(5, (ago) => 100e9 + ago * 1e9)), null);
  // Six polls a hair under five minutes apart (measured 299927ms) do forecast.
  const drift = { capacity: 200e9, readings: Array.from({ length: 6 }, (_, k) => ({ t: NOW - (5 - k) * 59985, balance: (100 + (5 - k)) * 1e9 })) };
  eq("six one-minute polls with timer drift do forecast", forecastAperture(drift)?.kind, "empty");
  // Down $1/min net with $100 left -> empty in 100 minutes.
  eq("a falling balance projects empty",
    forecastAperture(series(16, (ago) => 100e9 + ago * 1e9)), { kind: "empty", atMs: NOW + 100 * MIN });
  // Up $0.50/min with $40 to go -> full in 80 minutes.
  eq("a climbing balance projects full",
    forecastAperture(series(16, (ago) => 160e9 - ago * 0.5e9)), { kind: "full", atMs: NOW + 80 * MIN });
  eq("a full tank is full now", forecastAperture(series(16, () => 200e9)), { kind: "full", atMs: null });
  eq("a dead level has no direction", forecastAperture(series(16, () => 100e9)), null);
  // Only the last 15 minutes count: a steep fall 20+ min ago, climbing since.
  const recent = series(25, (ago) => (ago > 15 ? 50e9 + ago * 10e9 : 100e9 - ago * 1e9));
  eq("only the last FORECAST_WINDOW_MS counts", forecastAperture(recent),
    { kind: "full", atMs: NOW + 100 * MIN });
  eq("...the window is 15 minutes", FORECAST_WINDOW_MS, 15 * MIN);
  // A 10-minute gap (laptop asleep) 4 minutes ago: only the 4 minutes after it are
  // contiguous, which is under the 5-minute minimum.
  const gap = { capacity: 200e9, readings: [
    ...Array.from({ length: 5 }, (_, k) => ({ t: NOW - (18 - k) * MIN, balance: 50e9 })),
    ...Array.from({ length: 5 }, (_, k) => ({ t: NOW - (4 - k) * MIN, balance: 120e9 - k * 1e9 })),
  ] };
  eq("a gap restarts the history instead of reading as a refill", forecastAperture(gap), null);
}

section("renderAperture: the forecast text");
{
  const MIN = 60_000;
  const cache = (bal, capacity = 200e9) => ({
    writtenAt: NOW, usedPct: 50, balance: bal(0), capacity,
    readings: Array.from({ length: 16 }, (_, k) => ({ t: NOW - (15 - k) * MIN, balance: bal(15 - k) })),
  });
  // NOW is 05:43:30 UTC; empty in 100 min -> 07:23 today.
  eq("draining: empty ~HH:MM", renderAperture(cache((ago) => 100e9 + ago * 1e9), NOW).windows[0].eta, "empty ~07:23");
  eq("refilling: nothing shown", renderAperture(cache((ago) => 160e9 - ago * 0.5e9), NOW).windows[0].eta, null);
  eq("full: nothing shown", renderAperture(cache(() => 200e9), NOW).windows[0].eta, null);
  eq("warming up: nothing shown", renderAperture({ ...cache(() => 100e9), readings: [{ t: NOW, balance: 100e9 }] }, NOW).windows[0].eta, null);
  // Down $0.01/min with $100 left -> ~6.9 days away: not today, so hidden.
  eq("an empty on a later day is hidden", renderAperture(cache((ago) => 100e9 + ago * 0.01e9), NOW).windows[0].eta, null);
  // Down $1/min with $1100 left -> 00:02 tomorrow: just past midnight, hidden.
  eq("an empty just past midnight is hidden", renderAperture(cache((ago) => 1098.5e9 + ago * 1e9, 2000e9), NOW).windows[0].eta, null);
  // Down $1/min with $1000 left -> 22:23 today: shown.
  eq("a late-evening empty today is shown", renderAperture(cache((ago) => 1000e9 + ago * 1e9, 2000e9), NOW).windows[0].eta, "empty ~22:23");
  const stale = { ...cache((ago) => 100e9 + ago * 1e9), writtenAt: NOW - STALE_MS - 1 };
  eq("stale: the forecast is dropped", renderAperture(stale, NOW).windows[0].eta, null);
}

section("the aperture cache and the gateway origin");
{
  const dir = scratch();
  eq("absent cache reads null", readApertureCache(dir), null);
  writeApertureCache({ writtenAt: NOW, usedPct: 36 }, dir);
  eq("a bare cache reads back with empty history", readApertureCache(dir),
    { writtenAt: NOW, usedPct: 36, balance: null, capacity: null, readings: [] });
  const full = { writtenAt: NOW, usedPct: 36, balance: 128, capacity: 200, readings: [{ t: NOW - 60000, balance: 130 }, { t: NOW, balance: 128 }] };
  writeApertureCache(full, dir);
  eq("write then read round-trips the readings", readApertureCache(dir), full);
  fs.writeFileSync(path.join(dir, "aperture-cache.json"), JSON.stringify({ ...full, readings: [{ t: "x" }, null, { t: NOW, balance: 5 }] }));
  eq("malformed readings are dropped", readApertureCache(dir).readings, [{ t: NOW, balance: 5 }]);
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
  eq("...holding the used percentage and the first reading",
    [readApertureCache(dir).usedPct, readApertureCache(dir).readings], [36, [{ t: NOW, balance: 128436628079 }]]);

  mode = "500";
  eq("a failed fetch reports its kind", await refreshApertureCache({ origin: ORIGIN, settingsFile, dir, now: () => NOW + 60_000 }), "transient");
  eq("...and keeps the last reading", [readApertureCache(dir).writtenAt, readApertureCache(dir).readings.length], [NOW, 1]);
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
