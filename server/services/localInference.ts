import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { DATA_DIR } from "../db/paths.js";
import { localPiperRuntimeId } from "../../src/shared/localModelConfig.js";

export const LOCAL_INFERENCE_URL = "vellium-local://inference";
const ROOT = path.join(DATA_DIR, "local-models");
const MAX_STDERR_CHARS = 16_000;

interface Manifest {
  version: 1;
  componentId: "stt" | "tts";
  modelFiles: string[];
  executable: string;
  runtimeId?: string;
  voice?: string;
}

function safeResolve(root: string, relative: string) {
  const resolved = path.resolve(root, relative);
  const relation = path.relative(root, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("Invalid local inference manifest path");
  return resolved;
}

async function loadManifest(componentId: "stt" | "tts") {
  const root = path.join(ROOT, componentId);
  const raw = JSON.parse(await readFile(path.join(root, "install.json"), "utf8")) as Manifest;
  if (raw.version !== 1 || raw.componentId !== componentId || !Array.isArray(raw.modelFiles) || !raw.modelFiles[0]) {
    throw new Error(`Local ${componentId.toUpperCase()} installation is invalid`);
  }
  if (componentId === "tts" && raw.runtimeId !== localPiperRuntimeId(process.platform, process.arch)) {
    throw new Error("Local TTS runtime is outdated or incompatible with this computer; reinstall OHF Voice in Settings");
  }
  const executable = safeResolve(root, String(raw.executable || ""));
  const models = raw.modelFiles.map((item) => safeResolve(root, String(item || "")));
  if (!existsSync(executable) || models.some((item) => !existsSync(item))) {
    throw new Error(`Local ${componentId.toUpperCase()} files are missing; reinstall the component`);
  }
  return { root, executable, models, voice: raw.voice };
}

async function runProcess(command: string, args: string[], options: { cwd: string; input?: string; timeoutMs: number }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Local inference timed out"));
    }, options.timeoutMs);
    timer.unref?.();
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-MAX_STDERR_CHARS);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Local inference exited with code ${code ?? "?"}${signal ? ` (${signal})` : ""}: ${stderr.trim().slice(-1000)}`));
    });
    child.stdin.end(options.input || undefined);
  });
}

export function buildLocalWhisperArgs(model: string, input: string, outputPrefix: string, language = "") {
  const normalizedLanguage = String(language || "").trim().toLowerCase();
  const resolvedLanguage = /^[a-z]{2,3}$/.test(normalizedLanguage) ? normalizedLanguage : "auto";
  return [
    "--model", model,
    "--file", input,
    "--language", resolvedLanguage,
    "--output-txt",
    "--output-file", outputPrefix,
    "--no-timestamps"
  ];
}

export async function transcribeLocalWhisper(audio: Buffer, mimeType: string, language = "") {
  const normalized = String(mimeType || "").split(";")[0].toLowerCase();
  if (normalized !== "audio/wav" && normalized !== "audio/x-wav") {
    throw new Error("Local Whisper requires PCM WAV audio; restart Live mode and record again");
  }
  const runtime = await loadManifest("stt");
  const temp = path.join(DATA_DIR, "local-models", ".tmp", randomUUID());
  await mkdir(temp, { recursive: true });
  const input = path.join(temp, "input.wav");
  const outputPrefix = path.join(temp, "transcript");
  try {
    await writeFile(input, audio, { flag: "wx" });
    await runProcess(
      runtime.executable,
      buildLocalWhisperArgs(runtime.models[0], input, outputPrefix, language),
      { cwd: path.dirname(runtime.executable), timeoutMs: 120_000 }
    );
    const text = (await readFile(`${outputPrefix}.txt`, "utf8")).trim();
    if (!text) throw new Error("Local Whisper returned an empty transcript");
    return text.slice(0, 100_000);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function synthesizeLocalPiper(input: string) {
  const runtime = await loadManifest("tts");
  const temp = path.join(DATA_DIR, "local-models", ".tmp", randomUUID());
  await mkdir(temp, { recursive: true });
  const output = path.join(temp, "speech.wav");
  try {
    await runProcess(runtime.executable, [
      "--model", runtime.models[0],
      "--config", runtime.models[1],
      "--output_file", output
    ], { cwd: path.dirname(runtime.executable), input: `${input}\n`, timeoutMs: 60_000 });
    const audio = await readFile(output);
    if (!audio.length) throw new Error("Local Piper returned empty audio");
    return audio;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
