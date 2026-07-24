import { useEffect, useMemo, useState } from "react";
import { api } from "../shared/api";
import { useI18n } from "../shared/i18n";
import { normalizeManagedBackends } from "../shared/managedBackends";
import type { AppSettings } from "../shared/types/contracts";
import type {
  LocalModelCatalog,
  LocalModelComponentId,
  LocalModelInstallResult,
  LocalModelProgress
} from "../shared/types/localModels";

interface LocalModelsSetupProps {
  locale: "en" | "ru" | "zh" | "ja";
  compact?: boolean;
  onInstalled?: (result: LocalModelInstallResult) => void;
}

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function formatExactBytes(bytes: number) {
  return `${formatBytes(bytes)} (${bytes.toLocaleString("en-US")} B)`;
}

async function applyInstallResult(result: LocalModelInstallResult) {
  if (result.provider) await api.providerUpsert(result.provider);
  const current = await api.settingsGet();
  const patch: Partial<AppSettings> = { ...result.settingsPatch };
  if (result.managedBackend) {
    patch.managedBackends = [
      ...normalizeManagedBackends(current.managedBackends).filter((item) => item.id !== result.managedBackend!.id),
      result.managedBackend
    ];
    patch.activeProviderId = result.provider?.id || current.activeProviderId;
    patch.activeModel = `managed:${result.managedBackend.id}`;
    patch.fullLocalMode = true;
  }
  const updated = await api.settingsUpdate(patch);
  window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
}

export function LocalModelsSetup({ locale, compact = false, onInstalled }: LocalModelsSetupProps) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<LocalModelCatalog | null>(null);
  const [selected, setSelected] = useState<Set<LocalModelComponentId>>(new Set(["llm", "stt", "tts"]));
  const [progress, setProgress] = useState<Partial<Record<LocalModelComponentId, LocalModelProgress>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedBytes = useMemo(() => catalog?.items
    .filter((item) => selected.has(item.id))
    .reduce((total, item) => total + item.modelBytes + item.auxiliaryBytes, 0) || 0, [catalog, selected]);

  async function refresh() {
    if (!window.electronAPI?.getLocalModelCatalog) return;
    const next = await window.electronAPI.getLocalModelCatalog();
    setCatalog(next);
    setSelected((current) => new Set([...current].filter((id) => !next.items.find((item) => item.id === id)?.installed)));
  }

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return window.electronAPI?.onLocalModelProgress?.((next) => {
      setProgress((current) => ({ ...current, [next.componentId]: next }));
    });
  }, []);

  async function install() {
    if (!window.electronAPI || busy || selected.size === 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.electronAPI.installLocalModels({ componentIds: [...selected], locale });
      await applyInstallResult(result);
      onInstalled?.(result);
      if (result.errors && Object.keys(result.errors).length) {
        setError(Object.entries(result.errors).map(([id, message]) => `${id}: ${message}`).join("; "));
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: LocalModelComponentId) {
    if (!window.electronAPI || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.electronAPI.removeLocalModel(id);
      setCatalog(next);
      const current = await api.settingsGet();
      const patch: Partial<AppSettings> = {};
      if (id === "llm") {
        patch.managedBackends = normalizeManagedBackends(current.managedBackends).filter((item) => item.id !== "vellium-local-llama-backend");
        if (current.activeProviderId === "vellium-local-llama") {
          patch.activeProviderId = null;
          patch.activeModel = null;
        }
      } else if (id === "stt" && current.sttBaseUrl === "vellium-local://inference") {
        Object.assign(patch, { sttSource: "system", sttBaseUrl: "", sttModel: "" });
      } else if (id === "tts" && current.ttsBaseUrl === "vellium-local://inference") {
        Object.assign(patch, { ttsBaseUrl: "", ttsModel: "", ttsVoice: "alloy" });
      }
      const updated = await api.settingsUpdate(patch);
      window.dispatchEvent(new CustomEvent("settings-change", { detail: updated }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!window.electronAPI?.getLocalModelCatalog) {
    return compact ? null : <p className="text-xs text-text-tertiary">{t("localModels.desktopOnly")}</p>;
  }

  return (
    <div className={`rounded-xl border border-border-subtle bg-bg-primary ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-text-primary">{t("localModels.title")}</div>
          <p className="mt-1 text-[11px] text-text-tertiary">{t("localModels.description")}</p>
        </div>
        {catalog ? (
          <span className="shrink-0 rounded-md border border-border-subtle px-2 py-1 text-[10px] text-text-secondary">
            {catalog.hardware.accelerator.toUpperCase()} · RAM {formatBytes(catalog.hardware.memoryBytes)}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2">
        {catalog?.items.map((item) => {
          const state = progress[item.id];
          const percent = state?.totalBytes ? Math.min(100, Math.round(state.receivedBytes / state.totalBytes * 100)) : 0;
          return (
            <div key={item.id} className="rounded-lg border border-border-subtle bg-bg-secondary p-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(item.id)}
                  disabled={busy || item.installed}
                  onChange={(event) => setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(item.id); else next.delete(item.id);
                    return next;
                  })}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-xs text-text-primary">{item.name}: {item.modelName}</strong>
                    <span className="text-[10px] text-text-tertiary">{formatExactBytes(item.modelBytes)} {t("localModels.model")} + {formatBytes(item.auxiliaryBytes)} {t("localModels.runtime")}</span>
                    {item.installed ? <span className="text-[10px] text-success">{t("localModels.installed")}</span> : null}
                  </div>
                  {item.warning ? <p className="mt-1 text-[10px] text-warning">{item.warning}</p> : null}
                  {state && state.phase !== "idle" ? (
                    <div className="mt-2">
                      <div className="h-1 overflow-hidden rounded-full bg-bg-hover"><div className="h-full bg-accent" style={{ width: `${state.phase === "extracting" || state.phase === "verifying" || state.phase === "installed" ? 100 : percent}%` }} /></div>
                      <p className="mt-1 truncate text-[10px] text-text-tertiary">{state.label}{state.phase === "downloading" ? ` · ${percent}%` : ""}</p>
                    </div>
                  ) : null}
                </div>
                {item.installed ? (
                  <button type="button" disabled={busy} onClick={() => void remove(item.id)} className="text-[10px] text-danger hover:underline disabled:opacity-50">
                    {t("localModels.remove")}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] text-text-tertiary">{t("localModels.lighterHint")}</p>
      {error ? <p className="mt-2 rounded-lg border border-danger-border bg-danger-subtle px-2 py-1.5 text-[11px] text-danger">{error}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-secondary">{t("localModels.downloadTotal")}: {formatBytes(selectedBytes)}</span>
        <div className="flex gap-2">
          {busy ? <button type="button" onClick={() => void window.electronAPI?.cancelLocalModelInstall()} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary">{t("localModels.cancel")}</button> : null}
          <button type="button" disabled={busy || !catalog?.available || selected.size === 0} onClick={() => void install()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-text-inverse disabled:opacity-50">
            {busy ? t("localModels.installing") : t("localModels.installSelected")}
          </button>
        </div>
      </div>
    </div>
  );
}
