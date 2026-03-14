import type { ManagedBackendConfig, ManagedBackendKoboldOptions, ManagedBackendOllamaOptions, ManagedBackendStatusMode } from "./types/contracts";

function expandUserPath(value: string): string {
  const raw = String(value || "").trim().replace(/^(['"])(.*)\1$/, "$2");
  if (!raw) return "";
  const home = typeof process !== "undefined" && process?.env?.HOME ? process.env.HOME : "";
  if (raw === "~") {
    return home || raw;
  }
  if (raw.startsWith("~/")) {
    return home ? `${home}/${raw.slice(2)}` : raw;
  }
  return raw;
}

function quoteShellArg(value: string): string {
  const raw = String(value || "");
  if (!raw) return '""';
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(raw)) return raw;
  return `"${raw.replace(/(["\\$`])/g, "\\$1")}"`;
}

function emitCommandPrefix(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return '""';
  return shellJoin(tokenizeShellCommand(raw).map((token) => expandUserPath(token)));
}

function tokenizeShellCommand(command: string): string[] {
  const out: string[] = [];
  const input = String(command || "");
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (const char of input) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

function shellJoin(args: string[]): string {
  return args.map((arg) => quoteShellArg(arg)).join(" ");
}

export function resolveManagedBackendBaseUrl(config: ManagedBackendConfig): string {
  const explicit = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  if (config.backendKind === "koboldcpp") {
    const options = config.koboldcpp || defaultManagedBackendKoboldOptions();
    return `http://${options.host || "127.0.0.1"}:${options.port || 5001}`;
  }
  if (config.backendKind === "ollama") {
    const options = config.ollama || defaultManagedBackendOllamaOptions();
    return `http://${options.host || "127.0.0.1"}:${options.port || 11434}`;
  }
  return "http://127.0.0.1:5001";
}

export function defaultManagedBackendKoboldOptions(): ManagedBackendKoboldOptions {
  return {
    executable: "koboldcpp",
    modelPath: "",
    host: "127.0.0.1",
    port: 5001,
    contextSize: 8192,
    gpuLayers: 0,
    threads: 8,
    blasThreads: 8,
    batchSize: 512,
    highPriority: false,
    smartContext: false,
    useMmap: false,
    flashAttention: false,
    noMmap: false,
    noKvOffload: false
  };
}

export function defaultManagedBackendOllamaOptions(): ManagedBackendOllamaOptions {
  return {
    executable: "ollama",
    host: "127.0.0.1",
    port: 11434
  };
}

export function defaultManagedBackendConfig(index = 1): ManagedBackendConfig {
  const koboldcpp = defaultManagedBackendKoboldOptions();
  return {
    id: `managed-backend-${Date.now()}-${index}`,
    name: `Managed Backend ${index}`,
    enabled: true,
    providerId: "",
    providerType: "koboldcpp",
    adapterId: null,
    backendKind: "koboldcpp",
    baseUrl: resolveManagedBackendBaseUrl({
      id: "",
      name: "",
      enabled: true,
      providerId: "",
      providerType: "koboldcpp",
      backendKind: "koboldcpp",
      baseUrl: "",
      extraArgs: "",
      autoStopOnSwitch: true,
      statusMode: "auto",
      koboldcpp
    }),
    extraArgs: "",
    workingDirectory: "",
    envText: "",
    defaultModel: null,
    autoStopOnSwitch: true,
    statusMode: "auto",
    healthPath: "",
    modelsPath: "",
    statusPath: "",
    statusTextPath: "",
    statusProgressPath: "",
    stdoutProgressRegex: "",
    koboldcpp,
    ollama: defaultManagedBackendOllamaOptions()
  };
}

function parseNumeric(raw: unknown, fallback: number, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function normalizeManagedBackendConfig(raw: unknown, index = 1): ManagedBackendConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const fallback = defaultManagedBackendConfig(index);
  const backendKind = row.backendKind === "ollama" || row.backendKind === "generic" ? row.backendKind : "koboldcpp";
  const providerType = row.providerType === "openai" || row.providerType === "custom" ? row.providerType : backendKind === "koboldcpp" ? "koboldcpp" : "openai";
  const koboldDefaults = defaultManagedBackendKoboldOptions();
  const ollamaDefaults = defaultManagedBackendOllamaOptions();
  const koboldRaw = row.koboldcpp && typeof row.koboldcpp === "object" ? row.koboldcpp as Record<string, unknown> : {};
  const ollamaRaw = row.ollama && typeof row.ollama === "object" ? row.ollama as Record<string, unknown> : {};
  const config: ManagedBackendConfig = {
    ...fallback,
    id: String(row.id || fallback.id).trim() || fallback.id,
    name: String(row.name || fallback.name).trim() || fallback.name,
    enabled: row.enabled !== false,
    providerId: String(row.providerId || "").trim(),
    providerType,
    adapterId: providerType === "custom" ? String(row.adapterId || "").trim() || null : null,
    backendKind,
    baseUrl: String(row.baseUrl || "").trim(),
    commandOverride: String(row.commandOverride || "").trim() || undefined,
    extraArgs: String(row.extraArgs || "").trim(),
    workingDirectory: String(row.workingDirectory || "").trim(),
    envText: String(row.envText || "").trim(),
    defaultModel: String(row.defaultModel || "").trim() || null,
    autoStopOnSwitch: row.autoStopOnSwitch !== false,
    statusMode: (row.statusMode === "api" || row.statusMode === "stdout" || row.statusMode === "none") ? row.statusMode as ManagedBackendStatusMode : "auto",
    healthPath: String(row.healthPath || "").trim(),
    modelsPath: String(row.modelsPath || "").trim(),
    statusPath: String(row.statusPath || "").trim(),
    statusTextPath: String(row.statusTextPath || "").trim(),
    statusProgressPath: String(row.statusProgressPath || "").trim(),
    stdoutProgressRegex: String(row.stdoutProgressRegex || "").trim(),
    koboldcpp: {
      executable: String(koboldRaw.executable || koboldDefaults.executable).trim() || koboldDefaults.executable,
      modelPath: String(koboldRaw.modelPath || "").trim(),
      host: String(koboldRaw.host || koboldDefaults.host).trim() || koboldDefaults.host,
      port: parseNumeric(koboldRaw.port, koboldDefaults.port, 1, 65535),
      contextSize: parseNumeric(koboldRaw.contextSize, koboldDefaults.contextSize, 512, 262144),
      gpuLayers: parseNumeric(koboldRaw.gpuLayers, koboldDefaults.gpuLayers, 0, 999),
      threads: parseNumeric(koboldRaw.threads, koboldDefaults.threads, 1, 256),
      blasThreads: parseNumeric(koboldRaw.blasThreads, koboldDefaults.blasThreads, 1, 256),
      batchSize: parseNumeric(koboldRaw.batchSize, koboldDefaults.batchSize, -1, 4096),
      highPriority: koboldRaw.highPriority === true,
      smartContext: koboldRaw.smartContext === true,
      useMmap: koboldRaw.useMmap === true,
      flashAttention: koboldRaw.flashAttention === true,
      noMmap: koboldRaw.noMmap === true,
      noKvOffload: koboldRaw.noKvOffload === true
    },
    ollama: {
      executable: String(ollamaRaw.executable || ollamaDefaults.executable).trim() || ollamaDefaults.executable,
      host: String(ollamaRaw.host || ollamaDefaults.host).trim() || ollamaDefaults.host,
      port: parseNumeric(ollamaRaw.port, ollamaDefaults.port, 1, 65535)
    }
  };
  if (!config.baseUrl) config.baseUrl = resolveManagedBackendBaseUrl(config);
  return config;
}

export function normalizeManagedBackends(raw: unknown): ManagedBackendConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => normalizeManagedBackendConfig(item, index + 1))
    .filter((item): item is ManagedBackendConfig => item !== null);
}

