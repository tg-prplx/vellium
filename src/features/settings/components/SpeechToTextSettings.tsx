import { useState } from "react";
import { api } from "../../../shared/api";
import { useI18n } from "../../../shared/i18n";
import type { AppSettings, ProviderModel } from "../../../shared/types/contracts";
import { FieldLabel, InputField, SelectField } from "./FormControls";

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
    <div id="settings-stt" className="settings-section scroll-mt-24">
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{t("settings.stt")}</div>
          <p className="settings-section-desc">{t("settings.sttDesc")}</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <div>
            <FieldLabel>{t("settings.sttSource")}</FieldLabel>
            <SelectField
              value={settings.sttSource || "system"}
              onChange={(value) => void onPatch({ sttSource: value === "whisper" ? "whisper" : "system" })}
            >
              <option value="system">{t("live.systemStt")}</option>
              <option value="whisper">{t("live.whisperStt")}</option>
            </SelectField>
          </div>
          <div>
            <FieldLabel>{t("settings.sttEndpoint")}</FieldLabel>
            <InputField
              value={settings.sttBaseUrl || ""}
              onChange={(value) => void onPatch({ sttBaseUrl: value })}
              placeholder="https://api.openai.com/v1"
              {...autosaveProps}
            />
          </div>
          <div>
            <FieldLabel>{t("settings.apiKey")}</FieldLabel>
            <InputField
              type="password"
              value={settings.sttApiKey || ""}
              onChange={(value) => void onPatch({ sttApiKey: value })}
              placeholder={t("settings.apiKey")}
              {...autosaveProps}
            />
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <FieldLabel>{t("settings.sttModel")}</FieldLabel>
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-50"
                onClick={() => void loadModels()}
                disabled={loading || !settings.sttBaseUrl?.trim()}
              >
                {loading ? t("settings.loadingModels") : t("settings.loadModels")}
              </button>
            </div>
            <InputField
              value={settings.sttModel || ""}
              onChange={(value) => void onPatch({ sttModel: value })}
              placeholder="whisper-1"
              list="stt-model-options"
              {...autosaveProps}
            />
            <datalist id="stt-model-options">
              <option value="whisper-1" />
              <option value="gpt-4o-mini-transcribe" />
              <option value="gpt-4o-transcribe" />
              {models.map((model) => <option key={model.id} value={model.id} />)}
            </datalist>
          </div>
          <div>
            <FieldLabel>{t("settings.sttLanguage")}</FieldLabel>
            <InputField
              value={settings.sttLanguage || ""}
              onChange={(value) => void onPatch({ sttLanguage: value })}
              placeholder={t("settings.sttLanguageAuto")}
              {...autosaveProps}
            />
            <p className="mt-1 text-[11px] text-text-tertiary">{t("settings.sttLanguageHint")}</p>
          </div>
          {status ? <p className="text-[11px] text-text-tertiary" role="status">{status}</p> : null}
        </div>
      </div>
    </div>
  );
}
