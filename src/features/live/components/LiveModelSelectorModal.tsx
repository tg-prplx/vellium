import { ModalShell } from "../../../components/ModalShell";
import type { ProviderModel, ProviderProfile } from "../../../shared/types/contracts";

export function LiveModelSelectorModal({
  open,
  providers,
  models,
  providerId,
  modelId,
  activeModel,
  loadingModels,
  applying,
  onClose,
  onProviderChange,
  onModelChange,
  onApply,
  onOpenSettings,
  t
}: {
  open: boolean;
  providers: ProviderProfile[];
  models: ProviderModel[];
  providerId: string;
  modelId: string;
  activeModel: string;
  loadingModels: boolean;
  applying: boolean;
  onClose: () => void;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onApply: () => void;
  onOpenSettings: () => void;
  t: (key: any) => string;
}) {
  if (!open) return null;
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  return (
    <ModalShell
      title={t("chat.selectModel")}
      description={selectedProvider?.name || t("settings.selectProvider")}
      closeLabel={t("chat.cancel")}
      onClose={onClose}
      size="sm"
      originId="live-model"
      surfaceClassName="live-model-modal"
      bodyClassName="live-model-modal-body"
      footer={(
        <>
          <button type="button" className="vellium-button vellium-button-secondary mr-auto" onClick={onOpenSettings}>
            {t("live.openSettings")}
          </button>
          <button type="button" className="vellium-button vellium-button-secondary" onClick={onClose}>
            {t("chat.cancel")}
          </button>
          <button
            type="button"
            className="vellium-button vellium-button-primary"
            onClick={onApply}
            disabled={!providerId || !modelId || loadingModels || applying}
          >
            {applying ? t("chat.loading") : t("chat.ok")}
          </button>
        </>
      )}
    >
      <div className="live-model-current">
        <span className={activeModel ? "is-online" : ""} aria-hidden="true" />
        <div><small>{t("settings.activeModel")}</small><strong>{activeModel || t("chat.noModel")}</strong></div>
      </div>
      <div className="live-model-form">
        <label>
          <span>{t("settings.provider")}</span>
          <select value={providerId} onChange={(event) => onProviderChange(event.target.value)}>
            <option value="">{t("settings.selectProvider")}</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </label>
        <label>
          <span>{t("chat.model")}</span>
          <select
            value={modelId}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={!providerId || loadingModels}
          >
            <option value="">{loadingModels ? t("chat.loading") : t("settings.selectModel")}</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
          </select>
        </label>
      </div>
    </ModalShell>
  );
}
