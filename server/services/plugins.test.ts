import { describe, expect, it } from "vitest";
import { PLUGIN_SDK_SOURCE } from "./plugins.js";

describe("PLUGIN_SDK_SOURCE", () => {
  it("pins plugin host messaging to the current origin and parent frame", () => {
    expect(PLUGIN_SDK_SOURCE).toContain("const HOST_ORIGIN = window.location.origin;");
    expect(PLUGIN_SDK_SOURCE).toContain("window.parent.postMessage({ __velliumPlugin: true, pluginId: PLUGIN_ID, frameId: FRAME_ID, type, ...payload }, HOST_ORIGIN);");
    expect(PLUGIN_SDK_SOURCE).toContain("if (event.origin !== HOST_ORIGIN) return;");
    expect(PLUGIN_SDK_SOURCE).toContain("if (event.source !== window.parent) return;");
  });
});
