import { spawn } from "child_process";
import { existsSync, realpathSync } from "fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "path";

export interface WorkspaceToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface PreparedWorkspaceTools {
  rootDir: string;
  tools: WorkspaceToolDefinition[];
  executeToolCall: (callName: string, rawArgs: string | undefined, signal?: AbortSignal) => Promise<{
    modelText: string;
    traceText: string;
  }>;
  close: () => Promise<void>;
}

export interface WorkspaceToolsOptions {
  includeFileTools?: boolean;
  includeCommandTool?: boolean;
  securityPolicy?: WorkspaceToolSecurityPolicy;
}

type ToolResult = { modelText: string; traceText: string };

export interface WorkspaceToolSecurityPolicy {
  allowDangerousFileOps?: boolean;
  allowNetworkCommands?: boolean;
  allowShellCommands?: boolean;
  allowGitWriteCommands?: boolean;
}

export type WorkspaceCommandRiskCategory =
  | "system_admin"
  | "shell_escape"
  | "network"
  | "git_write"
  | "file_mutation";

const MAX_LIST_RESULTS = 200;
const MAX_SEARCH_RESULTS = 80;
const MAX_FILE_CHARS = 120_000;
const MAX_WRITE_CHARS = 160_000;
const MAX_LINE_WINDOW = 400;
const MAX_MULTI_EDIT_OPERATIONS = 16;
const MAX_COMMAND_OUTPUT_CHARS = 40_000;
const BINARY_SAMPLE_BYTES = 4096;
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  "coverage",
  ".next",
  ".turbo"
]);
const ALWAYS_BLOCKED_COMMANDS = new Set([
  "sudo",
  "su",
  "doas",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "diskutil",
  "launchctl",
  "mkfs",
  "mount",
  "umount"
]);
const NETWORK_COMMANDS = new Set([
  "curl",
  "wget",
  "ssh",
  "scp",
  "sftp",
  "nc",
  "ncat",
  "netcat",
  "ping",
  "ftp",
  "telnet",
  "nmap"
]);
const SHELL_COMMANDS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash"
]);
const FILE_MUTATION_COMMANDS = new Set([
  "rm",
  "mv",
  "cp",
  "chmod",
  "chown",
  "ln",
  "mkdir",
  "rmdir",
  "touch",
  "truncate",
  "dd",
  "install",
  "tee"
]);
const GIT_WRITE_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "fetch",
  "merge",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "submodule",
  "switch",
  "tag"
]);

const WORKSPACE_TOOL_DEFINITIONS: WorkspaceToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "workspace_list_files",
      description: "List files and folders inside the current workspace. Use this before reading an unfamiliar area.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory inside the workspace. Defaults to the root." },
          depth: { type: "integer", minimum: 0, maximum: 8, description: "How deep to recurse. Defaults to 3." },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIST_RESULTS, description: `Maximum entries to return. Defaults to 80.` },
          includeHidden: { type: "boolean", description: "Include dotfiles and dot-directories. Defaults to false." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_stat_path",
      description: "Inspect one workspace path and return its type, size, timestamps, and normalized relative path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file or directory path inside the workspace." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_read_file",
      description: "Read UTF-8 text from a file in the current workspace and return numbered lines.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file to read." },
          startLine: { type: "integer", minimum: 1, description: "1-based start line. Defaults to 1." },
          endLine: { type: "integer", minimum: 1, description: "1-based end line. Defaults to startLine + 199." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_search_text",
      description: "Search for plain text across workspace files and return matching paths, line numbers, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Plain text to search for." },
          path: { type: "string", description: "Optional relative subdirectory to search in." },
          limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS, description: "Maximum matches to return. Defaults to 20." },
          includeHidden: { type: "boolean", description: "Include dotfiles and dot-directories. Defaults to false." },
          caseSensitive: { type: "boolean", description: "Whether to treat the query as case-sensitive. Defaults to false." }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_write_file",
      description: "Write UTF-8 text to a workspace file. Use for new files or full rewrites. Creates parent directories automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path to write." },
          content: { type: "string", description: "Full UTF-8 content to write." },
          mode: { type: "string", enum: ["overwrite", "append", "create"], description: "overwrite replaces the file, append adds to the end, create fails if the file already exists." }
        },
        required: ["path", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_make_directory",
      description: "Create one directory or a nested directory path inside the current workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path to create." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_move_path",
      description: "Move or rename a file or directory inside the current workspace.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Existing relative path inside the workspace." },
          to: { type: "string", description: "Destination relative path inside the workspace." },
          overwrite: { type: "boolean", description: "Allow replacing an existing destination. Defaults to false." }
        },
        required: ["from", "to"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_delete_path",
      description: "Delete a file or directory inside the current workspace. Use carefully and only when deletion is explicitly needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to remove." },
          recursive: { type: "boolean", description: "Allow deleting directories recursively. Defaults to false." }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_multi_edit",
      description: "Apply multiple exact text edits to one UTF-8 file in a single call. Prefer this over full rewrites for grouped changes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path to update." },
          edits: {
            type: "array",
            maxItems: MAX_MULTI_EDIT_OPERATIONS,
            description: "Ordered exact replacements to apply sequentially.",
            items: {
              type: "object",
              properties: {
                search: { type: "string", description: "Exact text to find." },
                replace: { type: "string", description: "Replacement text." },
                replaceAll: { type: "boolean", description: "Replace every exact match instead of only the first one. Defaults to false." }
              },
              required: ["search", "replace"],
              additionalProperties: false
            }
          }
        },
        required: ["path", "edits"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_insert_text",
      description: "Insert text into a UTF-8 workspace file before or after an exact anchor, or at a 1-based line number.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path to update." },
          text: { type: "string", description: "Text to insert." },
          before: { type: "string", description: "Insert immediately before this exact anchor text." },
          after: { type: "string", description: "Insert immediately after this exact anchor text." },
          atLine: { type: "integer", minimum: 1, description: "Insert before this 1-based line number. Use one line past the end to append." }
        },
        required: ["path", "text"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_replace_text",
      description: "Replace exact text inside a UTF-8 workspace file. Prefer this for targeted edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path to update." },
          search: { type: "string", description: "Exact text to find." },
          replace: { type: "string", description: "Replacement text." },
          replaceAll: { type: "boolean", description: "Replace every exact match instead of only the first one. Defaults to false." }
        },
        required: ["path", "search", "replace"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_git_status",
      description: "Return a compact git status for the current workspace or a relative subdirectory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative path inside the workspace. Defaults to the workspace root." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_git_diff",
      description: "Return a compact git diff for the current workspace or one relative file/path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative path to diff." },
          staged: { type: "boolean", description: "Show staged diff instead of working tree diff. Defaults to false." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_run_command",
      description: "Run a command inside the current workspace without a shell. Use this for tests, builds, linters, and structured inspection commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Executable to run, for example node, npm, pnpm, rg, git, or pytest." },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Arguments passed directly to the executable. No shell expansion is applied."
          },
          cwd: { type: "string", description: "Optional relative working directory inside the workspace." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, description: "Optional timeout in milliseconds. Defaults to 20000." },
          input: { type: "string", description: "Optional stdin to write to the command before closing stdin." }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  }
];

