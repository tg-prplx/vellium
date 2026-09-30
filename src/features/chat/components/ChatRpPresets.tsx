import { useI18n } from "../../../shared/i18n";
import { RP_PRESETS } from "../constants";

export function ChatRpPresets({ activePreset, expanded, onToggle, onApply }: {
  activePreset: string | null; expanded: boolean; onToggle: () => void; onApply: (preset: string) => void;
}) {
  const { t } = useI18n();
  return <div className="chat-sidebar-context-group chat-inspector-section rounded-lg border border-border-subtle bg-bg-primary p-3">
    <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center justify-between">
      <span className="text-xs font-medium text-text-secondary">{t("chat.rpPresets")}</span>
      <svg className={`h-3 w-3 text-text-tertiary transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    {expanded && <div className="mt-3 flex flex-wrap gap-1.5">
      {RP_PRESETS.map((preset) => <button key={preset} type="button" onClick={() => onApply(preset)}
        aria-pressed={activePreset === preset}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${activePreset === preset ? "bg-accent-subtle text-accent" : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"}`}>
        {t(`preset.${preset}`)}
      </button>)}
    </div>}
  </div>;
}
