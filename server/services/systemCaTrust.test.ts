import { describe, expect, it, vi } from "vitest";
import { enableSystemCaTrust } from "./systemCaTrust.js";

describe("enableSystemCaTrust", () => {
  it("preserves existing roots and adds system-trusted roots", () => {
    const setDefaultCACertificates = vi.fn();
    const result = enableSystemCaTrust({
      getCACertificates: (type) => type === "system"
        ? ["system-ca", "shared-ca"]
        : ["bundled-ca", "shared-ca", "extra-ca"],
      setDefaultCACertificates
    });

    expect(result).toEqual({
      supported: true,
      applied: true,
      addedCertificates: 1
    });
    expect(setDefaultCACertificates).toHaveBeenCalledWith([
      "bundled-ca",
      "shared-ca",
      "extra-ca",
      "system-ca"
    ]);
  });

  it("does not replace the CA set when system roots are already active", () => {
    const setDefaultCACertificates = vi.fn();
    const result = enableSystemCaTrust({
      getCACertificates: () => ["bundled-ca", "system-ca"],
      setDefaultCACertificates
    });

    expect(result).toEqual({
      supported: true,
      applied: false,
      addedCertificates: 0
    });
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });

  it("remains compatible with Node runtimes that lack the system CA APIs", () => {
    expect(enableSystemCaTrust({})).toEqual({
      supported: false,
      applied: false,
      addedCertificates: 0
    });
  });

  it("keeps startup resilient when the operating-system store cannot be read", () => {
    expect(enableSystemCaTrust({
      getCACertificates: () => {
        throw new Error("system store unavailable");
      },
      setDefaultCACertificates: vi.fn()
    })).toEqual({
      supported: true,
      applied: false,
      addedCertificates: 0
    });
  });
});