function sanitizeText(raw: unknown, maxLength: number) {
  return String(raw ?? "").trim().slice(0, maxLength);
}

function parseArgs(rawArgs: string | undefined): Record<string, unknown> {
  if (!rawArgs || !rawArgs.trim()) return {};
  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall back to empty arguments on malformed tool payloads.
  }
  return {};
}

function normalizeCount(raw: unknown, fallback: number, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeBoolean(raw: unknown, fallback = false) {
  return typeof raw === "boolean" ? raw : fallback;
}

function normalizeStringArray(raw: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item ?? "").slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSecurityPolicy(raw: WorkspaceToolSecurityPolicy | undefined): Required<WorkspaceToolSecurityPolicy> {
  return {
    allowDangerousFileOps: raw?.allowDangerousFileOps === true,
    allowNetworkCommands: raw?.allowNetworkCommands === true,
    allowShellCommands: raw?.allowShellCommands === true,
    allowGitWriteCommands: raw?.allowGitWriteCommands === true
  };
}

function formatWorkspacePath(rootDir: string, absolutePath: string) {
  const relativePath = relative(rootDir, absolutePath).split("\\").join("/");
  return relativePath || ".";
}

function isPathInside(rootDir: string, candidatePath: string) {
  const rel = relative(rootDir, candidatePath);
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !isAbsolute(rel));
}

function realpathOrResolved(targetPath: string) {
  try {
    return realpathSync.native(targetPath);
  } catch {
    return resolve(targetPath);
  }
}

