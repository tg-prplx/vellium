import { describe, expect, it } from "vitest";
import { buildManagedBackendLaunch } from "./managedBackends";
import {
  buildLocalLlamaManagedBackend,
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
    expect(launch.command).toBe("/Applications/Vellium Data/llama-server");
    expect(launch.args).toContain("/Applications/Vellium Data/model.gguf");
    expect(launch.args).toContain("--ctx-size");
    expect(launch.args).toContain(String(heaviest.contextSize));
    expect(launch.args).toContain("--n-gpu-layers");
    expect(launch.args).toContain("999");
  });

  it("names the backend and default model after the installed variant", () => {
    const lightest = findLocalLlmVariant("e2b")!;
    const config = buildLocalLlamaManagedBackend("/data/llama-server", "/data/model.gguf", { accelerator: "cpu" }, 4, lightest);
    expect(config.name).toBe(`${lightest.label} (llama.cpp)`);
    expect(config.defaultModel).toBe(lightest.file);
    expect(buildManagedBackendLaunch(config).args).toContain(String(lightest.contextSize));
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
