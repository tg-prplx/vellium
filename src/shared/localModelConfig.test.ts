import { describe, expect, it } from "vitest";
import { buildManagedBackendLaunch } from "./managedBackends";
import { buildLocalLlamaManagedBackend } from "./localModelConfig";

describe("local llama.cpp backend config", () => {
  it("keeps the executable path and all recommended launch arguments", () => {
    const config = buildLocalLlamaManagedBackend(
      "/Applications/Vellium Data/llama-server",
      "/Applications/Vellium Data/model.gguf",
      { accelerator: "metal" },
      10
    );
    const launch = buildManagedBackendLaunch(config);
    expect(launch.command).toBe("/Applications/Vellium Data/llama-server");
    expect(launch.args).toContain("/Applications/Vellium Data/model.gguf");
    expect(launch.args).toContain("--ctx-size");
    expect(launch.args).toContain("8192");
    expect(launch.args).toContain("--n-gpu-layers");
    expect(launch.args).toContain("999");
  });
});
