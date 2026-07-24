import { useI18n } from "../../../shared/i18n";

export function RpReasoningToggle({
  enabled,
  disabled,
  variant = "bar",
  onToggle
}: {
  enabled: boolean;
  disabled?: boolean;
  variant?: "bar" | "home" | "status";
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const className = variant === "home"
    ? "chat-simple-home-control rp-reasoning-toggle"
    : variant === "status"
      ? "rp-reasoning-toggle rp-reasoning-toggle-status"
      : "chat-simple-bar-model rp-reasoning-toggle";

  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={`${t("chat.rpReasoning")}: ${t("chat.rpReasoningTooltip")}`}
      title={t("chat.rpReasoningTooltip")}
      disabled={disabled}
      onClick={onToggle}
      className={`${className} ${enabled ? "is-active" : ""}`}
    >
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 18.5H7a3 3 0 01-3-3v-7a3 3 0 013-3h10a3 3 0 013 3v7a3 3 0 01-3 3h-4l-3.5 2.5v-2.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.5h6M10.5 13h3" />
      </svg>
      <span className="truncate">{t("chat.rpReasoning")}</span>
      <span className={`rp-reasoning-toggle-dot ${enabled ? "is-active" : ""}`} aria-hidden="true" />
    </button>
  );
}
