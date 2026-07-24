import { describe, expect, it } from "vitest";
import { buildPermissionsPolicy } from "./permissionsPolicy";

describe("buildPermissionsPolicy", () => {
  it("allows microphone capture only for the same-origin application document", () => {
    expect(buildPermissionsPolicy("/")).toContain("microphone=(self)");
    expect(buildPermissionsPolicy("/live")).toContain("microphone=(self)");
  });

  it("keeps microphone access disabled for API and plugin asset responses", () => {
    expect(buildPermissionsPolicy("/api/health")).toContain("microphone=()");
    expect(buildPermissionsPolicy("/api/plugins/example/assets/index.html")).toContain("microphone=()");
  });

  it("keeps unrelated browser capabilities disabled", () => {
    const policy = buildPermissionsPolicy("/");
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain("payment=()");
    expect(policy).toContain("usb=()");
    expect(policy).toContain("midi=()");
  });
});
