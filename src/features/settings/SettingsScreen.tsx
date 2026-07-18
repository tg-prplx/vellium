import { useEffect, useMemo, useRef, useState } from "react";
import { isPluginDevAutoRefreshEnabled, PluginSlotMount, setPluginDevAutoRefreshEnabled, usePlugins } from "../plugins/PluginHost";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import { triggerBlobDownload } from "../../shared/download";
import { PROVIDER_PRESETS, type ProviderPreset } from "../../shared/providerPresets";
import { buildManagedBackendCommand, defaultManagedBackendConfig, normalizeManagedBackends, parseManagedBackendCommand, resolveManagedBackendBaseUrl } from "../../shared/managedBackends";
import type { ApiParamPolicy, AppSettings, ManagedBackendConfig, ManagedBackendLogEntry, ManagedBackendRuntimeState, McpDiscoveredTool, McpServerConfig, McpServerTestResult, PluginDescriptor, PromptBlock, PromptTemplates, ProviderModel, ProviderProfile, SamplerConfig } from "../../shared/types/contracts";
import { FieldLabel, InputField, SelectField, TextareaField, ToggleSwitch } from "./components/FormControls";
import { ModalShell } from "../../components/ModalShell";
import { IconButton } from "../../components/IconButton";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { ManagedBackendsSettings } from "./components/ManagedBackendsSettings";
import { WallpaperThemePanel } from "./components/WallpaperThemePanel";
import { LegacyScreen } from "../legacy/public";
import { buildSettingsNavigation, DEFAULT_PROMPT_STACK, DEFAULT_SCENE_FIELD_VISIBILITY, PROMPT_STACK_COLORS, type SettingsCategory } from "./config";
import { buildPluginPermissionDraft, buildPluginSettingsDraft, hasHighRiskPluginPermissions, normalizeApiParamPolicy, normalizePromptStack, pluginPermissionDescription, pluginPermissionTone, promptBlockLabel, scrollToSettingsSection, sanitizePluginSettingsFieldValue } from "./utils";
import {
  applyWallpaperThemePalette,
  clearWallpaperTheme,
  generateWallpaperThemePalette,
  isWallpaperThemeEnabled,
  readWallpaperThemePalette,
  setWallpaperThemeEnabled, storeWallpaperThemePalette
} from "../../shared/wallpaperTheme";

function isLocalProviderEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local")) return true;
    if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) {
      return true;
    }

    const parts = hostname.split(".").map((segment) => Number(segment));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }

    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 169 && parts[1] === 254);
  } catch {
    return false;
  }
}

function resolveProviderPresetKey(provider: Pick<ProviderProfile, "id" | "baseUrl" | "providerType">): string {
  const normalizedType = provider.providerType === "koboldcpp" || provider.providerType === "custom"
    ? provider.providerType
    : "openai";
  const preset = PROVIDER_PRESETS.find((item) => (
    item.defaultId === provider.id
    || (item.baseUrl === provider.baseUrl && item.providerType === normalizedType)
  ));
  if (preset) return preset.key;
  if (normalizedType === "koboldcpp") return "koboldcpp";
  if (normalizedType === "custom") return "custom";
  return "custom";
}

function parseManualModels(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampInteger(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function clampDecimal(raw: string, fallback: number, min: number, max: number, precision = 2): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(Math.max(min, Math.min(max, parsed)).toFixed(precision));
}

async function prepareSimpleModeWallpaper(file: File, t: (key: any) => string): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(t("settings.wallpaperInvalidFile"));
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error(t("settings.wallpaperTooLarge"));
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(t("settings.wallpaperUnreadable")));
      image.src = objectUrl;
    });

    const maxEdge = 2560;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("settings.wallpaperProcessingUnavailable"));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  "connection",
  "backends",
  "interface",
  "generation",
  "context",
  "prompts",
  "tools",
  "legacy"
];

type SettingsActionIconName = "add" | "refresh" | "edit" | "test" | "save" | "models" | "activate" | "voice" | "tour";

function SettingsActionIcon({ name }: { name: SettingsActionIconName }) {
  const paths: Record<SettingsActionIconName, string> = {
    add: "M12 5v14M5 12h14",
    refresh: "M20 7v5h-5M4 17v-5h5M18.4 9A7 7 0 006.2 6.2L4 9m16 6l-2.2 2.8A7 7 0 015.6 15",
    edit: "M4 20h4l10.5-10.5a2.12 2.12 0 00-3-3L5 17v3zM13.5 8.5l3 3",
    test: "M9 3h6m-5 0v5l-5 9a2 2 0 001.75 3h10.5A2 2 0 0019 17l-5-9V3M7.5 15h9",
    save: "M5 4h12l2 2v14H5V4zm3 0v6h8V4M8 20v-6h8v6",
    models: "M12 3l8 4-8 4-8-4 8-4zm8 9l-8 4-8-4m16 5l-8 4-8-4",
    activate: "M5 12h13m-5-5l5 5-5 5",
    voice: "M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zm-6 9a6 6 0 0012 0M12 18v3m-3 0h6",
    tour: "M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3zm6 11l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"
  };

  return (
    <svg className="settings-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[name]} />
    </svg>
  );
}

