import { useI18n } from "../../../shared/i18n";
import type { ChatMode } from "../constants";

// Pure Chat and the RP modes read different system prompts. Showing the one the
// current mode really sends keeps users from editing a prompt that is ignored.
export function ChatSystemPromptField({
  chatMode,
  rpPrompt,
  onRpPromptChange,
  purePrompt,
  onPurePromptChange
}: {
  chatMode: ChatMode;
  rpPrompt: string;
  onRpPromptChange: (value: string) => void;
  purePrompt: string;
  onPurePromptChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const pure = chatMode === "pure_chat";
  const label = t(pure ? "inspector.systemPromptPure" : "inspector.systemPromptRp");

  return (
    <div>
      <div className="mb-1 text-sm font-medium text-text-primary">{label}</div>
      <p className="mb-2 text-[11px] leading-relaxed text-text-tertiary">
        {t(pure ? "inspector.systemPromptPureHint" : "inspector.systemPromptRpHint")}
      </p>
      <textarea
        value={pure ? purePrompt : rpPrompt}
        aria-label={label}
        onChange={(e) => (pure ? onPurePromptChange : onRpPromptChange)(e.target.value)}
        className="h-24 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
        placeholder={t(pure ? "inspector.systemPromptPurePlaceholder" : "inspector.systemPromptRpPlaceholder")}
      />
    </div>
  );
}
