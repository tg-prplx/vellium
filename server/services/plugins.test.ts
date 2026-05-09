import { describe, expect, it } from "vitest";
import { PLUGIN_SDK_SOURCE } from "./plugins.js";

describe("PLUGIN_SDK_SOURCE", () => {
  it("pins plugin host messaging to the embedding parent origin and parent frame", () => {
    expect(PLUGIN_SDK_SOURCE).toContain("return new URL(document.referrer || window.location.href).origin;");
    expect(PLUGIN_SDK_SOURCE).toContain("HOST_ORIGIN === 'null' ? '*' : HOST_ORIGIN");
    expect(PLUGIN_SDK_SOURCE).toContain("if (HOST_ORIGIN !== '*' && event.origin !== HOST_ORIGIN) return;");
    expect(PLUGIN_SDK_SOURCE).toContain("if (event.source !== window.parent) return;");
  });
});
