import { useEffect, useMemo, useRef, useState } from "react";
import { isPluginDevAutoRefreshEnabled, PluginSlotMount, setPluginDevAutoRefreshEnabled, usePlugins } from "../plugins/PluginHost";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import { PROVIDER_PRESETS, type ProviderPreset } from "../../shared/providerPresets";
import { buildManagedBackendCommand, defaultManagedBackendConfig, normalizeManagedBackends, parseManagedBackendCommand, resolveManagedBackendBaseUrl } from "../../shared/managedBackends";
import type { ApiParamPolicy, AppSettings, ManagedBackendConfig, ManagedBackendLogEntry, ManagedBackendRuntimeState, McpDiscoveredTool, McpServerConfig, McpServerTestResult, PluginDescriptor, PromptBlock, PromptTemplates, ProviderModel, ProviderProfile, SamplerConfig } from "../../shared/types/contracts";
import { FieldLabel, InputField, SelectField, TextareaField, ToggleSwitch } from "./components/FormControls";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { buildSettingsNavigation, DEFAULT_PROMPT_STACK, DEFAULT_SCENE_FIELD_VISIBILITY, PROMPT_STACK_COLORS, type SettingsCategory } from "./config";
import { buildPluginPermissionDraft, buildPluginSettingsDraft, hasHighRiskPluginPermissions, normalizeApiParamPolicy, normalizePromptStack, pluginPermissionDescription, pluginPermissionTone, promptBlockLabel, scrollToSettingsSection, sanitizePluginSettingsFieldValue, triggerBlobDownload } from "./utils";

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

