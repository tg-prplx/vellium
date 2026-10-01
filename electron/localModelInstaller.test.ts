import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { findLocalLlmVariant } from "../src/shared/localLlmVariants";
import type { LocalModelCatalog, LocalModelInstallRequest, LocalModelInstallResult } from "../src/shared/types/localModels";

// ZIP with text fixtures named like Windows and Unix executables plus a DLL.
// Nothing in this archive is launched.
const runtimeZip = Buffer.from("UEsDBBQAAAAIABNUQV1eTpLnDgAAAAwAAAAUAAAAcnVudGltZS9sbGFtYS1zZXJ2ZXIrSS0u0S0qzSvJzE0FAFBLAwQUAAAACAATVEFdXk6S5w4AAAAMAAAAGAAAAHJ1bnRpbWUvbGxhbWEtc2VydmVyLmV4ZStJLS7RLSrNK8nMTQUAUEsDBBQAAAAIABNUQV2Z2rSTDgAAAAwAAAAQAAAAcnVudGltZS9nZ21sLmRsbCtJLS7RzclMKkosqgQAUEsBAhQDFAAAAAgAE1RBXV5OkucOAAAADAAAABQAAAAAAAAAAAAAAIABAAAAAHJ1bnRpbWUvbGxhbWEtc2VydmVyUEsBAhQDFAAAAAgAE1RBXV5OkucOAAAADAAAABgAAAAAAAAAAAAAAIABQAAAAHJ1bnRpbWUvbGxhbWEtc2VydmVyLmV4ZVBLAQIUAxQAAAAIABNUQV2Z2rSTDgAAAAwAAAAQAAAAAAAAAAAAAACAAYQAAABydW50aW1lL2dnbWwuZGxsUEsFBgAAAAADAAMAxgAAAMAAAAAAAA==", "base64");

interface TestDownload { filename: string; url: string; bytes: number; archive?: "zip"; digest?: string }
interface BundledInstaller {
  catalog(): Promise<LocalModelCatalog>;
  resolveRuntimeBytes(item: unknown): Promise<number>;
  install(request: LocalModelInstallRequest): Promise<LocalModelInstallResult>;
  cancel(): void;
  remove(id: "llm"): Promise<unknown>;
  spec(): { id: "llm"; runtime: TestDownload[]; model: TestDownload[] };
  validateRuntime(executable: string, id: "llm", signal: AbortSignal): Promise<boolean>;
  installComponent(spec: { id: "llm"; runtime: TestDownload[]; model: TestDownload[] }, signal: AbortSignal, locale: "ru"): Promise<{ executable: string; modelFiles: string[]; gpuAvailable?: boolean }>;
  download(id: string, item: TestDownload, target: string, signal: AbortSignal): Promise<void>;
}

let temporaryRoot: string | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; }
  vi.unstubAllEnvs();
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

async function bundledInstaller(options: { runtimeError?: string; devices?: string; beforeReplace?: (id: string) => Promise<void> } = {}) {
  // Importing the TypeScript directly would hide default-import interop bugs.
  // Use the same bundling and external-module policy as build:electron-main.
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./localModelInstaller.ts", import.meta.url))],
    bundle: true, platform: "node", format: "cjs", write: false,
    external: ["electron", "@electron-internal/extract-zip"]
  });
  const module = { exports: {} as { LocalModelInstaller: new (beforeReplace?: (id: string) => Promise<void>) => BundledInstaller } };
  const load = createRequire(import.meta.url);
  runInNewContext(bundle.outputFiles[0].text, {
    module, process, Buffer, console, setTimeout, clearTimeout, queueMicrotask, DOMException, AbortSignal, AbortController, fetch,
    require: (id: string) => {
      if (id === "electron") return { app: { isPackaged: false, getVersion: () => "0.0.0", getGPUInfo: async () => ({ gpuDevice: [] }) } };
      if (id === "child_process") return { ...load(id), execFile: (command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        const nativeProbe = command === "nvidia-smi" || command.endsWith("powershell.exe") || command === "/usr/sbin/system_profiler";
        if (nativeProbe) { callback(null, "", ""); return; }
        callback(options.runtimeError ? new Error(options.runtimeError) : null,
          args[0] === "--list-devices" ? options.devices || "Available devices:\n  MTL0: Apple GPU (12000 MiB, 11000 MiB free)" : "version: 10107", "");
      } };
      return load(id);
    }
  });
  return new module.exports.LocalModelInstaller(options.beforeReplace);
}