function nearestExistingPath(targetPath: string) {
  let current = resolve(targetPath);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function ensureInsideWorkspace(rootDir: string, targetPath: string) {
  const normalizedRoot = resolve(rootDir);
  const candidate = resolve(isAbsolute(targetPath) ? targetPath : resolve(normalizedRoot, targetPath));
  if (!isPathInside(normalizedRoot, candidate)) {
    throw new Error("Path escapes the workspace root");
  }

  const realRoot = realpathOrResolved(normalizedRoot);
  const realExisting = realpathOrResolved(nearestExistingPath(candidate));
  if (!isPathInside(realRoot, realExisting)) {
    throw new Error("Path escapes the workspace root");
  }
  return candidate;
}

async function assertTextFile(filePath: string) {
  const handle = await readFile(filePath);
  const sample = handle.subarray(0, BINARY_SAMPLE_BYTES);
  if (sample.includes(0)) {
    throw new Error("Binary files are not supported by workspace text tools");
  }
}

function countExactMatches(content: string, search: string) {
  if (!search) return 0;
  let matches = 0;
  let offset = 0;
  while (offset <= content.length) {
    const index = content.indexOf(search, offset);
    if (index < 0) break;
    matches += 1;
    offset = index + Math.max(1, search.length);
  }
  return matches;
}

function describeBlockedCommand(params: {
  command: string;
  args: string[];
  policy: Required<WorkspaceToolSecurityPolicy>;
}) {
  const normalizedCommand = basename(params.command || "").toLowerCase();
  const args = params.args.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  const firstArg = args[0] || "";

  if (ALWAYS_BLOCKED_COMMANDS.has(normalizedCommand)) {
    return `Command "${normalizedCommand}" is blocked by agent security policy.`;
  }
  if (!params.policy.allowShellCommands && SHELL_COMMANDS.has(normalizedCommand)) {
    return `Shell commands like "${normalizedCommand}" are blocked unless shell escapes are explicitly enabled.`;
  }
  if (!params.policy.allowShellCommands) {
    if ((normalizedCommand === "node" && args.some((arg) => arg === "-e" || arg === "--eval"))
      || ((normalizedCommand === "python" || normalizedCommand === "python3") && args.includes("-c"))
      || (normalizedCommand === "ruby" && args.includes("-e"))
      || (normalizedCommand === "perl" && args.includes("-e"))) {
      return `Inline script execution for "${normalizedCommand}" is blocked unless shell-style commands are explicitly enabled.`;
    }
  }
  if (!params.policy.allowNetworkCommands) {
    if (NETWORK_COMMANDS.has(normalizedCommand)) {
      return `Network command "${normalizedCommand}" is blocked unless network access is explicitly enabled for Agents.`;
    }
    if ((normalizedCommand === "npm" || normalizedCommand === "pnpm" || normalizedCommand === "yarn" || normalizedCommand === "bun")
      && args.some((arg) => ["install", "add", "update", "upgrade", "dlx", "create"].includes(arg))) {
      return `Package manager network/install commands are blocked unless network access is explicitly enabled for Agents.`;
    }
    if ((normalizedCommand === "python" || normalizedCommand === "python3")
      && firstArg === "-m"
      && args[1] === "pip") {
      return "pip network/install commands are blocked unless network access is explicitly enabled for Agents.";
    }
    if (normalizedCommand === "git" && ["clone", "fetch", "pull", "push", "submodule", "ls-remote"].includes(firstArg)) {
      return `Git network command "${firstArg}" is blocked unless network access is explicitly enabled for Agents.`;
    }
  }
  if (!params.policy.allowGitWriteCommands && normalizedCommand === "git" && GIT_WRITE_SUBCOMMANDS.has(firstArg)) {
    return `Git write command "${firstArg}" is blocked unless git write commands are explicitly enabled for Agents.`;
  }
  if (!params.policy.allowDangerousFileOps) {
    if (FILE_MUTATION_COMMANDS.has(normalizedCommand)) {
      return `File-mutating command "${normalizedCommand}" is blocked unless destructive file operations are explicitly enabled for Agents.`;
    }
    if ((normalizedCommand === "sed" || normalizedCommand === "perl") && args.includes("-i")) {
      return `In-place mutation with "${normalizedCommand} -i" is blocked unless destructive file operations are explicitly enabled for Agents.`;
    }
  }
  return "";
}

export function describeBlockedWorkspaceCommand(params: {
  command: string;
  args: string[];
  policy: Required<WorkspaceToolSecurityPolicy>;
}) {
  return describeBlockedCommand(params);
}

export function classifyWorkspaceCommandRisk(params: {
  command: string;
  args: string[];
}): WorkspaceCommandRiskCategory | null {
  const normalizedCommand = basename(params.command || "").toLowerCase();
  const args = params.args.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  const firstArg = args[0] || "";

  if (ALWAYS_BLOCKED_COMMANDS.has(normalizedCommand)) {
    return "system_admin";
  }
  if (SHELL_COMMANDS.has(normalizedCommand)) {
    return "shell_escape";
  }
  if ((normalizedCommand === "node" && args.some((arg) => arg === "-e" || arg === "--eval"))
    || ((normalizedCommand === "python" || normalizedCommand === "python3") && args.includes("-c"))
    || (normalizedCommand === "ruby" && args.includes("-e"))
    || (normalizedCommand === "perl" && args.includes("-e"))) {
    return "shell_escape";
  }
  if (NETWORK_COMMANDS.has(normalizedCommand)) {
    return "network";
  }
  if ((normalizedCommand === "npm" || normalizedCommand === "pnpm" || normalizedCommand === "yarn" || normalizedCommand === "bun")
    && args.some((arg) => ["install", "add", "update", "upgrade", "dlx", "create"].includes(arg))) {
    return "network";
  }
  if ((normalizedCommand === "python" || normalizedCommand === "python3")
    && firstArg === "-m"
    && args[1] === "pip") {
    return "network";
  }
  if (normalizedCommand === "git") {
    if (GIT_WRITE_SUBCOMMANDS.has(firstArg)) return "git_write";
    if (["clone", "fetch", "pull", "push", "submodule", "ls-remote"].includes(firstArg)) return "network";
  }
  if (FILE_MUTATION_COMMANDS.has(normalizedCommand)) {
    return "file_mutation";
  }
  if ((normalizedCommand === "sed" || normalizedCommand === "perl") && args.includes("-i")) {
    return "file_mutation";
  }
  return null;
}

export function normalizeWorkspaceToolSecurityPolicy(raw: WorkspaceToolSecurityPolicy | undefined): Required<WorkspaceToolSecurityPolicy> {
  return normalizeSecurityPolicy(raw);
}

function normalizeEdits(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("workspace_multi_edit requires a non-empty edits array");
  }
  return raw.slice(0, MAX_MULTI_EDIT_OPERATIONS).map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Edit ${index + 1} must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const search = String(row.search ?? "");
    if (!search) {
      throw new Error(`Edit ${index + 1} requires search text`);
    }
    return {
      search,
      replace: String(row.replace ?? ""),
      replaceAll: normalizeBoolean(row.replaceAll, false)
    };
  });
}

