import { homedir } from "os";
import { isAbsolute, relative, resolve } from "path";

/**
 * Detects interpreter invocations that execute code passed on the command
 * line, including clustered short flags (`-pe`, `-cCODE`) that a plain
 * `args.includes("-e")` check misses.
 */
export function isInlineInterpreterCommand(command: string, args: string[]): boolean {
  if (command === "node" || command === "bun" || command === "deno") {
    return args.some((arg) => {
      const flag = arg.split("=")[0];
      return flag === "--eval" || flag === "--print" || /^-[a-z]*[ep][a-z]*$/.test(flag) || (command !== "node" && arg === "eval");
    });
  }
  if (command === "python" || command === "python3") {
    return args.some((arg) => {
      if (!/^-[a-z]/i.test(arg)) return false;
      for (const flag of arg.slice(1)) {
        if (flag === "c") return true;
        if (flag === "m" || flag === "W" || flag === "w" || flag === "X") return false;
      }
      return false;
    });
  }
  if (command === "ruby" || command === "perl") {
    return args.some((arg) => /^-[a-z]*e/i.test(arg) && !arg.startsWith("--"));
  }
  return false;
}

// Commands that only read workspace state and cannot spawn other programs
// with the argument restrictions below. Anything else needs user confirmation.
const READ_ONLY_COMMANDS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "find",
  "tree", "stat", "file", "du", "echo", "which", "date", "uname", "diff", "sleep", "git"
]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "blame"]);
const READ_ONLY_GIT_BRANCH_ARGS = new Set(["--list", "-a", "--all", "-r", "--remotes", "--show-current", "-v", "-vv"]);
const FIND_ACTION_ARGS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);
const GIT_UNSAFE_ARGS = ["--output", "--ext-diff", "--textconv", "--exec", "--upload-pack", "--receive-pack", "--config-env"];

function isPathInside(rootDir: string, candidatePath: string) {
  const rel = relative(rootDir, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function referencesPathOutsideWorkspace(rootDir: string, cwd: string, args: string[]): boolean {
  return args.some((arg) => {
    const value = arg.startsWith("-") && arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : arg;
    if (!value || (value.startsWith("-") && !value.includes("/"))) return false;
    const looksLikePath = value.startsWith("/") || value.startsWith("~") || /(^|[\\/])\.\.([\\/]|$)/.test(value) || /^[a-z]:[\\/]/i.test(value);
    if (!looksLikePath) return false;
    const expanded = value.startsWith("~") ? resolve(homedir(), value.slice(1).replace(/^[\\/]+/, "")) : resolve(cwd, value);
    return !isPathInside(rootDir, expanded);
  });
}

/**
 * True when a command may run without asking the user: a read-only tool whose
 * arguments cannot trigger execution or reference files outside the workspace.
 */
export function isAutoApprovedWorkspaceCommand(params: {
  command: string;
  args: string[];
  rootDir: string;
  cwd?: string;
}): boolean {
  if (/[\\/]/.test(params.command)) return false;
  const command = params.command.toLowerCase();
  if (!READ_ONLY_COMMANDS.has(command)) return false;
  const args = params.args.map((item) => String(item || "").trim()).filter(Boolean);
  const lowerArgs = args.map((arg) => arg.toLowerCase());
  const rootDir = resolve(params.rootDir);
  const cwd = resolve(rootDir, params.cwd || ".");
  if (!isPathInside(rootDir, cwd)) return false;

  if (command === "find" && lowerArgs.some((arg) => FIND_ACTION_ARGS.has(arg))) return false;
  if (command === "rg" && lowerArgs.some((arg) => arg.startsWith("--pre"))) return false;
  if (command === "git") {
    const subcommand = lowerArgs[0] || "";
    if (subcommand === "branch") {
      if (!lowerArgs.slice(1).every((arg) => READ_ONLY_GIT_BRANCH_ARGS.has(arg))) return false;
    } else if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return false;
    }
    if (lowerArgs.some((arg) => GIT_UNSAFE_ARGS.some((unsafe) => arg === unsafe || arg.startsWith(`${unsafe}=`)))) return false;
  }
  return !referencesPathOutsideWorkspace(rootDir, cwd, args);
}

/** Workspace edits may not touch git metadata, where hooks and config can run code. */
export function isProtectedWorkspaceMetadataPath(rootDir: string, absolutePath: string): boolean {
  const rel = relative(resolve(rootDir), absolutePath);
  return rel.split(/[\\/]+/).some((segment) => segment.toLowerCase() === ".git");
}

const STRIPPED_CHILD_ENV_KEYS = ["SLV_BASIC_AUTH"];

export function buildWorkspaceCommandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of STRIPPED_CHILD_ENV_KEYS) delete next[key];
  return next;
}