function appendFlag(parts: string[], flag: string, value?: string | number | boolean | null) {
  if (value === null || value === undefined || value === false || value === "") return;
  if (value === true) {
    parts.push(flag);
    return;
  }
  parts.push(flag, quoteShellArg(String(value)));
}

export function buildManagedBackendCommand(config: ManagedBackendConfig): { command: string; env: Record<string, string>; cwd?: string } {
  if (config.commandOverride && config.commandOverride.trim()) {
    const normalizedOverride = shellJoin(tokenizeShellCommand(config.commandOverride.trim()).map((token) => expandUserPath(token)));
    return {
      command: normalizedOverride,
      env: parseManagedBackendEnv(config.envText),
      cwd: config.workingDirectory?.trim() || undefined
    };
  }

  if (config.backendKind === "koboldcpp") {
    const options = config.koboldcpp || defaultManagedBackendKoboldOptions();
    const parts: string[] = [emitCommandPrefix(options.executable || "koboldcpp")];
    appendFlag(parts, "--model", expandUserPath(options.modelPath));
    appendFlag(parts, "--host", options.host || "127.0.0.1");
    appendFlag(parts, "--port", options.port || 5001);
    appendFlag(parts, "--contextsize", options.contextSize || 8192);
    appendFlag(parts, "--threads", options.threads || 8);
    appendFlag(parts, "--blasthreads", options.blasThreads || options.threads || 8);
    if ((options.gpuLayers || 0) > 0) appendFlag(parts, "--gpulayers", options.gpuLayers);
    appendFlag(parts, "--batchsize", options.batchSize ?? 512);
    appendFlag(parts, "--highpriority", options.highPriority);
    appendFlag(parts, "--smartcontext", options.smartContext);
    appendFlag(parts, "--usemmap", options.useMmap && !options.noMmap);
    appendFlag(parts, "--flashattention", options.flashAttention);
    appendFlag(parts, "--nommap", options.noMmap);
    appendFlag(parts, "--nokv-offload", options.noKvOffload);
    if (config.extraArgs.trim()) parts.push(config.extraArgs.trim());
    return {
      command: parts.join(" "),
      env: parseManagedBackendEnv(config.envText),
      cwd: expandUserPath(config.workingDirectory || "") || undefined
    };
  }

  if (config.backendKind === "ollama") {
    const options = config.ollama || defaultManagedBackendOllamaOptions();
    const env = parseManagedBackendEnv(config.envText);
    env.OLLAMA_HOST = `${options.host || "127.0.0.1"}:${options.port || 11434}`;
    const parts = [emitCommandPrefix(options.executable || "ollama"), "serve"];
    if (config.extraArgs.trim()) parts.push(config.extraArgs.trim());
    return {
      command: parts.join(" "),
      env,
      cwd: expandUserPath(config.workingDirectory || "") || undefined
    };
  }

  const executable = config.commandOverride?.trim() || config.name;
  const command = [quoteShellArg(executable), config.extraArgs.trim()].filter(Boolean).join(" ");
  return {
    command,
    env: parseManagedBackendEnv(config.envText),
    cwd: expandUserPath(config.workingDirectory || "") || undefined
  };
}

