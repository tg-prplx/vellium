import { accessSync, constants } from "fs";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import { basename, delimiter, join } from "path";

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string;
  cwd?: string;
  env: string;
  enabled: boolean;
  timeoutMs: number;
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface McpToolListItem {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpDiscoveredTool {
  serverId: string;
  serverName: string;
  toolName: string;
  callName: string;
  description: string;
}

interface PreparedTool {
  callName: string;
  toolName: string;
  serverId: string;
  timeoutMs: number;
  client: McpStdioClient;
}

interface PrepareOptions {
  signal?: AbortSignal;
}

const HEADER_DELIMITER = Buffer.from("\r\n\r\n");
const HEADER_DELIMITER_LF = Buffer.from("\n\n");
const MCP_PROTOCOL_VERSION = "2024-11-05";
const COMMON_POSIX_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const ALLOWED_MCP_COMMANDS = new Set([
  "npx",
  "node",
  "bunx",
  "uvx",
  "python",
  "python3",
  "deno",
  "cmd",
  "powershell",
  "pwsh"
]);

export function isAllowedMcpCommand(raw: unknown): boolean {
  const command = String(raw || "").trim();
  if (!command) return false;
  const base = basename(command).toLowerCase().replace(/\.exe$/i, "");
  return ALLOWED_MCP_COMMANDS.has(base);
}

let cachedShellPath: string | null | undefined;

function uniquePathEntries(entries: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const parts = String(raw || "")
      .split(delimiter)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (seen.has(part)) continue;
      seen.add(part);
      out.push(part);
    }
  }
  return out;
}

function getWindowsPathCandidates(): string[] {
  const out = [
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "nodejs") : "",
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "nodejs") : "",
    process.env.AppData ? join(process.env.AppData, "npm") : "",
    process.env.LocalAppData ? join(process.env.LocalAppData, "Programs", "nodejs") : ""
  ].filter(Boolean);
  return out;
}

function getShellPathSnapshot(): string | null {
  if (cachedShellPath !== undefined) return cachedShellPath;
  if (process.platform === "win32") {
    cachedShellPath = null;
    return cachedShellPath;
  }

  const shells = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter((item): item is string => Boolean(item));
  for (const shell of shells) {
    const result = spawnSync(shell, ["-lc", "printf %s \"$PATH\""], {
      env: process.env,
      encoding: "utf8",
      timeout: 1500
    });
    const value = String(result.stdout || "").trim();
    if (result.status === 0 && value) {
      cachedShellPath = value;
      return cachedShellPath;
    }
  }

  cachedShellPath = null;
  return cachedShellPath;
}

function buildSpawnEnv(envPatch: Record<string, string>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...envPatch };
  const pathEntries = uniquePathEntries([
    merged.PATH,
    (merged as { Path?: string }).Path,
    getShellPathSnapshot(),
    ...(process.platform === "win32" ? getWindowsPathCandidates() : COMMON_POSIX_PATHS)
  ]);
  if (pathEntries.length > 0) {
    const nextPath = pathEntries.join(delimiter);
    merged.PATH = nextPath;
    if ("Path" in merged) {
      (merged as { Path?: string }).Path = nextPath;
    }
  }
  return merged;
}