function formatNumberedLines(content: string, startLine: number, endLine: number) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.max(safeStart, Math.min(lines.length, endLine));
  return lines
    .slice(safeStart - 1, safeEnd)
    .map((line, index) => `${String(safeStart + index).padStart(4, " ")} | ${line}`)
    .join("\n");
}

async function walkDirectory(params: {
  rootDir: string;
  absoluteDir: string;
  depth: number;
  includeHidden: boolean;
  limit: number;
  entries: string[];
}) {
  if (params.entries.length >= params.limit) return;
  const items = await readdir(params.absoluteDir, { withFileTypes: true });
  items.sort((a, b) => a.name.localeCompare(b.name));

  for (const item of items) {
    if (params.entries.length >= params.limit) return;
    if (!params.includeHidden && item.name.startsWith(".")) continue;
    if (item.isDirectory() && DEFAULT_IGNORED_DIRECTORIES.has(item.name)) continue;

    const absolutePath = resolve(params.absoluteDir, item.name);
    const relativePath = formatWorkspacePath(params.rootDir, absolutePath);
    params.entries.push(`${item.isDirectory() ? "dir " : "file"} ${relativePath}`);

    if (item.isDirectory() && params.depth > 0) {
      await walkDirectory({
        ...params,
        absoluteDir: absolutePath,
        depth: params.depth - 1
      });
    }
  }
}

async function listFiles(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400) || ".";
  const absoluteDir = ensureInsideWorkspace(rootDir, inputPath);
  const directoryStats = await stat(absoluteDir).catch(() => null);
  if (!directoryStats?.isDirectory()) {
    throw new Error("workspace_list_files expects a directory path");
  }
  const depth = normalizeCount(args.depth, 3, 0, 8);
  const limit = normalizeCount(args.limit, 80, 1, MAX_LIST_RESULTS);
  const includeHidden = normalizeBoolean(args.includeHidden, false);
  const entries: string[] = [];
  await walkDirectory({
    rootDir,
    absoluteDir,
    depth,
    includeHidden,
    limit,
    entries
  });
  const target = formatWorkspacePath(rootDir, absoluteDir);
  const header = `Workspace directory: ${target}\nReturned ${entries.length} entr${entries.length === 1 ? "y" : "ies"} (depth ${depth}).`;
  const body = entries.length > 0 ? entries.join("\n") : "No matching files or directories.";
  const text = `${header}\n${body}`.slice(0, MAX_FILE_CHARS);
  return {
    modelText: text,
    traceText: text
  };
}

async function statWorkspacePath(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_stat_path requires a path");
  const absolutePath = ensureInsideWorkspace(rootDir, inputPath);
  const pathStats = await stat(absolutePath).catch(() => null);
  if (!pathStats) {
    throw new Error("Path not found");
  }
  const relativePath = formatWorkspacePath(rootDir, absolutePath);
  const lines = [
    `Path: ${relativePath}`,
    `Type: ${pathStats.isDirectory() ? "directory" : pathStats.isFile() ? "file" : "other"}`,
    `Size: ${pathStats.size} bytes`,
    `Modified: ${pathStats.mtime.toISOString()}`,
    `Created: ${pathStats.birthtime.toISOString()}`
  ];
  const text = lines.join("\n");
  return {
    modelText: text,
    traceText: text
  };
}

