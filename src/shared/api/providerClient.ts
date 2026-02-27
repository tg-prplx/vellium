import type { AppSettings, ProviderModel, ProviderProfile } from "../types/contracts";
import { get, post } from "./core";

export const providerClient = {
  providerUpsert: (profile: Omit<ProviderProfile, "apiKeyMasked"> & { apiKey: string }) =>
    post<ProviderProfile>("/providers", profile),
  providerList: () => get<ProviderProfile[]>("/providers"),
  providerFetchModels: (providerId: string) => get<ProviderModel[]>(`/providers/${providerId}/models`),
  providerSetActive: (providerId: string, modelId: string) =>
    post<AppSettings>("/providers/set-active", { providerId, modelId }),
  providerTestConnection: (providerId: string) => post<boolean>(`/providers/${providerId}/test`)
};