function commandHasPathSeparator(command: string): boolean {
  return /[\\/]/.test(command);
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommandFromPath(command: string, env: NodeJS.ProcessEnv): string | null {
  if (!command || commandHasPathSeparator(command)) return command || null;
  const pathValue = String(env.PATH || (env as { Path?: string }).Path || "").trim();
  if (!pathValue) return null;

  const extensions = process.platform === "win32"
    ? uniquePathEntries([String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM")]).flatMap((entry) => entry.split(";").filter(Boolean))
    : [""];

  for (const dir of pathValue.split(delimiter).map((part) => part.trim()).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, process.platform === "win32" && ext && !command.toLowerCase().endsWith(ext.toLowerCase()) ? `${command}${ext}` : command);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function resolveSpawnCommand(command: string, env: NodeJS.ProcessEnv): string {
  const trimmed = String(command || "").trim();
  if (!trimmed) return trimmed;
  if (commandHasPathSeparator(trimmed)) return trimmed;
  return resolveCommandFromPath(trimmed, env) ?? trimmed;
}

type StdioWireFormat = "content-length" | "jsonl";

function isLikelyJsonlServer(config: Pick<McpServerConfig, "command" | "args">): boolean {
  const commandBase = basename(String(config.command || "").trim()).toLowerCase().replace(/\.exe$/i, "");
  const signature = `${String(config.command || "")} ${String(config.args || "")}`.toLowerCase();
  if (/\bmcp-remote\b/.test(signature)) return true;
  if (["node", "npx", "bunx", "deno"].includes(commandBase) && /\.(?:c|m)?js\b|\.tsx?\b/.test(signature)) {
    return true;
  }
  return false;
}

function detectStdioWireFormat(config: McpServerConfig): StdioWireFormat {
  if (isLikelyJsonlServer(config)) return "jsonl";
  return "content-length";
}

function parseArgs(raw: string): string[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  const matches = text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return matches
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
        return token.slice(1, -1);
      }
      return token;
    });
}

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = String(raw || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function normalizeTimeoutMs(config: Pick<McpServerConfig, "command" | "args" | "timeoutMs">, override?: number): number {
  const raw = override ?? Number(config.timeoutMs);
  const isRemoteBridge = /\bmcp-remote\b/i.test(`${config.command} ${config.args}`);
  const fallback = isRemoteBridge ? 45000 : 15000;
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  const normalized = Math.max(1000, Math.min(120000, Math.floor(raw)));
  return isRemoteBridge ? Math.max(45000, normalized) : normalized;
}

function isInitializeTimeoutError(error: unknown): boolean {
  return error instanceof Error && /MCP timeout on initialize\b/.test(error.message);
}

function normalizeSchema(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

function sanitizeNamePart(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

function buildCallName(serverId: string, toolName: string, used: Set<string>): string {
  const base = `mcp_${sanitizeNamePart(serverId)}__${sanitizeNamePart(toolName)}`;
  let candidate = base.slice(0, 64);
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `_${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 64 - tail.length))}${tail}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function toToolText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result ?? "");
  }
  const payload = result as { content?: unknown; isError?: unknown };
  const content = Array.isArray(payload.content) ? payload.content : [];
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const row = item as { type?: unknown; text?: unknown };
    if (row.type === "text") {
      parts.push(String(row.text ?? ""));
    } else if (typeof row.type === "string") {
      parts.push(`[${row.type} result]`);
    }
  }
  const text = parts.join("\n").trim();
  if (text) {
    if (payload.isError === true) return `Tool error:\n${text}`;
    return text;
  }
  const serialized = JSON.stringify(result);
  if (payload.isError === true) return `Tool error:\n${serialized}`;
  return serialized;
}

interface ToolMediaItem {
  type: "image";
  url: string;
  markdown?: string;
  alt?: string;
}

function normalizeToolMediaItems(raw: unknown): ToolMediaItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { type?: unknown; url?: unknown; markdown?: unknown; alt?: unknown; text?: unknown };
      const type = String(row.type || "image").trim();
      const url = String(row.url || "").trim();
      if (type !== "image" || !url) return null;
      return {
        type: "image" as const,
        url,
        markdown: String(row.markdown || "").trim() || undefined,
        alt: String(row.alt || row.text || "").trim() || undefined
      };
    })
    .filter((item): item is ToolMediaItem => item !== null);
}

function extractSpecialToolExecutionResult(result: unknown): { modelText: string; traceText: string } | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const payload = result as { structuredContent?: unknown };
  const structured = payload.structuredContent && typeof payload.structuredContent === "object" && !Array.isArray(payload.structuredContent)
    ? payload.structuredContent as Record<string, unknown>
    : null;
  if (!structured) return null;

  const vellium = structured.vellium && typeof structured.vellium === "object" && !Array.isArray(structured.vellium)
    ? structured.vellium as Record<string, unknown>
    : null;
  const media = normalizeToolMediaItems(vellium?.media ?? structured.media ?? structured.images);
  if (media.length === 0) return null;

  const summary = String(
    vellium?.summary
    ?? structured.summary
    ?? "Image created and shown to the user."
  ).trim() || "Image created and shown to the user.";

  return {
    modelText: summary,
    traceText: JSON.stringify({
      kind: "vellium_media_result",
      summary,
      media
    })
  };
}

function normalizeToolExecutionResult(result: unknown): { modelText: string; traceText: string } {
  const special = extractSpecialToolExecutionResult(result);
  if (special) return special;
  const text = toToolText(result).slice(0, 24000);
  return {
    modelText: text,
    traceText: text
  };
}

class McpStdioClient {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly wireFormat: StdioWireFormat;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeout: NodeJS.Timeout;
  }>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private stderrTail = "";

  constructor(private readonly config: McpServerConfig, wireFormat?: StdioWireFormat) {
    if (!isAllowedMcpCommand(config.command)) {
      throw new Error(`MCP command is not allowed: ${config.command}`);
    }
    this.wireFormat = wireFormat ?? detectStdioWireFormat(config);
    const args = parseArgs(config.args);
    const envPatch = parseEnv(config.env);
    const spawnEnv = buildSpawnEnv(envPatch);
    const resolvedCommand = resolveSpawnCommand(config.command, spawnEnv);
    this.proc = spawn(resolvedCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: String(config.cwd || "").trim() || undefined,
      env: spawnEnv
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      // Keep stderr consumed to avoid process backpressure and keep a short tail for diagnostics.
      const text = chunk.toString("utf8");
      if (text) {
        this.stderrTail = `${this.stderrTail}${text}`.slice(-1200);
      }
    });
    this.proc.on("error", (err) => {
      if (err && typeof err === "object" && "message" in err && /ENOENT/.test(String((err as Error).message || ""))) {
        this.rejectAll(new Error(`MCP command not found: ${config.command}. Install it or use an absolute executable path.`));
        return;
      }
      this.rejectAll(err);
    });
    this.proc.on("exit", () => {
      const suffix = this.stderrTail.trim() ? ` | stderr: ${this.stderrTail.trim()}` : "";
      this.rejectAll(new Error(`MCP server exited: ${this.config.name || this.config.id}${suffix}`));
    });
  }

  async initialize(signal?: AbortSignal, timeoutOverrideMs?: number): Promise<void> {
    const timeout = this.normalizeTimeout(timeoutOverrideMs);
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "vellium", version: "0.2.0" }
    }, timeout, signal);
    this.notify("notifications/initialized", {});
  }

  async listTools(signal?: AbortSignal): Promise<McpToolListItem[]> {
    const timeout = this.normalizeTimeout();
    const result = await this.request("tools/list", {}, timeout, signal) as { tools?: unknown };
    return Array.isArray(result?.tools) ? (result.tools as McpToolListItem[]) : [];
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args }, timeoutMs, signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error("MCP client closed"));
    if (!this.proc.killed) {
      this.proc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!this.proc.killed) this.proc.kill("SIGKILL");
          resolve();
        }, 600);
        this.proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private normalizeTimeout(overrideMs?: number): number {
    return normalizeTimeoutMs(this.config, overrideMs);
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.sendFrame({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("MCP client already closed"));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Aborted"));
        return;
      }
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const suffix = this.stderrTail.trim() ? ` | stderr: ${this.stderrTail.trim()}` : "";
        reject(new Error(`MCP timeout on ${method}${suffix}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      if (signal) {
        const onAbort = () => {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(new Error("Aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.sendFrame({ jsonrpc: "2.0", id, method, params });
    });
  }

  private sendFrame(payload: Record<string, unknown>) {
    if (this.wireFormat === "jsonl") {
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, "utf8");
    this.proc.stdin.write(Buffer.concat([header, json]));
  }

  private handleStdout(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.wireFormat === "jsonl") {
      this.processJsonlBuffer();
      return;
    }
    this.processContentLengthBuffer();
  }

  private processJsonlBuffer() {
    while (true) {
      const lineEnd = this.buffer.indexOf(0x0a); // \n
      if (lineEnd === -1) return;

      const rawLine = this.buffer.slice(0, lineEnd).toString("utf8").replace(/\r$/, "");
      this.buffer = this.buffer.slice(lineEnd + 1);
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        this.resolvePending(message);
      } catch {
        // Ignore non-JSON lines/noise from stdout.
      }
    }
  }

  private processContentLengthBuffer() {
    while (true) {
      const crlfHeaderEnd = this.buffer.indexOf(HEADER_DELIMITER);
      const lfHeaderEnd = this.buffer.indexOf(HEADER_DELIMITER_LF);
      let headerEnd = -1;
      let delimiterLength = 0;
      if (crlfHeaderEnd !== -1 && (lfHeaderEnd === -1 || crlfHeaderEnd <= lfHeaderEnd)) {
        headerEnd = crlfHeaderEnd;
        delimiterLength = HEADER_DELIMITER.length;
      } else if (lfHeaderEnd !== -1) {
        headerEnd = lfHeaderEnd;
        delimiterLength = HEADER_DELIMITER_LF.length;
      }
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = /content-length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + delimiterLength);
        continue;
      }
      const contentLength = Number(lengthMatch[1]);
      const bodyStart = headerEnd + delimiterLength;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) return;

      const raw = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } };
        this.resolvePending(message);
      } catch {
        // Ignore malformed chunks and continue parsing stream.
      }
    }
  }

  private resolvePending(message: { id?: number; result?: unknown; error?: { message?: string } }) {
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(String(message.error.message || "MCP error")));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(reason: unknown) {
    if (this.pending.size === 0) return;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
      this.pending.delete(id);
    }
  }
}

