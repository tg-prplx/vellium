import { describe, expect, it } from "vitest";
import { defaultManagedBackendConfig, normalizeManagedBackendConfig } from "./managedBackends";

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
