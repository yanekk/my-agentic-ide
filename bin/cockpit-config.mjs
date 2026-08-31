#!/usr/bin/env node
// config — set, read and clear the cockpit's own settings, git-config style.
//
// Today it holds one setting: the Anthropic API key the session-namer uses to
// ask Haiku for a topic label. Setting it by hand-editing a file is error-prone,
// so this is the front door.
//
// Reachable ONLY from inside the cockpit, exactly like `note` and `agenda`:
// bin/cockpit-layout.sh symlinks this to ~/.claude/cockpit/bin/config and puts
// that directory on PATH for the shells it spawns. Outside a cockpit window
// `config` simply is not a command. Its cockpit-only-ness is that PATH placement
// and nothing else -- there is no COCKPIT_REPO runtime guard, both because this
// file must import nothing outside node:* (run.sh checks it) and because the
// property is verified as a live-cockpit fact in T04, not asserted here.
//
//   config                              list every setting and its masked status
//   config anthropic-api-key            print "set · …1234" or "not set" -- never the key
//   config anthropic-api-key <key>      write it (0600, atomic)
//   config anthropic-api-key --unset    remove it; naming returns to today's behaviour
//
// The read path is masked because the agents inherit the cockpit PATH and so have
// this command too: it must never become a way to print the secret (DESIGN 2.7).

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, chmodSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// COCKPIT_DIR override matches the hook, so a test can point both at a throwaway
// dir; otherwise the shared cockpit state directory.
const DIR = process.env.COCKPIT_DIR || join(homedir(), ".claude", "cockpit");

// The one setting there is, mapped to its file. Adding a setting is adding a row.
// The key lives in its OWN file (not session state, not a shared config JSON) so
// an unrelated corruption or an --unset cannot cost anything else, mirroring the
// agenda client secret being kept apart (DESIGN 3.5, decision in §7).
const SETTINGS = {
  "anthropic-api-key": "anthropic-api-key",
};

const die = (msg) => { console.error(`config: ${msg}`); process.exit(1); };

// --- the store: read / write / clear / mask --------------------------------

const keyPath = (dir) => join(dir, "anthropic-api-key");

/**
 * The raw key, or null if the file is absent or holds only whitespace. This is
 * the ONE function that returns the secret; it is for the hook and the tests,
 * never for the command's own read path (which masks). Trimming means a
 * hand-appended newline does not become part of the key -- API keys carry no
 * surrounding whitespace, so this only ever removes noise.
 *
 * DESIGN 3.2: the hook does NOT import this module -- a relative import would
 * trip its "imports nothing outside node:*" boundary check -- so it reads the
 * same file directly. The export here is the tested reference for that read.
 */
export function readApiKey(dir = DIR) {
  try {
    const raw = readFileSync(keyPath(dir), "utf8").trim();
    return raw || null;
  } catch {
    return null;                        // absent, unreadable: the feature is off
  }
}

/**
 * "set · …1234" or "not set". Never the whole key. The revealed tail is the last
 * four characters, but capped at one fewer than the key's length so a key of four
 * characters or fewer cannot be shown in full -- for a 2-char key that is one
 * character, for a 1-char key none at all.
 */
export function maskedStatus(dir = DIR) {
  const key = readApiKey(dir);
  if (!key) return "not set";
  const n = Math.min(4, key.length - 1);
  return `set · …${n > 0 ? key.slice(-n) : ""}`;
}

/**
 * Write atomically (temp then rename) at mode 0600, creating DIR if missing. The
 * rename is atomic, so a read that races a write sees the whole old key or the
 * whole new one, never a torn file (DESIGN 2.n); a crash mid-write leaves the old
 * key intact. chmod is applied explicitly because writeFileSync's mode is masked
 * by the process umask, so the {mode} alone does not guarantee 0600.
 */
function writeApiKey(dir, key) {
  mkdirSync(dir, { recursive: true });
  const p = keyPath(dir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, key, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, p);
}

function unsetApiKey(dir) {
  try { unlinkSync(keyPath(dir)); } catch { /* already absent: --unset is idempotent */ }
}

// --- the command -----------------------------------------------------------

const USAGE = `config — the cockpit's own settings.

  config                              list every setting and its masked status
  config anthropic-api-key            show whether the key is set (masked)
  config anthropic-api-key <key>      set it
  config anthropic-api-key --unset    remove it

Settings live in ~/.claude/cockpit, owner-only, and never in the repo. The read
path only ever shows a masked status -- it is never a way to print the key.`;

function listAll() {
  for (const name of Object.keys(SETTINGS)) {
    console.log(`${name}  ${maskedStatus(DIR)}`);
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

  // Only one setting so far, so the value handling is inline; a second would fan
  // out on `name` here.
  if (rest.length === 0) {
    console.log(maskedStatus(DIR));
  } else if (rest[0] === "--unset") {
    unsetApiKey(DIR);
    console.log(`${name} unset`);
  } else {
    writeApiKey(DIR, rest.join(" "));
    console.log(`${name} ${maskedStatus(DIR)}`);
  }
}

// Run the command only when invoked directly -- as the script or through the
// `config` PATH symlink, which realpath resolves back to this same file -- never
// when a test imports readApiKey/maskedStatus. Without this, importing the module
// would run the CLI (and exit) at import time.
function isEntrypoint() {
  try {
    return !!process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) main();
