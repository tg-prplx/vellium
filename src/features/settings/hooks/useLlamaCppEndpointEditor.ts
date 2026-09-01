import { useRef, useState } from "react";
import { api } from "../../../shared/api";
import type { TranslationKey } from "../../../shared/i18n";
import type { ProviderProfile } from "../../../shared/types/contracts";
import type { LlamaCppEndpointStatus } from "../../../shared/types/llamaCpp";

interface UseLlamaCppEndpointEditorOptions {
  baseUrl: string;
  apiKey: string;
  fullLocalOnly: boolean;
  editingProvider: ProviderProfile | null;
  t: (key: TranslationKey) => string;
  showResult: (message: string, variant?: "info" | "success" | "error") => void;
}

export function useLlamaCppEndpointEditor(options: UseLlamaCppEndpointEditorOptions) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<LlamaCppEndpointStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);

  function reset() {
    requestRef.current += 1;
    setEnabled(false);
    setStatus(null);
    setBusy(false);
  }

  function loadProfile(profile: ProviderProfile) {
    const nextEnabled = profile.llamaCppManagementEnabled === true;
    setEnabled(nextEnabled);
    setStatus(null);
    const requestId = ++requestRef.current;
    if (profile.providerType === "koboldcpp" || profile.providerType === "custom" || !nextEnabled) {
      setBusy(false);
      return;
    }
    setBusy(true);
    void api.providerLlamaCppStatus(profile.id)
      .then((nextStatus) => {
        if (requestId === requestRef.current) setStatus(nextStatus);
      })
      .catch(() => undefined)
      .finally(() => {
        if (requestId === requestRef.current) setBusy(false);
      });
  }

  async function refresh(announce = true) {
    if (!options.baseUrl.trim() || busy) return status;
    setBusy(true);
    const requestId = ++requestRef.current;
    try {
      const savedMatchesDraft = options.editingProvider?.baseUrl.trim().replace(/\/+$/, "") === options.baseUrl.trim().replace(/\/+$/, "");
      const nextStatus = await api.providerPreviewLlamaCppStatus({
        providerId: savedMatchesDraft ? options.editingProvider?.id : undefined,
        baseUrl: options.baseUrl.trim(),
        apiKey: options.apiKey.trim(),
        fullLocalOnly: options.fullLocalOnly
      });
      if (requestId !== requestRef.current) return nextStatus;
      setStatus(nextStatus);
      if (nextStatus.detected) setEnabled(true);
      if (announce) {
        options.showResult(nextStatus.detected
          ? `llama.cpp: ${options.t(`settings.llamaApiState.${nextStatus.state}` as TranslationKey)}`
          : (nextStatus.error || options.t("settings.llamaApiState.not-detected")), nextStatus.detected ? "success" : "info");
      }
      return nextStatus;
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }

  async function changeModel(model: string, loaded: boolean) {
    if (!options.editingProvider || busy) return;
    if (!loaded && !window.confirm(options.t("settings.llamaApiUnloadConfirm"))) return;
    setBusy(true);
    const requestId = ++requestRef.current;
    try {
      const nextStatus = loaded
        ? await api.providerLlamaCppLoadModel(options.editingProvider.id, model)
        : await api.providerLlamaCppUnloadModel(options.editingProvider.id, model);
      if (requestId === requestRef.current) setStatus(nextStatus);
    } catch (error) {
      options.showResult(error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }

  return { enabled, setEnabled, status, busy, reset, loadProfile, refresh, changeModel };
}
