import { useEffect, useMemo, useRef, useState } from "react";
import { isPluginDevAutoRefreshEnabled, PluginSlotMount, setPluginDevAutoRefreshEnabled, usePlugins } from "../plugins/PluginHost";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import { PROVIDER_PRESETS, type ProviderPreset } from "../../shared/providerPresets";
import type { ApiParamPolicy, AppSettings, McpDiscoveredTool, McpServerConfig, McpServerTestResult, PluginDescriptor, PluginSettingsFieldContribution, PromptBlock, PromptTemplates, ProviderModel, ProviderProfile, SamplerConfig } from "../../shared/types/contracts";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-text-secondary">{children}</label>;
}

function InputField({
  value,
  onChange,
  placeholder,
  type = "text",
  onBlur
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  onBlur?: () => void;
}) {
  return (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} onBlur={onBlur}
      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary" />
  );
}

function SelectField({ value, onChange, children, disabled = false }: { value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary">
      {children}
    </select>
  );
}

function StatusMessage({ text, variant = "info" }: { text: string; variant?: "info" | "success" | "error" }) {
  if (!text) return null;
  const styles = { info: "border-border-subtle bg-bg-primary text-text-secondary", success: "border-success-border bg-success-subtle text-success", error: "border-danger-border bg-danger-subtle text-danger" };
  return <div className={`rounded-lg border px-3 py-2 text-xs ${styles[variant]}`}>{text}</div>;
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false
}: {
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <div className="toggle-track">
        <div className="toggle-thumb" />
      </div>
    </label>
  );
}

const DEFAULT_API_PARAM_POLICY: ApiParamPolicy = {
  openai: {
    sendSampler: true,
    temperature: true,
    topP: true,
    frequencyPenalty: true,
    presencePenalty: true,
    maxTokens: true,
    stop: true
  },
  kobold: {
    sendSampler: true,
    memory: true,
    maxTokens: true,
    temperature: true,
    topP: true,
    topK: true,
    topA: true,
    minP: true,
    typical: true,
    tfs: true,
    nSigma: true,
    repetitionPenalty: true,
    repetitionPenaltyRange: true,
    repetitionPenaltySlope: true,
    samplerOrder: true,
    stop: true,
    phraseBans: true,
    useDefaultBadwords: true
  }
};
const DEFAULT_SCENE_FIELD_VISIBILITY: AppSettings["sceneFieldVisibility"] = {
  dialogueStyle: true,
  initiative: true,
  descriptiveness: true,
  unpredictability: true,
  emotionalDepth: true
};

const DEFAULT_PROMPT_STACK: PromptBlock[] = [
  { id: "default-1", kind: "system", enabled: true, order: 1, content: "" },
  { id: "default-2", kind: "jailbreak", enabled: true, order: 2, content: "Never break character. Write as the character would, staying true to their personality." },
  { id: "default-3", kind: "character", enabled: true, order: 3, content: "" },
  { id: "default-4", kind: "author_note", enabled: true, order: 4, content: "" },
  { id: "default-5", kind: "lore", enabled: false, order: 5, content: "" },
  { id: "default-6", kind: "scene", enabled: true, order: 6, content: "" },
  { id: "default-7", kind: "history", enabled: true, order: 7, content: "" }
];

const PROMPT_STACK_COLORS: Record<PromptBlock["kind"], string> = {
  system: "border-blue-500/30 bg-blue-500/8",
  jailbreak: "border-red-500/30 bg-red-500/8",
  character: "border-purple-500/30 bg-purple-500/8",
  author_note: "border-amber-500/30 bg-amber-500/8",
  lore: "border-emerald-500/30 bg-emerald-500/8",
  scene: "border-cyan-500/30 bg-cyan-500/8",
  history: "border-slate-500/30 bg-slate-500/8"
};

function normalizePromptStack(raw: PromptBlock[] | null | undefined): PromptBlock[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_PROMPT_STACK];
  return [...raw]
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({ ...block, order: index + 1 }));
}

function promptBlockLabel(kind: PromptBlock["kind"]): string {
  if (kind === "jailbreak") return "Character lock";
  return kind.replace("_", " ");
}

