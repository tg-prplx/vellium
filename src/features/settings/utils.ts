import type {
  ApiParamPolicy,
  PluginDescriptor,
  PluginSettingsFieldContribution,
  PromptBlock
} from "../../shared/types/contracts";
import { DEFAULT_API_PARAM_POLICY, DEFAULT_PROMPT_STACK } from "./config";

export function normalizePromptStack(raw: PromptBlock[] | null | undefined): PromptBlock[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_PROMPT_STACK];

  return [...raw]
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({ ...block, order: index + 1 }));
}

export function promptBlockLabel(kind: PromptBlock["kind"]): string {
  if (kind === "jailbreak") return "Character lock";
  return kind.replace("_", " ");
}

export function normalizeApiParamPolicy(raw: ApiParamPolicy | null | undefined): ApiParamPolicy {
  return {
    openai: {
      ...DEFAULT_API_PARAM_POLICY.openai,
      ...(raw?.openai ?? {})
    },
    kobold: {
      ...DEFAULT_API_PARAM_POLICY.kobold,
      ...(raw?.kobold ?? {})
    }
  };
}

export function scrollToSettingsSection(id: string) {
  const node = document.getElementById(id);
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}

const HIGH_RISK_PLUGIN_PERMISSIONS = new Set(["api.write", "pluginSettings.write"]);
const MEDIUM_RISK_PLUGIN_PERMISSIONS = new Set(["pluginSettings.read"]);

export function hasHighRiskPluginPermissions(permissions: string[]): boolean {
  return permissions.some((permission) => HIGH_RISK_PLUGIN_PERMISSIONS.has(permission));
}

export function pluginPermissionTone(permission: string): "high" | "medium" | "normal" {
  if (HIGH_RISK_PLUGIN_PERMISSIONS.has(permission)) return "high";
  if (MEDIUM_RISK_PLUGIN_PERMISSIONS.has(permission)) return "medium";
  return "normal";
}

export function pluginPermissionDescription(t: (key: any) => string, permission: string): string {
  switch (permission) {
    case "api.read":
      return t("settings.pluginPermissionHelp.api.read");
    case "api.write":
      return t("settings.pluginPermissionHelp.api.write");
    case "pluginSettings.read":
      return t("settings.pluginPermissionHelp.pluginSettings.read");
    case "pluginSettings.write":
      return t("settings.pluginPermissionHelp.pluginSettings.write");
    case "host.resize":
      return t("settings.pluginPermissionHelp.host.resize");
    default:
      return permission;
  }
}

export function buildPluginSettingsDraft(
  plugin: PluginDescriptor,
  current: Record<string, unknown>
): Record<string, string | number | boolean> {
  const draft: Record<string, string | number | boolean> = {};

  for (const field of plugin.settingsFields) {
    const stored = current[field.key];
    if (typeof stored === "boolean" || typeof stored === "number" || typeof stored === "string") {
      draft[field.key] = stored;
      continue;
    }
    if (field.defaultValue !== undefined) {
      draft[field.key] = field.defaultValue;
      continue;
    }
    draft[field.key] = field.type === "toggle" ? false : field.type === "number" || field.type === "range" ? 0 : "";
  }

  return draft;
}

export function sanitizePluginSettingsFieldValue(
  field: PluginSettingsFieldContribution,
  raw: string | number | boolean
): string | number | boolean {
  if (field.type === "toggle") return raw === true;

  if (field.type === "number" || field.type === "range") {
    const value = Number(raw);
    const fallback = typeof field.defaultValue === "number" ? field.defaultValue : field.min ?? 0;
    if (!Number.isFinite(value)) return fallback;
    const min = typeof field.min === "number" && Number.isFinite(field.min) ? field.min : value;
    const max = typeof field.max === "number" && Number.isFinite(field.max) ? field.max : value;
    return Math.max(min, Math.min(max, value));
  }

  return String(raw ?? "");
}

export function buildPluginPermissionDraft(plugin: PluginDescriptor): Record<string, boolean> {
  return Object.fromEntries(
    plugin.requestedPermissions.map((permission) => [permission, plugin.grantedPermissions.includes(permission)])
  );
}