it("installs a ZIP runtime from the real Electron CommonJS bundle without launching Electron", async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vellium-installer-bundle-"));
  vi.stubEnv("SLV_DATA_DIR", temporaryRoot);
  const installer = await bundledInstaller();
  // Substitute only downloads; checksum, extraction, executable discovery,
  // staging promotion and manifest writing all run through production code.
  installer.download = async (_id, item, target) => {
    await writeFile(target, item.archive ? runtimeZip : "fixture-model");
  };
  const manifest = await installer.installComponent({
    id: "llm",
    runtime: [{ filename: "runtime.zip", url: "https://example.invalid/runtime.zip", bytes: runtimeZip.length, archive: "zip", digest: `sha256:${createHash("sha256").update(runtimeZip).digest("hex")}` }],
    model: [{ filename: "fixture.gguf", url: "https://example.invalid/fixture.gguf", bytes: 13 }]
  }, new AbortController().signal, "ru");
  const installed = path.join(temporaryRoot, "local-models", "llm");
  await expect(readFile(path.join(installed, manifest.executable), "utf8")).resolves.toBe("test-runtime");
  await expect(readFile(path.join(installed, "runtime", "runtime", "llama-server.exe"), "utf8")).resolves.toBe("test-runtime");
  await expect(readFile(path.join(installed, "runtime", "runtime", "ggml.dll"), "utf8")).resolves.toBe("test-library");
  await expect(readFile(path.join(installed, manifest.modelFiles[0]), "utf8")).resolves.toBe("fixture-model");
  expect(JSON.parse(await readFile(path.join(installed, "install.json"), "utf8"))).toMatchObject({ componentId: "llm", executable: manifest.executable });
  await expect(readFile(path.join(installed, "downloads", "runtime.zip"))).rejects.toMatchObject({ code: "ENOENT" });
});

async function fixtureInstaller(options: { runtimeError?: string; devices?: string; beforeReplace?: (id: string) => Promise<void> } = {}) {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vellium-installer-flow-"));
  vi.stubEnv("SLV_DATA_DIR", temporaryRoot);
  const installer = await bundledInstaller(options);
  const spec = { id: "llm" as const,
    runtime: [{ filename: "runtime.zip", url: "https://example.invalid/runtime.zip", bytes: runtimeZip.length, archive: "zip" as const, digest: `sha256:${createHash("sha256").update(runtimeZip).digest("hex")}` }],
    model: [{ filename: findLocalLlmVariant("26b")!.file, url: "https://example.invalid/model.gguf", bytes: 13, digest: `sha256:${createHash("sha256").update("fixture-model").digest("hex")}` }] };
  installer.resolveRuntimeBytes = async () => runtimeZip.length;
  installer.spec = () => spec;
  installer.download = async (_id, item, target) => { await writeFile(target, item.archive ? runtimeZip : "fixture-model"); };
  return { installer, spec };
}

it("runs the installation pipeline through checksums, ZIP, native probe, manifest and automatic settings", async () => {
  const { installer } = await fixtureInstaller();
  const result = await installer.install({ componentIds: ["llm"], locale: "ru", llmVariantId: "26b" });
  expect(result.installed).toEqual(["llm"]);
  expect(result.errors).toBeUndefined();
  expect(result.provider).toMatchObject({ fullLocalOnly: true, llamaCppManagementEnabled: true, baseUrl: "http://127.0.0.1:8088/v1" });
  expect(result.managedBackend?.llamacpp).toMatchObject({ gpuLayers: process.platform === "darwin" && process.arch === "arm64" ? "auto" : 0, flashAttention: "auto", contextSize: 8192 });
  expect(result.managedBackend?.extraArgs).toContain("--fit-target 1024");
  const manifest = JSON.parse(await readFile(path.join(temporaryRoot!, "local-models", "llm", "install.json"), "utf8"));
  expect(manifest.gpuAvailable).toBe(true);
});

it("falls back to a CPU configuration when the runtime exposes no compute GPU", async () => {
  const { installer } = await fixtureInstaller({ devices: "Available devices:\n  BLAS: Accelerate (0 MiB, 0 MiB free)" });
  const result = await installer.install({ componentIds: ["llm"], locale: "ru" });
  expect(result.managedBackend?.llamacpp?.gpuLayers).toBe(0);
});

it("keeps the old installation on DLL/runtime validation failure", async () => {
  const beforeReplace = vi.fn(async () => {});
  const { installer } = await fixtureInstaller({ runtimeError: "Missing VCRUNTIME140.dll", beforeReplace });
  const root = path.join(temporaryRoot!, "local-models", "llm");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "old.gguf"), "old model");
  await expect(installer.install({ componentIds: ["llm"], locale: "ru" })).rejects.toThrow("VCRUNTIME140.dll");
  await expect(readFile(path.join(root, "old.gguf"), "utf8")).resolves.toBe("old model");
  await expect(readFile(path.join(`${root}.installing`, "install.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(beforeReplace).not.toHaveBeenCalled();
});

it("releases the running backend only after new files have been verified, before promotion", async () => {
  let root: string;
  const beforeReplace = vi.fn(async (id: string) => {
    expect(id).toBe("llm");
    await expect(readFile(path.join(root, "old.gguf"), "utf8")).resolves.toBe("old model");
    expect(JSON.parse(await readFile(path.join(`${root}.installing`, "install.json"), "utf8")).gpuAvailable).toBe(true);
  });
  const { installer } = await fixtureInstaller({ beforeReplace });
  root = path.join(temporaryRoot!, "local-models", "llm");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "old.gguf"), "old model");
  await installer.install({ componentIds: ["llm"], locale: "ru" });
  expect(beforeReplace).toHaveBeenCalledOnce();
});

