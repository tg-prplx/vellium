import { useI18n } from "../../../shared/i18n";
import { findMatchingSamplerPresetId } from "../../../shared/samplerPresets";
import type { SamplerConfig, SamplerPreset } from "../../../shared/types/contracts";

export function SamplerPresetSelect({
  presets,
  samplerConfig,
  disabled = false,
  variant = "header",
  onApply
}: {
  presets: SamplerPreset[];
  samplerConfig: SamplerConfig;
  disabled?: boolean;
  variant?: "header" | "simple";
  onApply: (preset: SamplerPreset) => void;
}) {
  const { t } = useI18n();
  const selectedId = findMatchingSamplerPresetId(presets, samplerConfig);
  if (presets.length === 0) return null;

  return (
    <div className={variant === "simple" ? "contents" : "min-w-[180px]"}>
      <label className={variant === "simple" ? "chat-simple-model-label" : "mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary"}>
        {t("chat.samplerPreset")}
      </label>
      <select
        value={selectedId}
        disabled={disabled}
        onChange={(event) => {
          const preset = presets.find((item) => item.id === event.target.value);
          if (preset) onApply(preset);
        }}
        className={variant === "simple" ? "chat-simple-model-select" : "w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary disabled:opacity-40"}
      >
        <option value="">{t("chat.samplerPresetCustom")}</option>
        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </div>
  );
}
