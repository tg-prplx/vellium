import { useI18n } from "../../../shared/i18n";
import type { ChatMode } from "../constants";

const MODE_HINT_KEYS = {
  rp: "inspector.modeRpHint",
  light_rp: "inspector.modeLightRpHint",
  pure_chat: "inspector.modePureChatHint"
} as const;

export function ChatModeHint({
  chatMode,
  hasCharacter,
  onSwitchToPureChat,
  className = ""
}: {
  chatMode: ChatMode;
  hasCharacter: boolean;
  onSwitchToPureChat: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const suggestPureChat = chatMode !== "pure_chat" && !hasCharacter;

  return (
    <div className={`space-y-1.5 text-[11px] leading-relaxed text-text-tertiary ${className}`}>
      <p>{t(MODE_HINT_KEYS[chatMode])}</p>
      {suggestPureChat && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/20 bg-warning/10 px-2 py-1.5 text-warning">
          <span className="min-w-0 flex-1">{t("inspector.noCharacterRpHint")}</span>
          <button
            type="button"
            onClick={onSwitchToPureChat}
            className="shrink-0 rounded-md border border-warning/30 px-2 py-0.5 font-medium hover:bg-warning/15"
          >
            {t("inspector.switchToPureChat")}
          </button>
        </div>
      )}
    </div>
  );
}
