import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./contentSecurityPolicy";

describe("frontend Content-Security-Policy", () => {
  it("allows app-created media blobs without allowing blob scripts", () => {
    const policy = buildContentSecurityPolicy(false);
    expect(policy).toContain("media-src 'self' blob: data:");
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).not.toContain("script-src 'self' blob:");
  });

  it("keeps public mode connections same-origin", () => {
    expect(buildContentSecurityPolicy(true)).toContain("connect-src 'self'");
    expect(buildContentSecurityPolicy(true)).not.toContain("http://127.0.0.1:3001");
  });
});