it("refuses a checksum mismatch before replacing an old model", async () => {
  const { installer, spec } = await fixtureInstaller();
  spec.model[0].digest = `sha256:${"0".repeat(64)}`;
  await expect(installer.install({ componentIds: ["llm"], locale: "ru" })).rejects.toThrow("Checksum mismatch");
  await expect(readFile(path.join(temporaryRoot!, "local-models", "llm", "install.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("locks the entire installation and honors cancellation during preflight", async () => {
  const { installer } = await fixtureInstaller();
  let release!: () => void;
  const reachedPreflight = new Promise<void>((resolve) => {
    installer.resolveRuntimeBytes = async () => { resolve(); await new Promise<void>((continueInstall) => { release = continueInstall; }); return runtimeZip.length; };
  });
  const pending = installer.install({ componentIds: ["llm"], locale: "ru" });
  const cancelled = expect(pending).rejects.toThrow();
  await reachedPreflight;
  await expect(installer.install({ componentIds: ["llm"], locale: "ru" })).rejects.toThrow("already in progress");
  await expect(installer.remove("llm")).rejects.toThrow("Wait for");
  installer.cancel();
  release();
  await cancelled;
  await expect(readFile(path.join(temporaryRoot!, "local-models", "llm", "install.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("downloads through a local HTTP server and retries a transient failure", async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vellium-installer-http-"));
  let requests = 0;
  server = createServer((_request, response) => {
    if (++requests === 1) { response.writeHead(503); response.end("retry"); return; }
    response.writeHead(200, { "Content-Length": "13" }); response.end("fixture-model");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const installer = await bundledInstaller();
  const target = path.join(temporaryRoot, "download.gguf");
  await installer.download("llm", { filename: "download.gguf", url: `http://127.0.0.1:${port}/model`, bytes: 13 }, target, new AbortController().signal);
  expect(requests).toBe(2);
  await expect(readFile(target, "utf8")).resolves.toBe("fixture-model");
});

it("handles file-write errors instead of hanging on a drain event", async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vellium-installer-write-"));
  server = createServer((_request, response) => { response.writeHead(200, { "Content-Length": "13" }); response.end("fixture-model"); });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const installer = await bundledInstaller();
  await expect(installer.download("llm", { filename: "model", url: `http://127.0.0.1:${port}/model`, bytes: 13 }, temporaryRoot, new AbortController().signal)).rejects.toThrow();
});

it("cancels an in-flight response without waiting for the remote server to finish", async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vellium-installer-cancel-"));
  let connected!: () => void;
  const responseStarted = new Promise<void>((resolve) => { connected = resolve; });
  server = createServer((_request, response) => { response.writeHead(200, { "Content-Length": "13" }); response.write("fix"); connected(); });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const installer = await bundledInstaller();
  const controller = new AbortController();
  const pending = installer.download("llm", { filename: "model", url: `http://127.0.0.1:${port}/model`, bytes: 13 }, path.join(temporaryRoot, "model"), controller.signal);
  const cancelled = expect(pending).rejects.toThrow();
  await responseStarted;
  controller.abort();
  await cancelled;
});

it("offers an update for installed StyleTune 26B and identifies Melody only after its GGUF is installed", async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vellium-installer-catalog-"));
  vi.stubEnv("SLV_DATA_DIR", temporaryRoot);
  const installer = await bundledInstaller();
  installer.resolveRuntimeBytes = async () => 0;
  const installed = path.join(temporaryRoot, "local-models", "llm");
  await mkdir(path.join(installed, "models"), { recursive: true });
  await writeFile(path.join(installed, "llama-server.exe"), "fixture-runtime");
  const oldFile = "gemma-4-26b-a4b-styletune-v2-q4_k_m-imat.gguf";
  await writeFile(path.join(installed, "models", oldFile), "old-model");
  const manifest = { componentId: "llm", variantId: "26b", executable: "llama-server.exe", modelFiles: [`models/${oldFile}`] };
  await writeFile(path.join(installed, "install.json"), JSON.stringify(manifest));
  const before = await installer.catalog();
  expect(before.items.find(item => item.id === "llm")).toMatchObject({ installed: false, updateAvailable: true, installedModelName: oldFile });
  expect(before.llmVariants.find(variant => variant.id === "26b")?.installed).toBe(false);

  const melody = findLocalLlmVariant("26b")!;
  await writeFile(path.join(installed, "models", melody.file), "replacement-model");
  await writeFile(path.join(installed, "install.json"), JSON.stringify({ ...manifest, modelFiles: [`models/${melody.file}`] }));
  const after = await installer.catalog();
  expect(after.items.find(item => item.id === "llm")).toMatchObject({ installed: true, updateAvailable: false, modelName: melody.modelName });
  expect(after.llmVariants.find(variant => variant.id === "26b")?.installed).toBe(true);
  await expect(readFile(path.join(installed, "models", oldFile), "utf8")).resolves.toBe("old-model");
});