async function tryConnectMcpClient(
  server: McpServerConfig,
  wireFormat: StdioWireFormat,
  signal?: AbortSignal,
  timeoutOverrideMs?: number
): Promise<McpStdioClient> {
  const client = new McpStdioClient(server, wireFormat);
  try {
    await client.initialize(signal, timeoutOverrideMs);
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function connectMcpClient(server: McpServerConfig, signal?: AbortSignal): Promise<McpStdioClient> {
  const preferred = detectStdioWireFormat(server);
  const attempts: StdioWireFormat[] = preferred === "jsonl"
    ? ["jsonl", "content-length"]
    : ["content-length", "jsonl"];
  const fullTimeout = normalizeTimeoutMs(server);
  const probeTimeout = Math.max(1000, Math.min(1800, fullTimeout));
  let lastError: unknown = null;

  if (preferred === "content-length") {
    for (const format of attempts) {
      try {
        return await tryConnectMcpClient(server, format, signal, probeTimeout);
      } catch (error) {
        lastError = error;
        if (!isInitializeTimeoutError(error)) {
          throw error instanceof Error ? error : new Error(String(error || "Failed to connect to MCP server"));
        }
      }
    }
  }

  for (const format of attempts) {
    try {
      return await tryConnectMcpClient(server, format, signal, fullTimeout);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Failed to connect to MCP server"));
}

export interface PreparedMcpTools {
  tools: OpenAIToolDefinition[];
  executeToolCall: (callName: string, rawArgs: string | undefined, signal?: AbortSignal) => Promise<{
    modelText: string;
    traceText: string;
  }>;
  close: () => Promise<void>;
}

export async function prepareMcpTools(servers: McpServerConfig[], options?: PrepareOptions): Promise<PreparedMcpTools> {
  const clients: McpStdioClient[] = [];
  const registry = new Map<string, PreparedTool>();
  const tools: OpenAIToolDefinition[] = [];
  const usedNames = new Set<string>();

  for (const server of servers) {
    if (!server?.enabled) continue;
    if (!String(server.command || "").trim()) continue;
    let client: McpStdioClient | null = null;
    try {
      client = await connectMcpClient(server, options?.signal);
      const listed = await client.listTools(options?.signal);
      clients.push(client);
      for (const item of listed) {
        const toolName = String(item?.name || "").trim();
        if (!toolName) continue;
        const callName = buildCallName(server.id || server.name || "server", toolName, usedNames);
        const description = String(item?.description || `${server.name || server.id}: ${toolName}`);
        const timeoutMs = Number(server.timeoutMs) > 0 ? Number(server.timeoutMs) : 15000;
        registry.set(callName, {
          callName,
          toolName,
          serverId: server.id,
          timeoutMs,
          client
        });
        tools.push({
          type: "function",
          function: {
            name: callName,
            description: description.slice(0, 512),
            parameters: normalizeSchema(item?.inputSchema)
          }
        });
      }
    } catch {
      if (client) {
        await client.close();
      }
    }
  }

  return {
    tools,
    executeToolCall: async (callName: string, rawArgs: string | undefined, signal?: AbortSignal) => {
      const selected = registry.get(callName);
      if (!selected) {
        return {
          modelText: `Tool not found: ${callName}`,
          traceText: `Tool not found: ${callName}`
        };
      }
      let parsedArgs: Record<string, unknown> = {};
      if (rawArgs && rawArgs.trim()) {
        try {
          const decoded = JSON.parse(rawArgs);
          if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
            parsedArgs = decoded as Record<string, unknown>;
          }
        } catch {
          return {
            modelText: `Tool argument parsing error for ${callName}`,
            traceText: `Tool argument parsing error for ${callName}`
          };
        }
      }
      try {
        const result = await selected.client.callTool(selected.toolName, parsedArgs, selected.timeoutMs, signal);
        return normalizeToolExecutionResult(result);
      } catch (err) {
        const message = `Tool execution failed (${callName}): ${err instanceof Error ? err.message : "Unknown error"}`;
        return {
          modelText: message,
          traceText: message
        };
      }
    },
    close: async () => {
      await Promise.all(clients.map((client) => client.close()));
    }
  };
}

export async function discoverMcpToolCatalog(
  servers: McpServerConfig[],
  options?: PrepareOptions
): Promise<McpDiscoveredTool[]> {
  const usedNames = new Set<string>();
  const discovered: McpDiscoveredTool[] = [];

  for (const server of servers) {
    if (!server?.enabled) continue;
    if (!String(server.command || "").trim()) continue;
    let client: McpStdioClient | null = null;
    try {
      client = await connectMcpClient(server, options?.signal);
      const listed = await client.listTools(options?.signal);
      for (const item of listed) {
        const toolName = String(item?.name || "").trim();
        if (!toolName) continue;
        const callName = buildCallName(server.id || server.name || "server", toolName, usedNames);
        discovered.push({
          serverId: String(server.id || "").trim(),
          serverName: String(server.name || server.id || "").trim(),
          toolName,
          callName,
          description: String(item?.description || `${server.name || server.id}: ${toolName}`).slice(0, 512)
        });
      }
    } catch {
      // Ignore failing servers to keep discovery best-effort.
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  return discovered;
}

export async function testMcpServerConnection(server: McpServerConfig, signal?: AbortSignal): Promise<{
  ok: boolean;
  tools: McpToolInfo[];
  error?: string;
}> {
  if (!server || !String(server.command || "").trim()) {
    return { ok: false, tools: [], error: "Command is required" };
  }

  let client: McpStdioClient | null = null;
  try {
    client = await connectMcpClient(server, signal);
    const list = await client.listTools(signal);
    const tools = list
      .map((item) => ({
        name: String(item.name || "").trim(),
        description: String(item.description || "").trim()
      }))
      .filter((item) => item.name.length > 0);
    return { ok: true, tools };
  } catch (err) {
    return {
      ok: false,
      tools: [],
      error: err instanceof Error ? err.message : "Unknown MCP error"
    };
  } finally {
    if (client) {
      await client.close();
    }
  }
}