export function SettingsScreen({
  initialCategory,
  initialSectionId,
  onInitialViewHandled,
  initialLegacyAgentThreadId,
  onInitialLegacyAgentThreadHandled
}: {
  initialCategory?: string;
  initialSectionId?: string;
  onInitialViewHandled?: () => void;
  initialLegacyAgentThreadId?: string | null;
  onInitialLegacyAgentThreadHandled?: () => void;
} = {}) {
  const { t } = useI18n();
  const { catalog: pluginCatalog, plugins, loading: pluginsLoading, error: pluginError, setPluginEnabled, refresh: refreshPlugins, pendingPluginStates } = usePlugins();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providerResult, setProviderResult] = useState("");
  const [resultVariant, setResultVariant] = useState<"info" | "success" | "error">("info");
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [translateModels, setTranslateModels] = useState<ProviderModel[]>([]);
  const [ragModels, setRagModels] = useState<ProviderModel[]>([]);
  const [ragRerankModels, setRagRerankModels] = useState<ProviderModel[]>([]);
  const [compressModels, setCompressModels] = useState<ProviderModel[]>([]);
  const [ttsModels, setTtsModels] = useState<ProviderModel[]>([]);
  const [ttsVoices, setTtsVoices] = useState<ProviderModel[]>([]);
  const [managedBackendStates, setManagedBackendStates] = useState<ManagedBackendRuntimeState[]>([]);
  const [managedBackendLogsFor, setManagedBackendLogsFor] = useState<ManagedBackendConfig | null>(null);
  const [managedBackendLogs, setManagedBackendLogs] = useState<ManagedBackendLogEntry[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");

  const [selectedPresetKey, setSelectedPresetKey] = useState("openai");
  const selectedPreset = useMemo(
    () => PROVIDER_PRESETS.find((p) => p.key === selectedPresetKey) ?? PROVIDER_PRESETS[0],
    [selectedPresetKey]
  );
  const pluginThemes = useMemo(() => {
    return plugins
      .flatMap((plugin) => plugin.themes.map((theme) => ({
        id: `${plugin.id}:${theme.id}`,
        label: theme.label,
        description: theme.description,
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginSource: plugin.source,
        themeId: theme.id,
        base: theme.base,
        order: theme.order,
        variables: theme.variables
      })))
      .sort((a, b) => {
        if (a.pluginSource !== b.pluginSource) {
          return a.pluginSource === "bundled" ? -1 : 1;
        }
        if (a.pluginName !== b.pluginName) {
          return a.pluginName.localeCompare(b.pluginName);
        }
        if (a.order !== b.order) {
          return a.order - b.order;
        }
        return a.label.localeCompare(b.label);
      });
  }, [plugins]);
  const managedBackends = useMemo(() => normalizeManagedBackends(settings?.managedBackends), [settings?.managedBackends]);
  const managedBackendStateMap = useMemo(() => new Map(managedBackendStates.map((item) => [item.backendId, item])), [managedBackendStates]);

  const [providerId, setProviderId] = useState(selectedPreset.defaultId);
  const [providerName, setProviderName] = useState(selectedPreset.defaultName);
  const [providerBaseUrl, setProviderBaseUrl] = useState(selectedPreset.baseUrl);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerProxyUrl, setProviderProxyUrl] = useState("");
  const [providerLocalOnly, setProviderLocalOnly] = useState(selectedPreset.localOnly);
  const [providerType, setProviderType] = useState<"openai" | "koboldcpp" | "custom">(selectedPreset.providerType);
  const [providerAdapterId, setProviderAdapterId] = useState("");
  const [providerManualModels, setProviderManualModels] = useState("");
  const editingProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId) ?? null,
    [providers, providerId]
  );
  const selectedProviderProfile = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );
  const draftManualModels = useMemo(() => parseManualModels(providerManualModels), [providerManualModels]);
  const draftProviderIsLocalEndpoint = useMemo(
    () => isLocalProviderEndpoint(providerBaseUrl.trim()),
    [providerBaseUrl]
  );
  const showExternalProviderWarning = providerLocalOnly && Boolean(providerBaseUrl.trim()) && !draftProviderIsLocalEndpoint;
  const providerStats = useMemo(() => {
    const local = providers.filter((provider) => provider.fullLocalOnly || isLocalProviderEndpoint(provider.baseUrl)).length;
    return {
      total: providers.length,
      local,
      remote: Math.max(providers.length - local, 0)
    };
  }, [providers]);

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("connection");
  const [mcpServersDraft, setMcpServersDraft] = useState<McpServerConfig[]>([]);
  const [mcpDirty, setMcpDirty] = useState(false);
  const [testingMcpId, setTestingMcpId] = useState<string | null>(null);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, McpServerTestResult | undefined>>({});
  const [mcpImportSource, setMcpImportSource] = useState("");
  const [mcpImportLoading, setMcpImportLoading] = useState(false);
  const [mcpDiscoveredTools, setMcpDiscoveredTools] = useState<McpDiscoveredTool[]>([]);
  const [mcpDiscoveryLoading, setMcpDiscoveryLoading] = useState(false);
  const [koboldBansInput, setKoboldBansInput] = useState("");
  const [quickJumpFilter, setQuickJumpFilter] = useState("");
  const [draggedPromptBlockId, setDraggedPromptBlockId] = useState<string | null>(null);
  const [pluginDevAutoRefresh, setPluginDevAutoRefresh] = useState<boolean>(isPluginDevAutoRefreshEnabled());
  const [pluginSettingsPlugin, setPluginSettingsPlugin] = useState<PluginDescriptor | null>(null);
  const [pluginSettingsDraft, setPluginSettingsDraft] = useState<Record<string, string | number | boolean>>({});
  const [pluginSettingsLoading, setPluginSettingsLoading] = useState(false);
  const [pluginSettingsSaving, setPluginSettingsSaving] = useState(false);
  const [pluginPermissionsPlugin, setPluginPermissionsPlugin] = useState<PluginDescriptor | null>(null);
  const [pluginPermissionsDraft, setPluginPermissionsDraft] = useState<Record<string, boolean>>({});
  const [pluginPermissionsSaving, setPluginPermissionsSaving] = useState(false);
  const [pluginPermissionsEnableAfterSave, setPluginPermissionsEnableAfterSave] = useState(false);
  const [pluginInstallBusy, setPluginInstallBusy] = useState(false);
  const [wallpaperThemeEnabled, setWallpaperThemeEnabledState] = useState(isWallpaperThemeEnabled);
  const [wallpaperThemePalette, setWallpaperThemePalette] = useState(readWallpaperThemePalette);
  const [wallpaperThemeGenerating, setWallpaperThemeGenerating] = useState(false);
  const pluginInstallInputRef = useRef<HTMLInputElement | null>(null);
  const wallpaperInputRef = useRef<HTMLInputElement | null>(null);
  const [managedBackendImportCommands, setManagedBackendImportCommands] = useState<Record<string, string>>({});
  const [settingsSaveState, setSettingsSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [settingsActionBusy, setSettingsActionBusy] = useState(false);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRequestIdRef = useRef(0);
  const wallpaperPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wallpaperPatchDraftRef = useRef<Partial<AppSettings>>({});
  const managedBackendsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const managedBackendsDraftRef = useRef<ManagedBackendConfig[]>([]);
  useEffect(() => {
    void Promise.all([api.settingsGet(), api.providerList()])
      .then(([s, p]) => {
        setSettings(s);
        setMcpServersDraft(Array.isArray(s.mcpServers) ? s.mcpServers : []);
        setMcpDiscoveredTools(Array.isArray(s.mcpDiscoveredTools) ? s.mcpDiscoveredTools : []);
        setMcpDirty(false);
        setProviders(p);
        if (s.activeProviderId) setSelectedProviderId(s.activeProviderId);
        if (s.activeModel) setSelectedModelId(s.activeModel);
      })
      .catch((error) => showResult(error instanceof Error ? error.message : String(error), "error"));
  }, []);
  useEffect(() => {
    if (!window.electronAPI?.listManagedBackends) return;
    let active = true;
    void window.electronAPI.listManagedBackends().then((states) => {
      if (active) setManagedBackendStates(states);
    }).catch(() => {});
    window.electronAPI.onManagedBackendsUpdate?.((states) => {
      if (active) setManagedBackendStates(states);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!managedBackendLogsFor || !window.electronAPI?.getManagedBackendLogs) return;
    void window.electronAPI.getManagedBackendLogs(managedBackendLogsFor.id).then(setManagedBackendLogs).catch(() => {});
  }, [managedBackendStates, managedBackendLogsFor]);

  useEffect(() => {
    const nextCategory = SETTINGS_CATEGORIES.includes(initialCategory as SettingsCategory)
      ? initialCategory as SettingsCategory
      : null;
    if (!nextCategory && !initialSectionId) return;
    if (nextCategory && activeCategory !== nextCategory) {
      setActiveCategory(nextCategory);
    }

    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (!initialSectionId) {
        onInitialViewHandled?.();
        return;
      }
      timer = window.setTimeout(() => {
        scrollToSettingsSection(initialSectionId);
        onInitialViewHandled?.();
      }, 60);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [activeCategory, initialCategory, initialSectionId, onInitialViewHandled]);

  useEffect(() => {
    return () => {
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current);
      }
      if (wallpaperPatchTimerRef.current) {
        clearTimeout(wallpaperPatchTimerRef.current);
      }
      if (managedBackendsSaveTimerRef.current) {
        clearTimeout(managedBackendsSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    managedBackendsDraftRef.current = managedBackends;
  }, [managedBackends]);

  function showResult(text: string, variant: "info" | "success" | "error" = "info") {
    setProviderResult(text);
    setResultVariant(variant);
  }

  async function runSettingsAction(action: () => Promise<void>) {
    if (settingsActionBusy) return;
    setSettingsActionBusy(true);
    try { await action(); } catch (error) {
      showResult(error instanceof Error ? error.message : String(error), "error");
    } finally { setSettingsActionBusy(false); }
  }
  function getProviderTypeLabel(type?: ProviderProfile["providerType"] | "openai" | "koboldcpp" | "custom") {
    if (type === "koboldcpp") return t("settings.providerTypeKobold");
    if (type === "custom") return t("settings.providerTypeCustom");
    return t("settings.providerTypeOpenAi");
  }

  async function openPluginSettings(plugin: PluginDescriptor) {
    if (plugin.settingsFields.length === 0) return;
    setPluginSettingsPlugin(plugin);
    setPluginSettingsLoading(true);
    try {
      const current = await api.pluginGetSettings(plugin.id);
      setPluginSettingsDraft(buildPluginSettingsDraft(plugin, current));
    } catch (error) {
      showResult(String(error), "error");
      setPluginSettingsPlugin(null);
    } finally {
      setPluginSettingsLoading(false);
    }
  }

  async function savePluginSettings() {
    if (!pluginSettingsPlugin) return;
    setPluginSettingsSaving(true);
    try {
      const payload = Object.fromEntries(
        pluginSettingsPlugin.settingsFields.map((field) => [
          field.key,
          sanitizePluginSettingsFieldValue(field, pluginSettingsDraft[field.key] ?? field.defaultValue ?? "")
        ])
      );
      await api.pluginPatchSettings(pluginSettingsPlugin.id, payload);
      showResult(t("settings.pluginSettingsSaved"), "success");
      setPluginSettingsPlugin(null);
    } catch (error) {
      showResult(String(error), "error");
    } finally {
      setPluginSettingsSaving(false);
    }
  }

  function openPluginPermissions(plugin: PluginDescriptor, options?: { enableAfterSave?: boolean }) {
    setPluginPermissionsPlugin(plugin);
    setPluginPermissionsDraft(buildPluginPermissionDraft(plugin));
    setPluginPermissionsEnableAfterSave(options?.enableAfterSave === true && !plugin.enabled);
  }

  async function savePluginPermissions() {
    if (!pluginPermissionsPlugin) return;
    setPluginPermissionsSaving(true);
    try {
      const result = await api.pluginPatchPermissions(pluginPermissionsPlugin.id, pluginPermissionsDraft);
      const nextGranted = result.granted ?? [];
      const nextConfigured = result.configured === true;
      const targetPluginId = pluginPermissionsPlugin.id;
      const targetEnabled = pluginPermissionsEnableAfterSave && !pluginPermissionsPlugin.enabled;
      const targetPluginName = pluginPermissionsPlugin.name;
      setPluginPermissionsPlugin(null);
      setPluginPermissionsEnableAfterSave(false);
      await refreshPlugins({ force: true, silent: true }).catch(() => {
        // Ignore follow-up refresh failures; the permission save already succeeded.
      });
      if (targetEnabled) {
        await setPluginEnabled(targetPluginId, true);
      }
      showResult(`${targetPluginName}: ${t("settings.pluginPermissionsSaved")} (${nextGranted.length}${nextConfigured ? "" : "*"})`, "success");
    } catch (error) {
      showResult(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPluginPermissionsSaving(false);
    }
  }

  async function installPluginfile(file: File) {
    setPluginInstallBusy(true);
    try {
      const rawJson = await file.text();
      const parsed = JSON.parse(rawJson) as unknown;
      const result = await api.pluginInstallPluginfile(parsed);
      await refreshPlugins({ force: true, silent: true }).catch(() => {
        // ignore follow-up refresh failures; install already succeeded
      });
      showResult(`${t("settings.pluginInstalled")}: ${result.plugin.name}`, "success");
    } catch (error) {
      showResult(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPluginInstallBusy(false);
      if (pluginInstallInputRef.current) {
        pluginInstallInputRef.current.value = "";
      }
    }
  }

  async function exportPluginfile(plugin: PluginDescriptor) {
    try {
      const blob = await api.pluginExportPluginfile(plugin.id);
      await triggerBlobDownload(blob, `${plugin.id}.pluginfile.json`);
      showResult(`${t("settings.pluginfileExported")}: ${plugin.name}`, "success");
    } catch (error) {
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function applyPresetToForm(preset: ProviderPreset) {
    setSelectedPresetKey(preset.key);
    setProviderId(preset.defaultId);
    setProviderName(preset.defaultName);
    setProviderBaseUrl(preset.baseUrl);
    setProviderProxyUrl("");
    setProviderLocalOnly(preset.localOnly);
    setProviderType(preset.providerType);
    setProviderAdapterId("");
    setProviderManualModels("");
    if (preset.key === "openai") {
      void patchApiParamPolicy({ openai: { sendSampler: false } });
    }
    showResult(`${t("settings.presetApplied")}: ${preset.label}`, "info");
  }

  function loadProviderIntoForm(profile: ProviderProfile) {
    setSelectedPresetKey(resolveProviderPresetKey(profile));
    setProviderId(profile.id);
    setProviderName(profile.name);
    setProviderBaseUrl(profile.baseUrl);
    setProviderApiKey("");
    setProviderProxyUrl(profile.proxyUrl || "");
    setProviderLocalOnly(Boolean(profile.fullLocalOnly));
    setProviderType(profile.providerType === "koboldcpp" || profile.providerType === "custom" ? profile.providerType : "openai");
    setProviderAdapterId(profile.adapterId || "");
    setProviderManualModels(Array.isArray(profile.manualModels) ? profile.manualModels.join("\n") : "");
    setSelectedProviderId(profile.id);
    showResult(`${t("settings.providerLoadedIntoEditor")}: ${profile.name}`, "info");
  }

  async function patch(next: Partial<AppSettings>) {
    const requestId = ++settingsRequestIdRef.current;
    setSettingsSaveState("saving");
    try {
      const updated = await api.settingsUpdate(next);
      if (requestId !== settingsRequestIdRef.current) return;
      setSettings(updated);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
      if (next.theme !== undefined || next.pluginThemeId !== undefined) {
        window.dispatchEvent(new CustomEvent("theme-change", { detail: updated }));
      }
      if (
        next.fontScale !== undefined
        || next.density !== undefined
        || next.simpleModeWallpaper !== undefined
        || next.simpleModeWallpaperDim !== undefined
        || next.simpleModeWallpaperBlur !== undefined
        || next.simpleModeWallpaperPosition !== undefined
      ) {
        window.dispatchEvent(new CustomEvent("display-settings-change", {
          detail: {
            fontScale: updated.fontScale,
            density: updated.density,
            simpleModeWallpaper: updated.simpleModeWallpaper,
            simpleModeWallpaperDim: updated.simpleModeWallpaperDim,
            simpleModeWallpaperBlur: updated.simpleModeWallpaperBlur,
            simpleModeWallpaperPosition: updated.simpleModeWallpaperPosition
          }
        }));
      }
      setSettingsSaveState("saved");
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current);
      }
      settingsSaveTimerRef.current = setTimeout(() => {
        setSettingsSaveState("idle");
        settingsSaveTimerRef.current = null;
      }, 1600);
    } catch (error) {
      if (requestId !== settingsRequestIdRef.current) return;
      setSettingsSaveState("error");
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function queueWallpaperPatch(next: Partial<AppSettings>) {
    if (!settings) return;
    wallpaperPatchDraftRef.current = { ...wallpaperPatchDraftRef.current, ...next };
    const optimistic = { ...settings, ...wallpaperPatchDraftRef.current };
    setSettings(optimistic);
    window.dispatchEvent(new CustomEvent("display-settings-change", {
      detail: {
        fontScale: optimistic.fontScale,
        density: optimistic.density,
        simpleModeWallpaper: optimistic.simpleModeWallpaper,
        simpleModeWallpaperDim: optimistic.simpleModeWallpaperDim,
        simpleModeWallpaperBlur: optimistic.simpleModeWallpaperBlur,
        simpleModeWallpaperPosition: optimistic.simpleModeWallpaperPosition
      }
    }));
    setSettingsSaveState("saving");
    if (wallpaperPatchTimerRef.current) clearTimeout(wallpaperPatchTimerRef.current);
    wallpaperPatchTimerRef.current = setTimeout(() => {
      const queued = wallpaperPatchDraftRef.current;
      wallpaperPatchDraftRef.current = {};
      wallpaperPatchTimerRef.current = null;
      void patch(queued);
    }, 180);
  }

  async function handleWallpaperFile(file: File | null) {
    if (!file) return;
    setSettingsSaveState("saving");
    try {
      const dataUrl = await prepareSimpleModeWallpaper(file, t);
      await patch({ simpleModeWallpaper: dataUrl });
      if (wallpaperThemeEnabled) {
        await regenerateWallpaperTheme(dataUrl, false);
      }
      showResult(t("settings.wallpaperApplied"), "success");
    } catch (error) {
      setSettingsSaveState("error");
      showResult(error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (wallpaperInputRef.current) wallpaperInputRef.current.value = "";
    }
  }

  async function regenerateWallpaperTheme(source = settings?.simpleModeWallpaper || "", announce = true) {
    if (!source || wallpaperThemeGenerating) return;
    setWallpaperThemeGenerating(true);
    try {
      const palette = await generateWallpaperThemePalette(source);
      storeWallpaperThemePalette(palette);
      applyWallpaperThemePalette(palette);
      setWallpaperThemePalette(palette);
      if (announce) showResult(t("settings.wallpaperThemeGenerated"), "success");
    } catch {
      showResult(t("settings.wallpaperThemeError"), "error");
    } finally {
      setWallpaperThemeGenerating(false);
    }
  }

  function handleWallpaperThemeToggle(enabled: boolean) {
    setWallpaperThemeEnabled(enabled);
    setWallpaperThemeEnabledState(enabled);
    if (!enabled) {
      clearWallpaperTheme();
      return;
    }
    if (settings?.simpleModeWallpaper) {
      void regenerateWallpaperTheme(settings.simpleModeWallpaper);
    }
  }

  async function handleWallpaperRemove() {
    await patch({ simpleModeWallpaper: "" });
    clearWallpaperTheme();
  }

  function handleThemeModeChange(nextValue: string) {
    if (!settings) return;
    const nextTheme = nextValue as AppSettings["theme"];
    if (nextTheme === "custom") {
      const fallbackThemeId = settings.pluginThemeId || pluginThemes[0]?.id || null;
      void patch({
        theme: "custom",
        pluginThemeId: fallbackThemeId
      });
      return;
    }
    void patch({ theme: nextTheme });
  }

  function applyPluginTheme(themeId: string) {
    void patch({
      theme: "custom",
      pluginThemeId: themeId
    });
  }

  async function saveManagedBackends(nextBackends: ManagedBackendConfig[]) {
    if (!settings) return;
    setSettingsSaveState("saving");
    try {
      const updated = await api.settingsUpdate({ managedBackends: nextBackends });
      setSettings(updated);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
      managedBackendsDraftRef.current = normalizeManagedBackends(updated.managedBackends);
      setSettingsSaveState("saved");
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current);
      }
      settingsSaveTimerRef.current = setTimeout(() => {
        setSettingsSaveState("idle");
        settingsSaveTimerRef.current = null;
      }, 1600);
    } catch (error) {
      setSettingsSaveState("error");
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function scheduleManagedBackendsSave(nextBackends: ManagedBackendConfig[]) {
    if (managedBackendsSaveTimerRef.current) {
      clearTimeout(managedBackendsSaveTimerRef.current);
    }
    managedBackendsSaveTimerRef.current = setTimeout(() => {
      managedBackendsSaveTimerRef.current = null;
      void saveManagedBackends(nextBackends);
    }, 420);
  }

  function addManagedBackend() {
    if (managedBackendsSaveTimerRef.current) {
      clearTimeout(managedBackendsSaveTimerRef.current);
      managedBackendsSaveTimerRef.current = null;
    }
    const base = managedBackendsDraftRef.current;
    const next = [...base, defaultManagedBackendConfig(base.length + 1)];
    managedBackendsDraftRef.current = next;
    void saveManagedBackends(next);
  }

  function updateManagedBackend(backendId: string, patchData: Partial<ManagedBackendConfig>) {
    const base = managedBackendsDraftRef.current;
    const next = base.map((backend) => {
      if (backend.id !== backendId) return backend;
      const merged: ManagedBackendConfig = {
        ...backend,
        ...patchData,
        koboldcpp: {
          ...(backend.koboldcpp || defaultManagedBackendConfig().koboldcpp!),
          ...(patchData.koboldcpp || {})
        },
        ollama: {
          ...(backend.ollama || defaultManagedBackendConfig().ollama!),
          ...(patchData.ollama || {})
        }
      };
      return {
        ...merged,
        baseUrl: merged.baseUrl.trim() || resolveManagedBackendBaseUrl(merged)
      };
    });
    managedBackendsDraftRef.current = next;
    scheduleManagedBackendsSave(next);
  }

  function removeManagedBackend(backendId: string) {
    if (managedBackendsSaveTimerRef.current) {
      clearTimeout(managedBackendsSaveTimerRef.current);
      managedBackendsSaveTimerRef.current = null;
    }
    const base = managedBackendsDraftRef.current;
    const next = base.filter((backend) => backend.id !== backendId);
    managedBackendsDraftRef.current = next;
    void saveManagedBackends(next);
  }

  async function startManagedBackend(backend: ManagedBackendConfig) {
    if (!window.electronAPI?.startManagedBackend) {
      showResult("Managed backends require Electron runtime", "error");
      return;
    }
    try {
      await window.electronAPI.startManagedBackend(backend);
      showResult(`${backend.name}: started`, "success");
      await loadModels().catch(() => undefined);
    } catch (error) {
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function stopManagedBackend(backendId: string) {
    if (!window.electronAPI?.stopManagedBackend) return;
    try {
      await window.electronAPI.stopManagedBackend(backendId);
      showResult("Managed backend stopped", "success");
      await loadModels().catch(() => undefined);
    } catch (error) {
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function openManagedBackendLogs(backend: ManagedBackendConfig) {
    if (!window.electronAPI?.getManagedBackendLogs) return;
    setManagedBackendLogsFor(backend);
    try {
      const logs = await window.electronAPI.getManagedBackendLogs(backend.id);
      setManagedBackendLogs(logs);
    } catch (error) {
      setManagedBackendLogs([]);
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function applyManagedBackendCommand(backend: ManagedBackendConfig) {
    const raw = String(managedBackendImportCommands[backend.id] || "").trim();
    if (!raw) return;
    const parsed = parseManagedBackendCommand(raw, backend.backendKind);
    if (!parsed) {
      showResult(t("settings.commandImportFailed"), "error");
      return;
    }
    updateManagedBackend(backend.id, parsed);
    setManagedBackendImportCommands((current) => ({ ...current, [backend.id]: "" }));
    showResult(t("settings.commandImported"), "success");
  }

  async function patchSceneFieldVisibility(next: Partial<AppSettings["sceneFieldVisibility"]>) {
    if (!settings) return;
    const merged: AppSettings["sceneFieldVisibility"] = {
      ...DEFAULT_SCENE_FIELD_VISIBILITY,
      ...(settings.sceneFieldVisibility || {}),
      ...next
    };
    await patch({ sceneFieldVisibility: merged });
  }

  async function reset() {
    if (!window.confirm(t("settings.confirmResetAll"))) return;
    await runSettingsAction(async () => {
      const defaults = await api.settingsReset();
      setSettings(defaults);
      ["settings-change", "onboarding-reset"].forEach((name) => {
        window.dispatchEvent(new CustomEvent(name, { detail: defaults }));
      });
      showResult(t("settings.settingsResetDone"), "success");
    });
  }
  function refreshProviders() { void runSettingsAction(async () => setProviders(await api.providerList())); }
  async function saveProvider() {
    if (settingsActionBusy) return;
    if (!providerId.trim() || !providerName.trim() || !providerBaseUrl.trim()) {
      showResult(t("settings.fillProviderRequired"), "error");
      return;
    }
    if (providerType === "custom" && !providerAdapterId.trim()) {
      showResult(t("settings.fillAdapterRequired"), "error");
      return;
    }
    await runSettingsAction(async () => {
      const saved = await api.providerUpsert({ id: providerId.trim(), name: providerName.trim(), baseUrl: providerBaseUrl.trim(),
        apiKey: providerApiKey.trim() || "local-key", proxyUrl: providerProxyUrl.trim() || null,
        fullLocalOnly: providerLocalOnly, providerType,
        adapterId: providerType === "custom" ? providerAdapterId.trim() || null : null, manualModels: draftManualModels
      });
      setProviders(await api.providerList());
      setSelectedProviderId(saved.id);
      showResult(`${t("settings.providerSaved")}: ${saved.name}`, "success");
    });
  }
  function buildProviderDraftPayload() {
    return {
      baseUrl: providerBaseUrl.trim(),
      apiKey: providerApiKey.trim() || "local-key",
      fullLocalOnly: providerLocalOnly,
      providerType,
      adapterId: providerType === "custom" ? providerAdapterId.trim() || null : null,
      manualModels: draftManualModels
    };
  }

  async function quickAddPreset() {
    if (settingsActionBusy) return;
    applyPresetToForm(selectedPreset);
    await runSettingsAction(async () => {
      await api.providerUpsert({ id: selectedPreset.defaultId, name: selectedPreset.defaultName, baseUrl: selectedPreset.baseUrl,
        apiKey: providerApiKey.trim() || (selectedPreset.localOnly ? "local-key" : ""),
        proxyUrl: null, fullLocalOnly: selectedPreset.localOnly, providerType: selectedPreset.providerType, adapterId: null
      });
      setProviders(await api.providerList()); setSelectedProviderId(selectedPreset.defaultId);
      showResult(`${t("settings.presetProviderAdded")}: ${selectedPreset.label}`, "success");
    });
  }

  async function testProvider() {
    if (!providerBaseUrl.trim()) {
      showResult(t("settings.fillProviderRequired"), "error");
      return;
    }
    try {
      const result = await api.providerPreviewTest(buildProviderDraftPayload());
      showResult(result.ok ? t("settings.connectionCheckOk") : (result.error || t("settings.providerBlockedOrInvalid")), result.ok ? "success" : "error");
    } catch (error) {
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function loadModels() {
    if (!selectedProviderId) { showResult(t("settings.selectProviderFirst"), "error"); return; }
    try {
      const list = await api.providerFetchModels(selectedProviderId);
      setModels(list);
      setSelectedModelId((prev) => {
        if (list.length === 0) return "";
        return list.some((model) => model.id === prev) ? prev : list[0].id;
      });
      showResult(
        list.length ? `${t("settings.modelsLoaded")}: ${list.length}` : t("settings.noModelsReturned"),
        list.length ? "success" : "info"
      );
    } catch (error) { showResult(`${t("settings.loadModelsFailed")}: ${error instanceof Error ? error.message : String(error)}`, "error"); }
  }

  async function loadDraftModels() {
    if (!providerBaseUrl.trim()) {
      showResult(t("settings.fillProviderRequired"), "error");
      return;
    }
    try {
      const list = await api.providerPreviewModels(buildProviderDraftPayload());
      setModels(list);
      setSelectedModelId((prev) => {
        if (list.length === 0) return "";
        return list.some((model) => model.id === prev) ? prev : list[0].id;
      });
      showResult(
        list.length ? `${t("settings.modelsLoaded")}: ${list.length}` : t("settings.noModelsReturned"),
        list.length ? "success" : "info"
      );
    } catch (error) {
      showResult(`${t("settings.loadModelsFailed")}: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  async function loadCompressModels() {
    const pid = settings?.compressProviderId;
    if (!pid) return;
    try {
      const list = await api.providerFetchModels(pid);
      setCompressModels(list);
    } catch { /* ignore */ }
  }

  async function loadTranslateModels(providerId?: string | null) {
    const pid = providerId ?? settings?.translateProviderId;
    if (!pid) {
      setTranslateModels([]);
      return;
    }
    try {
      const list = await api.providerFetchModels(pid);
      setTranslateModels(list);
    } catch {
      setTranslateModels([]);
    }
  }

  async function loadRagModels(providerId?: string | null) {
    const pid = providerId ?? settings?.ragProviderId;
    if (!pid) {
      setRagModels([]);
      return;
    }
    try {
      const list = await api.providerFetchModels(pid);
      setRagModels(list);
    } catch {
      setRagModels([]);
    }
  }

  async function loadRagRerankModels(providerId?: string | null) {
    const pid = providerId ?? settings?.ragRerankProviderId;
    if (!pid) {
      setRagRerankModels([]);
      return;
    }
    try {
      const list = await api.providerFetchModels(pid);
      setRagRerankModels(list);
    } catch {
      setRagRerankModels([]);
    }
  }

  async function loadTtsModels() {
    if (!settings) return;
    try {
      const list = await api.settingsFetchTtsModels(settings.ttsBaseUrl, settings.ttsApiKey, settings.ttsAdapterId);
      setTtsModels(list);
      showResult(
        list.length ? `${t("settings.modelsLoaded")}: ${list.length}` : t("settings.noModelsReturned"),
        list.length ? "success" : "info"
      );
    } catch (error) {
      setTtsModels([]);
      showResult(`${t("settings.loadModelsFailed")}: ${String(error)}`, "error");
    }
  }

  async function loadTtsVoices() {
    if (!settings) return;
    try {
      const list = await api.settingsFetchTtsVoices(settings.ttsBaseUrl, settings.ttsApiKey, settings.ttsAdapterId);
      setTtsVoices(list);
      showResult(
        list.length ? `${t("settings.voicesLoaded")}: ${list.length}` : t("settings.noVoicesReturned"),
        list.length ? "success" : "info"
      );
    } catch (error) {
      setTtsVoices([]);
      showResult(`${t("settings.loadVoicesFailed")}: ${String(error)}`, "error");
    }
  }

  async function applyActiveModel() {
    if (settingsActionBusy) return;
    if (!selectedProviderId || !selectedModelId) { showResult(t("settings.selectProviderAndModelFirst"), "error"); return; }
    await runSettingsAction(async () => {
      const result = await api.providerActivateModel(selectedProviderId, selectedModelId);
      setSettings(result.settings); setSelectedModelId(result.actualModelId || selectedModelId);
      showResult(`${t("settings.activeModelSet")}: ${selectedProviderId} / ${result.activeModelLabel || result.actualModelId || selectedModelId}`, "success");
    });
  }

  async function patchSampler(samplerPatch: Partial<SamplerConfig>) {
    if (!settings) return;
    const newSampler = { ...settings.samplerConfig, ...samplerPatch };
    await patch({ samplerConfig: newSampler });
  }

  async function patchApiParamPolicy(policyPatch: {
    openai?: Partial<ApiParamPolicy["openai"]>;
    kobold?: Partial<ApiParamPolicy["kobold"]>;
  }) {
    if (!settings) return;
    const currentPolicy = normalizeApiParamPolicy(settings.apiParamPolicy);
    const nextPolicy: ApiParamPolicy = {
      openai: {
        ...currentPolicy.openai,
        ...(policyPatch.openai ?? {})
      },
      kobold: {
        ...currentPolicy.kobold,
        ...(policyPatch.kobold ?? {})
      }
    };
    await patch({ apiParamPolicy: nextPolicy });
  }

  async function savePromptStack(nextStack: PromptBlock[]) {
    const normalized = normalizePromptStack(nextStack);
    await patch({ promptStack: normalized });
  }

  function togglePromptBlock(blockId: string) {
    const next = orderedPromptStack.map((block) => (
      block.id === blockId ? { ...block, enabled: !block.enabled } : block
    ));
    void savePromptStack(next);
  }

  function movePromptBlock(dragId: string, dropId: string) {
    if (!dragId || dragId === dropId) return;
    const next = [...orderedPromptStack];
    const from = next.findIndex((block) => block.id === dragId);
    const to = next.findIndex((block) => block.id === dropId);
    if (from < 0 || to < 0 || from === to) return;
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    void savePromptStack(next.map((block, index) => ({ ...block, order: index + 1 })));
  }

  function updatePromptBlockContent(blockId: string, content: string) {
    const next = orderedPromptStack.map((block) => (
      block.id === blockId ? { ...block, content } : block
    ));
    void savePromptStack(next);
  }

  function readToolStates(): Record<string, boolean> {
    const raw = settings?.mcpToolStates;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  }

  async function discoverMcpFunctions() {
    setMcpDiscoveryLoading(true);
    try {
      const discovered = await api.settingsDiscoverMcpTools();
      const currentStates = readToolStates();
      const mergedStates: Record<string, boolean> = { ...currentStates };
      for (const tool of discovered.tools || []) {
        if (!(tool.callName in mergedStates)) {
          mergedStates[tool.callName] = true;
        }
      }
      const updated = await api.settingsUpdate({
        mcpDiscoveredTools: discovered.tools || [],
        mcpToolStates: mergedStates
      });
      setSettings(updated);
      setMcpDiscoveredTools(Array.isArray(updated.mcpDiscoveredTools) ? updated.mcpDiscoveredTools : []);
      showResult(`${t("settings.mcpFunctionsLoaded")}: ${(discovered.tools || []).length}`, "success");
    } catch (err) {
      showResult(`${t("settings.mcpFunctionsLoadFail")}: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setMcpDiscoveryLoading(false);
    }
  }

  async function setToolEnabled(callName: string, enabled: boolean) {
    try {
      const states = readToolStates();
      const updated = await api.settingsUpdate({
        mcpToolStates: { ...states, [callName]: enabled }
      });
      setSettings(updated);
    } catch (err) {
      showResult(`${t("settings.mcpFunctionsLoadFail")}: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  function addMcpServer() {
    const id = `mcp-${Date.now()}`;
    setMcpServersDraft((prev) => [
      ...prev,
      {
        id,
        name: `MCP ${prev.length + 1}`,
        command: "",
        args: "",
        env: "",
        enabled: true,
        timeoutMs: 15000
      }
    ]);
    setMcpDirty(true);
  }

  function updateMcpServer(id: string, patchData: Partial<McpServerConfig>) {
    setMcpServersDraft((prev) => prev.map((server) => (server.id === id ? { ...server, ...patchData } : server)));
    setMcpDirty(true);
  }

  function removeMcpServer(id: string) {
    setMcpServersDraft((prev) => prev.filter((server) => server.id !== id));
    setMcpTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setMcpDirty(true);
  }

  async function saveMcpServers() {
    await patch({ mcpServers: mcpServersDraft });
    setMcpDirty(false);
    showResult(t("settings.mcpSaved"), "success");
    await discoverMcpFunctions();
  }

  async function importMcpServers() {
    const source = mcpImportSource.trim();
    if (!source) {
      showResult(t("settings.mcpImportEmpty"), "error");
      return;
    }
    setMcpImportLoading(true);
    try {
      const result = await api.settingsImportMcpSource(source);
      const incoming = result.servers || [];
      setMcpServersDraft((prev) => {
        const byId = new Map(prev.map((server) => [server.id, server]));
        for (const server of incoming) {
          byId.set(server.id, server);
        }
        return Array.from(byId.values());
      });
      setMcpDirty(true);
      showResult(`${t("settings.mcpImportSuccess")}: ${incoming.length}`, "success");
    } catch (err) {
      showResult(`${t("settings.mcpImportFail")}: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setMcpImportLoading(false);
    }
  }

  async function testMcpServer(server: McpServerConfig, resultKey: string) {
    setTestingMcpId(resultKey);
    try {
      const result = await api.settingsTestMcpServer(server);
      setMcpTestResults((prev) => ({ ...prev, [resultKey]: result }));
    } catch (err) {
      setMcpTestResults((prev) => ({
        ...prev,
        [resultKey]: { ok: false, tools: [], error: err instanceof Error ? err.message : String(err) }
      }));
    } finally {
      setTestingMcpId(null);
    }
  }

  function changeInterfaceLanguage(lang: "en" | "ru" | "zh" | "ja") {
    patch({ interfaceLanguage: lang });
    window.dispatchEvent(new CustomEvent("locale-change", { detail: lang }));
  }

  // Auto-load models when provider selection changes in settings
  useEffect(() => {
    if (!selectedProviderId) { setModels([]); setSelectedModelId(""); return; }
    api.providerFetchModels(selectedProviderId)
      .then((list) => {
        setModels(list);
        setSelectedModelId((prev) => {
          if (list.length === 0) return "";
          return list.some((m) => m.id === prev) ? prev : list[0].id;
        });
      })
      .catch(() => {
        setModels([]);
        setSelectedModelId("");
      });
  }, [selectedProviderId]);

  // Auto-load compress models when compress provider changes
  useEffect(() => {
    if (!settings?.compressProviderId) { setCompressModels([]); return; }
    api.providerFetchModels(settings.compressProviderId)
      .then((list) => setCompressModels(list))
      .catch(() => setCompressModels([]));
  }, [settings?.compressProviderId]);

  // Auto-load translate models when translate provider changes
  useEffect(() => {
    if (!settings?.translateProviderId) {
      setTranslateModels([]);
      return;
    }
    void loadTranslateModels(settings.translateProviderId);
  }, [settings?.translateProviderId]);

  // Auto-load RAG models when RAG provider changes
  useEffect(() => {
    if (!settings?.ragProviderId) {
      setRagModels([]);
      return;
    }
    void loadRagModels(settings.ragProviderId);
  }, [settings?.ragProviderId]);

  // Auto-load reranker models when reranker provider changes
  useEffect(() => {
    if (!settings?.ragRerankProviderId) {
      setRagRerankModels([]);
      return;
    }
    void loadRagRerankModels(settings.ragRerankProviderId);
  }, [settings?.ragRerankProviderId]);

  useEffect(() => {
    if (!settings) return;
    setMcpServersDraft(Array.isArray(settings.mcpServers) ? settings.mcpServers : []);
    setMcpDiscoveredTools(Array.isArray(settings.mcpDiscoveredTools) ? settings.mcpDiscoveredTools : []);
    setMcpDirty(false);
    setMcpTestResults({});
  }, [settings?.mcpServers, settings?.mcpDiscoveredTools]);

  useEffect(() => {
    const raw = settings?.samplerConfig.koboldBannedPhrases;
    if (Array.isArray(raw)) {
      setKoboldBansInput(raw.join(", "));
      return;
    }
    setKoboldBansInput(typeof raw === "string" ? raw : "");
  }, [settings?.samplerConfig.koboldBannedPhrases]);

  function parsePhraseBansInput(raw: string): string[] {
    return raw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const toolStates = useMemo(() => {
    const raw = settings?.mcpToolStates;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {} as Record<string, boolean>;
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  }, [settings?.mcpToolStates]);

  const discoveredToolsByServer = useMemo(() => {
    const groups = new Map<string, McpDiscoveredTool[]>();
    for (const tool of mcpDiscoveredTools) {
      const key = tool.serverId || "unknown";
      const list = groups.get(key) || [];
      list.push(tool);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([serverId, tools]) => ({
      serverId,
      serverName: tools[0]?.serverName || serverId,
      tools: [...tools].sort((a, b) => a.toolName.localeCompare(b.toolName))
    }));
  }, [mcpDiscoveredTools]);

  const activeProviderType = useMemo<"openai" | "koboldcpp" | "custom">(() => {
    const activeId = settings?.activeProviderId;
    if (!activeId) return "openai";
    const row = providers.find((provider) => provider.id === activeId);
    return row?.providerType === "koboldcpp" || row?.providerType === "custom" ? row.providerType : "openai";
  }, [providers, settings?.activeProviderId]);
  const toolCallingLocked = activeProviderType === "koboldcpp";
  const apiParamPolicy = useMemo(
    () => normalizeApiParamPolicy(settings?.apiParamPolicy),
    [settings?.apiParamPolicy]
  );
  const activeProvider = useMemo(() => {
    if (!settings?.activeProviderId) return null;
    return providers.find((provider) => provider.id === settings.activeProviderId) ?? null;
  }, [providers, settings?.activeProviderId]);
  const orderedPromptStack = useMemo(
    () => normalizePromptStack(settings?.promptStack),
    [settings?.promptStack]
  );

  const { categoryNav, categorySections } = useMemo(() => buildSettingsNavigation(t), [t]);

  const activeCategoryConfig = categoryNav.find((item) => item.id === activeCategory) ?? categoryNav[0];
  const visibleQuickSections = categorySections[activeCategory].filter((section) => {
    const query = quickJumpFilter.trim().toLowerCase();
    if (!query) return true;
    return section.label.toLowerCase().includes(query);
  });
  const draftHasApiKey = Boolean(providerApiKey.trim()) || Boolean(editingProvider?.apiKeyMasked);
  const canTestProvider = Boolean(providerBaseUrl.trim());
  const canActivateSelectedModel = Boolean(selectedProviderId && selectedModelId);
  const primaryActionClass = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
  const secondaryActionClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60";
  const subtleChipClass = "inline-flex items-center rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[10px] font-medium text-text-secondary";
  const insetPanelClass = "rounded-lg border border-border-subtle bg-bg-primary";
  const autosaveProps = { commitMode: "debounced" as const, debounceMs: 420 };
  const autosaveVariant = settingsSaveState === "error" ? "error" : settingsSaveState === "saved" ? "success" : "info";
  const autosaveText = settingsSaveState === "saving"
    ? t("settings.autosaveSaving")
    : settingsSaveState === "saved"
      ? t("settings.autosaveSaved")
      : settingsSaveState === "error"
        ? t("settings.autosaveError")
        : t("settings.autosaveHint");

  if (!settings) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-text-tertiary">{t("settings.loading")}</div></div>;
  }

  return (
    <div className="settings-root">
      <SettingsSidebar
        activeProviderName={activeProvider?.name || ""}
        activeModel={settings.activeModel || ""}
        activeCategory={activeCategory}
        categoryNav={categoryNav}
        categorySections={categorySections}
        quickJumpFilter={quickJumpFilter}
        visibleQuickSections={visibleQuickSections}
        statusText={providerResult || autosaveText}
        statusVariant={providerResult ? resultVariant : autosaveVariant}
        onCategoryChange={setActiveCategory}
        onDangerZoneClick={() => {
          setActiveCategory("tools");
          window.setTimeout(() => scrollToSettingsSection("settings-danger-zone"), 0);
        }}
        onQuickJumpFilterChange={setQuickJumpFilter}
        onQuickSectionClick={scrollToSettingsSection}
        t={t}
      />

      <div className="settings-content-area">
        <div className="settings-content-inner">
          <div className="settings-workbench-header">
            <div>
              <div className="settings-workbench-kicker">{t("settings.autosaveLabel")}</div>
              <h1 className="settings-workbench-title">{activeCategoryConfig.label}</h1>
              <p className="settings-workbench-desc">
                {autosaveText}
              </p>
            </div>
            <div className="settings-workbench-meta">
              <span className={`settings-workbench-pill is-status is-${autosaveVariant}`}>{autosaveText}</span>
              <span className="settings-workbench-pill">{activeProvider?.name || t("settings.provider")}</span>
              <span className="settings-workbench-pill">{settings.activeModel || t("settings.selectModel")}</span>
            </div>
          </div>
          <div className="settings-workbench-chip-row">
            {categorySections[activeCategory].map((section) => (
              <button
                key={section.id}
                onClick={() => scrollToSettingsSection(section.id)}
                className="settings-workbench-chip"
              >
                {section.label}
              </button>
            ))}
          </div>

          {/* ===== CONNECTION ===== */}
          {activeCategory === "connection" && (
            <div className="space-y-4">
              <div id="settings-quick-presets" className="settings-section scroll-mt-24">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t("settings.quickPresets")}</div>
                    <p className="settings-section-desc">{t("settings.quickPresetsDescConnection")}</p>
                  </div>
                </div>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_280px]">
                  <div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {PROVIDER_PRESETS.map((preset) => (
                        <button
                          key={preset.key}
                          onClick={() => applyPresetToForm(preset)}
                          className={`rounded-lg border p-3 text-left transition-colors ${
                            selectedPresetKey === preset.key
                              ? "border-accent-border bg-accent-subtle"
                              : "border-border-subtle bg-bg-primary hover:bg-bg-hover"
                          }`}
                        >
                          <div className="text-xs font-semibold text-text-primary">{preset.label}</div>
                          <div className="mt-1 text-[10px] leading-relaxed text-text-tertiary">{preset.description}</div>
                          <div className="mt-2 text-[10px] text-text-tertiary">{preset.baseUrl}</div>
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={quickAddPreset} disabled={settingsActionBusy} className={primaryActionClass}>
                        <SettingsActionIcon name="add" />
                        {t("settings.quickAdd")}
                      </button>
                      <button onClick={refreshProviders} disabled={settingsActionBusy} className={secondaryActionClass}>
                        <SettingsActionIcon name="refresh" />
                        {t("settings.refresh")}
                      </button>
                    </div>
                  </div>

                  <div className={`${insetPanelClass} p-3`}>
                    <div className="text-[11px] font-medium text-text-secondary">{t("settings.activeRouting")}</div>
                    <div className="mt-2 text-sm font-semibold text-text-primary">
                      {activeProvider?.name || t("settings.activeRoutingEmpty")}
                    </div>
                    <div className="mt-1 break-all text-[11px] leading-relaxed text-text-tertiary">
                      {activeProvider?.baseUrl || t("settings.connectionOverviewDesc")}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-md border border-border-subtle bg-bg-secondary px-2.5 py-2">
                        <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.providerCount")}</div>
                        <div className="mt-1 text-sm font-semibold text-text-primary">{providerStats.total}</div>
                      </div>
                      <div className="rounded-md border border-border-subtle bg-bg-secondary px-2.5 py-2">
                        <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.localEndpoints")}</div>
                        <div className="mt-1 text-sm font-semibold text-text-primary">{providerStats.local}</div>
                      </div>
                      <div className="rounded-md border border-border-subtle bg-bg-secondary px-2.5 py-2">
                        <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.remoteEndpoints")}</div>
                        <div className="mt-1 text-sm font-semibold text-text-primary">{providerStats.remote}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeProvider && <span className={subtleChipClass}>{getProviderTypeLabel(activeProvider.providerType)}</span>}
                      {settings.activeModel && <span className={subtleChipClass}>{settings.activeModel}</span>}
                      {settings.fullLocalMode && <span className={subtleChipClass}>{t("settings.fullLocalMode")}</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeProvider && (
                        <button onClick={() => loadProviderIntoForm(activeProvider)} className={secondaryActionClass}>
                          <SettingsActionIcon name="edit" />
                          {t("chat.edit")}
                        </button>
                      )}
                      <button onClick={testProvider} disabled={!canTestProvider} className={secondaryActionClass}>
                        <SettingsActionIcon name="test" />
                        {t("settings.test")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_320px]">
                <div id="settings-manual-provider" className="settings-section scroll-mt-24">
                  <div className="settings-section-header">
                    <div>
                      <div className="settings-section-title">{t("settings.manualConfig")}</div>
                      <p className="settings-section-desc">{t("settings.providerEditorDesc")}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <FieldLabel>{t("settings.providerId")}</FieldLabel>
                        <InputField value={providerId} onChange={setProviderId} placeholder={t("settings.providerIdPlaceholder")} />
                      </div>
                      <div>
                        <FieldLabel>{t("settings.providerName")}</FieldLabel>
                        <InputField value={providerName} onChange={setProviderName} placeholder={t("settings.providerNamePlaceholder")} />
                      </div>
                    </div>
                    <div>
                      <FieldLabel>{t("settings.baseUrl")}</FieldLabel>
                      <InputField value={providerBaseUrl} onChange={setProviderBaseUrl} placeholder={t("settings.baseUrlPlaceholder")} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <FieldLabel>{t("settings.providerType")}</FieldLabel>
                        <SelectField value={providerType} onChange={(v) => setProviderType(v as "openai" | "koboldcpp" | "custom")}>
                          <option value="openai">{t("settings.providerTypeOpenAi")}</option>
                          <option value="koboldcpp">{t("settings.providerTypeKobold")}</option>
                          <option value="custom">{t("settings.providerTypeCustom")}</option>
                        </SelectField>
                      </div>
                      <div>
                        <FieldLabel>{providerType === "custom" ? t("settings.adapterId") : t("settings.apiKey")}</FieldLabel>
                        {providerType === "custom" ? (
                          <InputField value={providerAdapterId} onChange={setProviderAdapterId} placeholder={t("settings.adapterIdPlaceholder")} />
                        ) : (
                          <InputField value={providerApiKey} onChange={setProviderApiKey} placeholder={selectedPreset.apiKeyHint} />
                        )}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {providerType === "custom" && (
                        <div>
                          <FieldLabel>{t("settings.apiKey")}</FieldLabel>
                          <InputField value={providerApiKey} onChange={setProviderApiKey} placeholder={selectedPreset.apiKeyHint} />
                        </div>
                      )}
                      <div className={providerType === "custom" ? "" : "md:col-span-2"}>
                        <FieldLabel>{t("settings.proxyUrl")}</FieldLabel>
                        <InputField value={providerProxyUrl} onChange={setProviderProxyUrl} placeholder={t("settings.proxyUrlPlaceholder")} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <FieldLabel>{t("settings.providerManualFallback")}</FieldLabel>
                        <span className="text-[11px] text-text-tertiary">{draftManualModels.length}</span>
                      </div>
                      <textarea
                        value={providerManualModels}
                        onChange={(e) => setProviderManualModels(e.target.value)}
                        placeholder={"gpt-4.1\nmy-local-model\nclaude-sonnet"}
                        rows={4}
                        className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition focus:border-accent"
                      />
                      <div className="mt-1 text-[11px] text-text-tertiary">{t("settings.providerManualFallbackDesc")}</div>
                    </div>
                    <label className="settings-toggle-row cursor-pointer">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary">{t("settings.localOnly")}</div>
                        <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.fullLocalDesc")}</div>
                      </div>
                      <ToggleSwitch checked={providerLocalOnly} onChange={(e) => setProviderLocalOnly(e.target.checked)} />
                    </label>
                    {showExternalProviderWarning && (
                      <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger">
                        {t("settings.localOnlyExternalWarning")}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button onClick={saveProvider} disabled={settingsActionBusy} className={primaryActionClass}><SettingsActionIcon name="save" />{t("settings.saveProvider")}</button>
                      <button onClick={testProvider} disabled={!canTestProvider} className={secondaryActionClass}><SettingsActionIcon name="test" />{t("settings.test")}</button>
                      <button onClick={loadDraftModels} disabled={!canTestProvider} className={secondaryActionClass}><SettingsActionIcon name="refresh" />{t("settings.refresh")}</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="settings-section">
                    <div className="settings-section-header">
                      <div>
                        <div className="settings-section-title">{t("settings.providerLibrary")}</div>
                        <p className="settings-section-desc">{t("settings.providerLibraryDesc")}</p>
                      </div>
                    </div>
                    {providers.length > 0 ? (
                      <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                        {providers.map((provider) => {
                          const isEditing = provider.id === providerId;
                          const isActive = provider.id === settings.activeProviderId;
                          return (
                            <button
                              key={provider.id}
                              onClick={() => loadProviderIntoForm(provider)}
                              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                isEditing
                                  ? "border-accent-border bg-accent-subtle"
                                  : isActive
                                    ? "border-border bg-bg-primary"
                                    : "border-border-subtle bg-bg-primary hover:bg-bg-hover"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-text-primary">{provider.name}</div>
                                  <div className="mt-0.5 truncate text-[10px] text-text-tertiary">{provider.id}</div>
                                </div>
                                {isActive && <span className={subtleChipClass}>{t("settings.activeModelSet")}</span>}
                              </div>
                              <div className="mt-2 break-all text-[10px] leading-relaxed text-text-tertiary">{provider.baseUrl}</div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={`${insetPanelClass} px-3 py-2 text-xs text-text-tertiary`}>
                        {t("settings.providerLibraryHint")}
                      </div>
                    )}
                  </div>

                  <div className="settings-section">
                    <div className="settings-section-header">
                      <div>
                        <div className="settings-section-title">{providerName || t("settings.provider")}</div>
                        <p className="settings-section-desc">{t("settings.providerEditorDesc")}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                        <span>{t("settings.providerType")}</span>
                        <span className="text-text-primary">{getProviderTypeLabel(providerType)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                        <span>{t("settings.apiKey")}</span>
                        <span className="text-text-primary">{draftHasApiKey ? t("chat.enable") : "—"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                        <span>{t("settings.providerManualFallback")}</span>
                        <span className="text-text-primary">{draftManualModels.length || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
                        <span>{t("settings.localOnly")}</span>
                        <span className="text-text-primary">{providerLocalOnly ? t("chat.enable") : t("chat.disable")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div id="settings-active-model" className="settings-section scroll-mt-24">
                  <div className="settings-section-header">
                    <div>
                      <div className="settings-section-title">{t("settings.activeModel")}</div>
                      <p className="settings-section-desc">{t("settings.activeModelDesc")}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <FieldLabel>{t("settings.provider")}</FieldLabel>
                      <SelectField value={selectedProviderId} onChange={setSelectedProviderId}>
                        <option value="">{t("settings.selectProvider")}</option>
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </SelectField>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <FieldLabel>{t("chat.model")}</FieldLabel>
                        <button onClick={loadModels} disabled={!selectedProviderId} className={secondaryActionClass}>
                          <SettingsActionIcon name="models" />
                          {t("settings.loadModels")}
                        </button>
                      </div>
                      <SelectField value={selectedModelId} onChange={setSelectedModelId}>
                        <option value="">{t("settings.selectModel")}</option>
                        {models.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                      </SelectField>
                    </div>
                    <div className="text-[11px] text-text-tertiary">
                      {models.length ? `${t("settings.modelsLoaded")}: ${models.length}` : t("settings.noModelsReturned")}
                      {selectedProviderProfile?.baseUrl ? ` • ${selectedProviderProfile.baseUrl}` : ""}
                    </div>
                    <button onClick={applyActiveModel} disabled={!canActivateSelectedModel || settingsActionBusy} className={primaryActionClass}>
                      <SettingsActionIcon name="activate" />
                      {t("settings.useModel")}
                    </button>
                  </div>
                </div>

                <div id="settings-runtime-mode" className="settings-section scroll-mt-24">
                  <div className="settings-section-header">
                    <div>
                      <div className="settings-section-title">{t("settings.runtimeMode")}</div>
                      <p className="settings-section-desc">{t("settings.runtimeModeDesc")}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="settings-toggle-row">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary">{t("settings.fullLocalMode")}</div>
                        <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.fullLocalDesc")}</div>
                      </div>
                      <ToggleSwitch checked={settings.fullLocalMode === true} onChange={(e) => patch({ fullLocalMode: e.target.checked })} />
                    </div>
                    <div className={`${insetPanelClass} px-3 py-2 text-[11px] leading-relaxed text-text-tertiary`}>
                      {settings.fullLocalMode ? t("settings.activeRoutingLocalMode") : t("settings.activeRoutingRemoteMode")}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div id="settings-translation-model" className="settings-section scroll-mt-24">
                  <div className="settings-section-header">
                    <div>
                      <div className="settings-section-title">{t("settings.translateModel")}</div>
                      <p className="settings-section-desc">{t("settings.translateModelDesc")}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <FieldLabel>{t("settings.provider")}</FieldLabel>
                      <SelectField value={settings.translateProviderId || ""} onChange={(v) => { void patch({ translateProviderId: v || null, translateModel: null }); }}>
                        <option value="">({t("settings.activeModel")})</option>
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </SelectField>
                    </div>
                    {settings.translateProviderId && (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <FieldLabel>{t("chat.model")}</FieldLabel>
                          <button onClick={() => void loadTranslateModels(settings.translateProviderId)} className={secondaryActionClass}>
                            <SettingsActionIcon name="models" />
                            {t("settings.loadModels")}
                          </button>
                        </div>
                        <SelectField value={settings.translateModel || ""} onChange={(v) => patch({ translateModel: v || null })}>
                          <option value="">({t("settings.activeModel")})</option>
                          {translateModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                        </SelectField>
                      </div>
                    )}
                  </div>
                </div>

                <div id="settings-compress-model" className="settings-section scroll-mt-24">
                  <div className="settings-section-header">
                    <div>
                      <div className="settings-section-title">{t("settings.compressModel")}</div>
                      <p className="settings-section-desc">{t("settings.compressModelDesc")}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <FieldLabel>{t("settings.compressProvider")}</FieldLabel>
                      <SelectField value={settings.compressProviderId || ""} onChange={(v) => { patch({ compressProviderId: v || null }); }}>
                        <option value="">({t("settings.activeModel")})</option>
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </SelectField>
                    </div>
                    {settings.compressProviderId && (
                      <div>
                        <FieldLabel>{t("chat.model")}</FieldLabel>
                        <SelectField value={settings.compressModel || ""} onChange={(v) => patch({ compressModel: v || null })}>
                          <option value="">({t("settings.activeModel")})</option>
                          {compressModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                        </SelectField>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div id="settings-tts" className="settings-section scroll-mt-24">
                <div className="settings-section-header">
                  <div>
                    <div className="settings-section-title">{t("settings.tts")}</div>
                    <p className="settings-section-desc">{t("settings.ttsDesc")}</p>
                  </div>
                </div>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div><FieldLabel>{t("settings.ttsEndpoint")}</FieldLabel><InputField value={settings.ttsBaseUrl || ""} onChange={(v) => patch({ ttsBaseUrl: v })} placeholder="https://api.openai.com/v1" {...autosaveProps} /></div>
                    <div><FieldLabel>{t("settings.apiKey")}</FieldLabel><InputField type="password" value={settings.ttsApiKey || ""} onChange={(v) => patch({ ttsApiKey: v })} placeholder={t("settings.apiKey")} {...autosaveProps} /></div>
                    <div><FieldLabel>{t("settings.ttsAdapterId")}</FieldLabel><InputField value={settings.ttsAdapterId || ""} onChange={(v) => patch({ ttsAdapterId: v.trim() || null })} placeholder={t("settings.ttsAdapterIdPlaceholder")} {...autosaveProps} /></div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <FieldLabel>{t("settings.ttsModel")}</FieldLabel>
                        <button onClick={() => void loadTtsModels()} className={secondaryActionClass}><SettingsActionIcon name="models" />{t("settings.loadModels")}</button>
                      </div>
                      <SelectField value={settings.ttsModel || ""} onChange={(v) => patch({ ttsModel: v })}>
                        <option value="">{t("settings.selectModel")}</option>
                        {ttsModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                      </SelectField>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <FieldLabel>{t("settings.ttsVoice")}</FieldLabel>
                        <button onClick={() => void loadTtsVoices()} className={secondaryActionClass}><SettingsActionIcon name="voice" />{t("settings.loadVoices")}</button>
                      </div>
                      <InputField
                        value={settings.ttsVoice || ""}
                        onChange={(v) => patch({ ttsVoice: v })}
                        placeholder="alloy"
                        list="tts-voice-options"
                        {...autosaveProps}
                      />
                      <datalist id="tts-voice-options">
                        <option value="alloy" /><option value="echo" /><option value="fable" /><option value="onyx" /><option value="nova" /><option value="shimmer" />
                        {ttsVoices.map((v) => <option key={v.id} value={v.id} />)}
                      </datalist>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== MANAGED BACKENDS ===== */}
          {activeCategory === "backends" && (
            <ManagedBackendsSettings
              backends={managedBackends}
              runtimeStateById={managedBackendStateMap}
              providers={providers}
              importCommands={managedBackendImportCommands}
              onImportCommandsChange={setManagedBackendImportCommands}
              onAdd={addManagedBackend}
              onUpdate={updateManagedBackend}
              onRemove={removeManagedBackend}
              onStart={startManagedBackend}
              onStop={stopManagedBackend}
              onOpenLogs={openManagedBackendLogs}
              onApplyCommand={applyManagedBackendCommand}
              autosaveProps={autosaveProps}
              t={t}
            />
          )}

          {/* ===== INTERFACE ===== */}
          {activeCategory === "interface" && (
            <div className="space-y-4">
              <div id="settings-general" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.general")}</div>
                <div className="space-y-3">
                  <div>
                    <FieldLabel>{t("settings.theme")}</FieldLabel>
                    <SelectField value={settings.theme} onChange={handleThemeModeChange}>
                      <option value="dark">{t("settings.dark")}</option>
                      <option value="light">{t("settings.light")}</option>
                      <option value="custom">{t("settings.themePlugin")}</option>
                    </SelectField>
                  </div>
                  {pluginThemes.length > 0 && (
                    <div>
                      <FieldLabel>{t("settings.pluginTheme")}</FieldLabel>
                      <SelectField value={settings.pluginThemeId || ""} onChange={(v) => applyPluginTheme(v || pluginThemes[0]?.id || "")}>
                        <option value="">{t("settings.selectPluginTheme")}</option>
                        {pluginThemes.map((theme) => (
                          <option key={theme.id} value={theme.id}>{theme.pluginName} · {theme.label}</option>
                        ))}
                      </SelectField>
                      <div className="settings-theme-grid mt-2">
                        {pluginThemes.map((theme) => {
                          const isActive = settings.theme === "custom" && settings.pluginThemeId === theme.id;
                          const accent = theme.variables["--color-accent"] || (theme.base === "light" ? "#1e66f5" : "#8aadf4");
                          const primary = theme.variables["--color-bg-primary"] || (theme.base === "light" ? "#eff1f5" : "#11111b");
                          const secondary = theme.variables["--color-bg-secondary"] || (theme.base === "light" ? "#e6e9ef" : "#181825");
                          const tertiary = theme.variables["--color-bg-tertiary"] || (theme.base === "light" ? "#dce0e8" : "#1e1e2e");
                          const text = theme.variables["--color-text-primary"] || (theme.base === "light" ? "#4c4f69" : "#cdd6f4");
                          const border = theme.variables["--color-border"] || tertiary;

                          return (
                            <button
                              key={theme.id}
                              type="button"
                              onClick={() => applyPluginTheme(theme.id)}
                              className={`settings-theme-card ${isActive ? "is-active" : ""}`}
                            >
                              <div className="settings-theme-card-head">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-text-primary">{theme.label}</div>
                                  <div className="truncate text-[11px] text-text-tertiary">{theme.pluginName}</div>
                                </div>
                                {isActive ? (
                                  <div className="settings-theme-card-check" aria-hidden="true">
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                ) : null}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                                <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-text-secondary">
                                  {theme.pluginSource === "bundled" ? t("settings.pluginBundled") : t("settings.pluginUser")}
                                </span>
                                <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-text-secondary">
                                  {theme.base === "light" ? t("settings.light") : t("settings.dark")}
                                </span>
                              </div>
                              <div
                                className="settings-theme-preview mt-3"
                                style={{
                                  background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 58%, ${tertiary} 100%)`,
                                  borderColor: border
                                }}
                              >
                                <div className="settings-theme-preview-bar" style={{ backgroundColor: secondary, borderColor: border }}>
                                  <span className="settings-theme-preview-pill" style={{ backgroundColor: accent, color: theme.base === "light" ? "#eff1f5" : "#11111b" }} />
                                  <span className="settings-theme-preview-line" style={{ backgroundColor: border }} />
                                </div>
                                <div className="settings-theme-preview-body">
                                  <div className="settings-theme-preview-card" style={{ backgroundColor: secondary, borderColor: border }}>
                                    <div className="settings-theme-preview-title" style={{ color: text }} />
                                    <div className="settings-theme-preview-copy" style={{ backgroundColor: border }} />
                                  </div>
                                  <div className="settings-theme-preview-accent" style={{ backgroundColor: accent, color: theme.base === "light" ? "#eff1f5" : "#11111b" }}>
                                    Aa
                                  </div>
                                </div>
                              </div>
                              {theme.description ? (
                                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-text-tertiary">{theme.description}</p>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {settings.theme === "custom" && pluginThemes.length === 0 && (
                    <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-tertiary">
                      {t("settings.noPluginThemes")}
                    </div>
                  )}
                  <div id="settings-wallpaper" className="settings-wallpaper-studio scroll-mt-24">
                    <div className="settings-wallpaper-copy">
                      <div>
                        <div className="settings-wallpaper-title">{t("settings.wallpaperTitle")}</div>
                        <p className="settings-wallpaper-desc">{t("settings.wallpaperDesc")}</p>
                      </div>
                      <span className={`settings-wallpaper-state ${settings.simpleModeWallpaper ? "is-active" : ""}`}>
                        {settings.simpleModeWallpaper ? t("settings.wallpaperActive") : t("settings.wallpaperDefault")}
                      </span>
                    </div>

                    <div
                      className={`settings-wallpaper-preview ${settings.simpleModeWallpaper ? "has-image" : ""}`}
                    >
                      {settings.simpleModeWallpaper ? (
                        <>
                          <div
                            className="settings-wallpaper-preview-image"
                            style={{
                              backgroundImage: `url(${JSON.stringify(settings.simpleModeWallpaper)})`,
                              backgroundPosition: settings.simpleModeWallpaperPosition,
                              filter: `blur(${settings.simpleModeWallpaperBlur}px)`,
                              transform: `scale(${1 + Math.min(24, settings.simpleModeWallpaperBlur) / 180})`
                            }}
                          />
                          <div
                            className="settings-wallpaper-preview-dim"
                            style={{ opacity: settings.simpleModeWallpaperDim }}
                          />
                        </>
                      ) : null}
                      <div className="settings-wallpaper-preview-ui">
                        <span />
                        <div>
                          <i />
                          <i />
                        </div>
                      </div>
                      <div className="settings-wallpaper-preview-label">Simple Mode</div>
                    </div>

                    <div className="settings-wallpaper-actions">
                      <button
                        type="button"
                        onClick={() => wallpaperInputRef.current?.click()}
                        className={primaryActionClass}
                      >
                        {settings.simpleModeWallpaper ? t("settings.wallpaperReplace") : t("settings.wallpaperChoose")}
                      </button>
                      {settings.simpleModeWallpaper ? (
                        <IconButton
                          label={t("settings.wallpaperRemove")}
                          onClick={() => { void handleWallpaperRemove(); }}
                          tone="danger"
                          icon={(
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
                            </svg>
                          )}
                        />
                      ) : null}
                      <input
                        ref={wallpaperInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => { void handleWallpaperFile(event.target.files?.[0] || null); }}
                      />
                    </div>

                    {settings.simpleModeWallpaper ? (
                      <>
                      <WallpaperThemePanel
                        enabled={wallpaperThemeEnabled}
                        generating={wallpaperThemeGenerating}
                        palette={wallpaperThemePalette}
                        secondaryActionClass={secondaryActionClass}
                        onToggle={handleWallpaperThemeToggle}
                        onRegenerate={() => { void regenerateWallpaperTheme(); }}
                        t={t}
                      />
                      <div className="settings-wallpaper-controls">
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <FieldLabel>{t("settings.wallpaperDim")}</FieldLabel>
                            <span className="text-xs text-text-tertiary">{Math.round(settings.simpleModeWallpaperDim * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.15}
                            max={0.9}
                            step={0.05}
                            value={settings.simpleModeWallpaperDim}
                            onChange={(event) => queueWallpaperPatch({ simpleModeWallpaperDim: Number(event.target.value) })}
                            className="w-full"
                          />
                        </div>
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <FieldLabel>{t("settings.wallpaperBlur")}</FieldLabel>
                            <span className="text-xs text-text-tertiary">{Math.round(settings.simpleModeWallpaperBlur)} px</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={24}
                            step={1}
                            value={settings.simpleModeWallpaperBlur}
                            onChange={(event) => queueWallpaperPatch({ simpleModeWallpaperBlur: Number(event.target.value) })}
                            className="w-full"
                          />
                        </div>
                        <div>
                          <FieldLabel>{t("settings.wallpaperPosition")}</FieldLabel>
                          <SelectField
                            value={settings.simpleModeWallpaperPosition}
                            onChange={(value) => void patch({ simpleModeWallpaperPosition: value as AppSettings["simpleModeWallpaperPosition"] })}
                          >
                            <option value="top">{t("settings.wallpaperPositionTop")}</option>
                            <option value="center">{t("settings.wallpaperPositionCenter")}</option>
                            <option value="bottom">{t("settings.wallpaperPositionBottom")}</option>
                          </SelectField>
                        </div>
                      </div>
                      </>
                    ) : null}
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <FieldLabel>{t("settings.textSize")}</FieldLabel>
                      <span className="text-xs text-text-tertiary">{Math.round(settings.fontScale * 100)}%</span>
                    </div>
                    <input type="range" min={0.65} max={1.5} step={0.05} value={settings.fontScale} onChange={(e) => patch({ fontScale: Number(e.target.value) })} className="w-full" />
                  </div>
                  <div>
                    <FieldLabel>{t("settings.interfaceLanguage")}</FieldLabel>
                    <SelectField value={settings.interfaceLanguage || "en"} onChange={(v) => changeInterfaceLanguage(v as "en" | "ru" | "zh" | "ja")}>
                      <option value="en">{t("common.english")}</option>
                      <option value="ru">{t("common.russian")}</option>
                      <option value="zh">{t("common.chinese")}</option>
                      <option value="ja">{t("common.japanese")}</option>
                    </SelectField>
                  </div>
                </div>
              </div>

              <div id="settings-welcome-tour" className="settings-section settings-tour-callout scroll-mt-24">
                <div className="settings-tour-callout-icon" aria-hidden="true">
                  <SettingsActionIcon name="tour" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="settings-section-title">{t("settings.welcomeTour")}</div>
                  <p className="settings-section-desc">{t("settings.welcomeTourDesc")}</p>
                </div>
                <button
                  type="button"
                  className={primaryActionClass}
                  onClick={() => window.dispatchEvent(new Event("welcome-tour-start"))}
                >
                  <SettingsActionIcon name="tour" />
                  {t("settings.welcomeTourStart")}
                </button>
              </div>

              <div id="settings-workspace-mode" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.workspaceMode")}</div>
                <div className="space-y-2">
                  <div className="settings-toggle-row">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("settings.simpleModeRequired")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.simpleModeRequiredDesc")}</div>
                    </div>
                    <span className="rounded-full border border-success-border bg-success-subtle px-2 py-1 text-[10px] font-semibold text-success">✓</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== GENERATION ===== */}
          {activeCategory === "generation" && (
            <div className="space-y-4">
              <div id="settings-output-behaviour" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.outputBehaviour")}</div>
                <div className="space-y-3">
                  <div><FieldLabel>{t("settings.responseLanguage")}</FieldLabel><InputField value={settings.responseLanguage} onChange={(v) => patch({ responseLanguage: v })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.translateLanguage")}</FieldLabel><InputField value={settings.translateLanguage || settings.responseLanguage || "English"} onChange={(v) => patch({ translateLanguage: v })} {...autosaveProps} /></div>
                  <div>
                    <FieldLabel>{t("settings.censorship")}</FieldLabel>
                    <SelectField value={settings.censorshipMode} onChange={(v) => patch({ censorshipMode: v as AppSettings["censorshipMode"] })}>
                      <option value="Unfiltered">{t("settings.unfiltered")}</option>
                      <option value="Filtered">{t("settings.filtered")}</option>
                    </SelectField>
                  </div>
                </div>
              </div>

              <div id="settings-sampler-defaults" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.samplerDefaults")}</div>
                <div className="space-y-4">
                  {([
                    { key: "temperature" as const, label: t("inspector.temperature"), min: 0, max: 2 },
                    { key: "topP" as const, label: t("inspector.topP"), min: 0, max: 1 },
                    { key: "frequencyPenalty" as const, label: t("inspector.freqPenalty"), min: 0, max: 2 },
                    { key: "presencePenalty" as const, label: t("inspector.presPenalty"), min: 0, max: 2 }
                  ]).map(({ key, label, min, max }) => (
                    <div key={key}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <FieldLabel>{label}</FieldLabel>
                        <span className="text-xs text-text-tertiary">{settings.samplerConfig[key].toFixed(2)}</span>
                      </div>
                      <input type="range" min={min} max={max} step={0.05} value={settings.samplerConfig[key]} onChange={(e) => patchSampler({ [key]: Number(e.target.value) })} className="w-full" />
                    </div>
                  ))}
                  <div><FieldLabel>{t("inspector.maxTokens")}</FieldLabel><InputField type="number" value={String(settings.samplerConfig.maxTokens)} onChange={(v) => patchSampler({ maxTokens: clampInteger(v, settings.samplerConfig.maxTokens, 1, 32768) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.stopSequences")}</FieldLabel><InputField value={(settings.samplerConfig.stop || []).join(", ")} onChange={(v) => patchSampler({ stop: v.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={t("settings.stopSequencesPlaceholder")} {...autosaveProps} /></div>

                  <div className="settings-field-group">
                    <div className="mb-3 text-xs font-semibold text-text-secondary">{t("settings.koboldSampler")}</div>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { key: "topK" as const, label: "Top-K", min: 0, max: 300, step: 1, fallback: 100 },
                        { key: "topA" as const, label: "Top-A", min: 0, max: 1, step: 0.01, fallback: 0 },
                        { key: "minP" as const, label: "Min-P", min: 0, max: 1, step: 0.01, fallback: 0 },
                        { key: "typical" as const, label: "Typical", min: 0, max: 1, step: 0.01, fallback: 1 },
                        { key: "tfs" as const, label: "TFS", min: 0, max: 1, step: 0.01, fallback: 1 },
                        { key: "nSigma" as const, label: "N-Sigma", min: 0, max: 1, step: 0.01, fallback: 0 },
                        { key: "repetitionPenalty" as const, label: "Rep. Penalty", min: 0, max: 2, step: 0.01, fallback: 1.1 }
                      ]).map(({ key, label, min, max, step, fallback }) => (
                        <div key={key}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <FieldLabel>{label}</FieldLabel>
                            <span className="text-xs text-text-tertiary">{Number(settings.samplerConfig[key] ?? fallback).toFixed(2)}</span>
                          </div>
                          <input type="range" min={min} max={max} step={step} value={Number(settings.samplerConfig[key] ?? fallback)} onChange={(e) => patchSampler({ [key]: Number(e.target.value) })} className="w-full" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3"><FieldLabel>{t("settings.koboldMemoryLabel")}</FieldLabel><TextareaField value={settings.samplerConfig.koboldMemory || ""} onChange={(v) => patchSampler({ koboldMemory: v })} className="h-20 text-xs" placeholder={t("settings.koboldMemoryPlaceholder")} {...autosaveProps} /></div>
                    <div className="mt-3"><FieldLabel>{t("settings.koboldPhraseBansLabel")}</FieldLabel><InputField value={koboldBansInput} onChange={setKoboldBansInput} onBlur={() => patchSampler({ koboldBannedPhrases: parsePhraseBansInput(koboldBansInput) })} placeholder={t("settings.koboldPhraseBansPlaceholder")} /></div>
                    <label className="mt-3 flex items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
                      <span className="text-xs font-medium text-text-secondary">{t("settings.koboldUseDefaultBadwordsIds")}</span>
                      <ToggleSwitch checked={settings.samplerConfig.koboldUseDefaultBadwords === true} onChange={(e) => patchSampler({ koboldUseDefaultBadwords: e.target.checked })} />
                    </label>
                  </div>
                </div>
              </div>

              <div id="settings-api-param-forwarding" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.apiParamForwarding")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.apiParamForwardingDesc")}</p>
                <div className="space-y-3">
                  <div className="settings-field-group">
                    <div className="mb-2 text-xs font-semibold text-text-secondary">{t("settings.apiParamsOpenAi")}</div>
                    <label className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
                      <span>{t("settings.sendSampler")}</span>
                      <ToggleSwitch checked={apiParamPolicy.openai.sendSampler} onChange={(e) => void patchApiParamPolicy({ openai: { sendSampler: e.target.checked } })} />
                    </label>
                    <div className={`mt-2 grid grid-cols-2 gap-2 ${apiParamPolicy.openai.sendSampler ? "" : "opacity-60"}`}>
                      {([
                        { key: "temperature" as const, label: t("inspector.temperature") },
                        { key: "topP" as const, label: t("inspector.topP") },
                        { key: "frequencyPenalty" as const, label: t("inspector.freqPenalty") },
                        { key: "presencePenalty" as const, label: t("inspector.presPenalty") },
                        { key: "maxTokens" as const, label: t("inspector.maxTokens") },
                        { key: "stop" as const, label: t("settings.stopSequences") }
                      ]).map((item) => (
                        <label key={item.key} className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-2.5 py-2 text-xs text-text-secondary">
                          <span>{item.label}</span>
                          <ToggleSwitch checked={apiParamPolicy.openai[item.key]} disabled={!apiParamPolicy.openai.sendSampler}
                            onChange={(e) => void patchApiParamPolicy({ openai: { ...apiParamPolicy.openai, [item.key]: e.target.checked } })} />
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="settings-field-group">
                    <div className="mb-2 text-xs font-semibold text-text-secondary">{t("settings.apiParamsKobold")}</div>
                    <label className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
                      <span>{t("settings.sendSampler")}</span>
                      <ToggleSwitch checked={apiParamPolicy.kobold.sendSampler} onChange={(e) => void patchApiParamPolicy({ kobold: { sendSampler: e.target.checked } })} />
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {([
                        { key: "memory" as const, label: t("settings.koboldMemoryLabel"), disableWhenSamplerOff: false },
                        { key: "maxTokens" as const, label: t("inspector.maxTokens"), disableWhenSamplerOff: true },
                        { key: "temperature" as const, label: t("inspector.temperature"), disableWhenSamplerOff: true },
                        { key: "topP" as const, label: t("inspector.topP"), disableWhenSamplerOff: true },
                        { key: "topK" as const, label: "Top-K", disableWhenSamplerOff: true },
                        { key: "topA" as const, label: "Top-A", disableWhenSamplerOff: true },
                        { key: "minP" as const, label: "Min-P", disableWhenSamplerOff: true },
                        { key: "typical" as const, label: "Typical", disableWhenSamplerOff: true },
                        { key: "tfs" as const, label: "TFS", disableWhenSamplerOff: true },
                        { key: "nSigma" as const, label: "N-Sigma", disableWhenSamplerOff: true },
                        { key: "repetitionPenalty" as const, label: t("settings.koboldRepetitionPenalty"), disableWhenSamplerOff: true },
                        { key: "repetitionPenaltyRange" as const, label: t("settings.koboldRepetitionPenaltyRange"), disableWhenSamplerOff: true },
                        { key: "repetitionPenaltySlope" as const, label: t("settings.koboldRepetitionPenaltySlope"), disableWhenSamplerOff: true },
                        { key: "samplerOrder" as const, label: t("settings.koboldSamplerOrder"), disableWhenSamplerOff: true },
                        { key: "stop" as const, label: t("settings.stopSequences"), disableWhenSamplerOff: true },
                        { key: "phraseBans" as const, label: t("settings.koboldPhraseBansLabel"), disableWhenSamplerOff: true },
                        { key: "useDefaultBadwords" as const, label: t("settings.koboldUseDefaultBadwordsIds"), disableWhenSamplerOff: true }
                      ]).map((item) => {
                        const disabled = item.disableWhenSamplerOff && !apiParamPolicy.kobold.sendSampler;
                        return (
                          <label key={item.key} className={`flex items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-2.5 py-2 text-xs text-text-secondary ${disabled ? "opacity-60" : ""}`}>
                            <span>{item.label}</span>
                            <ToggleSwitch checked={apiParamPolicy.kobold[item.key]} disabled={disabled}
                              onChange={(e) => void patchApiParamPolicy({ kobold: { ...apiParamPolicy.kobold, [item.key]: e.target.checked } })} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ===== CONTEXT ===== */}
          {activeCategory === "context" && (
            <div className="space-y-4">
              <div id="settings-context-window" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.contextWindow")}</div>
                <div className="space-y-3">
                  <div><FieldLabel>{t("settings.contextSize")}</FieldLabel><InputField type="number" value={String(settings.contextWindowSize)} onChange={(v) => patch({ contextWindowSize: clampInteger(v, settings.contextWindowSize, 256, 1048576) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.contextTailWithSummary")}</FieldLabel><InputField type="number" value={String(settings.contextTailBudgetWithSummaryPercent ?? 35)} onChange={(v) => patch({ contextTailBudgetWithSummaryPercent: clampInteger(v, settings.contextTailBudgetWithSummaryPercent ?? 35, 5, 95) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.contextTailWithoutSummary")}</FieldLabel><InputField type="number" value={String(settings.contextTailBudgetWithoutSummaryPercent ?? 75)} onChange={(v) => patch({ contextTailBudgetWithoutSummaryPercent: clampInteger(v, settings.contextTailBudgetWithoutSummaryPercent ?? 75, 5, 95) })} {...autosaveProps} /></div>
                  <div className="settings-toggle-row">
                    <div>
                      <div className="text-sm font-medium text-text-primary">{t("settings.strictGrounding")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.strictGroundingDesc")}</div>
                    </div>
                    <ToggleSwitch checked={settings.strictGrounding !== false} onChange={(e) => patch({ strictGrounding: e.target.checked })} />
                  </div>
                  <p className="text-[10px] text-text-tertiary">{t("settings.contextDesc")}</p>
                </div>
              </div>

              <div id="settings-chat-behaviour" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.conversationBehaviour")}</div>
                <div className="space-y-2">
                  {([
                    { key: "useAlternateGreetings" as const, label: t("settings.altGreetingsRandom"), desc: t("settings.altGreetingsRandomDesc") },
                    { key: "mergeConsecutiveRoles" as const, label: t("settings.mergeRoles"), desc: t("settings.mergeRolesDesc") }, { key: "includeReasoningInContext" as const, label: t("settings.includeReasoningInContext"), desc: t("settings.includeReasoningInContextDesc") }
                  ]).map((item) => (
                    <div key={item.key} className="settings-toggle-row">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary">{item.label}</div>
                        <div className="mt-0.5 text-[11px] text-text-tertiary">{item.desc}</div>
                      </div>
                      <ToggleSwitch checked={settings[item.key] === true} onChange={(e) => patch({ [item.key]: e.target.checked })} />
                    </div>
                  ))}
                </div>
              </div>

              <div id="settings-scene-fields" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.sceneFields")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.sceneFieldsDesc")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {([
                    { key: "dialogueStyle" as const, label: t("inspector.dialogueStyle") },
                    { key: "initiative" as const, label: t("inspector.initiative") },
                    { key: "descriptiveness" as const, label: t("inspector.descriptiveness") },
                    { key: "unpredictability" as const, label: t("inspector.unpredictability") },
                    { key: "emotionalDepth" as const, label: t("inspector.emotionalDepth") }
                  ]).map((item) => (
                    <label key={item.key} className="flex cursor-pointer items-center justify-between rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-secondary">
                      <span>{item.label}</span>
                      <ToggleSwitch checked={(settings.sceneFieldVisibility?.[item.key] ?? DEFAULT_SCENE_FIELD_VISIBILITY[item.key]) === true}
                        onChange={(e) => { void patchSceneFieldVisibility({ [item.key]: e.target.checked }); }} />
                    </label>
                  ))}
                </div>
              </div>

              <div id="settings-rag-model" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.ragModel")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.ragModelDesc")}</p>
                <div className="space-y-2">
                  <div>
                    <FieldLabel>{t("settings.provider")}</FieldLabel>
                    <SelectField value={settings.ragProviderId || ""} onChange={(v) => { void patch({ ragProviderId: v || null, ragModel: null }); }}>
                      <option value="">({t("settings.activeModel")})</option>
                      {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </SelectField>
                  </div>
                  {settings.ragProviderId && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <FieldLabel>{t("chat.model")}</FieldLabel>
                        <button onClick={() => void loadRagModels(settings.ragProviderId)} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover">{t("settings.loadModels")}</button>
                      </div>
                      <SelectField value={settings.ragModel || ""} onChange={(v) => patch({ ragModel: v || null })}>
                        <option value="">{t("settings.selectModel")}</option>
                        {ragModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                      </SelectField>
                    </div>
                  )}
                  <label className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
                    <span>{t("settings.ragEnableByDefault")}</span>
                    <ToggleSwitch checked={settings.ragEnabledByDefault === true} onChange={(e) => patch({ ragEnabledByDefault: e.target.checked })} />
                  </label>
                </div>
              </div>

              <div id="settings-rag-reranker" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.ragReranker")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.ragRerankerDesc")}</p>
                <div className="space-y-2">
                  <label className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
                    <span>{t("settings.ragRerankerEnable")}</span>
                    <ToggleSwitch checked={settings.ragRerankEnabled === true} onChange={(e) => patch({ ragRerankEnabled: e.target.checked })} />
                  </label>
                  <div>
                    <FieldLabel>{t("settings.provider")}</FieldLabel>
                    <SelectField value={settings.ragRerankProviderId || ""} onChange={(v) => { void patch({ ragRerankProviderId: v || null, ragRerankModel: null }); }}>
                      <option value="">({t("settings.activeModel")})</option>
                      {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </SelectField>
                  </div>
                  {settings.ragRerankProviderId && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <FieldLabel>{t("chat.model")}</FieldLabel>
                        <button onClick={() => void loadRagRerankModels(settings.ragRerankProviderId)} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover">{t("settings.loadModels")}</button>
                      </div>
                      <SelectField value={settings.ragRerankModel || ""} onChange={(v) => patch({ ragRerankModel: v || null })}>
                        <option value="">{t("settings.selectModel")}</option>
                        {ragRerankModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                      </SelectField>
                    </div>
                  )}
                  <div><FieldLabel>{t("settings.ragRerankTopN")}</FieldLabel><InputField type="number" value={String(settings.ragRerankTopN ?? 40)} onChange={(v) => patch({ ragRerankTopN: clampInteger(v, settings.ragRerankTopN ?? 40, 5, 200) })} {...autosaveProps} /></div>
                </div>
              </div>

              <div id="settings-rag-retrieval" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.ragRetrieval")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.ragRetrievalDesc")}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><FieldLabel>{t("settings.ragTopK")}</FieldLabel><InputField type="number" value={String(settings.ragTopK ?? 6)} onChange={(v) => patch({ ragTopK: clampInteger(v, settings.ragTopK ?? 6, 1, 12) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.ragCandidateCount")}</FieldLabel><InputField type="number" value={String(settings.ragCandidateCount ?? 80)} onChange={(v) => patch({ ragCandidateCount: clampInteger(v, settings.ragCandidateCount ?? 80, 10, 300) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.ragSimilarityThreshold")}</FieldLabel><InputField type="number" value={String(settings.ragSimilarityThreshold ?? 0.15)} onChange={(v) => patch({ ragSimilarityThreshold: clampDecimal(v, settings.ragSimilarityThreshold ?? 0.15, -1, 1, 2) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.ragMaxContextTokens")}</FieldLabel><InputField type="number" value={String(settings.ragMaxContextTokens ?? 900)} onChange={(v) => patch({ ragMaxContextTokens: clampInteger(v, settings.ragMaxContextTokens ?? 900, 200, 4000) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.ragChunkSize")}</FieldLabel><InputField type="number" value={String(settings.ragChunkSize ?? 1200)} onChange={(v) => patch({ ragChunkSize: clampInteger(v, settings.ragChunkSize ?? 1200, 300, 8000) })} {...autosaveProps} /></div>
                  <div><FieldLabel>{t("settings.ragChunkOverlap")}</FieldLabel><InputField type="number" value={String(settings.ragChunkOverlap ?? 220)} onChange={(v) => patch({ ragChunkOverlap: clampInteger(v, settings.ragChunkOverlap ?? 220, 0, 3000) })} {...autosaveProps} /></div>
                </div>
              </div>
            </div>
          )}

          {/* ===== PROMPTS ===== */}
          {activeCategory === "prompts" && (
            <div className="space-y-4">
              <div id="settings-prompt-templates" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.promptTemplates")}</div>
                <p className="mb-4 text-[11px] text-text-tertiary">{t("settings.promptTemplatesDesc")}</p>
                <div className="space-y-4">
                  {([
                    { key: "jailbreak" as const, label: t("prompt.jailbreak"), desc: t("prompt.jailbreakDesc") },
                    { key: "compressSummary" as const, label: t("prompt.compress"), desc: t("prompt.compressDesc") },
                    { key: "creativeWriting" as const, label: t("prompt.creativeWriting"), desc: t("prompt.creativeWritingDesc") },
                    { key: "writerGenerate" as const, label: t("prompt.writerGenerate"), desc: t("prompt.writerGenerateDesc") },
                    { key: "writerExpand" as const, label: t("prompt.writerExpand"), desc: t("prompt.writerExpandDesc") },
                    { key: "writerRewrite" as const, label: t("prompt.writerRewrite"), desc: t("prompt.writerRewriteDesc") },
                    { key: "writerSummarize" as const, label: t("prompt.writerSummarize"), desc: t("prompt.writerSummarizeDesc") }
                  ]).map(({ key, label, desc }) => (
                    <div key={key}>
                      <FieldLabel>{label}</FieldLabel>
                      <p className="mb-1.5 text-[10px] text-text-tertiary">{desc}</p>
                      <TextareaField value={settings.promptTemplates?.[key] ?? ""} onChange={(value) => { const tpl: PromptTemplates = { ...settings.promptTemplates, [key]: value }; patch({ promptTemplates: tpl }); }}
                        className="h-24 text-xs leading-relaxed" {...autosaveProps} />
                    </div>
                  ))}
                </div>
              </div>

              <div id="settings-prompt-stack" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("inspector.promptStack")}</div>
                <p className="mb-3 text-[11px] text-text-tertiary">{t("settings.promptStackDesc")}</p>
                <div className="space-y-2">
                  {orderedPromptStack.map((block) => (
                    <div key={block.id} draggable
                      onDragStart={() => setDraggedPromptBlockId(block.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => { if (!draggedPromptBlockId) return; movePromptBlock(draggedPromptBlockId, block.id); setDraggedPromptBlockId(null); }}
                      className={`rounded-lg border p-2 ${PROMPT_STACK_COLORS[block.kind] ?? "border-border bg-bg-primary"}`}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => togglePromptBlock(block.id)} className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary" title={block.enabled ? t("chat.disable") : t("chat.enable")}>
                          {block.enabled
                            ? <svg className="h-3.5 w-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            : <svg className="h-3.5 w-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                        </button>
                        <svg className="h-3.5 w-3.5 cursor-grab text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" /></svg>
                        <span className={`text-xs font-medium capitalize ${block.enabled ? "text-text-primary" : "text-text-tertiary"}`}>{promptBlockLabel(block.kind)}</span>
                      </div>
                      {(block.kind === "system" || block.kind === "jailbreak") && (
                        <TextareaField value={block.content || ""} onChange={(value) => updatePromptBlockContent(block.id, value)}
                          className="mt-2 h-20 rounded-md px-2 py-1.5 text-xs" {...autosaveProps} />
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => void savePromptStack(DEFAULT_PROMPT_STACK)} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover">{t("settings.promptStackReset")}</button>
              </div>

              <div id="settings-default-system-prompts" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.defaultSysPrompt")}</div>
                <p className="mb-2 text-[10px] text-text-tertiary">{t("settings.baseSysPromptDesc")}</p>
                <TextareaField value={settings.defaultSystemPrompt} onChange={(value) => patch({ defaultSystemPrompt: value })}
                  className="h-40 text-xs leading-relaxed"
                  placeholder={t("settings.defaultSystemPromptPlaceholder")}
                  {...autosaveProps} />
                <p className="mt-2 text-[10px] text-text-tertiary">{t("settings.defaultSysPromptDesc")}</p>
              </div>
            </div>
          )}

          {/* ===== TOOLS ===== */}
          {activeCategory === "tools" && (
            <div className="space-y-4">
              <div id="settings-tools-core" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.tools")}</div>
                <div className="space-y-3">
                  {toolCallingLocked && (
                    <div className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning">{t("settings.toolCallingKoboldDisabled")}</div>
                  )}
                  <div className={`settings-toggle-row ${toolCallingLocked ? "opacity-60" : ""}`}>
                    <div>
                      <div className="text-sm font-medium text-text-primary">{t("settings.toolCallingEnabled")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.toolCallingDesc")}</div>
                    </div>
                    <ToggleSwitch checked={settings.toolCallingEnabled ?? false} disabled={toolCallingLocked} onChange={(e) => patch({ toolCallingEnabled: e.target.checked })} />
                  </div>
                  <div className={toolCallingLocked ? "opacity-60" : ""}>
                    <FieldLabel>{t("settings.toolCallingPolicy")}</FieldLabel>
                    <SelectField value={settings.toolCallingPolicy ?? "balanced"} onChange={(v) => patch({ toolCallingPolicy: v as AppSettings["toolCallingPolicy"] })} disabled={toolCallingLocked}>
                      <option value="conservative">{t("settings.toolPolicyConservative")}</option>
                      <option value="balanced">{t("settings.toolPolicyBalanced")}</option>
                      <option value="aggressive">{t("settings.toolPolicyAggressive")}</option>
                    </SelectField>
                    <p className="mt-1 text-[10px] text-text-tertiary">{t("settings.toolCallingPolicyDesc")}</p>
                  </div>
                  <div className={toolCallingLocked ? "opacity-60" : ""}>
                    <FieldLabel>{t("settings.maxToolCalls")}</FieldLabel>
                    <InputField type="number" value={String(settings.maxToolCallsPerTurn ?? 4)} disabled={toolCallingLocked}
                      onChange={(v) => { patch({ maxToolCallsPerTurn: clampInteger(v, settings.maxToolCallsPerTurn ?? 4, 1, 12) }); }}
                      {...autosaveProps} />
                  </div>
                  <div className={`settings-toggle-row ${toolCallingLocked ? "opacity-60" : ""}`}>
                    <div>
                      <div className="text-sm font-medium text-text-primary">{t("settings.mcpAutoAttachTools")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.mcpAutoAttachToolsDesc")}</div>
                    </div>
                    <ToggleSwitch checked={settings.mcpAutoAttachTools ?? true} disabled={toolCallingLocked} onChange={(e) => patch({ mcpAutoAttachTools: e.target.checked })} />
                  </div>
                </div>
              </div>

              <div id="settings-security" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.security")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.securityDesc")}</p>
                <div className="space-y-2">
                  {([
                    { key: "sanitizeMarkdown" as const, label: t("settings.securitySanitizeMarkdown"), desc: t("settings.securitySanitizeMarkdownDesc") },
                    { key: "allowExternalLinks" as const, label: t("settings.securityAllowExternalLinks"), desc: t("settings.securityAllowExternalLinksDesc") },
                    { key: "allowRemoteImages" as const, label: t("settings.securityAllowRemoteImages"), desc: t("settings.securityAllowRemoteImagesDesc") },
                    { key: "allowUnsafeUploads" as const, label: t("settings.securityAllowUnsafeUploads"), desc: t("settings.securityAllowUnsafeUploadsDesc") }
                  ]).map((item) => (
                    <div key={item.key} className="settings-toggle-row">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary">{item.label}</div>
                        <div className="mt-0.5 text-[11px] text-text-tertiary">{item.desc}</div>
                      </div>
                      <ToggleSwitch checked={settings.security?.[item.key] === true}
                        onChange={(e) => patch({ security: { ...(settings.security || {}), [item.key]: e.target.checked } })} />
                    </div>
                  ))}
                </div>
              </div>

              <div id="settings-plugins" className="settings-section scroll-mt-24">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="settings-section-title mb-0">{t("settings.plugins")}</div>
                    <p className="mt-1 text-[10px] text-text-tertiary">{t("settings.pluginsDesc")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={pluginInstallInputRef}
                      type="file"
                      accept=".json,.pluginfile.json,application/json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        void installPluginfile(file);
                      }}
                    />
                    <button
                      onClick={() => pluginInstallInputRef.current?.click()}
                      disabled={pluginInstallBusy}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t("settings.installPluginfile")}
                    </button>
                    <button
                      onClick={() => { void refreshPlugins({ force: true }).then(() => showResult(t("settings.pluginsReloaded"), "success")).catch((err) => showResult(String(err), "error")); }}
                      disabled={pluginsLoading}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t("settings.reloadPlugins")}
                    </button>
                    <button
                      onClick={() => {
                        const path = pluginCatalog?.pluginsDir || "";
                        if (!path) return;
                        if (!navigator.clipboard?.writeText) {
                          showResult(path, "info");
                          return;
                        }
                        void navigator.clipboard.writeText(path)
                          .then(() => showResult(t("settings.pluginsDirCopied"), "success"))
                          .catch(() => showResult(path, "info"));
                      }}
                      disabled={!pluginCatalog?.pluginsDir}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                    >
                      {t("settings.copyPluginsDir")}
                    </button>
                  </div>
                </div>
                <div className="mb-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.pluginsDir")}</div>
                    <div className="mt-1 break-all text-xs text-text-primary">{pluginCatalog?.pluginsDir || "—"}</div>
                  </div>
                  <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.pluginSdk")}</div>
                    <div className="mt-1 break-all text-xs text-text-primary">{pluginCatalog?.sdkUrl || "/api/plugins/sdk.js"}</div>
                  </div>
                  <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 md:col-span-2">
                    <div className="text-[10px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.bundledPluginsDir")}</div>
                    <div className="mt-1 break-all text-xs text-text-primary">{pluginCatalog?.bundledPluginsDir || "—"}</div>
                  </div>
                </div>
                <div className="mb-3 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                  <div className="settings-toggle-row">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("settings.pluginDevAutoRefresh")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.pluginDevAutoRefreshDesc")}</div>
                    </div>
                    <ToggleSwitch checked={pluginDevAutoRefresh} onChange={(e) => {
                      const next = e.target.checked;
                      setPluginDevAutoRefresh(next);
                      setPluginDevAutoRefreshEnabled(next);
                    }} />
                  </div>
                </div>
                {pluginsLoading ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-tertiary">{t("settings.loading")}</div>
                ) : pluginError ? (
                  <div className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger">
                    {t("settings.pluginsLoadFailed")}: {pluginError}
                  </div>
                ) : plugins.length === 0 ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-tertiary">{t("settings.noPluginsFound")}</div>
                ) : (
                  <div className="space-y-2">
                    {plugins.map((plugin) => (
                      <div key={plugin.id} className="rounded-lg border border-border-subtle bg-bg-primary p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-semibold text-text-primary">{plugin.name}</div>
                              <span className="rounded-md border border-border-subtle bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-secondary">v{plugin.version}</span>
                              <span className="rounded-md border border-border-subtle bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-secondary">
                                {plugin.source === "bundled" ? t("settings.pluginBundled") : t("settings.pluginUser")}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-text-tertiary">{plugin.description || t("settings.pluginsNoDescription")}</div>
                            <div className="mt-2 text-[10px] text-text-tertiary">
                              {t("settings.pluginCapabilities")}: {plugin.tabs.length} {t("settings.pluginTabsCount")} · {plugin.slots.length} {t("settings.pluginSlotsCount")} · {plugin.actions.length} {t("settings.pluginActionsCount")} · {plugin.themes.length} {t("settings.pluginThemesCount")}
                            </div>
                            <div className="mt-2">
                              <div className="text-[10px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.pluginPermissions")}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {plugin.requestedPermissions.map((permission) => {
                                  const tone = pluginPermissionTone(permission);
                                  const granted = plugin.grantedPermissions.includes(permission);
                                  const className =
                                    tone === "high"
                                      ? granted ? "border-danger-border bg-danger-subtle text-danger" : "border-danger-border/50 bg-transparent text-danger/60"
                                      : tone === "medium"
                                        ? granted ? "border-warning-border bg-warning-subtle text-warning" : "border-warning-border/50 bg-transparent text-warning/60"
                                        : granted ? "border-border-subtle bg-bg-secondary text-text-secondary" : "border-border-subtle bg-transparent text-text-tertiary";
                                  return (
                                    <span key={permission} className={`rounded-full border px-2 py-0.5 text-[10px] ${className}`}>
                                      {permission}{granted ? "" : ` · ${t("settings.pluginPermissionDenied")}`}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                            {hasHighRiskPluginPermissions(plugin.requestedPermissions) && (
                              <div className="mt-2 rounded-lg border border-danger-border bg-danger-subtle px-2.5 py-2 text-[11px] text-danger">
                                {t("settings.pluginHighTrustWarning")}
                              </div>
                            )}
                            {plugin.actions.length > 0 && (
                              <div className="mt-2">
                                <div className="text-[10px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.pluginActionLocations")}</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {Array.from(new Set(plugin.actions.map((action) => action.location))).map((location) => (
                                    <span key={location} className="rounded-full border border-accent-border bg-accent-subtle px-2 py-0.5 text-[10px] text-accent">
                                      {location}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <IconButton
                              size="sm"
                              label={t("settings.exportPluginfile")}
                              onClick={() => { void exportPluginfile(plugin); }}
                              icon={(
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
                                </svg>
                              )}
                            />
                            {plugin.requestedPermissions.length > 0 && (
                              <IconButton
                                size="sm"
                                label={t("settings.pluginPermissionsManage")}
                                data-modal-trigger="plugin-permissions"
                                onClick={() => openPluginPermissions(plugin)}
                                icon={(
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Zm-2 9 1.5 1.5L15 10" />
                                  </svg>
                                )}
                              />
                            )}
                            {plugin.settingsFields.length > 0 && (
                              <IconButton
                                size="sm"
                                label={t("settings.pluginSettings")}
                                data-modal-trigger="plugin-settings"
                                onClick={() => { void openPluginSettings(plugin); }}
                                icon={(
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4 2-1-2-3-2 .5a8 8 0 0 0-1.6-.9L16 5h-4l-.4 2.6a8 8 0 0 0-1.6.9L8 8 6 11l2 1a8 8 0 0 0 0 2l-2 1 2 3 2-.5a8 8 0 0 0 1.6.9L12 21h4l.4-2.6a8 8 0 0 0 1.6-.9l2 .5 2-3-2-1a8 8 0 0 0 0-2Z" />
                                  </svg>
                                )}
                              />
                            )}
                            <ToggleSwitch checked={plugin.enabled} disabled={Object.prototype.hasOwnProperty.call(pendingPluginStates, plugin.id)} onChange={(e) => {
                              if (e.target.checked && plugin.requestedPermissions.length > 0 && !plugin.permissionsConfigured) {
                                openPluginPermissions(plugin, { enableAfterSave: true });
                                return;
                              }
                              void setPluginEnabled(plugin.id, e.target.checked);
                            }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div id="settings-tools-mcp-functions" className={`settings-section scroll-mt-24 ${toolCallingLocked ? "opacity-60" : ""}`}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="settings-section-title mb-0">{t("settings.mcpFunctions")}</div>
                  <button onClick={() => void discoverMcpFunctions()} disabled={mcpDiscoveryLoading || toolCallingLocked}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60">
                    {mcpDiscoveryLoading ? t("settings.mcpLoadingFunctions") : t("settings.mcpLoadFunctions")}
                  </button>
                </div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.mcpFunctionsDesc")}</p>
                {discoveredToolsByServer.length === 0 ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-tertiary">{t("settings.mcpNoFunctions")}</div>
                ) : (
                  <div className="space-y-2">
                    {discoveredToolsByServer.map((group) => (
                      <div key={group.serverId} className="rounded-lg border border-border-subtle bg-bg-primary p-2">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">{group.serverName}</div>
                        <div className="space-y-1.5">
                          {group.tools.map((tool) => {
                            const enabled = toolStates[tool.callName] !== false;
                            return (
                              <label key={tool.callName} className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1.5">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-text-primary">{tool.toolName}</div>
                                  <div className="truncate text-[10px] text-text-tertiary">{tool.callName}</div>
                                </div>
                                <ToggleSwitch checked={enabled} disabled={toolCallingLocked} onChange={(e) => { void setToolEnabled(tool.callName, e.target.checked); }} />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div id="settings-tools-mcp" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.mcpServers")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.mcpServersDesc")}</p>
                <div className="mb-3 settings-field-group">
                  <FieldLabel>{t("settings.mcpImportSource")}</FieldLabel>
                  <textarea value={mcpImportSource} onChange={(e) => setMcpImportSource(e.target.value)}
                    className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary"
                    placeholder={t("settings.mcpImportPlaceholder")} />
                  <button onClick={() => void importMcpServers()} disabled={mcpImportLoading}
                    className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60">
                    {mcpImportLoading ? t("settings.mcpImporting") : t("settings.mcpImport")}
                  </button>
                </div>
                <div className="space-y-3">
                  {mcpServersDraft.map((server, index) => {
                    const rowKey = server.id || `mcp-row-${index}`;
                    const testResult = mcpTestResults[rowKey];
                    return (
                      <div key={rowKey} className="rounded-lg border border-border-subtle bg-bg-primary p-3">
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <div><FieldLabel>{t("settings.mcpId")}</FieldLabel><InputField value={server.id} onChange={(v) => updateMcpServer(server.id, { id: v })} /></div>
                          <div><FieldLabel>{t("settings.mcpName")}</FieldLabel><InputField value={server.name} onChange={(v) => updateMcpServer(server.id, { name: v })} /></div>
                        </div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <div><FieldLabel>{t("settings.mcpCommand")}</FieldLabel><InputField value={server.command} onChange={(v) => updateMcpServer(server.id, { command: v })} /></div>
                          <div><FieldLabel>{t("settings.mcpArgs")}</FieldLabel><InputField value={server.args} onChange={(v) => updateMcpServer(server.id, { args: v })} /></div>
                        </div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <div>
                            <FieldLabel>{t("settings.mcpTimeout")}</FieldLabel>
                            <input type="number" min={1000} max={120000} value={server.timeoutMs}
                              onChange={(e) => { const v = Number(e.target.value); updateMcpServer(server.id, { timeoutMs: Number.isFinite(v) ? Math.max(1000, Math.min(120000, Math.floor(v))) : 15000 }); }}
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" />
                          </div>
                          <div className="flex items-end">
                            <label className="flex w-full items-center justify-between rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5">
                              <span className="text-xs font-medium text-text-secondary">{t("settings.mcpEnabled")}</span>
                              <ToggleSwitch checked={server.enabled} onChange={(e) => updateMcpServer(server.id, { enabled: e.target.checked })} />
                            </label>
                          </div>
                        </div>
                        <div><FieldLabel>{t("settings.mcpEnv")}</FieldLabel><textarea value={server.env || ""} onChange={(e) => updateMcpServer(server.id, { env: e.target.value })} className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary" /></div>
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => void testMcpServer(server, rowKey)} disabled={testingMcpId === rowKey}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60">
                            {testingMcpId === rowKey ? t("settings.mcpTesting") : t("settings.mcpTest")}
                          </button>
                          <button onClick={() => removeMcpServer(server.id)} className="rounded-lg border border-danger-border px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-subtle">{t("settings.mcpRemove")}</button>
                        </div>
                        {testResult && (
                          <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${testResult.ok ? "border-success-border bg-success-subtle text-success" : "border-danger-border bg-danger-subtle text-danger"}`}>
                            <div className="font-medium">{testResult.ok ? t("settings.mcpTestOk") : t("settings.mcpTestFail")}</div>
                            {testResult.ok
                              ? <div className="mt-1">{t("settings.mcpToolsFound")}: {testResult.tools.length}{testResult.tools.length > 0 && <span className="ml-1 text-text-secondary">{testResult.tools.map((tool) => tool.name).join(", ")}</span>}</div>
                              : <div className="mt-1">{testResult.error || "Unknown error"}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={addMcpServer} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover">{t("settings.mcpAdd")}</button>
                  <button onClick={saveMcpServers} disabled={!mcpDirty} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60">{t("settings.mcpSave")}</button>
                </div>
              </div>

              <div id="settings-danger-zone" className="settings-section scroll-mt-24 border-danger-border">
                <div className="settings-section-title">{t("settings.dangerZone")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.dangerZoneDesc")}</p>
                <button
                  onClick={() => void reset()}
                  disabled={settingsActionBusy}
                  className="w-full rounded-lg border border-danger-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger-subtle"
                >
                  {t("settings.resetAll")}
                </button>
              </div>

              <PluginSlotMount slotId="settings.bottom" />
            </div>
          )}

          {activeCategory === "legacy" && (
            <div id="settings-legacy" className="scroll-mt-24">
              <LegacyScreen
                embedded
                initialAgentThreadId={initialLegacyAgentThreadId}
                onInitialAgentThreadHandled={onInitialLegacyAgentThreadHandled}
              />
            </div>
          )}

          {pluginPermissionsPlugin && (
            <ModalShell
              title={pluginPermissionsPlugin.name}
              description={t("settings.pluginPermissionsDesc")}
              closeLabel={t("settings.pluginPermissionsCancel")}
              onClose={() => {
                setPluginPermissionsPlugin(null);
                setPluginPermissionsEnableAfterSave(false);
              }}
              closeDisabled={pluginPermissionsSaving}
              size="md"
              originId="plugin-permissions"
              surfaceClassName="settings-dialog"
              bodyClassName="settings-dialog-body"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Zm-2 9 1.5 1.5L15 10" />
                </svg>
              )}
              footer={(
                <>
                  <span className="vellium-modal-footer-note mr-auto">
                    {pluginPermissionsEnableAfterSave ? t("settings.pluginPermissionsEnableHint") : t("settings.pluginPermissionsRuntimeHint")}
                  </span>
                  <button
                    onClick={() => {
                      setPluginPermissionsPlugin(null);
                      setPluginPermissionsEnableAfterSave(false);
                    }}
                    className="vellium-button vellium-button-secondary"
                  >
                    {t("settings.pluginPermissionsCancel")}
                  </button>
                  <button onClick={() => void savePluginPermissions()} disabled={pluginPermissionsSaving} className="vellium-button vellium-button-primary">
                    {pluginPermissionsSaving ? t("settings.pluginPermissionsSaving") : t("settings.pluginPermissionsSave")}
                  </button>
                </>
              )}
            >
                <div className="settings-dialog-list">
                  {pluginPermissionsPlugin.requestedPermissions.map((permission) => {
                    const tone = pluginPermissionTone(permission);
                    const badgeClass =
                      tone === "high"
                        ? "border-danger-border bg-danger-subtle text-danger"
                        : tone === "medium"
                          ? "border-warning-border bg-warning-subtle text-warning"
                          : "border-border-subtle bg-bg-secondary text-text-secondary";
                    return (
                      <div key={permission} className="rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badgeClass}`}>{permission}</span>
                            </div>
                            <div className="mt-2 text-xs text-text-tertiary">
                              {pluginPermissionDescription(t, permission)}
                            </div>
                          </div>
                          <ToggleSwitch
                            checked={pluginPermissionsDraft[permission] === true}
                            onChange={(e) => setPluginPermissionsDraft((prev) => ({ ...prev, [permission]: e.target.checked }))}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
            </ModalShell>
          )}

          {pluginSettingsPlugin && (
            <ModalShell
              title={pluginSettingsPlugin.name}
              description={t("settings.pluginSettingsDesc")}
              closeLabel={t("settings.pluginSettingsCancel")}
              onClose={() => setPluginSettingsPlugin(null)}
              closeDisabled={pluginSettingsSaving}
              size="lg"
              originId="plugin-settings"
              surfaceClassName="settings-dialog"
              bodyClassName="settings-dialog-body"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4 2-1-2-3-2 .5a8 8 0 0 0-1.6-.9L16 5h-4l-.4 2.6a8 8 0 0 0-1.6.9L8 8 6 11l2 1a8 8 0 0 0 0 2l-2 1 2 3 2-.5a8 8 0 0 0 1.6.9L12 21h4l.4-2.6a8 8 0 0 0 1.6-.9l2 .5 2-3-2-1a8 8 0 0 0 0-2Z" />
                </svg>
              )}
              footer={(
                <>
                  <button onClick={() => setPluginSettingsPlugin(null)} className="vellium-button vellium-button-secondary">
                    {t("settings.pluginSettingsCancel")}
                  </button>
                  <button
                    onClick={() => void savePluginSettings()}
                    disabled={pluginSettingsLoading || pluginSettingsSaving}
                    className="vellium-button vellium-button-primary"
                  >
                    {pluginSettingsSaving ? t("settings.pluginSettingsSaving") : t("settings.pluginSettingsSave")}
                  </button>
                </>
              )}
            >
                <div className="settings-dialog-fields">
                  {pluginSettingsLoading ? (
                    <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-sm text-text-tertiary">{t("settings.pluginSettingsLoading")}</div>
                  ) : (
                    pluginSettingsPlugin.settingsFields.map((field) => {
                      const value = pluginSettingsDraft[field.key];
                      return (
                        <div key={field.id} className="settings-field-group">
                          <FieldLabel>{field.label}</FieldLabel>
                          {field.type === "toggle" ? (
                            <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                              <div className="min-w-0 text-xs text-text-secondary">{field.description || field.placeholder || ""}</div>
                              <ToggleSwitch
                                checked={value === true}
                                onChange={(e) => setPluginSettingsDraft((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                              />
                            </div>
                          ) : field.type === "select" ? (
                            <SelectField value={String(value ?? "")} onChange={(next) => setPluginSettingsDraft((prev) => ({ ...prev, [field.key]: next }))}>
                              <option value="">{field.placeholder || "—"}</option>
                              {(field.options || []).map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </SelectField>
                          ) : field.type === "textarea" ? (
                            <textarea
                              value={String(value ?? "")}
                              onChange={(e) => setPluginSettingsDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              rows={field.rows || 4}
                              placeholder={field.placeholder}
                              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary"
                            />
                          ) : field.type === "number" || field.type === "range" ? (
                            <div className="space-y-2">
                              <input
                                type={field.type}
                                min={field.min}
                                max={field.max}
                                step={field.step}
                                value={Number(value ?? field.defaultValue ?? 0)}
                                onChange={(e) => setPluginSettingsDraft((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))}
                                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
                              />
                              {field.type === "range" && (
                                <div className="text-xs text-text-tertiary">{Number(value ?? field.defaultValue ?? 0)}</div>
                              )}
                            </div>
                          ) : (
                            <InputField
                              type={field.type === "secret" ? "password" : "text"}
                              value={String(value ?? "")}
                              onChange={(next) => setPluginSettingsDraft((prev) => ({ ...prev, [field.key]: next }))}
                              placeholder={field.placeholder}
                            />
                          )}
                          {field.description && field.type !== "toggle" && (
                            <div className="mt-1 text-[11px] text-text-tertiary">{field.description}</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
            </ModalShell>
          )}

          {managedBackendLogsFor && (
            <ModalShell
              title={managedBackendLogsFor.name}
              description={t("settings.backendLogsDesc")}
              closeLabel={t("common.close")}
              onClose={() => setManagedBackendLogsFor(null)}
              size="xl"
              originId="backend-logs"
              surfaceClassName="settings-dialog backend-logs-dialog"
              bodyClassName="settings-dialog-body"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 8 4 4-4 4m6 0h6M4 4h16v16H4z" />
                </svg>
              )}
              footer={(
                <button onClick={() => setManagedBackendLogsFor(null)} className="vellium-button vellium-button-primary">
                  {t("common.close")}
                </button>
              )}
            >
                <div className="backend-log-stack">
                  <div className="backend-log-command">
                    {managedBackendStateMap.get(managedBackendLogsFor.id)?.commandPreview || buildManagedBackendCommand(managedBackendLogsFor).command}
                  </div>
                  <div className="backend-log-output">
                    {managedBackendLogs.length === 0 ? (
                      <div className="text-slate-400">{t("settings.backendLogsEmpty")}</div>
                    ) : managedBackendLogs.map((entry) => (
                      <div key={entry.id} className="mb-1 whitespace-pre-wrap break-words">
                        <span className={entry.stream === "stderr" ? "text-rose-300" : entry.stream === "system" ? "text-amber-300" : "text-slate-200"}>
                          [{entry.stream}] {entry.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
            </ModalShell>
          )}

        </div>
      </div>
    </div>
  );
}
