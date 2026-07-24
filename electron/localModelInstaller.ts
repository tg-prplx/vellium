import { app, type BrowserWindow } from "electron";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { chmod, mkdir, readFile, rename, rm, statfs } from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import extractZip from "extract-zip";
import { x as extractTar } from "tar";
import type {
  LocalModelCatalog,
  LocalModelComponentId,
  LocalModelInstallRequest,
  LocalModelInstallResult,
  LocalModelProgress
} from "../src/shared/types/localModels";
import type { ManagedBackendConfig } from "../src/shared/types/contracts";
import {
  buildLocalLlamaManagedBackend,
  localPiperRuntimeId,
  LOCAL_INFERENCE_SETTINGS_URL,
  LOCAL_LLAMA_PROVIDER_ID,
  LOCAL_PIPER_VERSION
} from "../src/shared/localModelConfig";

type GitHubReleaseAsset = { owner: string; repo: string; tag: string };
type Download = {
  url: string;
  bytes: number;
  digest?: string;
  filename: string;
  archive?: "zip" | "tgz";
  githubReleaseAsset?: GitHubReleaseAsset;
};
type DownloadSource = {
  url: string;
  headers?: Record<string, string>;
  bytes?: number;
  digest?: string;
};
type ComponentSpec = { id: LocalModelComponentId; model: Download[]; runtime: Download[]; runtimeId?: string };
type InstallManifest = {
  version: 1;
  componentId: LocalModelComponentId;
  modelFiles: string[];
  executable: string;
  installedAt: string;
  runtimeId?: string;
  voice?: string;
};

const LLAMA_VERSION = "b10107";
const WHISPER_VERSION = "v1.9.1";
const MODEL_ROOT = "https://huggingface.co";
const LLM_FILE = "gemma-4-26b-a4b-styletune-v2-q4_k_m-imat.gguf";
const LLM_BYTES = 17_211_235_552;
const WHISPER_FILE = "ggml-small-q5_1.bin";
const WHISPER_MODEL_ID = "whisper-small-q5_1";
const WHISPER_BYTES = 190_085_487;
const PIPER_MODEL_BYTES = 63_201_294;
const RETRYABLE_DOWNLOAD_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DOWNLOAD_RETRY_DELAYS_MS = [0, 500, 1_500];

class DownloadHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "DownloadHttpError";
  }
}

const VOICES = {
  en: { key: "en_US-lessac-medium", path: "en/en_US/lessac/medium", jsonBytes: 4885, modelMd5: "2fc642b535197b6305c7c8f92dc8b24f", jsonMd5: "c1f2b7bdfe113f3255ff9ef234cfd3" },
  ru: { key: "ru_RU-irina-medium", path: "ru/ru_RU/irina/medium", jsonBytes: 4765, modelMd5: "21fbe77fdc68bdc35d7adb6bf4f52199", jsonMd5: "e239bb7f22d5de4a44ec6b1cb6c06bb5" },
  zh: { key: "zh_CN-huayan-medium", path: "zh/zh_CN/huayan/medium", jsonBytes: 4822, modelMd5: "40cdb7930ff91b81574d5f0489e076ea", jsonMd5: "1fda3ec1d0d3a5a74064397ea8fe0af0" },
  ja: { key: "en_US-lessac-medium", path: "en/en_US/lessac/medium", jsonBytes: 4885, modelMd5: "2fc642b535197b6305c7c8f92dc8b24f", jsonMd5: "c1f2b7bdfe113f3255ff9ef234cfd3" }
} as const;

function dataRoot() {
  const base = process.env.SLV_DATA_DIR || (app.isPackaged ? path.join(app.getPath("userData"), "data") : path.resolve(process.cwd(), "data"));
  return path.resolve(base, "local-models");
}

function componentRoot(id: LocalModelComponentId) {
  return path.join(dataRoot(), id);
}

