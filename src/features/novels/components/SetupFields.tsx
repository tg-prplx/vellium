import { useI18n, type TranslationKey } from "../../../shared/i18n";
import type { NovelConfig } from "../../../shared/types/novels";
export interface SetupFieldsProps { config: NovelConfig; patch: (value: Partial<NovelConfig>) => void }
export function NovelTextField({ config, patch, name, label, rows = 2, placeholder }: SetupFieldsProps & {
  name: "premise" | "protagonist" | "tone" | "artStyle" | "direction"; label: TranslationKey; rows?: number; placeholder?: TranslationKey;
}) {
  const { t } = useI18n();
  return <label className="novel-field"><span>{t(label)}</span><textarea aria-label={t(label)} rows={rows} maxLength={name === "premise" ? 16000 : 6000} value={config[name]} placeholder={placeholder ? t(placeholder) : undefined} onChange={(e) => patch({ [name]: e.target.value })} /></label>;
}
export function NovelNumberField({ config, patch, name, label, min, max }: SetupFieldsProps & {
  name: "scenesPerTurn" | "imagesPerScene" | "maxTokens" | "contextChars" | "width" | "height"; label: TranslationKey; min: number; max: number;
}) {
  const { t } = useI18n();
  return <label className="novel-field"><span>{t(label)}</span><input aria-label={t(label)} type="number" min={min} max={max} value={Number.isFinite(config[name]) ? config[name] : ""} onChange={(e) => patch({ [name]: e.target.valueAsNumber })} /></label>;
}
