import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_SETTINGS_ARRAY,
  MAX_PLUGIN_SETTINGS_STRING,
  buildPluginAssetHeaders,
  sanitizePluginSettingsPatch
} from "./pluginSecurity.js";

describe("sanitizePluginSettingsPatch", () => {
  it("keeps only supported JSON-like values", () => {
    expect(sanitizePluginSettingsPatch({
      ok: true,
      count: 4,
      text: "value",
      nested: { enabled: false },
      list: [1, "two", null],
      fn: () => "nope"
    })).toEqual({
      ok: true,
      count: 4,
      text: "value",
      nested: { enabled: false },
      list: [1, "two", null]
    });
  });

  it("caps strings and arrays", () => {
    const result = sanitizePluginSettingsPatch({
      text: "x".repeat(MAX_PLUGIN_SETTINGS_STRING + 50),
      list: Array.from({ length: MAX_PLUGIN_SETTINGS_ARRAY + 5 }, (_, index) => index)
    });
    expect(result.text).toHaveLength(MAX_PLUGIN_SETTINGS_STRING);
    expect(Array.isArray(result.list) ? result.list.length : -1).toBe(MAX_PLUGIN_SETTINGS_ARRAY);
  });

  it("rejects non-object patches", () => {
    expect(() => sanitizePluginSettingsPatch([])).toThrow("settings patch must be an object");
  });

  it("drops dangerous object keys", () => {
    expect(sanitizePluginSettingsPatch(JSON.parse(`{
      "ok": true,
      "__proto__": { "polluted": true },
      "nested": {
        "constructor": "nope",
        "fine": "yes"
      }
    }`))).toEqual({
      ok: true,
      nested: {
        fine: "yes"
      }
    });
  });
});

describe("buildPluginAssetHeaders", () => {
  it("returns stricter CSP for html assets", () => {
    const headers = buildPluginAssetHeaders("html");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