export function SettingsScreen() {
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
  const pluginInstallInputRef = useRef<HTMLInputElement | null>(null);
  const [managedBackendImportCommands, setManagedBackendImportCommands] = useState<Record<string, string>>({});
  const [settingsSaveState, setSettingsSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const managedBackendsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const managedBackendsDraftRef = useRef<ManagedBackendConfig[]>([]);

  useEffect(() => {
    void (async () => {
      const s = await api.settingsGet();
      setSettings(s);
      setMcpServersDraft(Array.isArray(s.mcpServers) ? s.mcpServers : []);
      setMcpDiscoveredTools(Array.isArray(s.mcpDiscoveredTools) ? s.mcpDiscoveredTools : []);
      setMcpDirty(false);
      const p = await api.providerList();
      setProviders(p);
      if (s.activeProviderId) setSelectedProviderId(s.activeProviderId);
      if (s.activeModel) setSelectedModelId(s.activeModel);
    })();
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
    return () => {
      if (settingsSaveTimerRef.current) {
        clearTimeout(settingsSaveTimerRef.current);
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
    setSettingsSaveState("saving");
    try {
      const updated = await api.settingsUpdate(next);
      setSettings(updated);
      if (next.theme !== undefined || next.pluginThemeId !== undefined) {
        window.dispatchEvent(new CustomEvent("theme-change", { detail: updated }));
      }
      if (next.fontScale !== undefined || next.density !== undefined) {
        window.dispatchEvent(new CustomEvent("display-settings-change", {
          detail: {
            fontScale: updated.fontScale,
            density: updated.density
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
      setSettingsSaveState("error");
      showResult(error instanceof Error ? error.message : String(error), "error");
    }
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
    if (!window.confirm(t("settings.confirmResetAll"))) {
      return;
    }
    const defaults = await api.settingsReset();
    setSettings(defaults);
    window.dispatchEvent(new CustomEvent("onboarding-reset", { detail: defaults }));
    showResult(t("settings.settingsResetDone"), "success");
  }

  async function refreshProviders() {
    const p = await api.providerList();
    setProviders(p);
  }

  async function saveProvider() {
    if (!providerId.trim() || !providerName.trim() || !providerBaseUrl.trim()) {
      showResult(t("settings.fillProviderRequired"), "error");
      return;
    }
    if (providerType === "custom" && !providerAdapterId.trim()) {
      showResult(t("settings.fillAdapterRequired"), "error");
      return;
    }
    const saved = await api.providerUpsert({
      id: providerId.trim(), name: providerName.trim(), baseUrl: providerBaseUrl.trim(),
      apiKey: providerApiKey.trim() || "local-key",
      proxyUrl: providerProxyUrl.trim() || null,
      fullLocalOnly: providerLocalOnly,
      providerType,
      adapterId: providerType === "custom" ? providerAdapterId.trim() || null : null,
      manualModels: draftManualModels
    });
    showResult(`${t("settings.providerSaved")}: ${saved.name}`, "success");
    await refreshProviders();
    setSelectedProviderId(saved.id);
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
    applyPresetToForm(selectedPreset);
    await api.providerUpsert({
      id: selectedPreset.defaultId, name: selectedPreset.defaultName, baseUrl: selectedPreset.baseUrl,
      apiKey: providerApiKey.trim() || (selectedPreset.localOnly ? "local-key" : ""),
      proxyUrl: null,
      fullLocalOnly: selectedPreset.localOnly,
      providerType: selectedPreset.providerType,
      adapterId: null
    });
    await refreshProviders();
    setSelectedProviderId(selectedPreset.defaultId);
    showResult(`${t("settings.presetProviderAdded")}: ${selectedPreset.label}`, "success");
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
    if (!selectedProviderId || !selectedModelId) { showResult(t("settings.selectProviderAndModelFirst"), "error"); return; }
    const result = await api.providerActivateModel(selectedProviderId, selectedModelId);
    const updated = result.settings;
    setSettings(updated);
    setSelectedModelId(result.actualModelId || selectedModelId);
    showResult(`${t("settings.activeModelSet")}: ${selectedProviderId} / ${result.activeModelLabel || result.actualModelId || selectedModelId}`, "success");
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
  const primaryActionClass = "rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
  const secondaryActionClass = "rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60";
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
                      <button onClick={quickAddPreset} className={primaryActionClass}>
                        {t("settings.quickAdd")}
                      </button>
                      <button onClick={refreshProviders} className={secondaryActionClass}>
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
                          {t("chat.edit")}
                        </button>
                      )}
                      <button onClick={testProvider} disabled={!canTestProvider} className={secondaryActionClass}>
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
                      <button onClick={saveProvider} className={primaryActionClass}>{t("settings.saveProvider")}</button>
                      <button onClick={testProvider} disabled={!canTestProvider} className={secondaryActionClass}>{t("settings.test")}</button>
                      <button onClick={loadDraftModels} disabled={!canTestProvider} className={secondaryActionClass}>{t("settings.refresh")}</button>
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
                    <button onClick={applyActiveModel} disabled={!canActivateSelectedModel} className={primaryActionClass}>
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
                        <button onClick={() => void loadTtsModels()} className={secondaryActionClass}>{t("settings.loadModels")}</button>
                      </div>
                      <SelectField value={settings.ttsModel || ""} onChange={(v) => patch({ ttsModel: v })}>
                        <option value="">{t("settings.selectModel")}</option>
                        {ttsModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
                      </SelectField>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <FieldLabel>{t("settings.ttsVoice")}</FieldLabel>
                        <button onClick={() => void loadTtsVoices()} className={secondaryActionClass}>{t("settings.loadVoices")}</button>
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
            <div className="space-y-4">
              <div id="settings-managed-backends" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.managedBackends")}</div>
                <p className="mb-4 text-xs text-text-tertiary">{t("settings.managedBackendsDesc")}</p>

                {managedBackends.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-bg-primary px-4 py-5 text-sm text-text-tertiary">
                    {t("settings.managedBackendsEmpty")}
                  </div>
                ) : null}

                <div className="space-y-4">
                  {managedBackends.map((backend) => {
                    const runtime = managedBackendStateMap.get(backend.id);
                    const koboldOptions = backend.koboldcpp || defaultManagedBackendConfig().koboldcpp!;
                    const ollamaOptions = backend.ollama || defaultManagedBackendConfig().ollama!;
                    const isStarting = runtime?.status === "starting";
                    const isRunning = runtime?.status === "running" || isStarting;
                    const commandPreview = runtime?.commandPreview || buildManagedBackendCommand(backend).command;
                    const envText = backend.envText || "";
                    const runtimeStatus = runtime?.status || "idle";

                    return (
                      <div key={backend.id} className="rounded-2xl border border-border bg-bg-secondary p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-text-primary">{backend.name}</div>
                              <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                                {backend.backendKind}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                runtimeStatus === "running"
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                  : isStarting
                                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                    : runtimeStatus === "error"
                                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                                      : "border-border-subtle bg-bg-primary text-text-tertiary"
                              }`}>
                                {runtimeStatus}
                              </span>
                              {runtime?.pid ? (
                                <span className="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] text-text-tertiary">
                                  PID {runtime.pid}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-[11px] text-text-tertiary">
                              {resolveManagedBackendBaseUrl(backend)}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => void startManagedBackend(backend)}
                              disabled={isRunning}
                              className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("settings.startBackend")}
                            </button>
                            <button
                              onClick={() => void stopManagedBackend(backend.id)}
                              disabled={!isRunning}
                              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("settings.stopBackend")}
                            </button>
                            <button
                              onClick={() => void openManagedBackendLogs(backend)}
                              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                            >
                              {t("settings.viewLogs")}
                            </button>
                            <button
                              onClick={() => removeManagedBackend(backend.id)}
                              className="rounded-lg border border-danger-border px-3 py-2 text-xs font-medium text-danger hover:bg-danger-subtle"
                            >
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>

                        {typeof runtime?.progress === "number" || runtime?.progressLabel ? (
                          <div className="mt-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-text-secondary">
                              <span>{runtime?.progressLabel || runtimeStatus}</span>
                              <span>{typeof runtime?.progress === "number" ? `${runtime.progress}%` : runtimeStatus}</span>
                            </div>
                            <div className="h-2 rounded-full bg-bg-hover">
                              <div
                                className="h-2 rounded-full bg-accent transition-all"
                                style={{ width: `${Math.max(0, Math.min(100, runtime?.progress ?? 0))}%` }}
                              />
                            </div>
                          </div>
                        ) : null}

                        {runtime?.lastError ? (
                          <div className="mt-4 rounded-xl border border-danger-border bg-danger-subtle px-3 py-2 text-xs text-danger">
                            {runtime.lastError}
                          </div>
                        ) : null}

                        {Array.isArray(runtime?.models) && runtime.models.length > 0 ? (
                          <div className="mt-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                            <div className="mb-2 text-xs font-semibold text-text-secondary">{t("settings.modelsLoaded")}</div>
                            <div className="flex flex-wrap gap-2">
                              {runtime.models.map((model) => (
                                <span key={model} className="rounded-full border border-border-subtle bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary">
                                  {model}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel>{t("settings.backendName")}</FieldLabel>
                            <InputField
                              value={backend.name}
                              onChange={(value) => updateManagedBackend(backend.id, { name: value })}
                              placeholder={t("settings.backendNamePlaceholder")}
                            />
                          </div>
                          <div>
                            <FieldLabel>{t("settings.backendKind")}</FieldLabel>
                            <SelectField
                              value={backend.backendKind}
                              onChange={(value) => updateManagedBackend(backend.id, { backendKind: value as ManagedBackendConfig["backendKind"] })}
                            >
                              <option value="koboldcpp">KoboldCpp</option>
                              <option value="ollama">Ollama</option>
                              <option value="generic">Generic</option>
                            </SelectField>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <div>
                            <FieldLabel>{t("settings.provider")}</FieldLabel>
                            <SelectField value={backend.providerId} onChange={(value) => updateManagedBackend(backend.id, { providerId: value })}>
                              {providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.name}</option>
                              ))}
                            </SelectField>
                          </div>
                          <div>
                            <FieldLabel>{t("settings.providerType")}</FieldLabel>
                            <SelectField
                              value={backend.providerType}
                              onChange={(value) => updateManagedBackend(backend.id, { providerType: value as ManagedBackendConfig["providerType"] })}
                            >
                              <option value="openai">{t("settings.providerTypeOpenAi")}</option>
                              <option value="koboldcpp">{t("settings.providerTypeKobold")}</option>
                              <option value="custom">{t("settings.providerTypeCustom")}</option>
                            </SelectField>
                          </div>
                          <div>
                            <FieldLabel>{t("settings.baseUrl")}</FieldLabel>
                            <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-sm text-text-secondary">
                              {resolveManagedBackendBaseUrl(backend)}
                            </div>
                          </div>
                        </div>

                        {backend.providerType === "custom" && (
                          <div className="mt-4">
                            <FieldLabel>{t("settings.adapterId")}</FieldLabel>
                            <InputField
                              value={backend.adapterId || ""}
                              onChange={(value) => updateManagedBackend(backend.id, { adapterId: value.trim() || null })}
                              placeholder={t("settings.adapterIdPlaceholder")}
                            />
                          </div>
                        )}

                        <div className="mt-4 rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                          <div className="mb-2 text-xs font-semibold text-text-secondary">{t("settings.importCommand")}</div>
                          <div className="flex flex-col gap-3 md:flex-row">
                            <textarea
                              value={managedBackendImportCommands[backend.id] || ""}
                              onChange={(e) => setManagedBackendImportCommands((current) => ({ ...current, [backend.id]: e.target.value }))}
                              placeholder={t("settings.importCommandPlaceholder")}
                              className="h-24 min-h-[96px] flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
                            />
                            <button
                              onClick={() => applyManagedBackendCommand(backend)}
                              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover"
                            >
                              {t("settings.applyCommand")}
                            </button>
                          </div>
                        </div>

                        {backend.backendKind === "koboldcpp" && (
                          <>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.executable")}</FieldLabel>
                                <InputField value={koboldOptions.executable} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, executable: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.modelPath")}</FieldLabel>
                                <InputField value={koboldOptions.modelPath || ""} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, modelPath: value } })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-4">
                              <div>
                                <FieldLabel>{t("settings.host")}</FieldLabel>
                                <InputField value={koboldOptions.host} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, host: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.port")}</FieldLabel>
                                <InputField type="number" value={String(koboldOptions.port)} onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, port: Number(value || 0) || koboldOptions.port } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.contextWindow")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.contextSize || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, contextSize: Number(value || 0) || 0 } })}
                                />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.gpuLayers")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.gpuLayers || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, gpuLayers: Number(value || 0) || 0 } })}
                                />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                              <div>
                                <FieldLabel>{t("settings.threads")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.threads || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, threads: Number(value || 0) || 0 } })}
                                />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.blasThreads")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.blasThreads || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, blasThreads: Number(value || 0) || 0 } })}
                                />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.batchSize")}</FieldLabel>
                                <InputField
                                  type="number"
                                  value={String(koboldOptions.batchSize || 0)}
                                  onChange={(value) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, batchSize: Number(value || 0) || 0 } })}
                                />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {([
                                ["highPriority", t("settings.highPriority")],
                                ["smartContext", t("settings.smartContext")],
                                ["useMmap", t("settings.useMmap")],
                                ["flashAttention", t("settings.flashAttention")],
                                ["noMmap", t("settings.noMmap")],
                                ["noKvOffload", t("settings.noKvOffload")]
                              ] as const).map(([key, label]) => (
                                <label key={key} className="settings-toggle-row rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
                                  <span className="text-xs font-medium text-text-secondary">{label}</span>
                                  <ToggleSwitch
                                    checked={Boolean(koboldOptions[key])}
                                    onChange={(e) => updateManagedBackend(backend.id, { koboldcpp: { ...koboldOptions, [key]: e.target.checked } })}
                                  />
                                </label>
                              ))}
                            </div>
                          </>
                        )}

                        {backend.backendKind === "ollama" && (
                          <>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.executable")}</FieldLabel>
                                <InputField value={ollamaOptions.executable} onChange={(value) => updateManagedBackend(backend.id, { ollama: { ...ollamaOptions, executable: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.defaultModel")}</FieldLabel>
                                <InputField value={backend.defaultModel || ""} onChange={(value) => updateManagedBackend(backend.id, { defaultModel: value })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.host")}</FieldLabel>
                                <InputField value={ollamaOptions.host} onChange={(value) => updateManagedBackend(backend.id, { ollama: { ...ollamaOptions, host: value } })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.port")}</FieldLabel>
                                <InputField type="number" value={String(ollamaOptions.port)} onChange={(value) => updateManagedBackend(backend.id, { ollama: { ...ollamaOptions, port: Number(value || 0) || ollamaOptions.port } })} />
                              </div>
                            </div>
                          </>
                        )}

                        {backend.backendKind === "generic" && (
                          <>
                            <div className="mt-4">
                              <FieldLabel>{t("settings.commandOverride")}</FieldLabel>
                              <InputField
                                value={backend.commandOverride || ""}
                                onChange={(value) => updateManagedBackend(backend.id, { commandOverride: value })}
                                placeholder="python server.py --host 127.0.0.1 --port 8000"
                              />
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.defaultModel")}</FieldLabel>
                                <InputField value={backend.defaultModel || ""} onChange={(value) => updateManagedBackend(backend.id, { defaultModel: value })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.healthPath")}</FieldLabel>
                                <InputField value={backend.healthPath || ""} onChange={(value) => updateManagedBackend(backend.id, { healthPath: value })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <div>
                                <FieldLabel>{t("settings.modelsPath")}</FieldLabel>
                                <InputField value={backend.modelsPath || ""} onChange={(value) => updateManagedBackend(backend.id, { modelsPath: value })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.statusPath")}</FieldLabel>
                                <InputField value={backend.statusPath || ""} onChange={(value) => updateManagedBackend(backend.id, { statusPath: value })} />
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                              <div>
                                <FieldLabel>{t("settings.statusMode")}</FieldLabel>
                                <SelectField
                                  value={backend.statusMode || "auto"}
                                  onChange={(value) => updateManagedBackend(backend.id, { statusMode: value as ManagedBackendConfig["statusMode"] })}
                                >
                                  <option value="auto">auto</option>
                                  <option value="api">api</option>
                                  <option value="stdout">stdout</option>
                                  <option value="none">none</option>
                                </SelectField>
                              </div>
                              <div>
                                <FieldLabel>{t("settings.statusTextPath")}</FieldLabel>
                                <InputField value={backend.statusTextPath || ""} onChange={(value) => updateManagedBackend(backend.id, { statusTextPath: value })} />
                              </div>
                              <div>
                                <FieldLabel>{t("settings.statusProgressPath")}</FieldLabel>
                                <InputField value={backend.statusProgressPath || ""} onChange={(value) => updateManagedBackend(backend.id, { statusProgressPath: value })} />
                              </div>
                            </div>
                          </>
                        )}

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div>
                            <FieldLabel>{t("settings.workingDirectory")}</FieldLabel>
                            <InputField value={backend.workingDirectory || ""} onChange={(value) => updateManagedBackend(backend.id, { workingDirectory: value })} />
                          </div>
                          <div>
                            <FieldLabel>{t("settings.extraArgs")}</FieldLabel>
                            <InputField value={backend.extraArgs || ""} onChange={(value) => updateManagedBackend(backend.id, { extraArgs: value })} />
                          </div>
                        </div>

                        <div className="mt-4">
                          <FieldLabel>{t("settings.envVars")}</FieldLabel>
                          <TextareaField
                            value={envText}
                            onChange={(value) => updateManagedBackend(backend.id, { envText: value })}
                            placeholder={"KEY=value\nANOTHER=value"}
                            className="h-24 min-h-[96px] text-xs"
                            {...autosaveProps}
                          />
                        </div>

                        <label className="mt-4 settings-toggle-row rounded-lg border border-border-subtle bg-bg-primary px-3 py-2">
                          <span className="text-xs font-medium text-text-secondary">{t("settings.autoStopOnSwitch")}</span>
                          <ToggleSwitch
                            checked={backend.autoStopOnSwitch !== false}
                            onChange={(e) => updateManagedBackend(backend.id, { autoStopOnSwitch: e.target.checked })}
                          />
                        </label>

                        <div className="mt-4">
                          <FieldLabel>{t("settings.commandPreview")}</FieldLabel>
                          <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 font-mono text-[11px] text-text-secondary">
                            {commandPreview}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={addManagedBackend}
                  className="mt-4 w-full rounded-lg border border-border border-dashed px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover"
                >
                  {t("settings.addManagedBackend")}
                </button>
              </div>
            </div>
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

              <div id="settings-workspace-mode" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.workspaceMode")}</div>
                <div className="space-y-2">
                  <div className="settings-toggle-row">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("settings.alternateSimpleMode")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.alternateSimpleModeDesc")}</div>
                    </div>
                    <ToggleSwitch checked={settings.alternateSimpleMode === true} onChange={(e) => patch({ alternateSimpleMode: e.target.checked })} />
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
                    { key: "mergeConsecutiveRoles" as const, label: t("settings.mergeRoles"), desc: t("settings.mergeRolesDesc") }
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
                            <button
                              onClick={() => { void exportPluginfile(plugin); }}
                              className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
                            >
                              {t("settings.exportPluginfile")}
                            </button>
                            {plugin.requestedPermissions.length > 0 && (
                              <button
                                onClick={() => openPluginPermissions(plugin)}
                                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
                              >
                                {t("settings.pluginPermissionsManage")}
                              </button>
                            )}
                            {plugin.settingsFields.length > 0 && (
                              <button
                                onClick={() => { void openPluginSettings(plugin); }}
                                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
                              >
                                {t("settings.pluginSettings")}
                              </button>
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
                  className="w-full rounded-lg border border-danger-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger-subtle"
                >
                  {t("settings.resetAll")}
                </button>
              </div>

              <PluginSlotMount slotId="settings.bottom" />
            </div>
          )}

          {pluginPermissionsPlugin && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
              <div className="modal-pop w-full max-w-xl rounded-2xl border border-border bg-bg-secondary shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-text-primary">{pluginPermissionsPlugin.name}</div>
                    <div className="mt-1 text-xs text-text-tertiary">{t("settings.pluginPermissionsDesc")}</div>
                  </div>
                  <button
                    onClick={() => {
                      setPluginPermissionsPlugin(null);
                      setPluginPermissionsEnableAfterSave(false);
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                  >
                    {t("settings.pluginPermissionsCancel")}
                  </button>
                </div>
                <div className="max-h-[70vh] space-y-3 overflow-auto px-5 py-4">
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
                <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-4">
                  <div className="text-xs text-text-tertiary">
                    {pluginPermissionsEnableAfterSave ? t("settings.pluginPermissionsEnableHint") : t("settings.pluginPermissionsRuntimeHint")}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setPluginPermissionsPlugin(null);
                        setPluginPermissionsEnableAfterSave(false);
                      }}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                    >
                      {t("settings.pluginPermissionsCancel")}
                    </button>
                    <button
                      onClick={() => void savePluginPermissions()}
                      disabled={pluginPermissionsSaving}
                      className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
                    >
                      {pluginPermissionsSaving ? t("settings.pluginPermissionsSaving") : t("settings.pluginPermissionsSave")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {pluginSettingsPlugin && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
              <div className="modal-pop w-full max-w-2xl rounded-2xl border border-border bg-bg-secondary shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-text-primary">{pluginSettingsPlugin.name}</div>
                    <div className="mt-1 text-xs text-text-tertiary">{t("settings.pluginSettingsDesc")}</div>
                  </div>
                  <button
                    onClick={() => setPluginSettingsPlugin(null)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                  >
                    {t("settings.pluginSettingsCancel")}
                  </button>
                </div>
                <div className="max-h-[70vh] space-y-4 overflow-auto px-5 py-4">
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
                <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
                  <button
                    onClick={() => setPluginSettingsPlugin(null)}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                  >
                    {t("settings.pluginSettingsCancel")}
                  </button>
                  <button
                    onClick={() => void savePluginSettings()}
                    disabled={pluginSettingsLoading || pluginSettingsSaving}
                    className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover disabled:opacity-60"
                  >
                    {pluginSettingsSaving ? t("settings.pluginSettingsSaving") : t("settings.pluginSettingsSave")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {managedBackendLogsFor && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
              <div className="modal-pop w-full max-w-4xl rounded-2xl border border-border bg-bg-secondary shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-text-primary">{managedBackendLogsFor.name}</div>
                    <div className="mt-1 text-xs text-text-tertiary">{t("settings.backendLogsDesc")}</div>
                  </div>
                  <button
                    onClick={() => setManagedBackendLogsFor(null)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                  >
                    {t("common.close")}
                  </button>
                </div>
                <div className="space-y-3 px-5 py-4">
                  <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-[11px] text-text-secondary">
                    {managedBackendStateMap.get(managedBackendLogsFor.id)?.commandPreview || buildManagedBackendCommand(managedBackendLogsFor).command}
                  </div>
                  <div className="max-h-[60vh] overflow-auto rounded-lg border border-border-subtle bg-black/80 px-3 py-2 font-mono text-[11px] text-slate-200">
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
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
