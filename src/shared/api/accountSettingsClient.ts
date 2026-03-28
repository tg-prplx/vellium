import type { AppSettings, McpDiscoverResult, McpImportResult, McpServerConfig, McpServerTestResult, ProviderModel } from "../types/contracts";
import { get, patchReq, post } from "./core";

const LONG_RUNNING_REQUEST_OPTIONS = { timeoutMs: 0 };

export const accountSettingsClient = {
  accountCreate: (password: string, recoveryKey?: string) =>
    post<string>("/account/create", { password, recoveryKey }),
  accountUnlock: (password: string, recoveryKey?: string) =>
    post<boolean>("/account/unlock", { password, recoveryKey }),
  settingsGet: () => get<AppSettings>("/settings"),
  settingsUpdate: (patchData: Partial<AppSettings>) => patchReq<AppSettings>("/settings", patchData),
  settingsReset: () => post<AppSettings>("/settings/reset"),
  settingsFetchTtsModels: (baseUrl?: string, apiKey?: string, adapterId?: string | null) =>
    post<ProviderModel[]>("/settings/tts/models", { baseUrl, apiKey, adapterId }, LONG_RUNNING_REQUEST_OPTIONS),
  settingsFetchTtsVoices: (baseUrl?: string, apiKey?: string, adapterId?: string | null) =>
    post<ProviderModel[]>("/settings/tts/voices", { baseUrl, apiKey, adapterId }, LONG_RUNNING_REQUEST_OPTIONS),
  settingsTestMcpServer: (server: McpServerConfig) =>
    post<McpServerTestResult>("/settings/mcp/test", { server }, LONG_RUNNING_REQUEST_OPTIONS),
  settingsImportMcpSource: (source: string) =>
    post<McpImportResult>("/settings/mcp/import", { source }, LONG_RUNNING_REQUEST_OPTIONS),
  settingsDiscoverMcpTools: (serverIds?: string[]) =>
    post<McpDiscoverResult>("/settings/mcp/discover", { serverIds }, LONG_RUNNING_REQUEST_OPTIONS)
};