async function isCurrentComponentInstalled(id: LocalModelComponentId) {
  const manifestPath = path.join(componentRoot(id), "install.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<InstallManifest>;
    if (manifest.componentId !== id || !manifest.executable) return false;
    const executable = safeInside(componentRoot(id), path.resolve(componentRoot(id), manifest.executable));
    if (!existsSync(executable)) return false;
    if (id === "stt") {
      return Array.isArray(manifest.modelFiles)
        && manifest.modelFiles.some((item) => String(item).split(/[\\/]/).pop() === WHISPER_FILE);
    }
    if (id === "tts") {
      return manifest.runtimeId === localPiperRuntimeId(process.platform, process.arch);
    }
    return true;
  } catch {
    return false;
  }
}

function safeInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".") return candidate;
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe local model path");
  return candidate;
}

async function hashFile(filename: string, algorithm: "sha256" | "md5") {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(filename), hash);
  return hash.digest("hex");
}

function llamaRuntime(platform: NodeJS.Platform, arch: string, accelerator: string): Download {
  const base = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}`;
  if (platform === "darwin") {
    const arm = arch === "arm64";
    return {
      filename: `llama-${LLAMA_VERSION}-bin-macos-${arm ? "arm64" : "x64"}.tar.gz`,
      url: `${base}/llama-${LLAMA_VERSION}-bin-macos-${arm ? "arm64" : "x64"}.tar.gz`,
      bytes: arm ? 10_804_162 : 11_075_592,
      digest: arm ? "sha256:b9554ab4c9f6e91199f48387cb4ab27466fb1d724881f81463ef03f6370cfa32" : "sha256:6f35c90a6e9f33c905d09694946b82a29b4ab530a358226d95d832262f526ea2",
      archive: "tgz"
    };
  }
  if (platform === "win32") {
    const variant = accelerator === "vulkan" ? "vulkan" : "cpu";
    const bytes = variant === "vulkan" ? 33_479_694 : 18_213_827;
    const digest = variant === "vulkan"
      ? "sha256:c5b3a5ee8319b1eccbb748a54390aa806bbf7d1aceeea452e4c57921d113e53e"
      : "sha256:52133a0a5a8f6035b1bdd2f89c3425ea8b742413d9bdb9a2dee30e3a1681b18c";
    return { filename: `llama-${LLAMA_VERSION}-bin-win-${variant}-x64.zip`, url: `${base}/llama-${LLAMA_VERSION}-bin-win-${variant}-x64.zip`, bytes, digest, archive: "zip" };
  }
  const arm = arch === "arm64";
  const variant = accelerator === "vulkan" ? "vulkan-" : "";
  const filename = `llama-${LLAMA_VERSION}-bin-ubuntu-${variant}${arm ? "arm64" : "x64"}.tar.gz`;
  const bytes = variant ? (arm ? 26_326_232 : 32_239_108) : (arm ? 13_173_138 : 16_275_561);
  const digest = variant
    ? (arm ? "sha256:c786b0f5269964e6c9385bf68ffeb275c070b5a5bfcc7d9cea0d8ae6d6790bc1" : "sha256:28f86dfce8c3723d4e9fd971b8456d946e09324708880533091399d284fe9add")
    : (arm ? "sha256:1f93c35122865287824ef0dc040e24190b18edc6e163152be9ac10b8aaeafeef" : "sha256:afe1ae0b706c4a0830b218a9249037b7a6cc723f81deb78825662128b25453e6");
  return { filename, url: `${base}/${filename}`, bytes, digest, archive: "tgz" };
}

function whisperRuntime(platform: NodeJS.Platform, arch: string): Download {
  if (platform === "darwin") {
    const filename = `vellium-whisper-${WHISPER_VERSION}-macos-${arch === "arm64" ? "arm64" : "x64"}.tar.gz`;
    return {
      filename,
      url: `https://github.com/tg-prplx/vellium/releases/download/v${app.getVersion()}/${filename}`,
      bytes: 0,
      archive: "tgz",
      githubReleaseAsset: { owner: "tg-prplx", repo: "vellium", tag: `v${app.getVersion()}` }
    };
  }
  const base = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}`;
  if (platform === "win32") {
    return { filename: "whisper-bin-x64.zip", url: `${base}/whisper-bin-x64.zip`, bytes: 7_982_101, digest: "sha256:7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539", archive: "zip" };
  }
  const arm = arch === "arm64";
  return {
    filename: `whisper-bin-ubuntu-${arm ? "arm64" : "x64"}.tar.gz`,
    url: `${base}/whisper-bin-ubuntu-${arm ? "arm64" : "x64"}.tar.gz`,
    bytes: arm ? 4_555_819 : 9_379_235,
    digest: arm ? "sha256:e0b66cd551ff6f2a28fabe3c6e89691eea037bb76833493abb9a71ca788994b3" : "sha256:f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5",
    archive: "tgz"
  };
}

function piperRuntime(platform: NodeJS.Platform, arch: string): Download {
  const platformName = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";
  const archName = arch === "arm64" ? "arm64" : "x64";
  const archive = platform === "win32" ? "zip" : "tgz";
  const extension = archive === "zip" ? "zip" : "tar.gz";
  const filename = `vellium-piper-ohf-v${LOCAL_PIPER_VERSION}-${platformName}-${archName}.${extension}`;
  return {
    filename,
    url: `https://github.com/tg-prplx/vellium/releases/download/v${app.getVersion()}/${filename}`,
    bytes: 0,
    archive,
    githubReleaseAsset: { owner: "tg-prplx", repo: "vellium", tag: `v${app.getVersion()}` }
  };
}