function normalizeApiParamPolicy(raw: ApiParamPolicy | null | undefined): ApiParamPolicy {
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

function scrollToSettingsSection(id: string) {
  const node = document.getElementById(id);
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const HIGH_RISK_PLUGIN_PERMISSIONS = new Set(["api.write", "pluginSettings.write"]);
const MEDIUM_RISK_PLUGIN_PERMISSIONS = new Set(["pluginSettings.read"]);

function pluginPermissionTone(permission: string): "high" | "medium" | "normal" {
  if (HIGH_RISK_PLUGIN_PERMISSIONS.has(permission)) return "high";
  if (MEDIUM_RISK_PLUGIN_PERMISSIONS.has(permission)) return "medium";
  return "normal";
}

function pluginPermissionDescription(t: (key: any) => string, permission: string): string {
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

function buildPluginSettingsDraft(
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

function sanitizePluginSettingsFieldValue(
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

function buildPluginPermissionDraft(plugin: PluginDescriptor): Record<string, boolean> {
  return Object.fromEntries(
    plugin.requestedPermissions.map((permission) => [permission, plugin.grantedPermissions.includes(permission)])
  );
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
        label: `${plugin.name} · ${theme.label}`,
        description: theme.description,
        pluginId: plugin.id,
        themeId: theme.id
      })))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [plugins]);

  const [providerId, setProviderId] = useState(selectedPreset.defaultId);
  const [providerName, setProviderName] = useState(selectedPreset.defaultName);
  const [providerBaseUrl, setProviderBaseUrl] = useState(selectedPreset.baseUrl);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerProxyUrl, setProviderProxyUrl] = useState("");
  const [providerLocalOnly, setProviderLocalOnly] = useState(selectedPreset.localOnly);
  const [providerType, setProviderType] = useState<"openai" | "koboldcpp" | "custom">(selectedPreset.providerType);
  const [providerAdapterId, setProviderAdapterId] = useState("");

  const [activeCategory, setActiveCategory] = useState<"connection" | "interface" | "generation" | "context" | "prompts" | "tools">("connection");
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

  function showResult(text: string, variant: "info" | "success" | "error" = "info") {
    setProviderResult(text);
    setResultVariant(variant);
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
    if (preset.key === "openai") {
      void patchApiParamPolicy({ openai: { sendSampler: false } });
    }
    showResult(`${t("settings.presetApplied")}: ${preset.label}`, "info");
  }

  async function patch(next: Partial<AppSettings>) {
    const updated = await api.settingsUpdate(next);
    setSettings(updated);
    if (next.theme !== undefined || next.pluginThemeId !== undefined) {
      window.dispatchEvent(new CustomEvent("theme-change", { detail: updated }));
    }
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
      adapterId: providerType === "custom" ? providerAdapterId.trim() || null : null
    });
    showResult(`${t("settings.providerSaved")}: ${saved.name}`, "success");
    await refreshProviders();
    setSelectedProviderId(saved.id);
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
    const targetId = selectedProviderId || providerId;
    if (!targetId) { showResult(t("settings.selectOrSaveProviderFirst"), "error"); return; }
    const ok = await api.providerTestConnection(targetId);
    showResult(ok ? t("settings.connectionCheckOk") : t("settings.providerBlockedOrInvalid"), ok ? "success" : "error");
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
    } catch (error) { showResult(`${t("settings.loadModelsFailed")}: ${String(error)}`, "error"); }
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
      const list = await api.settingsFetchTtsModels(settings.ttsBaseUrl, settings.ttsApiKey);
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
      const list = await api.settingsFetchTtsVoices(settings.ttsBaseUrl, settings.ttsApiKey);
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
    const updated = await api.providerSetActive(selectedProviderId, selectedModelId);
    setSettings(updated);
    showResult(`${t("settings.activeModelSet")}: ${selectedProviderId} / ${selectedModelId}`, "success");
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

  const categoryNav: Array<{ id: typeof activeCategory; label: string; icon: string }> = [
    { id: "connection", label: t("settings.categoryConnection"), icon: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" },
    { id: "interface", label: t("settings.categoryInterface"), icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
    { id: "generation", label: t("settings.categoryGeneration"), icon: "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" },
    { id: "context", label: t("settings.categoryContext"), icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
    { id: "prompts", label: t("settings.categoryPrompts"), icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    { id: "tools", label: t("settings.categoryTools"), icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }
  ];

  const categorySections = useMemo<Record<typeof activeCategory, Array<{ id: string; label: string }>>>(() => ({
    connection: [
      { id: "settings-quick-presets", label: t("settings.quickPresets") },
      { id: "settings-manual-provider", label: t("settings.manualConfig") },
      { id: "settings-runtime-mode", label: t("settings.runtimeMode") },
      { id: "settings-active-model", label: t("settings.activeModel") },
      { id: "settings-translation-model", label: t("settings.translateModel") },
      { id: "settings-compress-model", label: t("settings.compressModel") },
      { id: "settings-tts", label: t("settings.tts") }
    ],
    interface: [
      { id: "settings-general", label: t("settings.general") },
      { id: "settings-workspace-mode", label: t("settings.workspaceMode") }
    ],
    generation: [
      { id: "settings-output-behaviour", label: t("settings.outputBehaviour") },
      { id: "settings-sampler-defaults", label: t("settings.samplerDefaults") },
      { id: "settings-api-param-forwarding", label: t("settings.apiParamForwarding") }
    ],
    context: [
      { id: "settings-context-window", label: t("settings.contextWindow") },
      { id: "settings-chat-behaviour", label: t("settings.conversationBehaviour") },
      { id: "settings-scene-fields", label: t("settings.sceneFields") },
      { id: "settings-rag-model", label: t("settings.ragModel") },
      { id: "settings-rag-reranker", label: t("settings.ragReranker") },
      { id: "settings-rag-retrieval", label: t("settings.ragRetrieval") }
    ],
    prompts: [
      { id: "settings-prompt-templates", label: t("settings.promptTemplates") },
      { id: "settings-prompt-stack", label: t("inspector.promptStack") },
      { id: "settings-default-system-prompts", label: t("settings.defaultSysPrompt") }
    ],
    tools: [
      { id: "settings-tools-core", label: t("settings.tools") },
      { id: "settings-security", label: t("settings.security") },
      { id: "settings-plugins", label: t("settings.plugins") },
      { id: "settings-tools-mcp-functions", label: t("settings.mcpFunctions") },
      { id: "settings-tools-mcp", label: t("settings.mcpServers") },
      { id: "settings-danger-zone", label: t("settings.dangerZone") }
    ]
  }), [t]);

  const activeCategoryConfig = categoryNav.find((item) => item.id === activeCategory) ?? categoryNav[0];
  const visibleQuickSections = categorySections[activeCategory].filter((section) => {
    const query = quickJumpFilter.trim().toLowerCase();
    if (!query) return true;
    return section.label.toLowerCase().includes(query);
  });

  if (!settings) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-text-tertiary">{t("settings.loading")}</div></div>;
  }

  return (
    <div className="settings-root">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-status">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            {t("settings.activeModel")}
          </div>
          <div className="space-y-1.5">
            <div className="rounded-lg border border-border-subtle bg-bg-primary px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t("settings.provider")}</div>
              <div className="truncate text-xs font-semibold text-text-primary">{activeProvider?.name || "—"}</div>
            </div>
            <div className="rounded-lg border border-border-subtle bg-bg-primary px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{t("chat.model")}</div>
              <div className="truncate text-xs font-semibold text-text-primary">{settings.activeModel || "—"}</div>
            </div>
          </div>
        </div>

        <nav className="settings-sidebar-nav">
          {categoryNav.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`settings-nav-item ${activeCategory === cat.id ? "is-active" : ""}`}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={cat.icon} />
              </svg>
              <span className="min-w-0 flex-1 truncate">{cat.label}</span>
              <span className="settings-nav-count">{categorySections[cat.id].length}</span>
            </button>
          ))}
          <div className="settings-nav-divider" />
          <button
            onClick={() => {
              setActiveCategory("tools");
              window.setTimeout(() => scrollToSettingsSection("settings-danger-zone"), 0);
            }}
            className="settings-nav-item"
            style={{ color: "var(--color-danger)" }}
          >
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{t("settings.dangerZone")}</span>
          </button>
        </nav>

        <div className="settings-sidebar-jump">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
            {t("settings.quickJump")}
          </div>
          <input
            type="text"
            value={quickJumpFilter}
            onChange={(e) => setQuickJumpFilter(e.target.value)}
            placeholder={t("settings.searchSections")}
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
          />
          <div className="mt-2 max-h-[220px] space-y-1 overflow-y-auto pr-1">
            {visibleQuickSections.length > 0 ? (
              visibleQuickSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => scrollToSettingsSection(section.id)}
                  className="settings-quick-jump-item"
                >
                  <span className="truncate">{section.label}</span>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-tertiary">
                {t("settings.noMatchingSections")}
              </div>
            )}
          </div>
        </div>

        <div className="settings-sidebar-footer">
          <StatusMessage text={providerResult} variant={resultVariant} />
        </div>
      </aside>

      <div className="settings-content-area">
        <div className="settings-content-inner">
          <div className="settings-workbench-header">
            <div>
              <div className="settings-workbench-kicker">{t("settings.quickJump")}</div>
              <h1 className="settings-workbench-title">{activeCategoryConfig.label}</h1>
              <p className="settings-workbench-desc">
                {categorySections[activeCategory].map((section) => section.label).join(" • ")}
              </p>
            </div>
            <div className="settings-workbench-meta">
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
                <div className="settings-section-title">{t("settings.quickPresets")}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PROVIDER_PRESETS.map((preset) => (
                    <button key={preset.key} onClick={() => applyPresetToForm(preset)}
                      className={`rounded-lg border p-2.5 text-left transition-colors ${selectedPresetKey === preset.key ? "border-accent-border bg-accent-subtle" : "border-border hover:bg-bg-hover"}`}>
                      <div className="text-xs font-semibold text-text-primary">{preset.label}</div>
                      <div className="mt-0.5 text-[10px] text-text-tertiary">{preset.description}</div>
                    </button>
                  ))}
                </div>
                <button onClick={quickAddPreset} className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover">
                  {t("settings.quickAdd")}
                </button>
              </div>

              <div id="settings-manual-provider" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.manualConfig")}</div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><FieldLabel>{t("settings.providerId")}</FieldLabel><InputField value={providerId} onChange={setProviderId} placeholder={t("settings.providerIdPlaceholder")} /></div>
                    <div><FieldLabel>{t("settings.providerName")}</FieldLabel><InputField value={providerName} onChange={setProviderName} placeholder={t("settings.providerNamePlaceholder")} /></div>
                  </div>
                  <div><FieldLabel>{t("settings.baseUrl")}</FieldLabel><InputField value={providerBaseUrl} onChange={setProviderBaseUrl} placeholder={t("settings.baseUrlPlaceholder")} /></div>
                  <div>
                    <FieldLabel>{t("settings.providerType")}</FieldLabel>
                    <SelectField value={providerType} onChange={(v) => setProviderType(v as "openai" | "koboldcpp" | "custom")}>
                      <option value="openai">{t("settings.providerTypeOpenAi")}</option>
                      <option value="koboldcpp">{t("settings.providerTypeKobold")}</option>
                      <option value="custom">{t("settings.providerTypeCustom")}</option>
                    </SelectField>
                  </div>
                  {providerType === "custom" && (
                    <div>
                      <FieldLabel>{t("settings.adapterId")}</FieldLabel>
                      <InputField value={providerAdapterId} onChange={setProviderAdapterId} placeholder={t("settings.adapterIdPlaceholder")} />
                    </div>
                  )}
                  <div><FieldLabel>{t("settings.apiKey")}</FieldLabel><InputField value={providerApiKey} onChange={setProviderApiKey} placeholder={selectedPreset.apiKeyHint} /></div>
                  <div><FieldLabel>{t("settings.proxyUrl")}</FieldLabel><InputField value={providerProxyUrl} onChange={setProviderProxyUrl} placeholder={t("settings.proxyUrlPlaceholder")} /></div>
                  <label className="settings-toggle-row cursor-pointer">
                    <span className="text-xs font-medium text-text-secondary">{t("settings.localOnly")}</span>
                    <ToggleSwitch checked={providerLocalOnly} onChange={(e) => setProviderLocalOnly(e.target.checked)} />
                  </label>
                  <div className="flex gap-2">
                    <button onClick={saveProvider} className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover">{t("settings.saveProvider")}</button>
                    <button onClick={testProvider} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover">{t("settings.test")}</button>
                    <button onClick={refreshProviders} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover">{t("settings.refresh")}</button>
                  </div>
                </div>
              </div>

              <div id="settings-runtime-mode" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.runtimeMode")}</div>
                <div className="space-y-2">
                  <div className="settings-toggle-row">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("settings.fullLocalMode")}</div>
                      <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.fullLocalDesc")}</div>
                    </div>
                    <ToggleSwitch checked={settings.fullLocalMode === true} onChange={(e) => patch({ fullLocalMode: e.target.checked })} />
                  </div>
                </div>
              </div>

              <div id="settings-active-model" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.activeModel")}</div>
                <div className="space-y-3">
                  <div>
                    <FieldLabel>{t("settings.provider")}</FieldLabel>
                    <SelectField value={selectedProviderId} onChange={setSelectedProviderId}>
                      <option value="">{t("settings.selectProvider")}</option>
                      {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </SelectField>
                  </div>
                  <div>
                    <FieldLabel>{t("chat.model")}</FieldLabel>
                    <SelectField value={selectedModelId} onChange={setSelectedModelId}>
                      <option value="">{t("settings.selectModel")}</option>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                    </SelectField>
                  </div>
                  <button onClick={applyActiveModel} className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover">{t("settings.useModel")}</button>
                </div>
              </div>

              <div id="settings-translation-model" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.translateModel")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.translateModelDesc")}</p>
                <div className="space-y-2">
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
                        <button onClick={() => void loadTranslateModels(settings.translateProviderId)} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover">{t("settings.loadModels")}</button>
                      </div>
                      <SelectField value={settings.translateModel || ""} onChange={(v) => patch({ translateModel: v || null })}>
                        <option value="">({t("settings.activeModel")})</option>
                        {translateModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                      </SelectField>
                    </div>
                  )}
                </div>
              </div>

              <div id="settings-compress-model" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.compressModel")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.compressModelDesc")}</p>
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
                        {compressModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                      </SelectField>
                    </div>
                  )}
                </div>
              </div>

              <div id="settings-tts" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.tts")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.ttsDesc")}</p>
                <div className="space-y-3">
                  <div><FieldLabel>{t("settings.ttsEndpoint")}</FieldLabel><InputField value={settings.ttsBaseUrl || ""} onChange={(v) => patch({ ttsBaseUrl: v })} placeholder="https://api.openai.com/v1" /></div>
                  <div><FieldLabel>{t("settings.apiKey")}</FieldLabel><InputField type="password" value={settings.ttsApiKey || ""} onChange={(v) => patch({ ttsApiKey: v })} placeholder={t("settings.apiKey")} /></div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <FieldLabel>{t("settings.ttsModel")}</FieldLabel>
                      <button onClick={() => void loadTtsModels()} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover">{t("settings.loadModels")}</button>
                    </div>
                    <SelectField value={settings.ttsModel || ""} onChange={(v) => patch({ ttsModel: v })}>
                      <option value="">{t("settings.selectModel")}</option>
                      {ttsModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                    </SelectField>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <FieldLabel>{t("settings.ttsVoice")}</FieldLabel>
                      <button onClick={() => void loadTtsVoices()} className="rounded-md border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-bg-hover">{t("settings.loadVoices")}</button>
                    </div>
                    <input list="tts-voice-options" value={settings.ttsVoice || ""} onChange={(e) => patch({ ttsVoice: e.target.value })} placeholder="alloy"
                      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary" />
                    <datalist id="tts-voice-options">
                      <option value="alloy" /><option value="echo" /><option value="fable" /><option value="onyx" /><option value="nova" /><option value="shimmer" />
                      {ttsVoices.map((v) => <option key={v.id} value={v.id} />)}
                    </datalist>
                  </div>
                </div>
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
                    <SelectField value={settings.theme} onChange={(v) => patch({ theme: v as AppSettings["theme"] })}>
                      <option value="dark">{t("settings.dark")}</option>
                      <option value="light">{t("settings.light")}</option>
                      <option value="custom">{t("settings.themePlugin")}</option>
                    </SelectField>
                  </div>
                  {settings.theme === "custom" && (
                    <div>
                      <FieldLabel>{t("settings.pluginTheme")}</FieldLabel>
                      {pluginThemes.length === 0 ? (
                        <div className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-tertiary">
                          {t("settings.noPluginThemes")}
                        </div>
                      ) : (
                        <SelectField value={settings.pluginThemeId || ""} onChange={(v) => patch({ pluginThemeId: v || null })}>
                          <option value="">{t("settings.selectPluginTheme")}</option>
                          {pluginThemes.map((theme) => (
                            <option key={theme.id} value={theme.id}>{theme.label}</option>
                          ))}
                        </SelectField>
                      )}
                    </div>
                  )}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <FieldLabel>{t("settings.textSize")}</FieldLabel>
                      <span className="text-xs text-text-tertiary">{Math.round(settings.fontScale * 100)}%</span>
                    </div>
                    <input type="range" min={0.8} max={1.4} step={0.05} value={settings.fontScale} onChange={(e) => patch({ fontScale: Number(e.target.value) })} className="w-full" />
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
                  <div><FieldLabel>{t("settings.responseLanguage")}</FieldLabel><InputField value={settings.responseLanguage} onChange={(v) => patch({ responseLanguage: v })} /></div>
                  <div><FieldLabel>{t("settings.translateLanguage")}</FieldLabel><InputField value={settings.translateLanguage || settings.responseLanguage || "English"} onChange={(v) => patch({ translateLanguage: v })} /></div>
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
                  <div><FieldLabel>{t("inspector.maxTokens")}</FieldLabel><input type="number" value={settings.samplerConfig.maxTokens} onChange={(e) => patchSampler({ maxTokens: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.stopSequences")}</FieldLabel><InputField value={(settings.samplerConfig.stop || []).join(", ")} onChange={(v) => patchSampler({ stop: v.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={t("settings.stopSequencesPlaceholder")} /></div>

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
                    <div className="mt-3"><FieldLabel>{t("settings.koboldMemoryLabel")}</FieldLabel><textarea value={settings.samplerConfig.koboldMemory || ""} onChange={(e) => patchSampler({ koboldMemory: e.target.value })} className="h-20 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary" placeholder={t("settings.koboldMemoryPlaceholder")} /></div>
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
                  <div><FieldLabel>{t("settings.contextSize")}</FieldLabel><input type="number" value={settings.contextWindowSize} onChange={(e) => patch({ contextWindowSize: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.contextTailWithSummary")}</FieldLabel><input type="number" min={5} max={95} value={settings.contextTailBudgetWithSummaryPercent ?? 35} onChange={(e) => { const v = Number(e.target.value); patch({ contextTailBudgetWithSummaryPercent: Number.isFinite(v) ? Math.max(5, Math.min(95, Math.floor(v))) : 35 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.contextTailWithoutSummary")}</FieldLabel><input type="number" min={5} max={95} value={settings.contextTailBudgetWithoutSummaryPercent ?? 75} onChange={(e) => { const v = Number(e.target.value); patch({ contextTailBudgetWithoutSummaryPercent: Number.isFinite(v) ? Math.max(5, Math.min(95, Math.floor(v))) : 75 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
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
                        {ragModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
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
                        {ragRerankModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                      </SelectField>
                    </div>
                  )}
                  <div><FieldLabel>{t("settings.ragRerankTopN")}</FieldLabel><input type="number" min={5} max={200} value={settings.ragRerankTopN ?? 40} onChange={(e) => { const v = Number(e.target.value); patch({ ragRerankTopN: Number.isFinite(v) ? Math.max(5, Math.min(200, Math.floor(v))) : 40 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                </div>
              </div>

              <div id="settings-rag-retrieval" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.ragRetrieval")}</div>
                <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.ragRetrievalDesc")}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><FieldLabel>{t("settings.ragTopK")}</FieldLabel><input type="number" min={1} max={12} value={settings.ragTopK ?? 6} onChange={(e) => { const v = Number(e.target.value); patch({ ragTopK: Number.isFinite(v) ? Math.max(1, Math.min(12, Math.floor(v))) : 6 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.ragCandidateCount")}</FieldLabel><input type="number" min={10} max={300} value={settings.ragCandidateCount ?? 80} onChange={(e) => { const v = Number(e.target.value); patch({ ragCandidateCount: Number.isFinite(v) ? Math.max(10, Math.min(300, Math.floor(v))) : 80 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.ragSimilarityThreshold")}</FieldLabel><input type="number" min={-1} max={1} step={0.01} value={settings.ragSimilarityThreshold ?? 0.15} onChange={(e) => { const v = Number(e.target.value); patch({ ragSimilarityThreshold: Number.isFinite(v) ? Number(Math.max(-1, Math.min(1, v)).toFixed(2)) : 0.15 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.ragMaxContextTokens")}</FieldLabel><input type="number" min={200} max={4000} value={settings.ragMaxContextTokens ?? 900} onChange={(e) => { const v = Number(e.target.value); patch({ ragMaxContextTokens: Number.isFinite(v) ? Math.max(200, Math.min(4000, Math.floor(v))) : 900 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.ragChunkSize")}</FieldLabel><input type="number" min={300} max={8000} value={settings.ragChunkSize ?? 1200} onChange={(e) => { const v = Number(e.target.value); patch({ ragChunkSize: Number.isFinite(v) ? Math.max(300, Math.min(8000, Math.floor(v))) : 1200 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
                  <div><FieldLabel>{t("settings.ragChunkOverlap")}</FieldLabel><input type="number" min={0} max={3000} value={settings.ragChunkOverlap ?? 220} onChange={(e) => { const v = Number(e.target.value); patch({ ragChunkOverlap: Number.isFinite(v) ? Math.max(0, Math.min(3000, Math.floor(v))) : 220 }); }} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" /></div>
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
                      <textarea value={settings.promptTemplates?.[key] ?? ""} onChange={(e) => { const tpl: PromptTemplates = { ...settings.promptTemplates, [key]: e.target.value }; patch({ promptTemplates: tpl }); }}
                        className="h-24 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary" />
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
                        <textarea value={block.content || ""} onChange={(e) => updatePromptBlockContent(block.id, e.target.value)}
                          className="mt-2 h-20 w-full rounded-md border border-border bg-bg-primary px-2 py-1.5 text-xs text-text-primary" />
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => void savePromptStack(DEFAULT_PROMPT_STACK)} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover">{t("settings.promptStackReset")}</button>
              </div>

              <div id="settings-default-system-prompts" className="settings-section scroll-mt-24">
                <div className="settings-section-title">{t("settings.defaultSysPrompt")}</div>
                <p className="mb-2 text-[10px] text-text-tertiary">{t("settings.baseSysPromptDesc")}</p>
                <textarea value={settings.defaultSystemPrompt} onChange={(e) => patch({ defaultSystemPrompt: e.target.value })}
                  className="h-40 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary"
                  placeholder={t("settings.defaultSystemPromptPlaceholder")} />
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
                    <input type="number" min={1} max={12} value={settings.maxToolCallsPerTurn ?? 4} disabled={toolCallingLocked}
                      onChange={(e) => { const v = Number(e.target.value); patch({ maxToolCallsPerTurn: Number.isFinite(v) ? Math.max(1, Math.min(12, Math.floor(v))) : 4 }); }}
                      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" />
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
                            {plugin.requestedPermissions.some((permission) => HIGH_RISK_PLUGIN_PERMISSIONS.has(permission)) && (
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

        </div>
      </div>
    </div>
  );
}