async function readWorkspaceFile(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_read_file requires a path");
  const absoluteFile = ensureInsideWorkspace(rootDir, inputPath);
  const fileStats = await stat(absoluteFile).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("File not found");
  }
  await assertTextFile(absoluteFile);
  const startLine = normalizeCount(args.startLine, 1, 1, 1_000_000);
  const endLine = normalizeCount(args.endLine, startLine + 199, startLine, startLine + MAX_LINE_WINDOW - 1);
  const raw = await readFile(absoluteFile, "utf8");
  const capped = raw.slice(0, MAX_FILE_CHARS);
  const numbered = formatNumberedLines(capped, startLine, endLine);
  const relativePath = formatWorkspacePath(rootDir, absoluteFile);
  const text = [
    `File: ${relativePath}`,
    numbered || "Requested line range is empty."
  ].join("\n");
  return {
    modelText: text,
    traceText: text
  };
}

async function searchText(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const query = sanitizeText(args.query, 240);
  if (!query) throw new Error("workspace_search_text requires a query");
  const inputPath = sanitizeText(args.path, 400) || ".";
  const absoluteDir = ensureInsideWorkspace(rootDir, inputPath);
  const directoryStats = await stat(absoluteDir).catch(() => null);
  if (!directoryStats?.isDirectory()) {
    throw new Error("workspace_search_text expects a directory path");
  }
  const includeHidden = normalizeBoolean(args.includeHidden, false);
  const caseSensitive = normalizeBoolean(args.caseSensitive, false);
  const limit = normalizeCount(args.limit, 20, 1, MAX_SEARCH_RESULTS);
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: string[] = [];

  async function visit(directory: string) {
    if (matches.length >= limit) return;
    const items = await readdir(directory, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      if (matches.length >= limit) return;
      if (!includeHidden && item.name.startsWith(".")) continue;
      if (item.isDirectory() && DEFAULT_IGNORED_DIRECTORIES.has(item.name)) continue;
      const absolutePath = resolve(directory, item.name);
      if (item.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!item.isFile()) continue;
      try {
        const fileStats = await stat(absolutePath);
        if (fileStats.size > MAX_FILE_CHARS) continue;
        const buffer = await readFile(absolutePath);
        if (buffer.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) continue;
        const text = buffer.toString("utf8");
        const lines = text.replace(/\r\n?/g, "\n").split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
          if (!haystack.includes(needle)) continue;
          matches.push(`${formatWorkspacePath(rootDir, absolutePath)}:${index + 1}: ${lines[index].slice(0, 220)}`);
          if (matches.length >= limit) return;
        }
      } catch {
        // Ignore unreadable files and keep searching.
      }
    }
  }

  await visit(absoluteDir);
  const text = [
    `Query: ${query}`,
    matches.length > 0 ? matches.join("\n") : "No matches found."
  ].join("\n").slice(0, MAX_FILE_CHARS);
  return {
    modelText: text,
    traceText: text
  };
}

async function writeWorkspaceFile(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_write_file requires a path");
  if (!Object.prototype.hasOwnProperty.call(args, "content")) {
    throw new Error("workspace_write_file requires content");
  }
  const content = String(args.content ?? "");
  if (content.length > MAX_WRITE_CHARS) {
    throw new Error(`Content exceeds ${MAX_WRITE_CHARS} characters`);
  }
  const mode = sanitizeText(args.mode, 20) || "overwrite";
  if (mode !== "overwrite" && mode !== "append" && mode !== "create") {
    throw new Error("mode must be overwrite, append, or create");
  }
  const absoluteFile = ensureInsideWorkspace(rootDir, inputPath);
  await mkdir(dirname(absoluteFile), { recursive: true });
  const exists = await stat(absoluteFile).then((fileStats) => fileStats.isFile()).catch(() => false);
  if (mode === "create" && exists) {
    throw new Error("File already exists");
  }
  if (mode === "append") {
    const previous = exists ? await readFile(absoluteFile, "utf8") : "";
    if (previous.length + content.length > MAX_WRITE_CHARS) {
      throw new Error(`Combined content exceeds ${MAX_WRITE_CHARS} characters`);
    }
    await writeFile(absoluteFile, `${previous}${content}`, "utf8");
  } else {
    await writeFile(absoluteFile, content, "utf8");
  }
  const relativePath = formatWorkspacePath(rootDir, absoluteFile);
  const message = `Wrote ${content.length} characters to ${relativePath} using ${mode} mode.`;
  return {
    modelText: message,
    traceText: message
  };
}

async function makeWorkspaceDirectory(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_make_directory requires a path");
  const absoluteDir = ensureInsideWorkspace(rootDir, inputPath);
  await mkdir(absoluteDir, { recursive: true });
  const message = `Created directory ${formatWorkspacePath(rootDir, absoluteDir)}.`;
  return {
    modelText: message,
    traceText: message
  };
}

