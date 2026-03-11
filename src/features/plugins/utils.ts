import type { PluginActionContribution, PluginDescriptor } from "../../shared/types/contracts";

export function applyPluginTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{([^}]+)\}\}/g, (_match, keyRaw) => {
      const key = String(keyRaw || "").trim();
      const resolved = context[key];
      if (resolved === null || resolved === undefined) return "";
      return typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean"
        ? String(resolved)
        : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyPluginTemplate(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, applyPluginTemplate(item, context)])
    );
  }
  return value;
}

export function buildPluginInlineRequest(
  plugin: PluginDescriptor,
  action: PluginActionContribution,
  activeTab: string,
  locale: string,
  payload?: Record<string, unknown>
) {
  if (action.mode !== "inline" || !action.request) return null;
  const context = {
    pluginId: plugin.id,
    activeTab,
    locale,
    ...(payload || {})
  };
  return {
    method: action.request.method,
    path: String(applyPluginTemplate(action.request.path, context) || ""),
    body: action.request.body === undefined ? undefined : applyPluginTemplate(action.request.body, context)
  };
}
