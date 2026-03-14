import type { AppSettings, ManagedBackendConfig, ManagedBackendRuntimeState, ProviderModel, ProviderProfile } from "../types/contracts";
import { managedBackendModelId, normalizeManagedBackends, parseManagedBackendModelId, resolveManagedBackendBaseUrl } from "../managedBackends";
import { get, post } from "./core";
import { accountSettingsClient } from "./accountSettingsClient";

function isElectronRuntimeAvailable() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

async function listRuntimeStates(): Promise<ManagedBackendRuntimeState[]> {
  if (!isElectronRuntimeAvailable()) return [];
  try {
    return await window.electronAPI!.listManagedBackends();
  } catch {
    return [];
  }
}

async function listManagedBackendsForProvider(providerId: string): Promise<ManagedBackendConfig[]> {
  const settings = await accountSettingsClient.settingsGet();
  return normalizeManagedBackends(settings.managedBackends).filter((backend) => backend.enabled && backend.providerId === providerId);
}

async function maybeStopActiveManagedBackend() {
  if (!isElectronRuntimeAvailable()) return;
  const [runtimeStates, settings] = await Promise.all([
    listRuntimeStates(),
    accountSettingsClient.settingsGet().catch(() => null)
  ]);
  const activeState = runtimeStates.find((state) => state.status === "starting" || state.status === "running");
  if (!activeState) return;
  const activeConfig = normalizeManagedBackends(settings?.managedBackends).find((backend) => backend.id === activeState.backendId);
  if (activeConfig?.autoStopOnSwitch === false) return;
  await window.electronAPI!.stopActiveManagedBackend().catch(() => undefined);
}

function appendManagedBackendModels(models: ProviderModel[], backends: ManagedBackendConfig[], runtimeStates: ManagedBackendRuntimeState[]): ProviderModel[] {
  const byBackend = new Map(runtimeStates.map((state) => [state.backendId, state]));
  const next = [...models];
  for (const backend of backends) {
    next.push({
      id: managedBackendModelId(backend.id),
      label: backend.name,
      managedBackendId: backend.id,
      managedBackendKind: backend.backendKind,
      runtimeStatus: byBackend.get(backend.id)?.status || "stopped",
      placeholder: true
    });
  }
  return next;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForManagedBackendModels(providerId: string, backendId: string): Promise<string[]> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const [runtimeStates, providerModels] = await Promise.all([
      listRuntimeStates(),
      get<ProviderModel[]>(`/providers/${providerId}/models`).catch(() => [])
    ]);
    const runtime = runtimeStates.find((state) => state.backendId === backendId);
    if (runtime?.status === "error") {
      throw new Error(runtime.lastError || "Managed backend failed to start");
    }
    const discovered = [...new Set([
      ...((Array.isArray(runtime?.models) ? runtime!.models : []).filter(Boolean)),
      ...providerModels.map((item) => item.id).filter(Boolean)
    ])];
    if (discovered.length > 0) {
      return discovered;
    }
    await sleep(500);
  }
  return [];
}

async function resolveManagedBackendModel(providerId: string, backendId: string): Promise<{ actualModelId: string; displayLabel: string }> {
  if (!isElectronRuntimeAvailable()) {
    throw new Error("Managed backends require Electron runtime");
  }
  const backends = await listManagedBackendsForProvider(providerId);
  const target = backends.find((backend) => backend.id === backendId);
  if (!target) {
    throw new Error("Managed backend configuration not found");
  }
  await window.electronAPI!.startManagedBackend(target);
  await post<ProviderProfile>(`/providers/${providerId}/runtime-config`, {
    baseUrl: resolveManagedBackendBaseUrl(target),
    providerType: target.providerType,
    adapterId: target.providerType === "custom" ? target.adapterId || null : null
  });
  const discoveredModels = await waitForManagedBackendModels(providerId, backendId);
  const actualModelId = (target.defaultModel && discoveredModels.includes(target.defaultModel)
    ? target.defaultModel
    : discoveredModels[0]) || "";
  if (!actualModelId) {
    throw new Error("Managed backend started, but no models were discovered");
  }
  return {
    actualModelId,
    displayLabel: target.name
  };
}

export const providerClient = {
  providerUpsert: (profile: Omit<ProviderProfile, "apiKeyMasked"> & { apiKey: string }) =>
    post<ProviderProfile>("/providers", profile),
  providerList: () => get<ProviderProfile[]>("/providers"),
  providerFetchModels: async (providerId: string) => {
    const [models, managedBackends, runtimeStates] = await Promise.all([
      get<ProviderModel[]>(`/providers/${providerId}/models`).catch(() => []),
      listManagedBackendsForProvider(providerId),
      listRuntimeStates()
    ]);
    return appendManagedBackendModels(models, managedBackends, runtimeStates);
  },
  providerSetActive: (providerId: string, modelId: string) =>
    post<AppSettings>("/providers/set-active", { providerId, modelId }),
  providerActivateModel: async (providerId: string, modelId: string) => {
    const managedBackendId = parseManagedBackendModelId(modelId);
    if (managedBackendId) {
      const backends = await listManagedBackendsForProvider(providerId);
      const target = backends.find((backend) => backend.id === managedBackendId);
      if (!target) {
        throw new Error("Managed backend configuration not found");
      }
      const { actualModelId, displayLabel } = await resolveManagedBackendModel(providerId, managedBackendId);
      const updated = await post<AppSettings>("/providers/set-active", { providerId, modelId: actualModelId });
      return {
        settings: updated,
        activeModelLabel: displayLabel,
        actualModelId,
        managedBackendId
      };
    }

    await maybeStopActiveManagedBackend();
    const updated = await post<AppSettings>("/providers/set-active", { providerId, modelId });
    return {
      settings: updated,
      activeModelLabel: updated.activeModel || modelId,
      actualModelId: updated.activeModel || modelId,
      managedBackendId: null
    };
  },
  providerTestConnection: (providerId: string) => post<boolean>(`/providers/${providerId}/test`)
};