async function moveWorkspacePath(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const fromPath = sanitizeText(args.from, 400);
  const toPath = sanitizeText(args.to, 400);
  if (!fromPath || !toPath) throw new Error("workspace_move_path requires from and to");
  const overwrite = normalizeBoolean(args.overwrite, false);
  const absoluteFrom = ensureInsideWorkspace(rootDir, fromPath);
  const absoluteTo = ensureInsideWorkspace(rootDir, toPath);
  const fromStats = await stat(absoluteFrom).catch(() => null);
  if (!fromStats) throw new Error("Source path not found");
  const destinationExists = await stat(absoluteTo).then(() => true).catch(() => false);
  if (destinationExists && !overwrite) {
    throw new Error("Destination already exists");
  }
  if (destinationExists && overwrite) {
    await rm(absoluteTo, { recursive: true, force: true });
  }
  await mkdir(dirname(absoluteTo), { recursive: true });
  await rename(absoluteFrom, absoluteTo);
  const message = `Moved ${formatWorkspacePath(rootDir, absoluteFrom)} to ${formatWorkspacePath(rootDir, absoluteTo)}.`;
  return {
    modelText: message,
    traceText: message
  };
}

async function deleteWorkspacePath(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_delete_path requires a path");
  const recursive = normalizeBoolean(args.recursive, false);
  const absolutePath = ensureInsideWorkspace(rootDir, inputPath);
  const pathStats = await stat(absolutePath).catch(() => null);
  if (!pathStats) throw new Error("Path not found");
  if (pathStats.isDirectory() && !recursive) {
    throw new Error("Directory deletion requires recursive=true");
  }
  await rm(absolutePath, { recursive, force: true });
  const message = `Deleted ${formatWorkspacePath(rootDir, absolutePath)}.`;
  return {
    modelText: message,
    traceText: message
  };
}

async function multiEditWorkspaceFile(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_multi_edit requires a path");
  const edits = normalizeEdits(args.edits);
  const absoluteFile = ensureInsideWorkspace(rootDir, inputPath);
  const fileStats = await stat(absoluteFile).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("File not found");
  }
  await assertTextFile(absoluteFile);
  const original = await readFile(absoluteFile, "utf8");
  if (original.length > MAX_FILE_CHARS) {
    throw new Error("File is too large for workspace_multi_edit");
  }

  let next = original;
  let totalReplacements = 0;
  const editSummaries: string[] = [];
  edits.forEach((edit, index) => {
    if (!next.includes(edit.search)) {
      throw new Error(`Edit ${index + 1}: search text not found`);
    }
    let replacements = 0;
    if (edit.replaceAll) {
      replacements = countExactMatches(next, edit.search);
      next = next.split(edit.search).join(edit.replace);
    } else {
      const firstIndex = next.indexOf(edit.search);
      replacements = 1;
      next = `${next.slice(0, firstIndex)}${edit.replace}${next.slice(firstIndex + edit.search.length)}`;
    }
    totalReplacements += replacements;
    editSummaries.push(
      `Edit ${index + 1}: replacements=${replacements}, replaceAll=${edit.replaceAll ? "yes" : "no"}`
    );
  });

  await writeFile(absoluteFile, next, "utf8");
  const relativePath = formatWorkspacePath(rootDir, absoluteFile);
  const message = `Updated ${relativePath}. Applied ${edits.length} edit(s) across ${totalReplacements} replacement(s).`;
  return {
    modelText: message,
    traceText: [message, ...editSummaries].join("\n")
  };
}

async function insertTextInFile(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_insert_text requires a path");
  const text = String(args.text ?? "");
  if (!text) throw new Error("workspace_insert_text requires text");
  const before = Object.prototype.hasOwnProperty.call(args, "before") ? String(args.before ?? "") : "";
  const after = Object.prototype.hasOwnProperty.call(args, "after") ? String(args.after ?? "") : "";
  const hasAtLine = Number.isFinite(Number(args.atLine));
  const anchorsSpecified = [Boolean(before), Boolean(after), hasAtLine].filter(Boolean).length;
  if (anchorsSpecified !== 1) {
    throw new Error("Specify exactly one of before, after, or atLine");
  }

  const absoluteFile = ensureInsideWorkspace(rootDir, inputPath);
  const fileStats = await stat(absoluteFile).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("File not found");
  }
  await assertTextFile(absoluteFile);
  const original = await readFile(absoluteFile, "utf8");
  if (original.length > MAX_FILE_CHARS) {
    throw new Error("File is too large for workspace_insert_text");
  }

  let next = original;
  let placement = "";
  if (before) {
    const index = original.indexOf(before);
    if (index < 0) throw new Error("Before anchor not found");
    next = `${original.slice(0, index)}${text}${original.slice(index)}`;
    placement = `before the requested anchor`;
  } else if (after) {
    const index = original.indexOf(after);
    if (index < 0) throw new Error("After anchor not found");
    const insertAt = index + after.length;
    next = `${original.slice(0, insertAt)}${text}${original.slice(insertAt)}`;
    placement = `after the requested anchor`;
  } else {
    const atLine = normalizeCount(args.atLine, 1, 1, 1_000_000);
    const normalized = original.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const insertIndex = Math.max(0, Math.min(lines.length, atLine - 1));
    lines.splice(insertIndex, 0, text);
    next = lines.join("\n");
    placement = `before line ${atLine}`;
  }

  await writeFile(absoluteFile, next, "utf8");
  const relativePath = formatWorkspacePath(rootDir, absoluteFile);
  const message = `Inserted ${text.length} characters into ${relativePath} ${placement}.`;
  return {
    modelText: message,
    traceText: message
  };
}

