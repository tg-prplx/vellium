import type { TranslationKey } from "../../../shared/i18n";
import type { AppSettings } from "../../../shared/types/contracts";
import { InputField } from "./FormControls";
import { SettingRow, SettingsGroup } from "./SettingRow";

interface RuntimeTuningSettingsProps {
  group: "generation" | "context";
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => void;
  t: (key: TranslationKey) => string;
}

function clampedInteger(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function clampedDecimal(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

type NumericSetting = {
  key: keyof AppSettings;
  label: TranslationKey;
  min: number;
  max: number;
  decimal?: boolean;
};

const GENERATION_FIELDS: NumericSetting[] = [
  { key: "endpointDiscoveryTimeoutSeconds", label: "settings.endpointDiscoveryTimeout", min: 5, max: 300 },
  { key: "speechTranscriptionTimeoutSeconds", label: "settings.speechTranscriptionTimeout", min: 15, max: 1800 },
  { key: "translationTimeoutSeconds", label: "settings.translationTimeout", min: 5, max: 600 },
  { key: "translationMaxTokens", label: "settings.translationMaxTokens", min: 64, max: 32768 },
  { key: "translationTemperature", label: "settings.translationTemperature", min: 0, max: 2, decimal: true },
  { key: "autoConversationDefaultTurns", label: "settings.autoConversationTurns", min: 1, max: 50 },
  { key: "autoConversationDelayMs", label: "settings.autoConversationDelay", min: 0, max: 10000 }
];

const CONTEXT_FIELDS: NumericSetting[] = [
  { key: "contextMaxMessages", label: "settings.contextMaxMessages", min: 0, max: 1000 },
  { key: "reasoningMaxChars", label: "settings.reasoningMaxChars", min: 1000, max: 100000 },
  { key: "compressionFallbackMessages", label: "settings.compressionFallbackMessages", min: 1, max: 100 },
  { key: "compressionMaxTokens", label: "settings.compressionMaxTokens", min: 128, max: 32768 },
  { key: "compressionTemperature", label: "settings.compressionTemperature", min: 0, max: 2, decimal: true }
];

export function RuntimeTuningSettings({ group, settings, onPatch, t }: RuntimeTuningSettingsProps) {
  const autosave = { commitMode: "debounced" as const, debounceMs: 420 };
  const fields = group === "generation" ? GENERATION_FIELDS : CONTEXT_FIELDS;
  return (
    <SettingsGroup
      id={group === "generation" ? "settings-runtime-tuning" : "settings-context-tuning"}
      title={t(group === "generation" ? "settings.runtimeTuning" : "settings.contextTuning")}
      description={t(group === "generation" ? "settings.runtimeTuningDesc" : "settings.contextTuningDesc")}
    >
      <div className="settings-row-columns">
        {fields.map((field) => {
          const current = Number(settings[field.key]);
          return (
            <SettingRow key={field.key} label={t(field.label)}>
              <InputField type="number" value={String(current)} {...autosave}
                onChange={(value) => onPatch({
                  [field.key]: field.decimal
                    ? clampedDecimal(value, current, field.min, field.max)
                    : clampedInteger(value, current, field.min, field.max)
                } as Partial<AppSettings>)} />
            </SettingRow>
          );
        })}
      </div>
    </SettingsGroup>
  );
}
