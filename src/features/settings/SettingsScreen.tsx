import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import type { AppSettings, PromptTemplates, ProviderModel, ProviderProfile, SamplerConfig } from "../../shared/types/contracts";

type ProviderPreset = {
  key: string; label: string; description: string; baseUrl: string;
  defaultId: string; defaultName: string; apiKeyHint: string; localOnly: boolean;
};

const PRESETS: ProviderPreset[] = [
  { key: "openai", label: "OpenAI", description: "Official OpenAI API", baseUrl: "https://api.openai.com/v1", defaultId: "openai", defaultName: "OpenAI", apiKeyHint: "sk-...", localOnly: false },
  { key: "lm_studio", label: "LM Studio", description: "Local OpenAI-compatible server", baseUrl: "http://localhost:1234/v1", defaultId: "lm-studio", defaultName: "LM Studio (Local)", apiKeyHint: "any string", localOnly: true },
  { key: "ollama", label: "Ollama", description: "Ollama OpenAI-compatible endpoint", baseUrl: "http://localhost:11434/v1", defaultId: "ollama", defaultName: "Ollama (Local)", apiKeyHint: "ollama", localOnly: true },
  { key: "openrouter", label: "OpenRouter", description: "OpenRouter unified API", baseUrl: "https://openrouter.ai/api/v1", defaultId: "openrouter", defaultName: "OpenRouter", apiKeyHint: "sk-or-v1-...", localOnly: false },
  { key: "custom", label: "Custom", description: "Any OpenAI-compatible provider", baseUrl: "http://localhost:8080/v1", defaultId: "custom-provider", defaultName: "Custom Provider", apiKeyHint: "your key", localOnly: false }
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{children}</h2>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-text-secondary">{children}</label>;
}

function InputField({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary" />
  );
}