async function detectHardware() {
  const gpu = await app.getGPUInfo("basic").catch(() => ({ gpuDevice: [] })) as {
    gpuDevice?: Array<{ active?: boolean; vendorId?: number; deviceId?: number }>;
  };
  const label = (gpu.gpuDevice || []).map((item) => `${item.vendorId || ""} ${item.deviceId || ""}`.trim()).filter(Boolean).join(", ") || "Unknown GPU";
  let accelerator: "metal" | "cuda" | "vulkan" | "rocm" | "cpu" = "cpu";
  if (process.platform === "darwin") accelerator = "metal";
  else if (process.platform === "win32" && (gpu.gpuDevice || []).some((item) => item.active)) accelerator = "vulkan";
  else if (process.platform === "linux" && (gpu.gpuDevice || []).some((item) => item.active)) accelerator = "vulkan";
  const memoryBytes = Number(require("os").totalmem());
  return {
    platform: process.platform,
    arch: process.arch,
    memoryBytes,
    gpuLabel: label,
    accelerator,
    fullGpuOffloadRecommended: memoryBytes >= 24 * 1024 ** 3
  };
}

function voiceDownloads(locale: LocalModelInstallRequest["locale"]): Download[] {
  const voice = VOICES[locale];
  const base = `${MODEL_ROOT}/rhasspy/piper-voices/resolve/main/${voice.path}`;
  return [
    { filename: `${voice.key}.onnx`, url: `${base}/${voice.key}.onnx?download=true`, bytes: PIPER_MODEL_BYTES, digest: `md5:${voice.modelMd5}` },
    { filename: `${voice.key}.onnx.json`, url: `${base}/${voice.key}.onnx.json?download=true`, bytes: voice.jsonBytes, digest: `md5:${voice.jsonMd5}` }
  ];
}

export class LocalModelInstaller {
  private abortControllers = new Map<LocalModelComponentId, AbortController>();
  private listeners = new Set<BrowserWindow>();
  private runtimeByteCache = new Map<string, Promise<number>>();

  attachWindow(window: BrowserWindow) {
    this.listeners.add(window);
    window.once("closed", () => this.listeners.delete(window));
  }