async function replaceTextInFile(rootDir: string, args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = sanitizeText(args.path, 400);
  if (!inputPath) throw new Error("workspace_replace_text requires a path");
  const search = String(args.search ?? "");
  if (!search) throw new Error("workspace_replace_text requires search text");
  const replace = String(args.replace ?? "");
  const replaceAll = normalizeBoolean(args.replaceAll, false);
  const absoluteFile = ensureInsideWorkspace(rootDir, inputPath);
  const fileStats = await stat(absoluteFile).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("File not found");
  }
  await assertTextFile(absoluteFile);
  const original = await readFile(absoluteFile, "utf8");
  if (original.length > MAX_FILE_CHARS) {
    throw new Error("File is too large for workspace_replace_text");
  }
  if (!original.includes(search)) {
    throw new Error("Search text not found");
  }
  let replacements = 0;
  let next = original;
  if (replaceAll) {
    const segments = original.split(search);
    replacements = Math.max(0, segments.length - 1);
    next = segments.join(replace);
  } else {
    const firstIndex = original.indexOf(search);
    replacements = 1;
    next = `${original.slice(0, firstIndex)}${replace}${original.slice(firstIndex + search.length)}`;
  }
  await writeFile(absoluteFile, next, "utf8");
  const relativePath = formatWorkspacePath(rootDir, absoluteFile);
  const message = `Updated ${relativePath}. Replacements applied: ${replacements}.`;
  return {
    modelText: message,
    traceText: message
  };
}

function buildToolErrorMessage(callName: string, error: unknown): ToolResult {
  const message = `Workspace tool failed (${callName}): ${error instanceof Error ? error.message : String(error || "Unknown error")}`;
  return {
    modelText: message,
    traceText: message
  };
}

function appendCapped(current: string, incoming: string, maxLength: number) {
  if (!incoming) {
    return { text: current, truncated: false };
  }
  if (current.length >= maxLength) {
    return { text: current, truncated: true };
  }
  const available = maxLength - current.length;
  if (incoming.length <= available) {
    return { text: current + incoming, truncated: false };
  }
  return { text: current + incoming.slice(0, available), truncated: true };
}

