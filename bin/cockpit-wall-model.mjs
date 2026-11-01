// cockpit-wall-model -- what a calendar agent is allowed to do, as data.
//
// PURE side of the boundary (calendar-agent-sandbox DESIGN 3.1): facts arrive as
// arguments, settings and verdicts leave as return values. The calendar description
// is deliberately not an input to anything here, which is the proof an entry cannot
// loosen the wall (DESIGN 3.2). spikes/calendar-jobs-test/run.sh greps this file; if
// that grep fails, MOVE THE CODE, never relax the grep.
//
// The shape of the settings is pinned by a test because it cannot fail loudly: a
// wrongly typed known field makes Claude drop the WHOLE --settings silently, exit 0,
// and the agent runs with no wall at all (DESIGN 7, T00 results).

export const DEFAULT_SITES = Object.freeze(["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"]);

export const SECRET_DIRS = Object.freeze(["~/.ssh", "~/.aws", "~/.claude/cockpit", "~/.config/gh", "~/Library/Keychains"]);
// Claude's own sign-in. Claude itself still reads these: the rules bind its tools.
export const SECRET_FILES = Object.freeze(["~/.claude/.credentials.json", "~/.claude.json"]);

// No rule for WebFetch or WebSearch: under dontAsk no allow rule refuses them.
const ALLOW = ["Bash", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep"];
// Each of these works with no allow rule, outside the sandbox (measured, T00), and
// each `deny` removes the tool. The worktree tools move the sandbox's `.` elsewhere.
const DENY_TOOLS = ["SendMessage", "RemoteTrigger", "ListAgents", "PushNotification", "CronCreate",
  "DesignSync", "Workflow", "EnterWorktree", "ExitWorktree"];

// A shared cache would let a poisoned package run later, outside the wall (DESIGN 2.6).
const CACHE_ENV = { npm_config_cache: "/tmp/claude/npm-cache", PIP_CACHE_DIR: "/tmp/claude/pip-cache" };

const expand = (p, home) => (p === "~" ? home : p.startsWith("~/") ? `${home}${p.slice(1)}` : p);
const tidy = (p) => p.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
const isInside = (p, dir) => p === dir || p.startsWith(`${dir}/`);
// The first one holds the other, either way round.
const overlaps = (a, b) => isInside(a, b) || isInside(b, a);
// APFS ignores case by default, so ~/.SSH is ~/.ssh and comparing bytes would open it.
const fold = (p) => p.toLowerCase();

function siteProblem(value) {
  if (typeof value !== "string") return "a site must be a host name";
  const site = value.toLowerCase();
  if (site === "*") return "a wildcard covering everything opens every site";
  // Two labels after a wildcard, so `*.com` cannot pass as a single site.
  if (!/^(?:\*\.[a-z0-9-]+\.|(?:[a-z0-9-]+\.))(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(site)) {
    return "a site must be a host name such as example.com, with no scheme or path";
  }
  const host = site.replace(/^\*\./, "");
  if (host === "github.com" || host.endsWith(".github.com")) return "GitHub stays closed, because the stored login could push";
  return null;
}

function folderProblem(value, home) {
  if (typeof value !== "string" || !value) return "a folder must be a path";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f*?[\]{}]/.test(value)) return "a folder cannot hold a wildcard or a control character";
  const path = tidy(expand(value, home));
  if (!path.startsWith("/")) return "a folder must be an absolute path";
  const parts = path.split("/");
  if (parts.includes("..") || parts.includes(".")) return "a folder cannot hold . or ..";
  const p = fold(path), h = fold(tidy(home));
  if (p === "/" || isInside(h, p)) return "that opens the whole home folder";
  if (parts.some((part) => fold(part) === ".git")) return "a .git folder changes how git behaves";
  if (isInside(p, fold(`${tidy(home)}/.claude`))) return "~/.claude holds Claude's own settings";
  for (const secret of [...SECRET_DIRS, ...SECRET_FILES]) {
    if (overlaps(p, fold(expand(secret, home)))) return `that opens ${secret}`;
  }
  return null;
}

/**
 * Whether an exception may exist at all. The remote and .git checks that need a
 * project's facts are made again in buildWallSettings, the only place that has them.
 */
