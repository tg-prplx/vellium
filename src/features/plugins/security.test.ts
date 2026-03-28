import { describe, expect, it } from "vitest";
import { isTrustedPluginFrameMessage, normalizePluginApiRequest } from "./security";

describe("normalizePluginApiRequest", () => {
  it("keeps same-origin api routes and decodes path checks", () => {
    expect(normalizePluginApiRequest("/api/%61ccount/create?from=plugin", "http://localhost:1420")).toEqual({
      fetchPath: "/api/%61ccount/create?from=plugin",
      pathname: "/api/account/create"
    });
  });

  it("rejects cross-origin paths", () => {
    expect(() => normalizePluginApiRequest("https://example.com/api/chats", "http://localhost:1420"))
      .toThrow("Plugin API access is restricted to the current origin");
  });
});

describe("isTrustedPluginFrameMessage", () => {
  it("accepts only the exact iframe source and origin", () => {
    const frameSource = {} as MessageEventSource;
    expect(isTrustedPluginFrameMessage({
      origin: "http://localhost:1420",
      source: frameSource,
      data: {
        __velliumPlugin: true,
        pluginId: "hello-world",
        frameId: "plugin-frame:hello-world:default"
      }
    }, frameSource, "http://localhost:1420", "hello-world", "plugin-frame:hello-world:default")).toBe(true);
  });

  it("rejects forged messages from a different source", () => {
    expect(isTrustedPluginFrameMessage({
      origin: "http://localhost:1420",
      source: {} as MessageEventSource,
      data: {
        __velliumPlugin: true,
        pluginId: "hello-world",
        frameId: "plugin-frame:hello-world:default"
      }
    }, {} as MessageEventSource, "http://localhost:1420", "hello-world", "plugin-frame:hello-world:default")).toBe(false);
  });

  it("rejects origin mismatches", () => {
    const frameSource = {} as MessageEventSource;
    expect(isTrustedPluginFrameMessage({
      origin: "http://evil.local",
      source: frameSource,
      data: {
        __velliumPlugin: true,
        pluginId: "hello-world",
        frameId: "plugin-frame:hello-world:default"
      }
    }, frameSource, "http://localhost:1420", "hello-world", "plugin-frame:hello-world:default")).toBe(false);
  });
});
