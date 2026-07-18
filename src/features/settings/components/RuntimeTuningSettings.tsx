import type { TranslationKey } from "../../../shared/i18n";
import type { AppSettings } from "../../../shared/types/contracts";
import { FieldLabel, InputField } from "./FormControls";

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

export function RuntimeTuningSettings({ group, settings, onPatch, t }: RuntimeTuningSettingsProps) {
  const autosave = { commitMode: "debounced" as const, debounceMs: 420 };

  if (group === "generation") {
    return (
      <div id="settings-runtime-tuning" className="settings-section scroll-mt-24">
        <div className="settings-section-title">{t("settings.runtimeTuning")}</div>
        <p className="settings-section-desc">{t("settings.runtimeTuningDesc")}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div><FieldLabel>{t("settings.translationTimeout")}</FieldLabel><InputField type="number" value={String(settings.translationTimeoutSeconds)} onChange={(value) => onPatch({ translationTimeoutSeconds: clampedInteger(value, settings.translationTimeoutSeconds, 5, 600) })} {...autosave} /></div>
          <div><FieldLabel>{t("settings.translationMaxTokens")}</FieldLabel><InputField type="number" value={String(settings.translationMaxTokens)} onChange={(value) => onPatch({ translationMaxTokens: clampedInteger(value, settings.translationMaxTokens, 64, 32768) })} {...autosave} /></div>
          <div><FieldLabel>{t("settings.translationTemperature")}</FieldLabel><InputField type="number" value={String(settings.translationTemperature)} onChange={(value) => onPatch({ translationTemperature: clampedDecimal(value, settings.translationTemperature, 0, 2) })} {...autosave} /></div>
          <div><FieldLabel>{t("settings.autoConversationTurns")}</FieldLabel><InputField type="number" value={String(settings.autoConversationDefaultTurns)} onChange={(value) => onPatch({ autoConversationDefaultTurns: clampedInteger(value, settings.autoConversationDefaultTurns, 1, 50) })} {...autosave} /></div>
          <div><FieldLabel>{t("settings.autoConversationDelay")}</FieldLabel><InputField type="number" value={String(settings.autoConversationDelayMs)} onChange={(value) => onPatch({ autoConversationDelayMs: clampedInteger(value, settings.autoConversationDelayMs, 0, 10000) })} {...autosave} /></div>
        </div>
      </div>
    );
  }

  return (
    <div id="settings-context-tuning" className="settings-section scroll-mt-24">
      <div className="settings-section-title">{t("settings.contextTuning")}</div>
      <p className="settings-section-desc">{t("settings.contextTuningDesc")}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div><FieldLabel>{t("settings.contextMaxMessages")}</FieldLabel><InputField type="number" value={String(settings.contextMaxMessages)} onChange={(value) => onPatch({ contextMaxMessages: clampedInteger(value, settings.contextMaxMessages, 0, 1000) })} {...autosave} /></div>
        <div><FieldLabel>{t("settings.reasoningMaxChars")}</FieldLabel><InputField type="number" value={String(settings.reasoningMaxChars)} onChange={(value) => onPatch({ reasoningMaxChars: clampedInteger(value, settings.reasoningMaxChars, 1000, 100000) })} {...autosave} /></div>
        <div><FieldLabel>{t("settings.compressionFallbackMessages")}</FieldLabel><InputField type="number" value={String(settings.compressionFallbackMessages)} onChange={(value) => onPatch({ compressionFallbackMessages: clampedInteger(value, settings.compressionFallbackMessages, 1, 100) })} {...autosave} /></div>
        <div><FieldLabel>{t("settings.compressionMaxTokens")}</FieldLabel><InputField type="number" value={String(settings.compressionMaxTokens)} onChange={(value) => onPatch({ compressionMaxTokens: clampedInteger(value, settings.compressionMaxTokens, 128, 32768) })} {...autosave} /></div>
        <div><FieldLabel>{t("settings.compressionTemperature")}</FieldLabel><InputField type="number" value={String(settings.compressionTemperature)} onChange={(value) => onPatch({ compressionTemperature: clampedDecimal(value, settings.compressionTemperature, 0, 2) })} {...autosave} /></div>
      </div>
    </div>
  );
}