  async catalog(): Promise<LocalModelCatalog> {
    const hardware = await detectHardware();
    const installed = await Promise.all((["llm", "stt", "tts"] as const).map(isCurrentComponentInstalled));
    const whisper = whisperRuntime(process.platform, process.arch);
    const piper = piperRuntime(process.platform, process.arch);
    const [whisperBytes, piperBytes] = await Promise.all([
      this.resolveRuntimeBytes(whisper),
      this.resolveRuntimeBytes(piper)
    ]);
    return {
      available: ["darwin", "win32", "linux"].includes(process.platform) && ["x64", "arm64"].includes(process.arch),
      hardware,
      items: [
        { id: "llm", name: "llama.cpp", modelName: "Gemma 4 26B A4B StyleTune V2 Q4_K_M", modelBytes: LLM_BYTES, auxiliaryBytes: llamaRuntime(process.platform, process.arch, hardware.accelerator).bytes, installed: installed[0], recommended: hardware.fullGpuOffloadRecommended, warning: "Full GPU offload is intended for about 20–24 GB VRAM or unified memory including context headroom." },
        { id: "stt", name: "Whisper", modelName: "Whisper Small Q5_1 (multilingual)", modelBytes: WHISPER_BYTES, auxiliaryBytes: whisperBytes, installed: installed[1], recommended: true },
        { id: "tts", name: "OHF Voice", modelName: `Piper ${LOCAL_PIPER_VERSION} medium voice`, modelBytes: PIPER_MODEL_BYTES, auxiliaryBytes: piperBytes, installed: installed[2], recommended: true }
      ]
    };
  }

  cancel(id?: LocalModelComponentId) {
    if (id) this.abortControllers.get(id)?.abort();
    else for (const controller of this.abortControllers.values()) controller.abort();
  }

  async remove(id: LocalModelComponentId) {
    if (!["llm", "stt", "tts"].includes(id)) throw new Error("Unknown local model component");
    this.cancel(id);
    await rm(safeInside(dataRoot(), componentRoot(id)), { recursive: true, force: true });
    return this.catalog();
  }

  async install(request: LocalModelInstallRequest): Promise<LocalModelInstallResult> {
    const ids = [...new Set(request.componentIds)].filter((id): id is LocalModelComponentId => ["llm", "stt", "tts"].includes(id));
    if (!ids.length) throw new Error("Select at least one local model");
    const hardware = await detectHardware();
    await mkdir(dataRoot(), { recursive: true });
    const specs = ids.map((id) => this.spec(id, request.locale, hardware.accelerator));
    const requiredBytes = specs.flatMap((spec) => [...spec.runtime, ...spec.model]).reduce((sum, item) => sum + item.bytes, 0) + 1024 ** 3;
    const disk = await statfs(dataRoot());
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    if (Number.isFinite(availableBytes) && availableBytes < requiredBytes) {
      throw new Error(`Not enough free disk space: ${Math.ceil(requiredBytes / 1_000_000_000)} GB required including a 1 GB safety margin`);
    }
    const result: LocalModelInstallResult = { installed: [], errors: {}, settingsPatch: {} };
    for (const [index, id] of ids.entries()) {
      const controller = new AbortController();
      this.abortControllers.set(id, controller);
      try {
        const spec = specs[index];
        const manifest = await this.installComponent(spec, controller.signal, request.locale);
        result.installed.push(id);
        if (id === "llm") {
          const runtime = path.join(componentRoot(id), manifest.executable);
          const model = path.join(componentRoot(id), manifest.modelFiles[0]);
          result.managedBackend = this.managedBackend(runtime, model, hardware);
          result.provider = { id: LOCAL_LLAMA_PROVIDER_ID, name: "Vellium Local (llama.cpp)", baseUrl: "http://127.0.0.1:8088/v1", apiKey: "local-key", fullLocalOnly: true, providerType: "openai" };
        } else if (id === "stt") {
          Object.assign(result.settingsPatch, { sttSource: "whisper", sttBaseUrl: LOCAL_INFERENCE_SETTINGS_URL, sttApiKey: "", sttModel: WHISPER_MODEL_ID });
        } else {
          Object.assign(result.settingsPatch, { ttsBaseUrl: LOCAL_INFERENCE_SETTINGS_URL, ttsApiKey: "", ttsModel: "piper", ttsVoice: manifest.voice || VOICES[request.locale].key, ttsRealtime: true });
        }
      } catch (error) {
        result.errors![id] = error instanceof Error ? error.message : String(error);
        if (controller.signal.aborted) break;
      } finally {
        this.abortControllers.delete(id);
      }
    }
    if (!result.installed.length) {
      throw new Error(Object.entries(result.errors || {}).map(([id, message]) => `${id}: ${message}`).join("; ") || "Local model installation failed");
    }
    if (!Object.keys(result.errors || {}).length) delete result.errors;
    return result;
  }

