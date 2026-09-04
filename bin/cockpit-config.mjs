#!/usr/bin/env node
// config — set, read and clear the cockpit's own settings, git-config style.
//
// It holds two kinds of setting: masked SECRETS (the Anthropic API key the
// session-namer uses, and the BitBucket credential) and plain SHOWN values (the
// BitBucket workspace, repo list and team). A secret's read path only ever shows
// a masked status; a plain value is shown in full so you can see what is set.
// Setting any of them by hand-editing a file is error-prone, so this is the front
// door.
//
// Reachable ONLY from inside the cockpit, exactly like `note` and `agenda`:
// bin/cockpit-layout.sh symlinks this to ~/.claude/cockpit/bin/config and puts
// that directory on PATH for the shells it spawns. Outside a cockpit window
// `config` simply is not a command. Its cockpit-only-ness is that PATH placement
// and nothing else -- there is no COCKPIT_REPO runtime guard, both because this
// file must import nothing outside node:* (run.sh checks it) and because the
// property is verified as a live-cockpit fact in T04, not asserted here.
//
//   config                              list every setting and its status
//   config <setting>                    show it (secrets masked, plain values in full)
//   config <setting> <value>            write it (0600, atomic)
//   config <setting> --unset            remove it
//
// A secret's read path is masked because the agents inherit the cockpit PATH and
// so have this command too: it must never become a way to print the secret
// (DESIGN 2.7, and bitbucket-dashboard DESIGN 2.6).

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, chmodSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// COCKPIT_DIR override matches the hook, so a test can point both at a throwaway
// dir; otherwise the shared cockpit state directory.
const DIR = process.env.COCKPIT_DIR || join(homedir(), ".claude", "cockpit");

// Every setting there is, mapped to its own file and its mask policy. Adding a
// setting is adding a row. Each key lives in its OWN file (not session state, not
// a shared config JSON) so an unrelated corruption or an --unset cannot cost
// anything else, mirroring the agenda client secret being kept apart (DESIGN 3.5,
// and bitbucket-dashboard DESIGN 3.5). `secret: true` masks on read; a plain
// setting shows its value in full.
const SETTINGS = {
  "anthropic-api-key":   { file: "anthropic-api-key",   secret: true  },
  "bitbucket-key":       { file: "bitbucket-key",       secret: true  },
  "bitbucket-workspace": { file: "bitbucket-workspace", secret: false },
  "bitbucket-repos":     { file: "bitbucket-repos",     secret: false },
  "bitbucket-team":      { file: "bitbucket-team",      secret: false },
};

const die = (msg) => { console.error(`config: ${msg}`); process.exit(1); };

// --- the store: read / write / clear / mask --------------------------------

const settingPath = (dir, name) => join(dir, SETTINGS[name].file);

/**
 * A setting's raw value, or null if the file is absent or holds only whitespace.
 * This is the ONE function that returns a secret in the clear; it is for the
 * store (T04) and the tests, never for the command's own read path (which masks a
 * secret). Trimming means a hand-appended newline does not become part of the
 * value -- keys and slugs carry no surrounding whitespace, so this only ever
 * removes noise. An unknown name has no value.
 */
export function readSetting(name, dir = DIR) {
  if (!(name in SETTINGS)) return null;
  try {
    const raw = readFileSync(settingPath(dir, name), "utf8").trim();
    return raw || null;
  } catch {
    return null;                        // absent, unreadable: the setting is off
  }
}

/**
 * The Anthropic key specifically, kept as a named export because it is the tested
 * reference the hook mirrors (DESIGN 3.2: the hook reads the same file directly
 * rather than importing this module, to keep its "imports nothing outside node:*"
 * boundary). A thin wrapper over readSetting so there is one read path.
 */
export function readApiKey(dir = DIR) {
  return readSetting("anthropic-api-key", dir);
}

/**
 * A secret's masked status: "set · …1234" or "not set". Never the whole value.
 * The revealed tail is the last four characters, but capped at one fewer than the
 * value's length so a value of four characters or fewer cannot be shown in full --
 * for a 2-char value that is one character, for a 1-char value none at all.
 */
function maskValue(value) {
  const n = Math.min(4, value.length - 1);
  return `set · …${n > 0 ? value.slice(-n) : ""}`;
}

/**
 * What the read path shows for a setting: a secret is masked, a plain value is
 * shown in full, and either kind reads "not set" when absent.
 */
export function settingStatus(name, dir = DIR) {
  const value = readSetting(name, dir);
  if (!value) return "not set";
  return SETTINGS[name].secret ? maskValue(value) : value;
}

/**
 * maskedStatus for the Anthropic key, kept as a named export for its existing
 * callers and tests. A secret, so this is always masked.
 */
export function maskedStatus(dir = DIR) {
  return settingStatus("anthropic-api-key", dir);
}

/**
 * Write atomically (temp then rename) at mode 0600, creating DIR if missing. The
 * rename is atomic, so a read that races a write sees the whole old value or the
 * whole new one, never a torn file; a crash mid-write leaves the old value intact.
 * chmod is applied explicitly because writeFileSync's mode is masked by the
 * process umask, so the {mode} alone does not guarantee 0600.
 */
function writeSetting(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  const p = settingPath(dir, name);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, value, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, p);
}

function unsetSetting(dir, name) {
  try { unlinkSync(settingPath(dir, name)); } catch { /* already absent: --unset is idempotent */ }
}

// --- the command -----------------------------------------------------------

// The settings block is generated from SETTINGS so the help can never drift out
// of sync with what actually exists.
const settingsHelp = Object.entries(SETTINGS)
  .map(([name, spec]) => `  ${name.padEnd(20)}${spec.secret ? "(secret, masked on read)" : "(shown in full)"}`)
  .join("\n");

const USAGE = `config — the cockpit's own settings.

  config                       list every setting and its status
  config <setting>             show a setting (secrets masked, plain values in full)
  config <setting> <value>     set it
  config <setting> --unset     remove it

Settings:
${settingsHelp}

Settings live in ~/.claude/cockpit, owner-only, and never in the repo. A secret's
read path only ever shows a masked status -- it is never a way to print the secret.`;

function listAll() {
  // Pad the name column so the statuses line up now that there are several.
  const width = Math.max(...Object.keys(SETTINGS).map((n) => n.length));
  for (const name of Object.keys(SETTINGS)) {
    console.log(`${name.padEnd(width)}  ${settingStatus(name, DIR)}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (["help", "-h", "--help"].includes(argv[0])) { console.log(USAGE); return; }

  const [name, ...rest] = argv;

  if (name === undefined) { listAll(); return; }

  if (!(name in SETTINGS)) {
    die(`unknown setting '${name}'. Known settings: ${Object.keys(SETTINGS).join(", ")}`);
  }

  if (rest.length === 0) {
    console.log(settingStatus(name, DIR));
  } else if (rest[0] === "--unset") {
    unsetSetting(DIR, name);
    console.log(`${name} unset`);
  } else {
    writeSetting(DIR, name, rest.join(" "));
    console.log(`${name} ${settingStatus(name, DIR)}`);
  }
}

// Run the command only when invoked directly -- as the script or through the
// `config` PATH symlink, which realpath resolves back to this same file -- never
// when a test imports the readers. Without this, importing the module would run
// the CLI (and exit) at import time.
function isEntrypoint() {
  try {
    return !!process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) main();
