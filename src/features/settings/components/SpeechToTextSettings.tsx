import { useState } from "react";
import { LocalModelsSetup } from "../../../components/LocalModelsSetup";
import { api } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import type { AppSettings, ProviderModel } from "../../../shared/types/contracts";
import { InputField, SelectField } from "./FormControls";
import { SettingRow, SettingsGroup } from "./SettingRow";

interface SpeechToTextSettingsProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => Promise<void>;
  autosaveProps: { commitMode: "debounced"; debounceMs: number };
}

export function SpeechToTextSettings({ settings, onPatch, autosaveProps }: SpeechToTextSettingsProps) {
  const { t } = useI18n();
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function loadModels() {
    if (loading) return;
    setLoading(true);
    setStatus("");
    try {
      const result = await api.settingsFetchSttModels(settings.sttBaseUrl, settings.sttApiKey);
      setModels(result);
      setStatus(result.length
        ? `${t("settings.modelsLoaded")}: ${result.length}`
        : t("settings.noModelsReturned"));
    } catch (error) {
      setModels([]);
      setStatus(`${t("settings.loadModelsFailed")}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsGroup id="settings-stt" title={t("settings.stt")} description={t("settings.sttDesc")}>
      <div className="settings-group-block">
        <LocalModelsSetup locale={settings.interfaceLanguage || "en"} componentIds={["stt"]} />
      </div>
      <SettingRow label={t("settings.sttSource")}>
        <SelectField value={settings.sttSource || "system"} onChange={(value) => void onPatch({ sttSource: value === "whisper" ? "whisper" : "system" })}>
          <option value="system">{t("live.systemStt")}</option>
          <option value="whisper">{t("live.whisperStt")}</option>
        </SelectField>
      </SettingRow>
      <SettingRow label={t("settings.sttLanguage")} description={t("settings.sttLanguageHint")}>
        <InputField value={settings.sttLanguage || ""} onChange={(value) => void onPatch({ sttLanguage: value })} placeholder={t("settings.sttLanguageAuto")} {...autosaveProps} />
      </SettingRow>

      <h4 className="settings-subheading">{t("settings.externalEndpoint")}</h4>
      <p className="settings-subheading-desc">{t("localModels.otherSttHint")}</p>
      <SettingRow label={t("settings.sttEndpoint")}>
        <InputField value={settings.sttBaseUrl || ""} onChange={(value) => void onPatch({ sttBaseUrl: value })} placeholder="https://api.openai.com/v1" {...autosaveProps} />
      </SettingRow>
      <SettingRow label={t("settings.apiKey")}>
        <InputField type="password" value={settings.sttApiKey || ""} onChange={(value) => void onPatch({ sttApiKey: value })} placeholder={t("settings.apiKey")} {...autosaveProps} />
      </SettingRow>
      <SettingRow label={t("settings.sttModel")} description={status || undefined}
        aside={<button type="button" className="setting-inline-button" onClick={() => void loadModels()} disabled={loading || !settings.sttBaseUrl?.trim()}>{loading ? t("settings.loadingModels") : t("settings.loadModels")}</button>}>
        <InputField value={settings.sttModel || ""} onChange={(value) => void onPatch({ sttModel: value })} placeholder="whisper-1" list="stt-model-options" {...autosaveProps} />
        <datalist id="stt-model-options">
          <option value="whisper-1" />
          <option value="gpt-4o-mini-transcribe" />
          <option value="gpt-4o-transcribe" />
          {models.map((model) => <option key={model.id} value={model.id} />)}
        </datalist>
      </SettingRow>
    </SettingsGroup>
  );
}
