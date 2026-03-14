import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { BrowserWindow } from "electron";
import { buildManagedBackendCommand, parseManagedBackendEnv, resolveManagedBackendBaseUrl } from "../src/shared/managedBackends";
import type { ManagedBackendConfig, ManagedBackendLogEntry, ManagedBackendRuntimeState } from "../src/shared/types/contracts";

const LOG_LIMIT = 800;
const START_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 1200;

function nowIso() {
  return new Date().toISOString();
}

function normalizeUrl(url: string) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string) {
  const base = normalizeUrl(baseUrl);
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) return base;
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  return `${base}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

function resolveContextPath(context: unknown, path: string): unknown {
  const normalized = String(path || "").trim();
  if (!normalized) return context;
  const tokens = normalized
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\[\]/g, ".*")
    .split(".")
    .filter(Boolean);
  let values: unknown[] = [context];
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const value of values) {
      if (token === "*") {
        if (Array.isArray(value)) next.push(...value);
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (!(token in record)) continue;
      next.push(record[token]);
    }
    values = next;
    if (values.length === 0) break;
  }
  if (normalized.includes("[]")) return values;
  return values[0];
}

function extractStrings(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(raw)) return raw.flatMap((item) => extractStrings(item));
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    return [record.id, record.name, record.model, record.text, record.content].flatMap((item) => extractStrings(item));
  }
  return [];
}

async function fetchJson(url: string) {
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function fetchKoboldModels(baseUrl: string) {
  const base = normalizeUrl(baseUrl);
  const candidates = [
    `${base}/api/v1/models`,
    `${base}/api/extra/models`,
    `${base}/api/v1/model`,
    `${base}/api/extra/model`,
    `${base}/api/v1/info/model`,
    `${base}/v1/models`,
    `${base}/models`
  ];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      if (!response.ok) continue;
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        const ids = extractStrings(parsed);
        if (ids.length > 0) return [...new Set(ids)];
      } catch {
        const trimmed = text.trim();
        if (trimmed && !trimmed.startsWith("<")) return [trimmed];
      }
    } catch {
      // try next
    }
  }
  return [] as string[];
}

async function testKobold(baseUrl: string) {
  const base = normalizeUrl(baseUrl);
  const candidates = [`${base}/api/v1/model`, `${base}/api/v1/info/version`, `${base}/api/extra/version`];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function fetchOllamaModels(baseUrl: string) {
  const body = await fetchJson(`${normalizeUrl(baseUrl)}/api/tags`) as { models?: Array<{ name?: unknown; model?: unknown }> };
  const values = Array.isArray(body.models)
    ? body.models.map((item) => String(item?.name ?? item?.model ?? "").trim()).filter(Boolean)
    : [];
  return [...new Set(values)];
}

async function testOllama(baseUrl: string) {
  try {
    await fetchOllamaModels(baseUrl);
    return true;
  } catch {
    return false;
  }
}

interface ManagedProcessState {
  config: ManagedBackendConfig;
  child: ChildProcessWithoutNullStreams | null;
  runtime: ManagedBackendRuntimeState;
  logs: ManagedBackendLogEntry[];
  stdoutBuffer: string;
  stderrBuffer: string;
  pollTimer: NodeJS.Timeout | null;
  startDeadline: NodeJS.Timeout | null;
}

export class ManagedBackendManager {
  private states = new Map<string, ManagedProcessState>();
  private activeBackendId: string | null = null;
  private listeners = new Set<BrowserWindow>();

  attachWindow(window: BrowserWindow) {
    this.listeners.add(window);
    window.on("closed", () => {
      this.listeners.delete(window);
    });
  }

  listRuntimeStates(): ManagedBackendRuntimeState[] {
    return Array.from(this.states.values()).map((state) => ({ ...state.runtime, models: [...state.runtime.models] }));
  }

  getLogs(backendId: string): ManagedBackendLogEntry[] {
    return [...(this.states.get(backendId)?.logs || [])];
  }

  async start(config: ManagedBackendConfig): Promise<ManagedBackendRuntimeState> {
    if (this.activeBackendId && this.activeBackendId !== config.id) {
      await this.stop(this.activeBackendId);
    }
    const existing = this.states.get(config.id);
    if (existing && (existing.runtime.status === "starting" || existing.runtime.status === "running")) {
      this.activeBackendId = config.id;
      return { ...existing.runtime, models: [...existing.runtime.models] };
    }

    const { command, env, cwd } = buildManagedBackendCommand(config);
    const state: ManagedProcessState = existing || {
      config,
      child: null,
      runtime: {
        backendId: config.id,
        status: "starting",
        pid: null,
        baseUrl: resolveManagedBackendBaseUrl(config),
        commandPreview: command,
        progress: null,
        progressLabel: "Starting process...",
        models: [],
        startedAt: nowIso(),
        lastError: null
      },
      logs: [],
      stdoutBuffer: "",
      stderrBuffer: "",
      pollTimer: null,
      startDeadline: null
    };
    state.config = config;
    state.runtime = {
      ...state.runtime,
      status: "starting",
      pid: null,
      baseUrl: resolveManagedBackendBaseUrl(config),
      commandPreview: command,
      progress: null,
      progressLabel: "Starting process...",
      models: [],
      startedAt: nowIso(),
      lastError: null
    };
    state.logs = [];
    state.stdoutBuffer = "";
    state.stderrBuffer = "";
    this.states.set(config.id, state);
    this.activeBackendId = config.id;
    this.pushLog(state, "system", `Starting backend with command: ${command}`);

    const child = spawn(command, {
      shell: true,
      cwd: cwd || undefined,
      env: { ...process.env, ...parseManagedBackendEnv(config.envText), ...env },
      stdio: "pipe"
    });
    state.child = child;
    state.runtime.pid = child.pid ?? null;
    this.emitUpdate();

    child.stdout.on("data", (chunk) => this.handleOutput(state, "stdout", chunk));
    child.stderr.on("data", (chunk) => this.handleOutput(state, "stderr", chunk));
    child.on("error", (error) => {
      state.runtime.status = "error";
      state.runtime.lastError = error.message;
      state.runtime.progressLabel = error.message;
      this.pushLog(state, "system", `Process error: ${error.message}`);
      this.cleanupTimers(state);
      this.emitUpdate();
    });
    child.on("exit", (code, signal) => {
      state.child = null;
      this.cleanupTimers(state);
      if (state.runtime.status !== "stopping") {
        state.runtime.status = code === 0 ? "stopped" : "error";
        state.runtime.lastError = code === 0 ? null : `Process exited with code ${code ?? "?"}${signal ? ` (${signal})` : ""}`;
        state.runtime.progressLabel = state.runtime.lastError || "Stopped";
      } else {
        state.runtime.status = "stopped";
        state.runtime.progressLabel = "Stopped";
        state.runtime.lastError = null;
      }
      state.runtime.pid = null;
      state.runtime.progress = null;
      if (this.activeBackendId === state.config.id) this.activeBackendId = null;
      this.pushLog(state, "system", `Process exited${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}`);
      this.emitUpdate();
    });

    state.startDeadline = setTimeout(() => {
      if (state.runtime.status === "starting") {
        state.runtime.status = "error";
        state.runtime.lastError = `Backend did not become ready within ${Math.floor(START_TIMEOUT_MS / 1000)}s`;
        state.runtime.progressLabel = state.runtime.lastError;
        this.pushLog(state, "system", state.runtime.lastError);
        void this.stop(config.id);
      }
    }, START_TIMEOUT_MS);

    state.pollTimer = setInterval(() => {
      void this.pollState(state);
    }, POLL_INTERVAL_MS);
    void this.pollState(state);

    return { ...state.runtime, models: [...state.runtime.models] };
  }

  async stop(backendId: string): Promise<ManagedBackendRuntimeState | null> {
    const state = this.states.get(backendId);
    if (!state) return null;
    this.cleanupTimers(state);
    if (state.child && !state.child.killed) {
      state.runtime.status = "stopping";
      state.runtime.progressLabel = "Stopping process...";
      this.emitUpdate();
      state.child.kill("SIGTERM");
      setTimeout(() => {
        if (state.child && !state.child.killed) {
          state.child.kill("SIGKILL");
        }
      }, 3000);
    } else {
      state.runtime.status = "stopped";
      state.runtime.pid = null;
      state.runtime.progress = null;
      state.runtime.progressLabel = "Stopped";
      state.runtime.lastError = null;
      if (this.activeBackendId === backendId) this.activeBackendId = null;
      this.emitUpdate();
    }
    return { ...state.runtime, models: [...state.runtime.models] };
  }

  async stopActive(): Promise<void> {
    if (!this.activeBackendId) return;
    await this.stop(this.activeBackendId);
  }

  private cleanupTimers(state: ManagedProcessState) {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.startDeadline) clearTimeout(state.startDeadline);
    state.pollTimer = null;
    state.startDeadline = null;
  }

  private emitUpdate() {
    const snapshot = this.listRuntimeStates();
    for (const window of this.listeners) {
      if (!window.isDestroyed()) {
        window.webContents.send("managed-backends:update", snapshot);
      }
    }
  }

  private pushLog(state: ManagedProcessState, stream: ManagedBackendLogEntry["stream"], text: string) {
    const entry: ManagedBackendLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      stream,
      text,
      timestamp: nowIso()
    };
    state.logs.push(entry);
    if (state.logs.length > LOG_LIMIT) {
      state.logs.splice(0, state.logs.length - LOG_LIMIT);
    }
  }

  private handleOutput(state: ManagedProcessState, stream: "stdout" | "stderr", chunk: Buffer) {
    const key = stream === "stdout" ? "stdoutBuffer" : "stderrBuffer";
    state[key] += chunk.toString("utf8");
    const lines = state[key].split(/\r?\n/);
    state[key] = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      this.pushLog(state, stream, trimmed);
      this.applyStdoutProgress(state, trimmed);
    }
    this.emitUpdate();
  }

  private applyStdoutProgress(state: ManagedProcessState, line: string) {
    const pattern = state.config.stdoutProgressRegex?.trim();
    if (pattern) {
      try {
        const match = line.match(new RegExp(pattern));
        if (match && match[1]) {
          const value = Number(match[1]);
          if (Number.isFinite(value)) {
            state.runtime.progress = Math.max(0, Math.min(100, value));
            state.runtime.progressLabel = line;
          }
        }
      } catch {
        // ignore invalid regex
      }
    }
    if (state.config.backendKind === "koboldcpp") {
      const percent = line.match(/(\d{1,3})\s*%/);
      if (percent) {
        const value = Number(percent[1]);
        if (Number.isFinite(value)) {
          state.runtime.progress = Math.max(0, Math.min(100, value));
          state.runtime.progressLabel = line;
        }
      }
    }
  }

  private async pollState(state: ManagedProcessState) {
    const baseUrl = resolveManagedBackendBaseUrl(state.config);
    state.runtime.baseUrl = baseUrl;
    const healthy = await this.checkHealth(state.config, baseUrl);
    if (healthy) {
      if (state.runtime.status === "starting") {
        state.runtime.status = "running";
        state.runtime.progress = 100;
        state.runtime.progressLabel = "Backend ready";
      }
      const models = await this.fetchModels(state.config, baseUrl).catch(() => state.runtime.models);
      state.runtime.models = models;
      await this.pollApiStatus(state, baseUrl).catch(() => undefined);
    }
    this.emitUpdate();
  }

  private async checkHealth(config: ManagedBackendConfig, baseUrl: string) {
    if (config.statusMode === "none") return true;
    if (config.backendKind === "koboldcpp") return testKobold(baseUrl);
    if (config.backendKind === "ollama") return testOllama(baseUrl);
    if (config.healthPath) {
      try {
        const response = await fetch(joinUrl(baseUrl, config.healthPath), { method: "GET", cache: "no-store" });
        return response.ok;
      } catch {
        return false;
      }
    }
    try {
      const response = await fetch(baseUrl, { method: "GET", cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async fetchModels(config: ManagedBackendConfig, baseUrl: string) {
    if (config.backendKind === "koboldcpp") return fetchKoboldModels(baseUrl);
    if (config.backendKind === "ollama") return fetchOllamaModels(baseUrl);
    if (config.modelsPath) {
      const payload = await fetchJson(joinUrl(baseUrl, config.modelsPath));
      return [...new Set(extractStrings(payload).filter(Boolean))];
    }
    return [] as string[];
  }

  private async pollApiStatus(state: ManagedProcessState, baseUrl: string) {
    if (!(state.config.statusMode === "api" || state.config.statusMode === "auto")) return;
    if (!state.config.statusPath) return;
    const payload = await fetchJson(joinUrl(baseUrl, state.config.statusPath));
    const rawLabel = state.config.statusTextPath ? resolveContextPath(payload, state.config.statusTextPath) : undefined;
    const rawProgress = state.config.statusProgressPath ? resolveContextPath(payload, state.config.statusProgressPath) : undefined;
    const nextLabel = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : null;
    const nextProgress = Number(rawProgress);
    if (nextLabel) state.runtime.progressLabel = nextLabel;
    if (Number.isFinite(nextProgress)) {
      state.runtime.progress = Math.max(0, Math.min(100, nextProgress));
    }
  }
}
