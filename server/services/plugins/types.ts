export const PLUGIN_SLOT_IDS = [
  "chat.sidebar.bottom",
  "chat.inspector.bottom",
  "chat.composer.bottom",
  "chat.message.bottom",
  "writing.sidebar.bottom",
  "writing.editor.bottom",
  "settings.bottom"
] as const;

export type PluginSlotId = typeof PLUGIN_SLOT_IDS[number];

export const PLUGIN_ACTION_LOCATIONS = [
  "app.toolbar",
  "chat.composer",
  "chat.message",
  "writing.toolbar",
  "writing.editor"
] as const;

export type PluginActionLocation = typeof PLUGIN_ACTION_LOCATIONS[number];

export const ALL_PLUGIN_PERMISSIONS = [
  "api.read",
  "api.write",
  "pluginSettings.read",
  "pluginSettings.write",
  "host.resize"
] as const;

export type PluginPermission = typeof ALL_PLUGIN_PERMISSIONS[number];

export interface PluginTabManifest {
  id: string;
  label: string;
  path: string;
  order: number;
}

export interface PluginSlotManifest {
  id: string;
  slot: PluginSlotId;
  title: string;
  path: string;
  order: number;
  height: number;
}

export interface PluginActionManifest {
  id: string;
  location: PluginActionLocation;
  label: string;
  title: string;
  path: string;
  order: number;
  width: number;
  height: number;
  mode: "modal" | "inline";
  request?: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  };
  confirmText?: string;
  successMessage?: string;
  reloadPlugins: boolean;
  variant: "ghost" | "accent";
}

export interface PluginSettingsFieldOption {
  value: string;
  label: string;
}

export interface PluginSettingsFieldManifest {
  id: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "toggle" | "select" | "number" | "range" | "secret";
  description?: string;
  placeholder?: string;
  options?: PluginSettingsFieldOption[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  order: number;
  required: boolean;
}

export interface PluginThemeManifest {
  id: string;
  label: string;
  description?: string;
  base: "dark" | "light";
  order: number;
  variables: Record<string, string>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  author: string;
  defaultEnabled: boolean;
  permissions: PluginPermission[];
  settingsFields: PluginSettingsFieldManifest[];
  themes: PluginThemeManifest[];
  tabs: PluginTabManifest[];
  slots: PluginSlotManifest[];
  actions: PluginActionManifest[];
}

export interface PluginDescriptor extends PluginManifest {
  enabled: boolean;
  source: "user" | "bundled";
  assetBaseUrl: string;
  requestedPermissions: PluginPermission[];
  grantedPermissions: PluginPermission[];
  permissionsConfigured: boolean;
  tabs: Array<PluginTabManifest & { url: string }>;
  slots: Array<PluginSlotManifest & { url: string }>;
  actions: Array<PluginActionManifest & { url: string }>;
}

export interface PluginCatalog {
  pluginsDir: string;
  bundledPluginsDir: string;
  sdkUrl: string;
  slotIds: PluginSlotId[];
  plugins: PluginDescriptor[];
}

export interface PluginfileDocument {
  format: "vellium-pluginfile@1";
  manifest: Record<string, unknown>;
  files: Record<string, string>;
}

export interface PluginDiscoveryCache {
  signature: string;
  catalog: PluginCatalog;
  rootDirs: Record<string, string>;
}
