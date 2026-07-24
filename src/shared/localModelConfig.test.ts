import { describe, expect, it } from "vitest";
import { buildManagedBackendLaunch } from "./managedBackends";
import {
  buildLocalLlamaManagedBackend,
  localPiperRuntimeId,
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

describe("local OHF Voice runtime identity", () => {
  it("binds an installation to the Piper version, operating system, and CPU architecture", () => {
    expect(localPiperRuntimeId("darwin", "arm64"))
      .toBe(`ohf-piper-v${LOCAL_PIPER_VERSION}-darwin-arm64`);
    expect(localPiperRuntimeId("darwin", "x64"))
      .not.toBe(localPiperRuntimeId("darwin", "arm64"));
  });
});