async function runWorkspaceCommand(rootDir: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  const command = sanitizeText(args.command, 260);
  if (!command) throw new Error("workspace_run_command requires a command");
  const argv = normalizeStringArray(args.args, 80, 400);
  const input = Object.prototype.hasOwnProperty.call(args, "input") ? String(args.input ?? "") : "";
  const cwd = ensureInsideWorkspace(rootDir, sanitizeText(args.cwd, 400) || ".");
  const timeoutMs = normalizeCount(args.timeoutMs, 20_000, 1_000, 120_000);
  const startedAt = Date.now();

  const executable = /[\\/]/.test(command) ? ensureInsideWorkspace(rootDir, command) : command;

  const child = spawn(executable, argv, {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false
  });

  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;

  const onStdout = (chunk: Buffer) => {
    const next = appendCapped(stdout, chunk.toString("utf8"), MAX_COMMAND_OUTPUT_CHARS);
    stdout = next.text;
    stdoutTruncated = stdoutTruncated || next.truncated;
  };
  const onStderr = (chunk: Buffer) => {
    const next = appendCapped(stderr, chunk.toString("utf8"), MAX_COMMAND_OUTPUT_CHARS);
    stderr = next.text;
    stderrTruncated = stderrTruncated || next.truncated;
  };

  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);

  const cleanupAbort = signal ? (() => {
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  })() : () => undefined;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 500);
  }, timeoutMs);

  const result = await new Promise<{ exitCode: number | null; exitSignal: NodeJS.Signals | null }>((resolvePromise, rejectPromise) => {
    child.once("error", (error) => {
      rejectPromise(error);
    });
    child.once("close", (exitCode, exitSignal) => {
      resolvePromise({ exitCode, exitSignal });
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  }).finally(() => {
    clearTimeout(timeout);
    cleanupAbort();
  });

  const durationMs = Date.now() - startedAt;
  const commandLabel = [command, ...argv].join(" ").trim();
  const traceSections = [
    `Command: ${commandLabel}`,
    `CWD: ${formatWorkspacePath(rootDir, cwd)}`,
    `Exit code: ${result.exitCode === null ? "null" : String(result.exitCode)}${result.exitSignal ? ` (signal: ${result.exitSignal})` : ""}`,
    `Duration: ${durationMs}ms`,
    timedOut ? "Timed out: yes" : "Timed out: no"
  ];

  if (stdout) {
    traceSections.push(`stdout:\n${stdout}${stdoutTruncated ? "\n[stdout truncated]" : ""}`);
  }
  if (stderr) {
    traceSections.push(`stderr:\n${stderr}${stderrTruncated ? "\n[stderr truncated]" : ""}`);
  }
  if (!stdout && !stderr) {
    traceSections.push("No stdout/stderr output.");
  }

  const traceText = traceSections.join("\n\n").slice(0, MAX_COMMAND_OUTPUT_CHARS * 2);
  const summary =
    result.exitCode === 0 && !timedOut
      ? `Command succeeded: ${commandLabel}`
      : timedOut
        ? `Command timed out: ${commandLabel}`
        : `Command failed: ${commandLabel}`;

  return {
    modelText: `${summary}\n${stdout || stderr || "No output."}`.slice(0, MAX_COMMAND_OUTPUT_CHARS),
    traceText
  };
}

async function gitStatus(rootDir: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  const path = sanitizeText(args.path, 400) || ".";
  return runWorkspaceCommand(rootDir, {
    command: "git",
    args: ["status", "--short", "--branch", "--", path],
    cwd: ".",
    timeoutMs: 15000
  }, signal);
}

async function gitDiff(rootDir: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  const path = sanitizeText(args.path, 400);
  const staged = normalizeBoolean(args.staged, false);
  const gitArgs = ["diff"];
  if (staged) gitArgs.push("--cached");
  if (path) {
    gitArgs.push("--", path);
  }
  return runWorkspaceCommand(rootDir, {
    command: "git",
    args: gitArgs,
    cwd: ".",
    timeoutMs: 15000
  }, signal);
}

export function prepareWorkspaceTools(rootDir = process.cwd(), options?: WorkspaceToolsOptions): PreparedWorkspaceTools {
  const workspaceRoot = resolve(rootDir);
  const includeFileTools = options?.includeFileTools !== false;
  const includeCommandTool = options?.includeCommandTool !== false;
  const securityPolicy = normalizeSecurityPolicy(options?.securityPolicy);
  const tools = WORKSPACE_TOOL_DEFINITIONS
    .filter((tool) => {
      if (tool.function.name === "workspace_run_command") {
        return includeCommandTool;
      }
      return includeFileTools;
    })
    .map((tool) => ({ ...tool, function: { ...tool.function } }));
  return {
    rootDir: workspaceRoot,
    tools,
    executeToolCall: async (callName, rawArgs, signal) => {
      const args = parseArgs(rawArgs);
      try {
        if (callName === "workspace_list_files") {
          return await listFiles(workspaceRoot, args);
        }
        if (callName === "workspace_stat_path") {
          return await statWorkspacePath(workspaceRoot, args);
        }
        if (callName === "workspace_read_file") {
          return await readWorkspaceFile(workspaceRoot, args);
        }
        if (callName === "workspace_search_text") {
          return await searchText(workspaceRoot, args);
        }
        if (callName === "workspace_write_file") {
          return await writeWorkspaceFile(workspaceRoot, args);
        }
        if (callName === "workspace_make_directory") {
          return await makeWorkspaceDirectory(workspaceRoot, args);
        }
        if (callName === "workspace_move_path") {
          if (securityPolicy.allowDangerousFileOps !== true && normalizeBoolean(args.overwrite, false)) {
            throw new Error("workspace_move_path with overwrite is blocked by agent security policy");
          }
          return await moveWorkspacePath(workspaceRoot, args);
        }
        if (callName === "workspace_delete_path") {
          if (securityPolicy.allowDangerousFileOps !== true) {
            throw new Error("workspace_delete_path is blocked by agent security policy");
          }
          return await deleteWorkspacePath(workspaceRoot, args);
        }
        if (callName === "workspace_multi_edit") {
          return await multiEditWorkspaceFile(workspaceRoot, args);
        }
        if (callName === "workspace_insert_text") {
          return await insertTextInFile(workspaceRoot, args);
        }
        if (callName === "workspace_replace_text") {
          return await replaceTextInFile(workspaceRoot, args);
        }
        if (callName === "workspace_git_status") {
          return await gitStatus(workspaceRoot, args, signal);
        }
        if (callName === "workspace_git_diff") {
          return await gitDiff(workspaceRoot, args, signal);
        }
        if (callName === "workspace_run_command") {
          const command = sanitizeText(args.command, 260);
          const argv = normalizeStringArray(args.args, 80, 400);
          const blockedReason = describeBlockedCommand({
            command,
            args: argv,
            policy: securityPolicy
          });
          if (blockedReason) {
            throw new Error(blockedReason);
          }
          return await runWorkspaceCommand(workspaceRoot, args, signal);
        }
        return {
          modelText: `Workspace tool not found: ${callName}`,
          traceText: `Workspace tool not found: ${callName}`
        };
      } catch (error) {
        return buildToolErrorMessage(callName, error);
      }
    },
    close: async () => undefined
  };
}
