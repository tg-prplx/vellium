import { describe, expect, it } from "vitest";
import { buildManagedBackendLaunch, defaultManagedBackendConfig, normalizeManagedBackendConfig, parseManagedBackendCommand } from "./managedBackends";

describe("managed backend startup timeout", () => {
  it("gives old backend profiles a five-minute startup window", () => {
    const normalized = normalizeManagedBackendConfig({
      id: "old-backend",
      name: "Old backend"
    });

    expect(defaultManagedBackendConfig().startTimeoutSeconds).toBe(300);
    expect(normalized?.startTimeoutSeconds).toBe(300);
  });

  it("clamps per-backend startup timeouts to a safe range", () => {
    expect(normalizeManagedBackendConfig({ startTimeoutSeconds: 1 })?.startTimeoutSeconds).toBe(15);
    expect(normalizeManagedBackendConfig({ startTimeoutSeconds: 99_999 })?.startTimeoutSeconds).toBe(3600);
  });
});

describe("native llama.cpp managed backend", () => {
  it("normalizes and launches llama-server without a shell wrapper", () => {
    const normalized = normalizeManagedBackendConfig({
      id: "llama",
      name: "Local model",
      backendKind: "llamacpp",
      providerType: "openai",
      llamacpp: {
        executable: "/Applications/Local AI/llama-server",
        modelPath: "/Models/story model.gguf",
        contextSize: 16_384,
        gpuLayers: 999,
        threads: 10
      }
    });
    expect(normalized?.backendKind).toBe("llamacpp");
    const launch = buildManagedBackendLaunch(normalized!);
    expect(launch.command).toBe("/Applications/Local AI/llama-server");
    expect(launch.args).toContain("/Models/story model.gguf");
    expect(launch.args).toContain("16384");
    expect(launch.args).toContain("999");
  });

  it("imports the common llama-server command flags", () => {
    const patch = parseManagedBackendCommand("llama-server -m /models/a.gguf -c 4096 -ngl 48 --port 9090 --jinja", "llamacpp");
    expect(patch?.llamacpp).toMatchObject({
      executable: "llama-server",
      modelPath: "/models/a.gguf",
      contextSize: 4096,
      gpuLayers: 48,
      port: 9090,
      jinja: true
    });
  });
});

describe("managed KoboldCpp context cache", () => {
  it("normalizes SmartCache slots and adds the launch flag", () => {
    const normalized = normalizeManagedBackendConfig({
      id: "kobold",
      name: "KoboldCpp",
      backendKind: "koboldcpp",
      providerType: "koboldcpp",
      koboldcpp: {
        smartCacheSlots: 4
      }
    });

    expect(normalized?.koboldcpp?.smartCacheSlots).toBe(4);
    const launch = buildManagedBackendLaunch(normalized!);
    expect(launch.args).toContain("--smartcache");
    expect(launch.args).toContain("4");
  });

  it("imports SmartCache with an explicit or default slot count", () => {
    expect(parseManagedBackendCommand(
      "koboldcpp --model /models/rp.gguf --smartcache 6",
      "koboldcpp"
    )?.koboldcpp).toMatchObject({ smartCacheSlots: 6 });
    expect(parseManagedBackendCommand(
      "koboldcpp --model /models/rp.gguf --smartcache --flashattention",
      "koboldcpp"
    )?.koboldcpp).toMatchObject({ smartCacheSlots: 1, flashAttention: true });
  });
});
