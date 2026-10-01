import { describeChatGenerationError } from "../../../shared/chatGenerationError";
import { useI18n } from "../../../shared/i18n";

function openProviderSettings() {
  window.dispatchEvent(new CustomEvent("open-settings-view", {
    detail: { category: "providers", sectionId: "settings-providers" }
  }));
}

export function ChatGenerationFailure({ error, onRetry, onContext, busy }: {
  error: string;
  onRetry?: () => void;
  onContext?: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const info = describeChatGenerationError(error);
  const endpoint = info.endpoint || t("chat.providerEndpoint");
  const summary = info.contextBudgetExceeded ? t("context.overBudget") : info.authFailed
    ? t("chat.generationAuthFailed")
    : info.modelMissing
      ? t("chat.generationModelMissing")
      : info.timedOut
        ? info.timeoutSeconds
          ? t("chat.generationTimeout").replace("{endpoint}", endpoint).replace("{seconds}", String(info.timeoutSeconds))
          : t("chat.generationUnreachable").replace("{endpoint}", endpoint)
        : info.connectionFailed
          ? t("chat.generationUnreachable").replace("{endpoint}", endpoint)
          : info.providerMessage
            ? t("chat.generationProviderError").replace("{message}", info.providerMessage)
            : t("chat.generationFailed");
  // Retrying cannot fix a bad key, a missing model or an unreachable address; settings can.
  const settingsFirst = info.authFailed || info.modelMissing;
  const offerSettings = settingsFirst || info.timedOut || info.connectionFailed;

  return (
    <section className="chat-generation-failure" role="alert">
      <div className="chat-generation-failure-heading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        </svg>
        <div>
          <h3>{summary}</h3>
          <p>{info.contextBudgetExceeded ? t("context.budgetRecovery") : settingsFirst ? t("chat.generationSettingsHint") : t("chat.generationFailureHint")}</p>
        </div>
        <div className="chat-generation-failure-actions">
          {info.contextBudgetExceeded && onContext && <button type="button" onClick={onContext} className="is-primary">{t("context.title")}</button>}
          {offerSettings && (
            <button type="button" onClick={openProviderSettings} className={settingsFirst ? "is-primary" : ""}>
              {t("chat.openProviderSettings")}
            </button>
          )}
          {onRetry && <button type="button" onClick={onRetry} disabled={busy}>{t("chat.retryGeneration")}</button>}
        </div>
      </div>
      <details>
        <summary>{t("chat.generationDetails")}</summary>
        <pre>{info.details}</pre>
      </details>
    </section>
  );
}
