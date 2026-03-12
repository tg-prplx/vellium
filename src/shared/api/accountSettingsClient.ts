import type { AppSettings, McpDiscoverResult, McpImportResult, McpServerConfig, McpServerTestResult, ProviderModel } from "../types/contracts";
import { get, patchReq, post } from "./core";

export const accountSettingsClient = {
  accountCreate: (password: string, recoveryKey?: string) =>
    post<string>("/account/create", { password, recoveryKey }),
  accountUnlock: (password: string, recoveryKey?: string) =>
    post<boolean>("/account/unlock", { password, recoveryKey }),
  settingsGet: () => get<AppSettings>("/settings"),
  settingsUpdate: (patchData: Partial<AppSettings>) => patchReq<AppSettings>("/settings", patchData),
  settingsReset: () => post<AppSettings>("/settings/reset"),
  settingsFetchTtsModels: (baseUrl?: string, apiKey?: string, adapterId?: string | null) =>
    post<ProviderModel[]>("/settings/tts/models", { baseUrl, apiKey, adapterId }),
  settingsFetchTtsVoices: (baseUrl?: string, apiKey?: string, adapterId?: string | null) =>
    post<ProviderModel[]>("/settings/tts/voices", { baseUrl, apiKey, adapterId }),
  settingsTestMcpServer: (server: McpServerConfig) => post<McpServerTestResult>("/settings/mcp/test", { server }),
  settingsImportMcpSource: (source: string) => post<McpImportResult>("/settings/mcp/import", { source }),
  settingsDiscoverMcpTools: (serverIds?: string[]) => post<McpDiscoverResult>("/settings/mcp/discover", { serverIds })
};
