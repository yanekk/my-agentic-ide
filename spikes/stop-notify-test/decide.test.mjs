// The Stop-hook sound decision: who dings and who does not. Every session pir
// launched (it carries PIR_RUN=1) is silent, whatever its role; every other
// session keeps the old unconditional ding. Pure functions, no disk, no afplay.

import { isPirSession, decideSound, registerIn, unregisterIn }
  from "../../bin/cockpit-stop-notify.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); if (detail) console.log(`       got [${detail}]`); }
};

// --- isPirSession: the PIR_RUN marker pir's launcher sets --------------------
ok("PIR_RUN=1 is a pir session", isPirSession({ PIR_RUN: "1" }) === true);
ok("any other non-empty PIR_RUN is a pir session", isPirSession({ PIR_RUN: "yes" }) === true);
ok("PIR_RUN=0 is not (the person can force the ding back)", isPirSession({ PIR_RUN: "0" }) === false);
ok("empty PIR_RUN is not", isPirSession({ PIR_RUN: "" }) === false);
ok("no PIR_RUN is not", isPirSession({ HOME: "/h" }) === false);
ok("null / undefined env is not", isPirSession(null) === false && isPirSession(undefined) === false);
ok("PARALLEL_LIVE alone is not the marker", isPirSession({ PARALLEL_LIVE: "1" }) === false);

// --- decideSound: the whole rule --------------------------------------------
ok("the person's own session dings", decideSound({ HOME: "/h" }).play === true);
ok("a pir session is SILENT", decideSound({ PIR_RUN: "1" }).play === false);
ok("a pir build-run session is SILENT",
   decideSound({ PIR_RUN: "1", PARALLEL_LIVE: "1" }).play === false);
ok("no env at all dings (fail toward the ding)", decideSound(undefined).play === true);

// --- registerIn / unregisterIn: settings.json safety ------------------------
const CMD = "/repo/bin/cockpit-stop-notify.mjs";
const stopCmds = (s) => (s.hooks?.Stop ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);

// Superseding the legacy unconditional afplay.
{
  const legacy = { hooks: { Stop: [{ hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff", async: true }] }] } };
  const { settings, replaced } = registerIn(legacy, CMD);
  ok("install removes the legacy afplay Glass line", !stopCmds(settings).includes("afplay /System/Library/Sounds/Glass.aiff"));
  ok("install adds our script", stopCmds(settings).includes(CMD));
  ok("install reports it replaced something", replaced === true);
  ok("our entry keeps async:true", settings.hooks.Stop.at(-1).hooks[0].async === true);
}

// Other people's Stop hooks are left alone.
{
  const other = { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
  const { settings } = registerIn(other, CMD);
  ok("a foreign Stop hook survives install", stopCmds(settings).includes("say done"));
  ok("...and ours is added beside it", stopCmds(settings).includes(CMD));
}

// Re-pointing a moved checkout: drop the old path, add the new, no duplicate.
{
  const old = { hooks: { Stop: [{ hooks: [{ type: "command", command: "/old/bin/cockpit-stop-notify.mjs", async: true }] }] } };
  const { settings } = registerIn(old, CMD);
  const mine = stopCmds(settings).filter((c) => c.endsWith("cockpit-stop-notify.mjs"));
  ok("a moved checkout is re-pointed, not duplicated", mine.length === 1 && mine[0] === CMD);
}

// Idempotence: installing twice changes nothing the second time.
{
  const once = registerIn({}, CMD).settings;
  const twice = registerIn(once, CMD).settings;
  ok("install is idempotent", JSON.stringify(once) === JSON.stringify(twice));
}

// Nothing else in settings is disturbed.
{
  const full = { model: "m", hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "/x/cockpit-auto-name.mjs" }] }] } };
  const { settings } = registerIn(full, CMD);
  ok("unrelated settings survive install", settings.model === "m");
  ok("a UserPromptSubmit hook is untouched",
     settings.hooks.UserPromptSubmit[0].hooks[0].command === "/x/cockpit-auto-name.mjs");
}

// Uninstall removes only ours.
{
  const mixed = { hooks: { Stop: [{ hooks: [
    { type: "command", command: CMD, async: true },
    { type: "command", command: "say done" },
  ] }] } };
  const { settings, removed } = unregisterIn(mixed);
  ok("uninstall removes ours", !stopCmds(settings).includes(CMD));
  ok("uninstall keeps the foreign hook", stopCmds(settings).includes("say done"));
  ok("uninstall reports it removed something", removed === true);
}
{
  const { removed } = unregisterIn({ hooks: { Stop: [{ hooks: [{ command: "say hi" }] }] } });
  ok("uninstall on a settings without ours removes nothing", removed === false);
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
