import { describe, expect, it } from "vitest";
import { buildManagedBackendLaunch, normalizeManagedBackendConfig } from "./managedBackends";
import {
  buildLocalLlamaManagedBackend,
  buildDetectedLlamaManagedBackend,
  localPiperRuntimeId,
  localTeraTtsRuntimeId,
  localWhisperModelUrl,
  LOCAL_WHISPER_MODEL_BYTES,
  LOCAL_WHISPER_MODEL_FILE,
  LOCAL_WHISPER_MODEL_ID,
  LOCAL_WHISPER_MODEL_REVISION,
  LOCAL_WHISPER_MODEL_SHA256,
  LOCAL_TERATTS_DEFAULT_VOICE,
  LOCAL_TERATTS_MODEL_REVISION,
  LOCAL_TERATTS_RUNTIME_VERSION,
  LOCAL_TERATTS_VOICE_PROFILES,
  LOCAL_TERATTS_VOICES,
  LOCAL_PIPER_VERSION
} from "./localModelConfig";
import { findLocalLlmVariant, LOCAL_LLM_VARIANTS } from "./localLlmVariants";

const heaviest = LOCAL_LLM_VARIANTS[LOCAL_LLM_VARIANTS.length - 1];

describe("local llama.cpp backend config", () => {
  it("keeps the executable path and all recommended launch arguments", () => {
    const config = buildLocalLlamaManagedBackend(
      "/Applications/Vellium Data/llama-server",
      "/Applications/Vellium Data/model.gguf",
      { accelerator: "metal" },
      10,
      heaviest
    );
    const launch = buildManagedBackendLaunch(config);
    expect(config.backendKind).toBe("llamacpp");
    expect(launch.command).toBe("/Applications/Vellium Data/llama-server");
    expect(launch.args).toContain("/Applications/Vellium Data/model.gguf");
    expect(launch.args).toContain("--ctx-size");
    expect(launch.args).toContain(String(heaviest.contextSize));
    expect(launch.args).toContain("--n-gpu-layers");
    expect(launch.args[launch.args.indexOf("--n-gpu-layers") + 1]).toBe("auto");
    expect(launch.args[launch.args.indexOf("--flash-attn") + 1]).toBe("auto");
    expect(launch.args).toContain("--fit-target");
    expect(launch.args).toContain("1024");
    expect(launch.args[launch.args.indexOf("--parallel") + 1]).toBe("1");
    expect(buildManagedBackendLaunch(normalizeManagedBackendConfig(config)!).args).toEqual(launch.args);
  });

  it("creates a native managed profile for an auto-detected GGUF", () => {
    const config = buildDetectedLlamaManagedBackend("/usr/local/bin/llama-server", "/models/roleplay.gguf", "metal", 12);
    expect(config.backendKind).toBe("llamacpp");
    expect(config.llamacpp).toMatchObject({ modelPath: "/models/roleplay.gguf", gpuLayers: 999, threads: 12 });
    expect(buildManagedBackendLaunch(config).args).toContain("--jinja");
  });

  it("names the backend and default model after the installed variant", () => {
    const lightest = findLocalLlmVariant("e2b")!;
    const config = buildLocalLlamaManagedBackend("/data/llama-server", "/data/model.gguf", { accelerator: "cpu" }, 4, lightest);
    expect(config.name).toBe(`${lightest.label} (llama.cpp)`);
    expect(config.defaultModel).toBe(lightest.file);
    expect(buildManagedBackendLaunch(config).args).toContain(String(lightest.contextSize));
    expect(config.llamacpp?.gpuLayers).toBe(0);
  });

  it("keeps single-core and malformed thread counts usable", () => {
    expect(buildLocalLlamaManagedBackend("a", "b", { accelerator: "cpu" }, 0, heaviest).llamacpp?.threads).toBe(1);
    expect(buildLocalLlamaManagedBackend("a", "b", { accelerator: "cpu" }, NaN, heaviest).llamacpp?.threads).toBe(4);
  });
});

describe("local Whisper model", () => {
  it("pins the multilingual Large v3 Turbo Q5_0 artifact", () => {
    expect(LOCAL_WHISPER_MODEL_ID).toBe("whisper-large-v3-turbo-q5_0");
    expect(LOCAL_WHISPER_MODEL_FILE).toBe("ggml-large-v3-turbo-q5_0.bin");
    expect(LOCAL_WHISPER_MODEL_BYTES).toBe(574_041_195);
    expect(LOCAL_WHISPER_MODEL_SHA256).toHaveLength(64);
    expect(localWhisperModelUrl()).toContain(`/resolve/${LOCAL_WHISPER_MODEL_REVISION}/`);
    expect(localWhisperModelUrl()).toContain(LOCAL_WHISPER_MODEL_FILE);
  });
});

describe("local OHF Voice runtime identity", () => {
  it("binds an installation to the Piper version, operating system, and CPU architecture", () => {
    expect(localPiperRuntimeId("darwin", "arm64"))
      .toBe(`ohf-piper-v${LOCAL_PIPER_VERSION}-darwin-arm64`);
    expect(localPiperRuntimeId("darwin", "x64"))
      .not.toBe(localPiperRuntimeId("darwin", "arm64"));
  });
});

describe("local TeraTTSv2 runtime identity", () => {
  it("pins the model revision, runtime generation, platform, and architecture", () => {
    expect(LOCAL_TERATTS_RUNTIME_VERSION).toBe("2");
    expect(localTeraTtsRuntimeId("darwin", "arm64"))
      .toContain(LOCAL_TERATTS_MODEL_REVISION.slice(0, 8));
    expect(localTeraTtsRuntimeId("darwin", "x64"))
      .not.toBe(localTeraTtsRuntimeId("darwin", "arm64"));
  });

  it("exposes all ten selectable voices and marks the recommended Russian pair", () => {
    expect(LOCAL_TERATTS_VOICES).toHaveLength(10);
    expect(new Set(LOCAL_TERATTS_VOICES).size).toBe(10);
    expect(LOCAL_TERATTS_VOICES).toContain(LOCAL_TERATTS_DEFAULT_VOICE);
    expect(LOCAL_TERATTS_VOICE_PROFILES.filter((voice) => voice.recommended).map((voice) => voice.id))
      .toEqual(["ru_f1", "ru_m5"]);
  });
});