export function parseManagedBackendEnv(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

export function parseManagedBackendCommand(command: string, kind: "koboldcpp" | "ollama" | "generic"): Partial<ManagedBackendConfig> | null {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) return null;

  if (kind === "generic") {
    return { commandOverride: command.trim() };
  }

  if (kind === "ollama") {
    const serveIndex = tokens.findIndex((token) => token === "serve");
    const prefix = serveIndex >= 0 ? tokens.slice(0, serveIndex) : tokens.slice(0, 1);
    const rest = serveIndex >= 0 ? tokens.slice(serveIndex + 1) : tokens.slice(1);
    const ollamaPatch: Partial<ManagedBackendOllamaOptions> = {};
    if (prefix.length > 0) {
      ollamaPatch.executable = prefix.join(" ");
    }
    return {
      ...(Object.keys(ollamaPatch).length > 0 ? { ollama: ollamaPatch } : {}),
      extraArgs: shellJoin(rest)
    } as Partial<ManagedBackendConfig>;
  }

  const knownValueFlags = new Map<string, string>([
    ["--model", "modelPath"],
    ["-m", "modelPath"],
    ["--host", "host"],
    ["--port", "port"],
    ["--contextsize", "contextSize"],
    ["--ctx-size", "contextSize"],
    ["-c", "contextSize"],
    ["--threads", "threads"],
    ["-t", "threads"],
    ["--blasthreads", "blasThreads"],
    ["--batchthreads", "blasThreads"],
    ["--threadsbatch", "blasThreads"],
    ["--threads-batch", "blasThreads"],
    ["--gpulayers", "gpuLayers"],
    ["--gpu-layers", "gpuLayers"],
    ["--n-gpu-layers", "gpuLayers"],
    ["-ngl", "gpuLayers"],
    ["--batchsize", "batchSize"],
    ["--blasbatchsize", "batchSize"],
    ["--batch-size", "batchSize"],
    ["-b", "batchSize"]
  ]);
  const knownBoolFlags = new Map<string, keyof ManagedBackendKoboldOptions>([
    ["--highpriority", "highPriority"],
    ["--smartcontext", "smartContext"],
    ["--usemmap", "useMmap"],
    ["--flashattention", "flashAttention"],
    ["--nommap", "noMmap"],
    ["--nokv-offload", "noKvOffload"]
  ]);
  const firstFlagIndex = tokens.findIndex((token) => token.startsWith("-"));
  const prefix = firstFlagIndex >= 0 ? tokens.slice(0, firstFlagIndex) : tokens.slice();
  const rest = firstFlagIndex >= 0 ? tokens.slice(firstFlagIndex) : [];
  const next: Partial<ManagedBackendKoboldOptions> = {};
  const extra: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const valueKey = knownValueFlags.get(token);
    if (valueKey) {
      const value = rest[index + 1];
      if (value === undefined) {
        extra.push(token);
        continue;
      }
      index += 1;
      if (valueKey === "modelPath") next.modelPath = value;
      if (valueKey === "host") next.host = value;
      if (valueKey === "port") next.port = Number(value);
      if (valueKey === "contextSize") next.contextSize = Number(value);
      if (valueKey === "threads") next.threads = Number(value);
      if (valueKey === "blasThreads") next.blasThreads = Number(value);
      if (valueKey === "gpuLayers") next.gpuLayers = Number(value);
      if (valueKey === "batchSize") next.batchSize = Number(value);
      continue;
    }
    const boolKey = knownBoolFlags.get(token);
    if (boolKey) {
      switch (boolKey) {
        case "highPriority":
          next.highPriority = true;
          break;
        case "smartContext":
          next.smartContext = true;
          break;
        case "useMmap":
          next.useMmap = true;
          break;
        case "flashAttention":
          next.flashAttention = true;
          break;
        case "noMmap":
          next.noMmap = true;
          break;
        case "noKvOffload":
          next.noKvOffload = true;
          break;
      }
      continue;
    }
    extra.push(token);
    const maybeValue = rest[index + 1];
    if (maybeValue && !maybeValue.startsWith("-")) {
      extra.push(maybeValue);
      index += 1;
    }
  }

  if (prefix.length > 0) {
    next.executable = prefix.join(" ");
  }

  return {
    ...(Object.keys(next).length > 0 ? { koboldcpp: next } : {}),
    extraArgs: shellJoin(extra)
  } as Partial<ManagedBackendConfig>;
}

export function managedBackendModelId(backendId: string): string {
  return `managed:${backendId}`;
}

export function parseManagedBackendModelId(modelId: string): string | null {
  const raw = String(modelId || "").trim();
  if (!raw.startsWith("managed:")) return null;
  return raw.slice("managed:".length).trim() || null;
}