export function validateException(kind, value, { home }) {
  let why;
  if (kind === "site") why = siteProblem(value);
  else if (kind === "write") why = folderProblem(value, home);
  else if (kind === "ports") why = typeof value === "boolean" ? null : "ports are on or off";
  else why = "no such kind of exception";
  return why ? { ok: false, why } : { ok: true };
}

// Either side may be a wildcard or a subdomain of the other. Bitbucket's API sits on
// a subdomain of the push host, so the exact name alone would leave a way to push.
function sameFamily(site, remote) {
  const a = site.toLowerCase().replace(/^\*\./, ""), b = String(remote).toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * The settings of one run. An exception that fails is dropped and reported, never
 * applied: the file can be edited by hand, so the command's refusal is not enough.
 */
export function buildWallSettings({ worktree, home, guardPath, commonDir, branches, remoteHosts, exceptions, userTemp }) {
  const dropped = [];
  const drop = (kind, value, why) => dropped.push({ kind, value: typeof value === "string" ? value : JSON.stringify(value), why });
  const list = (key, kind) => {
    const v = exceptions?.[key];
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    drop(kind, v, `${key} must be a list`);
    return [];
  };

  const sites = [...DEFAULT_SITES];
  for (const value of list("sites", "site")) {
    const check = validateException("site", value, { home });
    if (!check.ok) { drop("site", value, check.why); continue; }
    if ((remoteHosts ?? []).some((r) => sameFamily(value, r))) { drop("site", value, "that is where this project pushes"); continue; }
    const site = value.toLowerCase();
    if (!sites.includes(site)) sites.push(site);
  }

  // macOS mktemp uses this per-user folder and ignores TMPDIR, so without it every script's
  // `mktemp -d` is refused (measured, T07). Owner's choice; published in DESIGN 2.8.
  const allowWrite = typeof userTemp === "string" && userTemp.startsWith("/") ? [tidy(userTemp)] : [];
  const gitDir = fold(tidy(commonDir));
  for (const value of list("write", "write")) {
    const check = validateException("write", value, { home });
    if (!check.ok) { drop("write", value, check.why); continue; }
    const folder = tidy(expand(value, home));
    // A folder holding the repo holds its .git, whose hooks and config run outside the wall.
    if (overlaps(fold(folder), gitDir)) { drop("write", value, "that opens this project's .git"); continue; }
    if (!allowWrite.includes(folder)) allowWrite.push(folder);
  }

  const ports = exceptions?.localPorts;
  if (ports != null && typeof ports !== "boolean") drop("ports", ports, "ports are on or off");

  const refs = (branches ?? []).flatMap((b) => [`${commonDir}/refs/heads/${b}`, `${commonDir}/refs/heads/${b}.lock`]);

  return {
    settings: {
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        autoAllowBashIfSandboxed: true,
        network: { allowedDomains: sites, ...(ports === true ? { allowLocalBinding: true } : {}) },
        filesystem: {
          denyRead: [...SECRET_DIRS, ...SECRET_FILES].map((s) => expand(s, home)),
          denyWrite: [...refs, `${commonDir}/packed-refs`, `${commonDir}/packed-refs.lock`, `${commonDir}/HEAD`],
          ...(allowWrite.length ? { allowWrite } : {}),
        },
      },
      permissions: {
        allow: [...ALLOW],
        // `~/` on purpose: Read(/abs) means relative to the settings file and silently
        // matches nothing (measured).
        deny: [...SECRET_DIRS.map((d) => `Read(${d}/**)`), ...SECRET_FILES.map((f) => `Read(${f})`), ...DENY_TOOLS],
      },
      hooks: {
        PreToolUse: [{
          matcher: "Write|Edit|NotebookEdit",
          // `|| exit 2`: any other failure of a hook lets the write through (measured),
          // so a missing script or a missing node has to become a refusal here.
          hooks: [{ type: "command", command: `node ${shellQuote(guardPath)} --root ${shellQuote(worktree)} || exit 2` }],
        }],
      },
      env: { ...CACHE_ENV },
    },
    dropped,
  };
}
