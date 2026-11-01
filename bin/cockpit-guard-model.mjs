// cockpit-guard-model -- the rule of the write guard: may a file tool write here?
//
// PURE side of the boundary (calendar-agent-sandbox DESIGN 3.1, 3.3). The hook,
// cockpit-jobs-guard.mjs, resolves paths on disk and asks this file; it decides
// nothing itself. spikes/calendar-jobs-test/run.sh greps this file; if that grep
// fails, MOVE THE CODE, never relax the grep.
//
// Reasons name the rule and never the path or the tool's input: they go to stderr,
// and from there into the agent's context and any log.

// Which input field each tool writes to. By tool and not "whichever is present": a
// NotebookEdit carrying a harmless file_path beside a hostile notebook_path must be
// judged on the one it will use.
const PATH_FIELD = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };

const refuse = (reason) => ({ allow: false, reason });

export function pathFieldFor(toolName) {
  return Object.hasOwn(PATH_FIELD, toolName) ? PATH_FIELD[toolName] : null;
}

// A raw path the tool would read differently from the guard. Claude's file tools
// expand `~` and trim whitespace; to the guard both are an ordinary relative name
// inside the root, so `~/.zshrc` would be judged as {root}/~/.zshrc and written to
// the home folder. Returns the reason, or null when the path is fine to resolve.
export function rawPathRefusal(rawPath) {
  if (typeof rawPath !== "string" || rawPath === "") return "no path to check";
  if (rawPath.includes("\0")) return "a path with a NUL byte is refused";
  if (rawPath !== rawPath.trim()) return "a path with surrounding whitespace is refused";
  if (rawPath.startsWith("~")) return "a path starting with ~ is refused";
  return null;
}

// A resolved path has no `.`, `..` or empty pieces. One that does was not resolved,
// and the prefix comparison below would be meaningless on it.
function isResolved(p) {
  if (typeof p !== "string" || !p.startsWith("/")) return false;
  if (p === "/") return true;
  return p.slice(1).split("/").every((c) => c !== "" && c !== "." && c !== "..");
}

export function guardVerdict({ root, resolvedPath, toolName }) {
  if (!pathFieldFor(toolName)) return refuse("not a file tool the guard knows");
  if (!resolvedPath) return refuse("no path to check");
  if (!isResolved(root) || root === "/") return refuse("no usable worktree root");
  if (!isResolved(resolvedPath)) return refuse("the path could not be resolved");

  // The separator matters: /a/wt2 starts with /a/wt.
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}/`)) {
    return refuse("writes outside the worktree are refused");
  }

  // Lower-cased because macOS file systems are case-insensitive: .GIT/hooks/x is
  // .git/hooks/x. At any depth, because a nested repository's .git behaves the same.
  const parts = resolvedPath.slice(root.length + 1).toLowerCase().split("/");
  if (parts.includes(".git")) return refuse("writes into .git are refused");
  for (let i = 0; i + 1 < parts.length; i++) {
    if (parts[i] === ".claude" && parts[i + 1].startsWith("settings")) {
      return refuse("writes to .claude/settings are refused");
    }
  }
  return { allow: true, reason: "inside the worktree" };
}
