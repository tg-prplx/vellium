import { useI18n } from "../../../shared/i18n";

export function openProviderSettings() {
  window.dispatchEvent(new CustomEvent("open-settings-view", {
    detail: { category: "providers", sectionId: "settings-providers" }
  }));
}

// Shown while no model is active: without one, a message only gets an echo
// placeholder back, which reads like a broken app to a first-time user.
export function ModelSetupNotice({ hasProviders, onChooseModel, compact = false }: {
  hasProviders: boolean;
  onChooseModel?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`chat-model-setup-notice ${compact ? "is-compact" : ""}`} role="status">
      <span className="chat-model-setup-notice-dot" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="chat-model-setup-notice-title">{t(hasProviders ? "chat.modelSetupPickTitle" : "chat.modelSetupConnectTitle")}</div>
        {!compact && <p>{t(hasProviders ? "chat.modelSetupPickDesc" : "chat.modelSetupConnectDesc")}</p>}
      </div>
      {hasProviders && onChooseModel ? (
        <button type="button" className="chat-model-setup-notice-action" onClick={onChooseModel}>{t("chat.selectModel")}</button>
      ) : !hasProviders ? (
        <button type="button" className="chat-model-setup-notice-action" onClick={openProviderSettings}>{t("chat.modelSetupOpenSettings")}</button>
      ) : null}
    </div>
  );
}
