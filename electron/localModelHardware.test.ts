import { describe, expect, it, vi } from "vitest";
import { detectLocalModelHardware, parseNvidiaMemory, parseWindowsGpuMemory } from "./localModelHardware";

const GIB = 1024 ** 3;
const noGpu = async () => ({ gpuDevice: [] });

describe("local GPU and VRAM detection", () => {
  it("uses driver-reported NVIDIA VRAM above the uint32 limit", async () => {
    const hardware = await detectLocalModelHardware({ platform: "win32", arch: "x64", memoryBytes: 32 * GIB, gpuInfo: noGpu,
      commandProbe: async (command) => command === "nvidia-smi" ? "NVIDIA GeForce RTX 4090, 24564, 20000\n" : JSON.stringify([{ name: "NVIDIA GeForce RTX 4090", memoryBytes: 4 * GIB - 1 }]) });
    expect(hardware.accelerator).toBe("vulkan");
    expect(hardware.gpuMemoryBytes).toBe(24564 * 1024 ** 2);
    expect(hardware.gpuMemoryFreeBytes).toBe(20000 * 1024 ** 2);
    expect(hardware.gpuDevices).toHaveLength(1);
  });

  it("finds a discrete GPU even when Chromium uses the integrated GPU", async () => {
    const hardware = await detectLocalModelHardware({ platform: "win32", arch: "x64", memoryBytes: 16 * GIB,
      gpuInfo: async () => ({ gpuDevice: [{ vendorId: 0x8086, active: true }, { vendorId: 0x10de, active: false }] }),
      commandProbe: async (command) => command === "nvidia-smi" ? "NVIDIA RTX 3060, 12288, 10000" : "[]" });
    expect(hardware.gpuLabel).toContain("RTX 3060");
    expect(hardware.gpuMemoryBytes).toBe(12 * GIB);
  });

  it("recognizes inactive adapters and never mistakes software rendering for physical VRAM", async () => {
    const hardware = await detectLocalModelHardware({ platform: "win32", arch: "x64", memoryBytes: 16 * GIB,
      gpuInfo: async () => ({ gpuDevice: [{ vendorId: 0x1002, active: false, deviceString: "AMD Radeon RX 6800" }] }), commandProbe: async () => "" });
    expect(hardware).toMatchObject({ accelerator: "vulkan", gpuLabel: "AMD Radeon RX 6800", gpuMemoryBytes: null });
    expect(parseWindowsGpuMemory('[{"name":"Microsoft Basic Display Adapter","memoryBytes":4294967295}]')).toEqual([]);
    const software = await detectLocalModelHardware({ platform: "win32", arch: "x64", memoryBytes: 16 * GIB,
      gpuInfo: async () => ({ gpuDevice: [{ vendorId: 0x1414, active: true, deviceString: "Microsoft Basic Render Driver" }] }), commandProbe: async () => "" });
    expect(software.accelerator).toBe("cpu");
  });

  it("treats Apple Silicon RAM as shared memory even with Chromium GPU acceleration disabled", async () => {
    const hardware = await detectLocalModelHardware({ platform: "darwin", arch: "arm64", memoryBytes: 24 * GIB,
      gpuInfo: async () => { throw Error("GPU disabled"); }, commandProbe: async () => JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "Apple M4" }] }) });
    expect(hardware).toMatchObject({ accelerator: "metal", gpuLabel: "Apple M4", unifiedMemory: true, memoryBytes: 24 * GIB, gpuMemoryBytes: null });
  });

  it("keeps unknown VRAM explicit and rejects malformed driver values", () => {
    expect(parseNvidiaMemory("NVIDIA GPU, N/A, N/A")).toEqual([]);
    expect(parseNvidiaMemory("NVIDIA GPU, 8192, N/A")[0].freeMemoryBytes).toBeNull();
    expect(parseNvidiaMemory("NVIDIA GPU, 8192, 99999")[0].freeMemoryBytes).toBeNull();
    expect(parseWindowsGpuMemory('[{"name":"AMD GPU"}]')[0].memoryBytes).toBeNull();
    expect(parseWindowsGpuMemory("bad json")).toEqual([]);
  });

  it("bounds a stuck Chromium hardware request", async () => {
    vi.useFakeTimers();
    try {
      const pending = detectLocalModelHardware({ platform: "win32", arch: "x64", gpuInfo: () => new Promise(() => {}), commandProbe: async () => "" });
      await vi.advanceTimersByTimeAsync(4_000);
      expect((await pending).accelerator).toBe("cpu");
    } finally { vi.useRealTimers(); }
  });
});