function SelectField({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
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

export function SettingsScreen() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [providerResult, setProviderResult] = useState("");
  const [resultVariant, setResultVariant] = useState<"info" | "success" | "error">("info");
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [compressModels, setCompressModels] = useState<ProviderModel[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");

  const [selectedPresetKey, setSelectedPresetKey] = useState("openai");
  const selectedPreset = useMemo(() => PRESETS.find((p) => p.key === selectedPresetKey) ?? PRESETS[0], [selectedPresetKey]);

  const [providerId, setProviderId] = useState(selectedPreset.defaultId);
  const [providerName, setProviderName] = useState(selectedPreset.defaultName);
  const [providerBaseUrl, setProviderBaseUrl] = useState(selectedPreset.baseUrl);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerProxyUrl, setProviderProxyUrl] = useState("");
  const [providerLocalOnly, setProviderLocalOnly] = useState(selectedPreset.localOnly);

  const [activeTab, setActiveTab] = useState<"basic" | "advanced" | "prompts">("basic");

  useEffect(() => {
    void (async () => {
      const s = await api.settingsGet();
      setSettings(s);
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

  function applyPresetToForm(preset: ProviderPreset) {
    setSelectedPresetKey(preset.key);
    setProviderId(preset.defaultId);
    setProviderName(preset.defaultName);
    setProviderBaseUrl(preset.baseUrl);
    setProviderProxyUrl("");
    setProviderLocalOnly(preset.localOnly);
    showResult(`Preset applied: ${preset.label}`, "info");
  }

  async function patch(next: Partial<AppSettings>) {
    const updated = await api.settingsUpdate(next);
    setSettings(updated);
  }

  async function reset() {
    const defaults = await api.settingsReset();
    setSettings(defaults);
    showResult("Settings reset to defaults", "success");
  }

  async function refreshProviders() {
    const p = await api.providerList();
    setProviders(p);
  }

  async function saveProvider() {
    if (!providerId.trim() || !providerName.trim() || !providerBaseUrl.trim()) {
      showResult("Fill Provider ID, Name, and Base URL", "error");
      return;
    }
    const saved = await api.providerUpsert({
      id: providerId.trim(), name: providerName.trim(), baseUrl: providerBaseUrl.trim(),
      apiKey: providerApiKey.trim() || "local-key", proxyUrl: providerProxyUrl.trim() || null, fullLocalOnly: providerLocalOnly
    });
    showResult(`Saved: ${saved.name}`, "success");
    await refreshProviders();
    setSelectedProviderId(saved.id);
  }

  async function quickAddPreset() {
    applyPresetToForm(selectedPreset);
    await api.providerUpsert({
      id: selectedPreset.defaultId, name: selectedPreset.defaultName, baseUrl: selectedPreset.baseUrl,
      apiKey: providerApiKey.trim() || (selectedPreset.localOnly ? "local-key" : ""), proxyUrl: null, fullLocalOnly: selectedPreset.localOnly
    });
    await refreshProviders();
    setSelectedProviderId(selectedPreset.defaultId);
    showResult(`Preset provider added: ${selectedPreset.label}`, "success");
  }

  async function testProvider() {
    const targetId = selectedProviderId || providerId;
    if (!targetId) { showResult("Select or save a provider first", "error"); return; }
    const ok = await api.providerTestConnection(targetId);
    showResult(ok ? "Connection check: OK" : "Provider blocked or invalid URL", ok ? "success" : "error");
  }

  async function loadModels() {
    if (!selectedProviderId) { showResult("Select a provider first", "error"); return; }
    try {
      const list = await api.providerFetchModels(selectedProviderId);
      setModels(list);
      if (list[0]) setSelectedModelId((prev) => prev || list[0].id);
      showResult(list.length ? `Loaded ${list.length} models` : "No models returned", list.length ? "success" : "info");
    } catch (error) { showResult(`Load models failed: ${String(error)}`, "error"); }
  }

  async function loadCompressModels() {
    const pid = settings?.compressProviderId;
    if (!pid) return;
    try {
      const list = await api.providerFetchModels(pid);
      setCompressModels(list);
    } catch { /* ignore */ }
  }

  async function applyActiveModel() {
    if (!selectedProviderId || !selectedModelId) { showResult("Select provider and model first", "error"); return; }
    const updated = await api.providerSetActive(selectedProviderId, selectedModelId);
    setSettings(updated);
    showResult(`Active: ${selectedProviderId} / ${selectedModelId}`, "success");
  }

  async function patchSampler(samplerPatch: Partial<SamplerConfig>) {
    if (!settings) return;
    const newSampler = { ...settings.samplerConfig, ...samplerPatch };
    await patch({ samplerConfig: newSampler });
  }

  function changeInterfaceLanguage(lang: "en" | "ru") {
    patch({ interfaceLanguage: lang });
    window.dispatchEvent(new CustomEvent("locale-change", { detail: lang }));
  }

  // Auto-load models when provider selection changes in settings
  useEffect(() => {
    if (!selectedProviderId) { setModels([]); return; }
    api.providerFetchModels(selectedProviderId)
      .then((list) => {
        setModels(list);
        if (list.length > 0 && !list.find((m) => m.id === selectedModelId)) {
          setSelectedModelId(list[0].id);
        }
      })
      .catch(() => setModels([]));
  }, [selectedProviderId]);

  // Auto-load compress models when compress provider changes
  useEffect(() => {
    if (!settings?.compressProviderId) { setCompressModels([]); return; }
    api.providerFetchModels(settings.compressProviderId)
      .then((list) => setCompressModels(list))
      .catch(() => setCompressModels([]));
  }, [settings?.compressProviderId]);

  if (!settings) {
    return <div className="flex h-full items-center justify-center"><div className="text-sm text-text-tertiary">Loading settings...</div></div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-bg-secondary p-1">
        {(["basic", "advanced", "prompts"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`settings-tab flex-1 rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
              activeTab === tab ? "is-active bg-accent text-text-inverse" : "text-text-secondary hover:bg-bg-hover"
            }`}>
            {t(`settings.${tab}` as keyof typeof import("../../shared/i18n").translations.en)}
          </button>
        ))}
      </div>

      <div key={activeTab} className="settings-content">
      {activeTab === "prompts" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-bg-secondary p-5">
            <SectionTitle>{t("settings.promptTemplates")}</SectionTitle>
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
                  <div className="mb-1.5 flex items-center justify-between"><FieldLabel>{label}</FieldLabel></div>
                  <p className="mb-1.5 text-[10px] text-text-tertiary">{desc}</p>
                  <textarea value={settings.promptTemplates?.[key] ?? ""}
                    onChange={(e) => {
                      const newTemplates: PromptTemplates = { ...settings.promptTemplates, [key]: e.target.value };
                      patch({ promptTemplates: newTemplates });
                    }}
                    className="h-24 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-bg-secondary p-5">
            <SectionTitle>{t("settings.defaultSysPrompt")}</SectionTitle>
            <p className="mb-2 text-[10px] text-text-tertiary">{t("settings.baseSysPromptDesc")}</p>
            <textarea value={settings.defaultSystemPrompt} onChange={(e) => patch({ defaultSystemPrompt: e.target.value })}
              className="h-32 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary" />
          </div>
        </div>
      ) : activeTab === "basic" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border bg-bg-secondary p-5">
            <SectionTitle>{t("settings.general")}</SectionTitle>
            <div className="space-y-4">
              <div>
                <FieldLabel>{t("settings.theme")}</FieldLabel>
                <SelectField value={settings.theme} onChange={(v) => patch({ theme: v as AppSettings["theme"] })}>
                  <option value="dark">{t("settings.dark")}</option>
                  <option value="light">{t("settings.light")}</option>
                  <option value="custom">{t("settings.custom")}</option>
                </SelectField>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <FieldLabel>{t("settings.textSize")}</FieldLabel>
                  <span className="text-xs text-text-tertiary">{Math.round(settings.fontScale * 100)}%</span>
                </div>
                <input type="range" min={0.8} max={1.4} step={0.05} value={settings.fontScale}
                  onChange={(e) => patch({ fontScale: Number(e.target.value) })} className="w-full" />
              </div>

              <div>
                <FieldLabel>{t("settings.interfaceLanguage")}</FieldLabel>
                <SelectField value={settings.interfaceLanguage || "en"} onChange={(v) => changeInterfaceLanguage(v as "en" | "ru")}>
                  <option value="en">English</option>
                  <option value="ru">Русский</option>
                </SelectField>
              </div>

              <div>
                <FieldLabel>{t("settings.responseLanguage")}</FieldLabel>
                <InputField value={settings.responseLanguage} onChange={(v) => patch({ responseLanguage: v })} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-text-primary">{t("settings.fullLocalMode")}</div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.fullLocalDesc")}</div>
                </div>
                <input type="checkbox" checked={settings.fullLocalMode} onChange={(e) => patch({ fullLocalMode: e.target.checked })} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-text-primary">{t("settings.censorship")}</div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.censorshipDesc")}</div>
                </div>
                <SelectField value={settings.censorshipMode} onChange={(v) => patch({ censorshipMode: v as AppSettings["censorshipMode"] })}>
                  <option value="Unfiltered">{t("settings.unfiltered")}</option>
                  <option value="Filtered">{t("settings.filtered")}</option>
                </SelectField>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-text-primary">{t("settings.mergeRoles")}</div>
                  <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.mergeRolesDesc")}</div>
                </div>
                <input type="checkbox" checked={settings.mergeConsecutiveRoles ?? false}
                  onChange={(e) => patch({ mergeConsecutiveRoles: e.target.checked })} />
              </div>

              <button onClick={reset}
                className="w-full rounded-lg border border-danger-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger-subtle">
                {t("settings.resetDefaults")}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-bg-secondary p-5">
              <SectionTitle>{t("settings.quickPresets")}</SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PRESETS.map((preset) => (
                  <button key={preset.key} onClick={() => applyPresetToForm(preset)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      selectedPresetKey === preset.key ? "border-accent-border bg-accent-subtle" : "border-border hover:bg-bg-hover"
                    }`}>
                    <div className="text-xs font-semibold text-text-primary">{preset.label}</div>
                    <div className="mt-0.5 text-[10px] text-text-tertiary">{preset.description}</div>
                  </button>
                ))}
              </div>
              <button onClick={quickAddPreset}
                className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover">
                {t("settings.quickAdd")}
              </button>
            </div>

            <div className="rounded-xl border border-border bg-bg-secondary p-5">
              <SectionTitle>{t("settings.manualConfig")}</SectionTitle>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>{t("settings.providerId")}</FieldLabel>
                    <InputField value={providerId} onChange={setProviderId} placeholder="Provider ID" />
                  </div>
                  <div>
                    <FieldLabel>{t("settings.providerName")}</FieldLabel>
                    <InputField value={providerName} onChange={setProviderName} placeholder="Display Name" />
                  </div>
                </div>
                <div>
                  <FieldLabel>{t("settings.baseUrl")}</FieldLabel>
                  <InputField value={providerBaseUrl} onChange={setProviderBaseUrl} placeholder="https://api.example.com/v1" />
                </div>
                <div>
                  <FieldLabel>{t("settings.apiKey")}</FieldLabel>
                  <InputField value={providerApiKey} onChange={setProviderApiKey} placeholder={selectedPreset.apiKeyHint} />
                </div>
                <div>
                  <FieldLabel>{t("settings.proxyUrl")}</FieldLabel>
                  <InputField value={providerProxyUrl} onChange={setProviderProxyUrl} placeholder="https://proxy.example.com" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                  <span className="text-xs font-medium text-text-secondary">{t("settings.localOnly")}</span>
                  <input type="checkbox" checked={providerLocalOnly} onChange={(e) => setProviderLocalOnly(e.target.checked)} />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveProvider} className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover">{t("settings.saveProvider")}</button>
                  <button onClick={testProvider} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover">{t("settings.test")}</button>
                  <button onClick={refreshProviders} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover">{t("settings.refresh")}</button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-bg-secondary p-5">
              <SectionTitle>{t("settings.activeModel")}</SectionTitle>
              <div className="space-y-3">
                <div>
                  <FieldLabel>{t("settings.provider")}</FieldLabel>
                  <SelectField value={selectedProviderId} onChange={setSelectedProviderId}>
                    <option value="">{t("settings.selectProvider")}</option>
                    {providers.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </SelectField>
                </div>
                <div>
                  <FieldLabel>{t("chat.model")}</FieldLabel>
                  <SelectField value={selectedModelId} onChange={setSelectedModelId}>
                    <option value="">{t("settings.selectModel")}</option>
                    {models.map((model) => (<option key={model.id} value={model.id}>{model.id}</option>))}
                  </SelectField>
                </div>
                <button onClick={applyActiveModel}
                  className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-text-inverse hover:bg-accent-hover">
                  {t("settings.useModel")}
                </button>
                <StatusMessage text={providerResult} variant={resultVariant} />
              </div>
            </div>

            {/* Compress Model Settings */}
            <div className="rounded-xl border border-border bg-bg-secondary p-5">
              <SectionTitle>{t("settings.compressModel")}</SectionTitle>
              <p className="mb-3 text-[10px] text-text-tertiary">{t("settings.compressModelDesc")}</p>
              <div className="space-y-3">
                <div>
                  <FieldLabel>{t("settings.compressProvider")}</FieldLabel>
                  <SelectField value={settings.compressProviderId || ""} onChange={(v) => { patch({ compressProviderId: v || null }); }}>
                    <option value="">({t("settings.activeModel")})</option>
                    {providers.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </SelectField>
                </div>
                {settings.compressProviderId && (
                  <>
                    <div>
                      <FieldLabel>{t("chat.model")}</FieldLabel>
                      <SelectField value={settings.compressModel || ""} onChange={(v) => patch({ compressModel: v || null })}>
                        <option value="">({t("settings.activeModel")})</option>
                        {compressModels.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                      </SelectField>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border bg-bg-secondary p-5">
            <SectionTitle>{t("settings.samplerDefaults")}</SectionTitle>
            <div className="space-y-4">
              {[
                { key: "temperature" as const, label: t("inspector.temperature"), min: 0, max: 2 },
                { key: "topP" as const, label: t("inspector.topP"), min: 0, max: 1 },
                { key: "frequencyPenalty" as const, label: t("inspector.freqPenalty"), min: 0, max: 2 },
                { key: "presencePenalty" as const, label: t("inspector.presPenalty"), min: 0, max: 2 }
              ].map(({ key, label, min, max }) => (
                <div key={key}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <FieldLabel>{label}</FieldLabel>
                    <span className="text-xs text-text-tertiary">{settings.samplerConfig[key].toFixed(2)}</span>
                  </div>
                  <input type="range" min={min} max={max} step={0.05} value={settings.samplerConfig[key]}
                    onChange={(e) => patchSampler({ [key]: Number(e.target.value) })} className="w-full" />
                </div>
              ))}

              <div>
                <FieldLabel>{t("inspector.maxTokens")}</FieldLabel>
                <input type="number" value={settings.samplerConfig.maxTokens}
                  onChange={(e) => patchSampler({ maxTokens: Number(e.target.value) })}
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" />
              </div>

              <div>
                <FieldLabel>{t("settings.stopSequences")}</FieldLabel>
                <InputField value={(settings.samplerConfig.stop || []).join(", ")}
                  onChange={(v) => patchSampler({ stop: v.split(",").map((s) => s.trim()).filter(Boolean) })}
                  placeholder="e.g. <|end|>, ###" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-bg-secondary p-5">
              <SectionTitle>{t("settings.defaultSysPrompt")}</SectionTitle>
              <textarea value={settings.defaultSystemPrompt}
                onChange={(e) => patch({ defaultSystemPrompt: e.target.value })}
                className="h-40 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary"
                placeholder="Default system prompt for new chats..." />
              <p className="mt-2 text-[10px] text-text-tertiary">{t("settings.defaultSysPromptDesc")}</p>
            </div>

            <div className="rounded-xl border border-border bg-bg-secondary p-5">
              <SectionTitle>{t("settings.contextWindow")}</SectionTitle>
              <div className="space-y-3">
                <div>
                  <FieldLabel>{t("settings.contextSize")}</FieldLabel>
                  <input type="number" value={settings.contextWindowSize}
                    onChange={(e) => patch({ contextWindowSize: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary" />
                </div>
                <p className="text-[10px] text-text-tertiary">{t("settings.contextDesc")}</p>
              </div>
            </div>

            <button onClick={reset}
              className="w-full rounded-lg border border-danger-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger-subtle">
              {t("settings.resetAll")}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
