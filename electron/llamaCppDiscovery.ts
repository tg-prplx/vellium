import { app } from "electron";
import { constants as fsConstants, type Dirent } from "fs";
import { access, readFile, readdir, stat } from "fs/promises";
import path from "path";
import type {
  LlamaCppDiscoveryResult,
  LlamaCppEndpointCandidate,
  LlamaCppExecutableCandidate,
  LlamaCppModelCandidate
} from "../src/shared/types/llamaCpp";

const MAX_DISCOVERY_ENTRIES = 6_000;
const MAX_MODEL_RESULTS = 48;
const MIN_GGUF_BYTES = 64 * 1024 * 1024;
const DISCOVERY_REQUEST_TIMEOUT_MS = 900;
const LLAMA_ENDPOINT_PORTS = [8088, 1234, 8080];

function localModelsRoot() {
  const base = process.env.SLV_DATA_DIR || (app.isPackaged ? path.join(app.getPath("userData"), "data") : path.resolve(process.cwd(), "data"));
  return path.resolve(base, "local-models", "llm");
}

async function existingFile(candidate: string, executable = false) {
  if (!candidate) return false;
  try {
    await access(candidate, executable && process.platform !== "win32" ? fsConstants.X_OK : fsConstants.F_OK);
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function uniqueByPath<T extends { path: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = process.platform === "win32" ? item.path.toLowerCase() : item.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function bundledCandidates(): Promise<{ executable: LlamaCppExecutableCandidate[]; models: LlamaCppModelCandidate[] }> {
  const root = localModelsRoot();
  try {
    const manifest = JSON.parse(await readFile(path.join(root, "install.json"), "utf8")) as { executable?: unknown; modelFiles?: unknown };
    const executablePath = path.resolve(root, String(manifest.executable || ""));
    const modelPaths = Array.isArray(manifest.modelFiles)
      ? manifest.modelFiles.map((value) => path.resolve(root, String(value || "")))
      : [];
    const executable = await existingFile(executablePath, true)
      ? [{ path: executablePath, source: "bundled" as const }]
      : [];
    const models: LlamaCppModelCandidate[] = [];
    for (const modelPath of modelPaths) {
      if (!modelPath.toLowerCase().endsWith(".gguf") || !await existingFile(modelPath)) continue;
      const info = await stat(modelPath);
      models.push({ path: modelPath, name: path.basename(modelPath), sizeBytes: info.size, source: "vellium" });
    }
    return { executable, models };
  } catch {
    return { executable: [], models: [] };
  }
}

async function scanForFiles(
  roots: Array<{ root: string; source: LlamaCppModelCandidate["source"] }>,
  predicate: (filename: string) => boolean,
  maxDepth: number
) {
  const matches: Array<{ path: string; source: LlamaCppModelCandidate["source"]; size: number }> = [];
  let inspected = 0;
  async function walk(root: string, source: LlamaCppModelCandidate["source"], depth: number): Promise<void> {
    if (depth > maxDepth || inspected >= MAX_DISCOVERY_ENTRIES || matches.length >= MAX_MODEL_RESULTS) return;
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries.filter((item) => item.isFile() || item.isSymbolicLink())) {
      inspected += 1;
      if (inspected >= MAX_DISCOVERY_ENTRIES || matches.length >= MAX_MODEL_RESULTS) return;
      const absolute = path.join(root, entry.name);
      if (predicate(entry.name)) {
        try {
          const info = await stat(absolute);
          if (info.size >= MIN_GGUF_BYTES) matches.push({ path: absolute, source, size: info.size });
        } catch {
          // File disappeared during discovery.
        }
      }
    }
    for (const entry of entries.filter((item) => item.isDirectory())) {
      inspected += 1;
      if (inspected >= MAX_DISCOVERY_ENTRIES || matches.length >= MAX_MODEL_RESULTS) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "release") continue;
      await walk(path.join(root, entry.name), source, depth + 1);
    }
  }
  for (const candidate of roots) await walk(candidate.root, candidate.source, 0);
  return matches;
}

async function discoverExecutables(home: string) {
  const filename = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const pathCandidates = String(process.env.PATH || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, filename));
  const known = process.platform === "win32"
    ? [
        path.join(process.env.ProgramFiles || "C:\\Program Files", "llama.cpp", filename),
        path.join(home, "llama.cpp", "build", "bin", filename),
        path.join(home, "Downloads", "llama.cpp", filename)
      ]
    : [
        "/opt/homebrew/bin/llama-server",
        "/usr/local/bin/llama-server",
        "/usr/bin/llama-server",
        path.join(home, ".local", "bin", "llama-server"),
        path.join(home, "llama.cpp", "build", "bin", "llama-server"),
        path.join(home, "Documents", "llama.cpp", "build", "bin", "llama-server"),
        path.join(home, "Documents", "llamametal", "build", "bin", "llama-server")
      ];
  const results: LlamaCppExecutableCandidate[] = [];
  for (const candidate of pathCandidates) {
    if (await existingFile(candidate, true)) results.push({ path: candidate, source: "path" });
  }
  for (const candidate of known) {
    if (await existingFile(candidate, true)) results.push({ path: candidate, source: "known" });
  }
  return uniqueByPath(results);
}

async function discoverModels(home: string) {
  const roots: Array<{ root: string; source: LlamaCppModelCandidate["source"] }> = [
    { root: path.join(home, "Downloads"), source: "downloads" },
    { root: path.join(home, "Documents"), source: "documents" },
    { root: path.join(home, ".lmstudio", "models"), source: "lmstudio" },
    { root: path.join(home, ".cache", "lm-studio", "models"), source: "lmstudio" },
    { root: path.join(home, ".cache", "huggingface", "hub"), source: "huggingface" }
  ];
  const found = await scanForFiles(roots, (filename) => filename.toLowerCase().endsWith(".gguf"), 4);
  return uniqueByPath(found
    .filter((item) => item.size >= MIN_GGUF_BYTES)
    .map((item) => ({ path: item.path, name: path.basename(item.path), sizeBytes: item.size, source: item.source })))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

async function discoverEndpoint(port: number): Promise<LlamaCppEndpointCandidate | null> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/models`, { method: "GET", cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(payload.data)) return null;
    return {
      baseUrl,
      models: payload.data.map((item) => String(item?.id || "").trim()).filter(Boolean)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverLlamaCpp(): Promise<LlamaCppDiscoveryResult> {
  const home = app.getPath("home");
  const bundled = await bundledCandidates();
  const [executables, models, endpointResults, gpu] = await Promise.all([
    discoverExecutables(home),
    discoverModels(home),
    Promise.all(LLAMA_ENDPOINT_PORTS.map(discoverEndpoint)),
    app.getGPUInfo("basic").catch(() => ({ gpuDevice: [] })) as Promise<{ gpuDevice?: Array<{ active?: boolean }> }>
  ]);
  const accelerator: LlamaCppDiscoveryResult["accelerator"] = process.platform === "darwin"
    ? "metal"
    : (gpu.gpuDevice || []).some((device) => device.active) ? "vulkan" : "cpu";
  const executableCandidates = uniqueByPath([...bundled.executable, ...executables]);
  const modelCandidates = uniqueByPath([...bundled.models, ...models]);
  const endpointCandidates = endpointResults.filter((item): item is LlamaCppEndpointCandidate => item !== null);
  return {
    available: executableCandidates.length > 0 || endpointCandidates.length > 0,
    platform: process.platform,
    arch: process.arch,
    accelerator,
    executableCandidates,
    modelCandidates,
    endpointCandidates,
    scannedAt: new Date().toISOString()
  };
}
