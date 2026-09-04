// The four BitBucket settings, held by the same `config` command that already
// keeps the Anthropic key. The generalized store (readSetting/settingStatus) is
// imported and driven directly; the command's behaviour -- masking a secret on
// the read path, showing a plain value in full, a non-zero exit for an unknown
// setting, the 0600 file it leaves on disk -- is exercised by spawning the real
// script, since that is what an agent inheriting the cockpit PATH would run.
//
// Every case runs against its OWN throwaway dir, so one can never see another's
// value, and none touches the real ~/.claude/cockpit. (The existing Anthropic-key
// tests live in spikes/auto-name-test/config.test.mjs; those stay the record that
// the old behaviour is unchanged.)

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { readSetting, settingStatus } from "../../bin/cockpit-config.mjs";
import { ok, eq, section, done } from "./harness.mjs";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const CMD = join(ROOT, "bin", "cockpit-config.mjs");
const T = mkdtempSync(join(process.env.COCKPIT_DIR || tmpdir(), "bb-config-"));

let seq = 0;
const freshDir = () => {
  const d = join(T, `d${++seq}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// Run the command against a given dir. Returns { out, code }; never throws, so a
// refusal (non-zero exit) is assertable rather than an exception.
function config(dir, args) {
  try {
    const out = execFileSync("node", [CMD, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, COCKPIT_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

// The four new settings and whether each is a masked secret. Kept beside the test
// so a change to the policy in cockpit-config.mjs that is not mirrored here fails
// loudly.
const NEW = [
  { name: "bitbucket-key",       secret: true,  sample: "me@example.com:abc123TOKEN9876" },
  { name: "bitbucket-workspace", secret: false, sample: "acme-workspace" },
  { name: "bitbucket-repos",     secret: false, sample: "web,api,infra" },
  { name: "bitbucket-team",      secret: false, sample: "alice,bob" },
];

section("set / read / --unset round-trips");
for (const { name, secret, sample } of NEW) {
  const d = freshDir();

  // Absent first.
  eq(`${name}: absent reads null`, readSetting(name, d), null);
  eq(`${name}: absent status is 'not set'`, settingStatus(name, d), "not set");

  // Set, then read back.
  config(d, [name, sample]);
  eq(`${name}: readSetting returns the exact value`, readSetting(name, d), sample);

  if (secret) {
    const status = settingStatus(name, d);
    ok(`${name}: a secret reads masked`, /^set · …/.test(status), status);
    ok(`${name}: ...never the raw value`, !status.includes(sample), status);
  } else {
    eq(`${name}: a plain value reads back in full`, settingStatus(name, d), sample);
  }

  // Unset removes it.
  const r = config(d, [name, "--unset"]);
  eq(`${name}: --unset exits 0`, r.code, 0);
  ok(`${name}: ...removes the file`, !existsSync(join(d, name)));
  eq(`${name}: ...so a following read is null`, readSetting(name, d), null);
}

section("a value with spaces or a colon survives");
{
  // The credential is email:token and may itself carry punctuation; a team list
  // could be pasted with a space. rest.join(" ") in the command must round-trip.
  const d = freshDir();
  config(d, ["bitbucket-team", "alice, bob"]);
  eq("a space in the value round-trips", readSetting("bitbucket-team", d), "alice, bob");

  const d2 = freshDir();
  const cred = "me@example.com:tok:with:colons";
  config(d2, ["bitbucket-key", cred]);
  eq("a colon in a secret round-trips", readSetting("bitbucket-key", d2), cred);
}

section("files are written 0600 and atomically");
for (const { name, sample } of NEW) {
  const d = freshDir();
  config(d, [name, sample]);
  const p = join(d, name);
  eq(`${name}: mode is 0600`, statSync(p).mode & 0o777, 0o600);
  ok(`${name}: no temp file left behind (the rename was atomic)`, !existsSync(`${p}.tmp`));
}

section("bare `config` lists all five settings with the right status");
{
  const d = freshDir();
  config(d, ["anthropic-api-key", "sk-ant-EXAMPLE1234"]);
  config(d, ["bitbucket-key", "me@example.com:secretTOKEN99"]);
  config(d, ["bitbucket-workspace", "acme-workspace"]);
  config(d, ["bitbucket-repos", "web,api"]);
  // bitbucket-team left unset on purpose, to see a 'not set' among the rows.

  const list = config(d, []).out;
  for (const name of ["anthropic-api-key", "bitbucket-key", "bitbucket-workspace", "bitbucket-repos", "bitbucket-team"]) {
    ok(`list names ${name}`, list.includes(name), list);
  }
  ok("the secret bitbucket-key is masked in the list", list.includes("set · …") && !list.includes("secretTOKEN99"), list);
  ok("the plain workspace is shown in full", list.includes("acme-workspace"), list);
  ok("the plain repos are shown in full", list.includes("web,api"), list);
  ok("the unset team reads 'not set'", /bitbucket-team\s+not set/.test(list), list);
}

section("an unknown setting is refused with the known list");
{
  const d = freshDir();
  const r = config(d, ["bitbucket-nonsense"]);
  ok("unknown setting exits non-zero", r.code !== 0, String(r.code));
  ok("...names the setting it did not know", r.out.includes("bitbucket-nonsense"), r.out.trim());
  ok("...and lists the known settings", r.out.includes("bitbucket-key") && r.out.includes("anthropic-api-key"), r.out.trim());
}

section("a secret's read path never prints the value");
{
  const d = freshDir();
  const cred = "me@example.com:doNotPrintThisTOKEN";
  config(d, ["bitbucket-key", cred]);
  const readOut = config(d, ["bitbucket-key"]).out;
  ok("bare read shows a masked status", /^set · …/.test(readOut.trim()), readOut.trim());
  ok("...and never the credential", !readOut.includes(cred), readOut.trim());
}

section("a plain setting's read path shows it in full");
{
  const d = freshDir();
  config(d, ["bitbucket-workspace", "acme-workspace"]);
  eq("bare read of a plain setting is the value", config(d, ["bitbucket-workspace"]).out.trim(), "acme-workspace");
}

done();
