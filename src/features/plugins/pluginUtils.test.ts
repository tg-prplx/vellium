import { describe, expect, it } from "vitest";
import { applyPluginTemplate, buildPluginInlineRequest } from "./utils";
import type { PluginActionContribution, PluginDescriptor } from "../../shared/types/contracts";

const plugin: PluginDescriptor = {
  id: "demo-plugin",
  name: "Demo Plugin",
  version: "0.1.0",
  apiVersion: 1,
  description: "",
  author: "",
  defaultEnabled: true,
  enabled: true,
  assetBaseUrl: "/api/plugins/demo-plugin/assets",
  permissions: ["api.read", "api.write", "pluginSettings.read", "pluginSettings.write", "host.resize"],
  tabs: [],
  slots: [],
  actions: []
};

describe("applyPluginTemplate", () => {
  it("replaces primitive placeholders in strings", () => {
    expect(applyPluginTemplate("/api/chats/{{chatId}}/fork", { chatId: "abc-123" })).toBe("/api/chats/abc-123/fork");
  });

  it("replaces nested placeholders in arrays and objects", () => {
    expect(applyPluginTemplate({
      title: "{{name}}",
      flags: ["{{enabled}}", "{{count}}"],
      nested: { locale: "{{locale}}" }
    }, {
      name: "Plugin",
      enabled: true,
      count: 4,
      locale: "en"
    })).toEqual({
      title: "Plugin",
      flags: ["true", "4"],
      nested: { locale: "en" }
    });
  });
});

describe("buildPluginInlineRequest", () => {
  it("builds a templated inline request from action context", () => {
    const action: PluginActionContribution = {
      id: "inline-save",
      location: "chat.message",
      label: "Save",
      title: "Save",
      path: "",
      order: 1,
      width: 640,
      height: 320,
      mode: "inline",
      request: {
        method: "PATCH",
        path: "/api/plugins/{{pluginId}}/settings",
        body: {
          lastTab: "{{activeTab}}",
          messageId: "{{messageId}}"
        }
      },
      confirmText: undefined,
      successMessage: undefined,
      reloadPlugins: false,
      variant: "ghost",
      url: ""
    };

    expect(buildPluginInlineRequest(plugin, action, "chat", "en", { messageId: "msg-42" })).toEqual({
      method: "PATCH",
      path: "/api/plugins/demo-plugin/settings",
      body: {
        lastTab: "chat",
        messageId: "msg-42"
      }
    });
  });

  it("returns null for modal actions", () => {
    const action: PluginActionContribution = {
      id: "modal-open",
      location: "chat.composer",
      label: "Open",
      title: "Open",
      path: "widget.html",
      order: 1,
      width: 640,
      height: 320,
      mode: "modal",
      request: undefined,
      confirmText: undefined,
      successMessage: undefined,
      reloadPlugins: false,
      variant: "ghost",
      url: "/api/plugins/demo-plugin/assets/widget.html"
    };

    expect(buildPluginInlineRequest(plugin, action, "chat", "en")).toBeNull();
  });
});