  private spec(id: LocalModelComponentId, locale: LocalModelInstallRequest["locale"], accelerator: string): ComponentSpec {
    if (id === "llm") return {
      id,
      runtime: [llamaRuntime(process.platform, process.arch, accelerator)],
      model: [{ filename: LLM_FILE, url: `${MODEL_ROOT}/Kraekin/Gemma-4-26B-A4B-StyleTune-V2-Q4_K_M-GGUF/resolve/1c49854aee1a3a6551f6ac0e5c9bccae4a1f66e2/${LLM_FILE}?download=true`, bytes: LLM_BYTES, digest: "sha256:0d7c6006e8c767f55e4f18252f28e25537d72f8c1b5dd01fa0450408a707bcf8" }]
    };
    if (id === "stt") return {
      id,
      runtime: [whisperRuntime(process.platform, process.arch)],
      model: [{ filename: WHISPER_FILE, url: `${MODEL_ROOT}/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/${WHISPER_FILE}?download=true`, bytes: WHISPER_BYTES, digest: "sha256:ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb" }]
    };
    return {
      id,
      runtime: [piperRuntime(process.platform, process.arch)],
      model: voiceDownloads(locale),
      runtimeId: localPiperRuntimeId(process.platform, process.arch)
    };
  }

  private async installComponent(spec: ComponentSpec, signal: AbortSignal, locale: LocalModelInstallRequest["locale"]) {
    const root = componentRoot(spec.id);
    const staging = `${root}.installing`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(path.join(staging, "downloads"), { recursive: true });
    try {
      for (const item of [...spec.runtime, ...spec.model]) {
        const target = path.join(staging, "downloads", item.filename);
        await this.download(spec.id, item, target, signal);
        if (item.digest) {
          this.emit({ componentId: spec.id, phase: "verifying", receivedBytes: item.bytes, totalBytes: item.bytes, label: `Verifying ${item.filename}` });
          const [algorithm, expected] = item.digest.split(":") as ["sha256" | "md5", string];
          if (await hashFile(target, algorithm) !== expected) throw new Error(`Checksum mismatch for ${item.filename}`);
        }
        if (item.archive) {
          this.emit({ componentId: spec.id, phase: "extracting", receivedBytes: item.bytes, totalBytes: item.bytes, label: `Extracting ${item.filename}` });
          const destination = path.join(staging, "runtime");
          await mkdir(destination, { recursive: true });
          if (item.archive === "zip") await extractZip(target, { dir: destination });
          else await extractTar({ file: target, cwd: destination, strict: true, preservePaths: false });
          await rm(target, { force: true });
        } else {
          const destination = path.join(staging, "models", item.filename);
          await mkdir(path.dirname(destination), { recursive: true });
          await rename(target, destination);
        }
      }
      const executable = await this.findExecutable(staging, spec.id);
      if (process.platform !== "win32") await chmod(path.join(staging, executable), 0o755);
      if (spec.id === "tts") {
        this.emit({ componentId: spec.id, phase: "verifying", receivedBytes: 1, totalBytes: 1, label: "Checking OHF Voice runtime" });
        await this.validateTtsRuntime(path.join(staging, executable), signal);
      }
      const manifest: InstallManifest = {
        version: 1,
        componentId: spec.id,
        modelFiles: spec.model.map((item) => path.join("models", item.filename)),
        executable,
        installedAt: new Date().toISOString(),
        ...(spec.runtimeId ? { runtimeId: spec.runtimeId } : {}),
        ...(spec.id === "tts" ? { voice: VOICES[locale].key } : {})
      };
      await require("fs/promises").writeFile(path.join(staging, "install.json"), JSON.stringify(manifest, null, 2));
      await rm(root, { recursive: true, force: true });
      await rename(staging, root);
      this.emit({ componentId: spec.id, phase: "installed", receivedBytes: 1, totalBytes: 1, label: "Installed" });
      return manifest;
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      const aborted = signal.aborted;
      this.emit({ componentId: spec.id, phase: aborted ? "cancelled" : "error", receivedBytes: 0, totalBytes: 0, label: aborted ? "Cancelled" : "Installation failed", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async download(id: LocalModelComponentId, item: Download, target: string, signal: AbortSignal) {
    const sources: DownloadSource[] = [];
    if (item.githubReleaseAsset) {
      try {
        const asset = await this.resolveGitHubReleaseAsset(item.githubReleaseAsset, item.filename, signal);
        sources.push({
          url: asset.url,
          bytes: asset.size,
          digest: asset.digest,
          headers: {
            Accept: "application/octet-stream",
            "X-GitHub-Api-Version": "2022-11-28"
          }
        });
      } catch {
        // The public browser URL remains available when the GitHub API is rate-limited.
      }
    }
    sources.push({ url: item.url });

    let lastError: unknown = new Error(`Download failed for ${item.filename}`);
    for (const source of sources) {
      for (const [attempt, delayMs] of DOWNLOAD_RETRY_DELAYS_MS.entries()) {
        if (signal.aborted) throw new DOMException("Download cancelled", "AbortError");
        if (delayMs > 0) {
          this.emit({ componentId: id, phase: "downloading", receivedBytes: 0, totalBytes: item.bytes, label: `Retrying ${item.filename} (${attempt + 1}/${DOWNLOAD_RETRY_DELAYS_MS.length})` });
          await this.waitForRetry(delayMs, signal);
        }
        await rm(target, { force: true }).catch(() => {});
        try {
          await this.downloadOnce(id, item, target, source, signal);
          if (source.digest) {
            const [algorithm, expected] = source.digest.split(":") as ["sha256", string];
            if (algorithm !== "sha256" || !expected || await hashFile(target, "sha256") !== expected) {
              throw new Error(`Checksum mismatch for ${item.filename}`);
            }
          }
          return;
        } catch (error) {
          lastError = error;
          if (signal.aborted) throw error;
          const status = error instanceof DownloadHttpError ? error.status : 0;
          if (status && !RETRYABLE_DOWNLOAD_STATUSES.has(status)) break;
        }
      }
    }
    throw lastError;
  }

  private async downloadOnce(id: LocalModelComponentId, item: Download, target: string, source: DownloadSource, signal: AbortSignal) {
    const response = await fetch(source.url, { signal, redirect: "follow", headers: source.headers });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new DownloadHttpError(response.status, `Download failed (${response.status}) for ${item.filename}`);
    }
    const expectedBytes = source.bytes || item.bytes;
    const headerBytes = Number(response.headers.get("content-length")) || expectedBytes;
    if (expectedBytes && headerBytes && headerBytes !== expectedBytes) throw new Error(`Unexpected download size for ${item.filename}`);
    let received = 0;
    const reader = response.body.getReader();
    const output = createWriteStream(target, { flags: "wx" });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) throw new DOMException("Download cancelled", "AbortError");
        received += value.byteLength;
        if (expectedBytes && received > expectedBytes) throw new Error(`Download exceeded expected size for ${item.filename}`);
        if (!output.write(Buffer.from(value))) await new Promise<void>((resolve) => output.once("drain", resolve));
        this.emit({ componentId: id, phase: "downloading", receivedBytes: received, totalBytes: headerBytes, label: `Downloading ${item.filename}` });
      }
      await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
    } catch (error) {
      output.destroy();
      throw error;
    }
    if (expectedBytes && received !== expectedBytes) throw new Error(`Incomplete download for ${item.filename}`);
  }

