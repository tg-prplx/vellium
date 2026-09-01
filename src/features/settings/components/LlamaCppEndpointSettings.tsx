import type { TranslationKey } from "../../../shared/i18n";
import type { LlamaCppEndpointStatus } from "../../../shared/types/llamaCpp";
import { ToggleSwitch } from "./FormControls";

interface LlamaCppEndpointSettingsProps {
  enabled: boolean;
  busy: boolean;
  status: LlamaCppEndpointStatus | null;
  canManageModels: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onRefresh: () => Promise<void>;
  onLoadModel: (model: string) => Promise<void>;
  onUnloadModel: (model: string) => Promise<void>;
  t: (key: TranslationKey) => string;
}

function formatNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

export function LlamaCppEndpointSettings({
  enabled,
  busy,
  status,
  canManageModels,
  onEnabledChange,
  onRefresh,
  onLoadModel,
  onUnloadModel,
  t
}: LlamaCppEndpointSettingsProps) {
  const stateKey = `settings.llamaApiState.${status?.state || "not-detected"}` as TranslationKey;

  return (
    <div className="llama-api-panel">
      <div className="llama-api-panel-header">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">{t("settings.llamaApiTitle")}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-text-tertiary">{t("settings.llamaApiDesc")}</div>
        </div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void onRefresh()}>
          {busy ? t("settings.llamaApiChecking") : t("settings.llamaApiCheck")}
        </button>
      </div>

      <label className="settings-toggle-row cursor-pointer">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">{t("settings.llamaApiEnabled")}</div>
          <div className="mt-0.5 text-[11px] text-text-tertiary">{t("settings.llamaApiEnabledDesc")}</div>
        </div>
        <ToggleSwitch checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
      </label>

      {status ? (
        <div className="llama-api-status">
          <div className="llama-api-status-title">
            <span className={`llama-api-state is-${status.state}`}>{t(stateKey)}</span>
            <span>{status.baseUrl}</span>
          </div>
          {status.error ? <div className="llama-api-error">{status.error}</div> : null}

          {status.detected ? (
            <>
              <div className="llama-api-facts">
                <div><span>{t("settings.llamaApiModelPath")}</span><strong>{status.modelPath || "—"}</strong></div>
                <div><span>{t("settings.contextWindow")}</span><strong>{formatNumber(status.contextSize)}</strong></div>
                <div><span>{t("settings.llamaApiSlots")}</span><strong>{status.busySlots}/{status.slotCount || "—"}</strong></div>
                <div><span>{t("settings.llamaApiModalities")}</span><strong>{status.modalities.join(", ") || "text"}</strong></div>
              </div>

              <div className="llama-api-server-defaults">
                <span>{t("settings.llamaApiServerDefaults")}</span>
                <code>T {formatNumber(status.samplerDefaults.temperature)}</code>
                <code>Top-P {formatNumber(status.samplerDefaults.topP)}</code>
                <code>Top-K {formatNumber(status.samplerDefaults.topK)}</code>
                <code>Min-P {formatNumber(status.samplerDefaults.minP)}</code>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {status?.models.length ? (
        <div className="llama-api-models">
          <div className="text-xs font-semibold text-text-secondary">{t("settings.llamaApiRouterModels")}</div>
          {status.models.map((model) => {
            const loaded = model.state === "loaded" || model.state === "loading" || model.state === "sleeping";
            return (
              <div key={model.id} className="llama-api-model-row">
                <div className="min-w-0">
                  <strong>{model.id}</strong>
                  <span>{model.state}{model.args.length ? ` · ${model.args.join(" ")}` : ""}</span>
                </div>
                {status.supportsModelControl ? (
                  <button
                    type="button"
                    disabled={busy || !enabled || !canManageModels || model.state === "loading"}
                    onClick={() => void (loaded ? onUnloadModel(model.id) : onLoadModel(model.id))}
                  >
                    {loaded ? t("settings.llamaApiUnload") : t("settings.llamaApiLoad")}
                  </button>
                ) : null}
              </div>
            );
          })}
          {!canManageModels ? <p className="llama-api-help">{t("settings.llamaApiSaveToManage")}</p> : null}
        </div>
      ) : status?.detected ? <p className="llama-api-help">{t("settings.llamaApiSingleModel")}</p> : null}
    </div>
  );
}
