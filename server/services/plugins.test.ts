import { describe, expect, it } from "vitest";
import { PLUGIN_SDK_SOURCE } from "./plugins.js";
import { normalizePluginfile, sanitizePluginDirSegment, sanitizeRelativeAssetPath } from "./plugins/manifest.js";

describe("PLUGIN_SDK_SOURCE", () => {
  it("pins plugin host messaging to the embedding parent origin and parent frame", () => {
    expect(PLUGIN_SDK_SOURCE).toContain("return new URL(document.referrer || window.location.href).origin;");
    expect(PLUGIN_SDK_SOURCE).toContain("HOST_ORIGIN === 'null' ? '*' : HOST_ORIGIN");
    expect(PLUGIN_SDK_SOURCE).toContain("if (HOST_ORIGIN !== '*' && event.origin !== HOST_ORIGIN) return;");
    expect(PLUGIN_SDK_SOURCE).toContain("if (event.source !== window.parent) return;");
  });
});

describe("plugin package path security", () => {
  it("rejects traversal, drive paths, dot segments, and reserved manifests", () => {
    expect(sanitizeRelativeAssetPath("../secret.txt")).toBeNull();
    expect(sanitizeRelativeAssetPath("assets/../secret.txt")).toBeNull();
    expect(sanitizeRelativeAssetPath("C:/secret.txt")).toBeNull();
    expect(sanitizePluginDirSegment("..")).toBe("plugin");
    expect(normalizePluginfile({
      format: "vellium-pluginfile@1",
      manifest: { id: "safe-plugin", name: "Safe" },
      files: { "plugin.json": "{}" }
    })).toBeNull();
  });

  it("keeps normal nested plugin assets valid", () => {
    expect(sanitizeRelativeAssetPath("assets/panel.html")).toBe("assets/panel.html");
  });
});
