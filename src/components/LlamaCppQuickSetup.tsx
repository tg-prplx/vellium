import { useEffect, useMemo, useState } from "react";
import { api } from "../shared/api";
import { normalizeManagedBackends } from "../shared/managedBackends";
import {
  buildDetectedLlamaManagedBackend,
  DETECTED_LLAMA_BACKEND_ID,
  DETECTED_LLAMA_PROVIDER_ID
} from "../shared/localModelConfig";
import { useI18n } from "../shared/i18n";
import type { AppSettings, ManagedBackendRuntimeState } from "../shared/types/contracts";
import type { LlamaCppDiscoveryResult } from "../shared/types/llamaCpp";

type LlamaCppQuickSetupProps = {
  compact?: boolean;
  onConfigured?: () => void;
};

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

function endpointProviderUrl(baseUrl: string) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/v1`;
}

async function activateSettings(patch: Partial<AppSettings>) {
  const updated = await api.settingsUpdate(patch);
  window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
  return updated;
}

export function LlamaCppQuickSetup({ compact = false, onConfigured }: LlamaCppQuickSetupProps) {
  const { t } = useI18n();
  const [discovery, setDiscovery] = useState<LlamaCppDiscoveryResult | null>(null);
  const [executable, setExecutable] = useState("");
  const [modelPath, setModelPath] = useState("");
  const [runtime, setRuntime] = useState<ManagedBackendRuntimeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedModel = useMemo(
    () => discovery?.modelCandidates.find((item) => item.path === modelPath) || null,
    [discovery, modelPath]
  );

  async function discover() {
    if (!window.electronAPI?.discoverLlamaCpp) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.electronAPI.discoverLlamaCpp();
      setDiscovery(result);
      setExecutable((current) => current || result.executableCandidates[0]?.path || "");
      setModelPath((current) => current || result.modelCandidates[0]?.path || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void discover();
    void window.electronAPI?.listManagedBackends?.().then((states) => {
      setRuntime(states.find((item) => item.backendId === DETECTED_LLAMA_BACKEND_ID) || null);
    }).catch(() => undefined);
    return window.electronAPI?.onManagedBackendsUpdate?.((states) => {
      setRuntime(states.find((item) => item.backendId === DETECTED_LLAMA_BACKEND_ID) || null);
    });
  }, []);

  async function useRunningEndpoint() {
    const endpoint = discovery?.endpointCandidates[0];
    if (!endpoint || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.providerUpsert({
        id: DETECTED_LLAMA_PROVIDER_ID,
        name: "Local llama.cpp",
        baseUrl: endpointProviderUrl(endpoint.baseUrl),
        apiKey: "local-key",
        proxyUrl: null,
        fullLocalOnly: true,
        providerType: "openai",
        llamaCppManagementEnabled: true
      });
      await activateSettings({
        activeProviderId: DETECTED_LLAMA_PROVIDER_ID,
        activeModel: endpoint.models[0] || null,
        fullLocalMode: true
      });
      onConfigured?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function configureManaged() {
    if (!executable || !modelPath || busy) return;
    setBusy(true);
    setError("");
    try {
      const backend = buildDetectedLlamaManagedBackend(
        executable,
        modelPath,
        discovery?.accelerator || "cpu",
        Math.max(2, (navigator.hardwareConcurrency || 8) - 1)
      );
      await api.providerUpsert({
        id: DETECTED_LLAMA_PROVIDER_ID,
        name: "Local llama.cpp",
        baseUrl: endpointProviderUrl(backend.baseUrl),
        apiKey: "local-key",
        proxyUrl: null,
        fullLocalOnly: true,
        providerType: "openai",
        llamaCppManagementEnabled: true
      });
      const current = await api.settingsGet();
      await activateSettings({
        managedBackends: [
          ...normalizeManagedBackends(current.managedBackends).filter((item) => item.id !== backend.id),
          backend
        ],
        activeProviderId: DETECTED_LLAMA_PROVIDER_ID,
        activeModel: `managed:${backend.id}`,
        fullLocalMode: true
      });
      const state = await window.electronAPI?.startManagedBackend?.(backend);
      if (state) setRuntime(state);
      onConfigured?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function pickExecutable() {
    const picked = await window.electronAPI?.pickLlamaCppExecutable?.();
    if (!picked?.canceled && picked?.path) setExecutable(picked.path);
  }

  async function pickModel() {
    const picked = await window.electronAPI?.pickLlamaCppModel?.();
    if (!picked?.canceled && picked?.path) setModelPath(picked.path);
  }

  if (!window.electronAPI?.discoverLlamaCpp) {
    return <p className="text-xs text-text-tertiary">{t("llamaCpp.desktopOnly")}</p>;
  }

  const endpoint = discovery?.endpointCandidates[0];
  const readyToConfigure = Boolean(executable && modelPath);
  const runtimeTone = runtime?.status === "running"
    ? "border-success-border bg-success-subtle text-success"
    : runtime?.status === "error"
      ? "border-danger-border bg-danger-subtle text-danger"
      : "border-warning-border bg-warning-subtle text-warning";

  return (
    <section className={`llama-quick-setup ${compact ? "is-compact" : ""}`}>
      <div className="llama-quick-header">
        <div>
          <div className="text-sm font-semibold text-text-primary">{t("llamaCpp.title")}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">{t("llamaCpp.description")}</p>
        </div>
        <button type="button" className="llama-quick-rescan" disabled={busy} onClick={() => void discover()}>
          {busy ? t("llamaCpp.scanning") : t("llamaCpp.rescan")}
        </button>
      </div>

      {runtime ? (
        <div className={`llama-runtime-status ${runtimeTone}`} role="status">
          <span className="llama-runtime-dot" />
          <span className="min-w-0 flex-1">
            <strong>{t(`llamaCpp.status.${runtime.status}` as any)}</strong>
            <span>{runtime.progressLabel || runtime.baseUrl}</span>
          </span>
          {runtime.pid ? <code>PID {runtime.pid}</code> : null}
        </div>
      ) : null}

      {endpoint ? (
        <div className="llama-endpoint-found">
          <div>
            <strong>{t("llamaCpp.runningFound")}</strong>
            <span>{endpoint.baseUrl} · {endpoint.models[0] || t("llamaCpp.modelUnknown")}</span>
          </div>
          <button type="button" disabled={busy} onClick={() => void useRunningEndpoint()}>{t("llamaCpp.useRunning")}</button>
        </div>
      ) : null}

      <div className="llama-detection-summary" aria-live="polite">
        <span className={executable ? "is-found" : ""}>
          <b>{discovery?.executableCandidates.length || 0}</b> {t("llamaCpp.runtimesFound")}
        </span>
        <span className={modelPath ? "is-found" : ""}>
          <b>{discovery?.modelCandidates.length || 0}</b> {t("llamaCpp.modelsFound")}
        </span>
        {discovery ? <span>{discovery.accelerator.toUpperCase()}</span> : null}
      </div>

      <div className="llama-quick-fields">
        <label>
          <span>{t("llamaCpp.runtime")}</span>
          <div className="llama-quick-field-row">
            <select value={executable} onChange={(event) => setExecutable(event.target.value)}>
              <option value="">{t("llamaCpp.runtimeNotFound")}</option>
              {discovery?.executableCandidates.map((item) => <option key={item.path} value={item.path}>{item.path}</option>)}
              {executable && !discovery?.executableCandidates.some((item) => item.path === executable) ? <option value={executable}>{executable}</option> : null}
            </select>
            <button type="button" onClick={() => void pickExecutable()}>{t("llamaCpp.choose")}</button>
          </div>
        </label>
        <label>
          <span>{t("llamaCpp.model")}</span>
          <div className="llama-quick-field-row">
            <select value={modelPath} onChange={(event) => setModelPath(event.target.value)}>
              <option value="">{t("llamaCpp.modelNotFound")}</option>
              {discovery?.modelCandidates.map((item) => (
                <option key={item.path} value={item.path}>{item.name} · {formatBytes(item.sizeBytes)}</option>
              ))}
              {modelPath && !discovery?.modelCandidates.some((item) => item.path === modelPath) ? <option value={modelPath}>{modelPath}</option> : null}
            </select>
            <button type="button" onClick={() => void pickModel()}>{t("llamaCpp.choose")}</button>
          </div>
          {selectedModel ? <small>{selectedModel.path}</small> : null}
        </label>
      </div>

      {!readyToConfigure && discovery && !endpoint ? (
        <p className="llama-quick-guidance">{t("llamaCpp.nothingFound")}</p>
      ) : null}
      {error ? <p className="llama-quick-error" role="alert">{error}</p> : null}

      <div className="llama-quick-actions">
        {runtime?.status === "running" ? (
          <button type="button" className="secondary" onClick={() => void window.electronAPI?.stopManagedBackend(DETECTED_LLAMA_BACKEND_ID)}>{t("llamaCpp.stop")}</button>
        ) : null}
        <button type="button" className="primary" disabled={!readyToConfigure || busy} onClick={() => void configureManaged()}>
          {runtime?.status === "error" ? t("llamaCpp.retry") : t("llamaCpp.configureAndStart")}
        </button>
      </div>
    </section>
  );
}