  private async resolveGitHubReleaseAsset(release: GitHubReleaseAsset, filename: string, signal: AbortSignal) {
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(release.owner)}/${encodeURIComponent(release.repo)}/releases/tags/${encodeURIComponent(release.tag)}`;
    let lastError: unknown = new Error(`GitHub release metadata unavailable for ${release.tag}`);
    for (const delayMs of DOWNLOAD_RETRY_DELAYS_MS) {
      if (delayMs > 0) await this.waitForRetry(delayMs, signal);
      try {
        const response = await fetch(endpoint, {
          signal,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
          }
        });
        if (!response.ok) {
          if (!RETRYABLE_DOWNLOAD_STATUSES.has(response.status)) {
            throw new DownloadHttpError(response.status, `GitHub release metadata failed (${response.status})`);
          }
          lastError = new DownloadHttpError(response.status, `GitHub release metadata failed (${response.status})`);
          continue;
        }
        const payload = await response.json() as {
          assets?: Array<{ name?: unknown; url?: unknown; size?: unknown; digest?: unknown }>;
        };
        const asset = payload.assets?.find((candidate) => candidate.name === filename);
        const url = String(asset?.url || "").trim();
        if (!url) throw new Error(`GitHub release asset not found: ${filename}`);
        const digest = String(asset?.digest || "").trim();
        return {
          url,
          size: Number(asset?.size) || 0,
          digest: /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : undefined
        };
      } catch (error) {
        lastError = error;
        if (signal.aborted || error instanceof DownloadHttpError) throw error;
      }
    }
    throw lastError;
  }

  private async resolveRuntimeBytes(item: Download) {
    if (item.bytes || !item.githubReleaseAsset) return item.bytes;
    const cacheKey = `${item.githubReleaseAsset.tag}/${item.filename}`;
    const cached = this.runtimeByteCache.get(cacheKey);
    if (cached) return cached;
    const pending = this.fetchRuntimeBytes(item);
    this.runtimeByteCache.set(cacheKey, pending);
    return pending;
  }

  private async fetchRuntimeBytes(item: Download) {
    if (!item.githubReleaseAsset) return item.bytes;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    timer.unref?.();
    try {
      const asset = await this.resolveGitHubReleaseAsset(item.githubReleaseAsset, item.filename, controller.signal);
      return asset.size;
    } catch {
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }

  private async validateTtsRuntime(executable: string, signal: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let output = "";
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const child = spawn(executable, ["--help"], {
        cwd: path.dirname(executable),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const collect = (chunk: Buffer) => {
        output = `${output}${chunk.toString("utf8")}`.slice(-2_000);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.once("error", (error) => {
        finish(new Error(`OHF Voice runtime cannot start on ${process.platform}/${process.arch}: ${error.message}`));
      });
      child.once("exit", (code, exitSignal) => {
        if (code === 0) finish();
        else finish(new Error(`OHF Voice runtime check failed with code ${code ?? "?"}${exitSignal ? ` (${exitSignal})` : ""}: ${output.trim()}`));
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("OHF Voice runtime check timed out"));
      }, 30_000);
      timer.unref?.();
      const abort = () => {
        child.kill("SIGKILL");
        finish(new DOMException("Download cancelled", "AbortError"));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }

  private async waitForRetry(delayMs: number, signal: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Download cancelled", "AbortError"));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }

  private async findExecutable(root: string, id: LocalModelComponentId) {
    const names = id === "llm"
      ? (process.platform === "win32" ? ["llama-server.exe"] : ["llama-server"])
      : id === "stt"
        ? (process.platform === "win32" ? ["whisper-cli.exe", "main.exe"] : ["whisper-cli", "main"])
        : (process.platform === "win32" ? ["piper.exe"] : ["piper"]);
    const walk = async (dir: string): Promise<string | null> => {
      for (const entry of await require("fs/promises").readdir(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await walk(absolute);
          if (found) return found;
        } else if (names.includes(entry.name)) return path.relative(root, absolute);
      }
      return null;
    };
    const executable = await walk(path.join(root, "runtime"));
    if (!executable) throw new Error(`Installed ${id} runtime does not contain its executable`);
    return executable;
  }

  private managedBackend(executable: string, model: string, hardware: Awaited<ReturnType<typeof detectHardware>>): ManagedBackendConfig {
    return buildLocalLlamaManagedBackend(executable, model, hardware, require("os").cpus().length - 1);
  }

  private emit(progress: LocalModelProgress) {
    for (const window of this.listeners) if (!window.isDestroyed()) window.webContents.send("local-models:progress", progress);
  }
}
