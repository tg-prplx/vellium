import { useMemo, useState } from "react";
import { api } from "../../shared/api";
import { useI18n } from "../../shared/i18n";
import { PROVIDER_PRESETS } from "../../shared/providerPresets";
import type { AppSettings } from "../../shared/types/contracts";
import type { LocalModelInstallResult } from "../../shared/types/localModels";
import { LocalModelsSetup } from "../../components/LocalModelsSetup";
import { LlamaCppQuickSetup } from "../../components/LlamaCppQuickSetup";

type WelcomeScreenProps = {
  initialSettings: AppSettings;
  onComplete: (patch: Partial<AppSettings>) => Promise<void>;
  onPreviewLocale: (locale: "en" | "ru" | "zh" | "ja") => void;
};

type ConnectionMode = "detect" | "download" | "cloud" | "later";

const RESPONSE_LANGUAGE_BY_LOCALE = { en: "English", ru: "Russian", zh: "Chinese", ja: "Japanese" } as const;

function ChoiceIcon({ kind }: { kind: ConnectionMode }) {
  const paths: Record<ConnectionMode, string> = {
    detect: "M4 7h16M6 12h12M8 17h8M9 4v3m6-3v3m-6 10v3m6-3v3",
    download: "M12 3v12m0 0 4-4m-4 4-4-4M5 19h14",
    cloud: "M7 18h10a4 4 0 00.6-7.95A6 6 0 006.2 8.2 4.5 4.5 0 007 18z",
    later: "M12 8v4l3 2m6-2a9 9 0 11-9-9 9 9 0 019 9z"
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={paths[kind]} /></svg>;
}

export function WelcomeScreen({ initialSettings, onComplete, onPreviewLocale }: WelcomeScreenProps) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [interfaceLanguage, setInterfaceLanguage] = useState<"en" | "ru" | "zh" | "ja">(initialSettings.interfaceLanguage || "en");
  const [responseLanguage, setResponseLanguage] = useState(initialSettings.responseLanguage || "English");
  const [theme, setTheme] = useState<AppSettings["theme"]>(initialSettings.theme || "dark");
  const [censorshipMode, setCensorshipMode] = useState<AppSettings["censorshipMode"]>(initialSettings.censorshipMode || "Unfiltered");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(window.electronAPI ? "detect" : "cloud");
  const [selectedPresetKey, setSelectedPresetKey] = useState("openai");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [localModelsConfigured, setLocalModelsConfigured] = useState(Boolean(initialSettings.activeProviderId));
  const selectedPreset = useMemo(() => PROVIDER_PRESETS.find((preset) => preset.key === selectedPresetKey) ?? null, [selectedPresetKey]);
  const cloudReady = connectionMode !== "cloud" || Boolean(selectedPreset && (selectedPreset.localOnly || providerApiKey.trim()));
  const modelStepReady = connectionMode === "later" || (connectionMode === "cloud" ? cloudReady : localModelsConfigured);
  const steps = [t("welcome.stepBasics"), t("welcome.stepModel"), t("welcome.stepReady")];

  function changeLocale(next: "en" | "ru" | "zh" | "ja") {
    const previousDefault = RESPONSE_LANGUAGE_BY_LOCALE[interfaceLanguage];
    setInterfaceLanguage(next);
    if (!responseLanguage.trim() || responseLanguage === previousDefault) setResponseLanguage(RESPONSE_LANGUAGE_BY_LOCALE[next]);
    onPreviewLocale(next);
  }

  async function handleFinish() {
    if (isSaving || !cloudReady) return;
    setIsSaving(true);
    setSetupError("");
    try {
      const providerPatch: Partial<AppSettings> = {};
      if (connectionMode === "cloud" && selectedPreset && !localModelsConfigured) {
        await api.providerUpsert({
          id: selectedPreset.defaultId,
          name: selectedPreset.defaultName,
          baseUrl: selectedPreset.baseUrl,
          apiKey: providerApiKey.trim() || (selectedPreset.localOnly ? "local-key" : ""),
          proxyUrl: null,
          fullLocalOnly: selectedPreset.localOnly,
          providerType: selectedPreset.providerType
        });
        providerPatch.activeProviderId = selectedPreset.defaultId;
        providerPatch.activeModel = null;
      }
      await onComplete({
        interfaceLanguage,
        responseLanguage,
        theme,
        censorshipMode,
        fullLocalMode: connectionMode === "detect" || connectionMode === "download" || initialSettings.fullLocalMode,
        alternateSimpleMode: true,
        ...providerPatch,
        onboardingCompleted: true
      });
      window.dispatchEvent(new CustomEvent("locale-change", { detail: interfaceLanguage }));
    } catch (error) {
      setSetupError(`${t("welcome.presetSetupFailed")}: ${String(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  function handleLocalModelsInstalled(result: LocalModelInstallResult) {
    if (!result.managedBackend) return;
    setLocalModelsConfigured(true);
    setConnectionMode("download");
  }

  const modes: Array<{ id: ConnectionMode; title: string; description: string; badge?: string }> = [
    { id: "detect", title: t("welcome.modelDetectTitle"), description: t("welcome.modelDetectDesc"), badge: t("welcome.recommended") },
    { id: "download", title: t("welcome.modelDownloadTitle"), description: t("welcome.modelDownloadDesc") },
    { id: "cloud", title: t("welcome.modelCloudTitle"), description: t("welcome.modelCloudDesc") },
    { id: "later", title: t("welcome.modelLaterTitle"), description: t("welcome.modelLaterDesc") }
  ];

  return (
    <div className="welcome-first-run">
      <aside className="welcome-first-run-rail">
        <div className="welcome-brand-mark" aria-hidden="true"><span /><span /><span /></div>
        <div><div className="welcome-kicker">Vellium</div><h1>{t("welcome.title")}</h1><p>{t("welcome.beginnerSubtitle")}</p></div>
        <ol className="welcome-step-list">
          {steps.map((label, index) => <li key={label} className={index === step ? "is-active" : index < step ? "is-done" : ""}><span>{index < step ? "✓" : index + 1}</span><b>{label}</b></li>)}
        </ol>
        <p className="welcome-privacy-note">{t("welcome.privacyNote")}</p>
      </aside>

      <main className="welcome-first-run-main">
        <div className="welcome-first-run-content" key={step}>
          {step === 0 ? (
            <>
              <header><span>{t("welcome.stepBasics")}</span><h2>{t("welcome.basicsTitle")}</h2><p>{t("welcome.basicsDesc")}</p></header>
              <div className="welcome-basics-grid">
                <label><span>{t("welcome.interfaceLanguage")}</span><select value={interfaceLanguage} onChange={(event) => changeLocale(event.target.value as typeof interfaceLanguage)}><option value="en">English</option><option value="ru">Русский</option><option value="zh">中文</option><option value="ja">日本語</option></select></label>
                <fieldset><legend>{t("welcome.theme")}</legend><div className="welcome-theme-picker">{(["dark", "light", "cream-rose"] as const).map((value) => <button key={value} type="button" className={theme === value ? "is-active" : ""} onClick={() => setTheme(value)}><i className={`theme-${value}`} />{t(value === "dark" ? "settings.dark" : value === "light" ? "settings.light" : "settings.creamRose")}</button>)}</div></fieldset>
              </div>
              <div className="welcome-simple-note"><span>✓</span><div><b>{t("welcome.simpleReadyTitle")}</b><p>{t("welcome.simpleReadyDesc")}</p></div></div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <header><span>{t("welcome.stepModel")}</span><h2>{t("welcome.modelTitle")}</h2><p>{t("welcome.modelDesc")}</p></header>
              <div className="welcome-model-choices">
                {modes.map((mode) => <button key={mode.id} type="button" className={connectionMode === mode.id ? "is-active" : ""} onClick={() => setConnectionMode(mode.id)}><i><ChoiceIcon kind={mode.id} /></i><span><b>{mode.title}</b><small>{mode.description}</small></span>{mode.badge ? <em>{mode.badge}</em> : null}</button>)}
              </div>
              <div className="welcome-connection-detail">
                {connectionMode === "detect" ? <LlamaCppQuickSetup compact onConfigured={() => setLocalModelsConfigured(true)} /> : null}
                {connectionMode === "download" ? <LocalModelsSetup locale={interfaceLanguage} compact componentIds={["llm"]} onInstalled={handleLocalModelsInstalled} /> : null}
                {connectionMode === "cloud" ? (
                  <div className="welcome-cloud-setup">
                    <label><span>{t("welcome.selectPreset")}</span><select value={selectedPresetKey} onChange={(event) => setSelectedPresetKey(event.target.value)}>{PROVIDER_PRESETS.filter((preset) => !preset.localOnly).map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}</select></label>
                    <label><span>{t("welcome.presetApiKey")}</span><input type="password" value={providerApiKey} onChange={(event) => setProviderApiKey(event.target.value)} placeholder={selectedPreset?.apiKeyHint || ""} /></label>
                    {!cloudReady ? <p>{t("welcome.apiKeyNeeded")}</p> : null}
                  </div>
                ) : null}
                {connectionMode === "later" ? <div className="welcome-later-note">{t("welcome.laterNote")}</div> : null}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <header><span>{t("welcome.stepReady")}</span><h2>{t("welcome.readyTitle")}</h2><p>{t("welcome.readyDesc")}</p></header>
              <div className="welcome-ready-summary"><div><span>{t("welcome.interfaceLanguage")}</span><b>{interfaceLanguage.toUpperCase()}</b></div><div><span>{t("welcome.modelSource")}</span><b>{modes.find((mode) => mode.id === connectionMode)?.title}</b></div><div><span>{t("welcome.dataMode")}</span><b>{connectionMode === "later" ? t("welcome.dataModeNone") : connectionMode === "cloud" ? t("welcome.dataModeCloud") : t("welcome.dataModeLocal")}</b></div></div>
              <details className="welcome-advanced-preferences"><summary>{t("welcome.advancedPreferences")}</summary><div><label><span>{t("welcome.responseLanguage")}</span><input value={responseLanguage} onChange={(event) => setResponseLanguage(event.target.value)} /></label><label><span>{t("welcome.censorship")}</span><select value={censorshipMode} onChange={(event) => setCensorshipMode(event.target.value as AppSettings["censorshipMode"])}><option value="Unfiltered">{t("settings.unfiltered")}</option><option value="Filtered">{t("settings.filtered")}</option></select></label></div></details>
              <div className="welcome-ready-callout"><span>✓</span><div><b>{t("welcome.readyCalloutTitle")}</b><p>{t("welcome.readyCalloutDesc")}</p></div></div>
            </>
          ) : null}

          {setupError ? <div className="welcome-error" role="alert">{setupError}</div> : null}
        </div>
        <footer className="welcome-first-run-actions">
          <button type="button" className="secondary" disabled={step === 0 || isSaving} onClick={() => setStep((current) => Math.max(0, current - 1))}>{t("tour.back")}</button>
          {step < 2 ? <button type="button" className="primary" disabled={step === 1 && !modelStepReady} onClick={() => setStep((current) => Math.min(2, current + 1))}>{t("tour.next")}</button> : <button type="button" className="primary" disabled={isSaving || !modelStepReady} onClick={() => void handleFinish()}>{isSaving ? t("welcome.saving") : t("welcome.finish")}</button>}
        </footer>
      </main>
    </div>
  );
}
