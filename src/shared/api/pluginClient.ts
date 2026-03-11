import type { PluginCatalog, PluginDescriptor } from "../types/contracts";
import { get, patchReq, post } from "./core";

export const pluginClient = {
  pluginsList: () => get<PluginCatalog>("/plugins"),
  pluginsReload: () => post<PluginCatalog>("/plugins/reload"),
  pluginSetState: (id: string, enabled: boolean) => patchReq<{ ok: boolean; enabled: boolean; plugin: PluginDescriptor }>(`/plugins/${id}/state`, { enabled }),
  pluginGetSettings: (id: string) => get<Record<string, unknown>>(`/plugins/${id}/settings`),
  pluginPatchSettings: (id: string, patch: Record<string, unknown>) => patchReq<{ ok: boolean; data: Record<string, unknown> }>(`/plugins/${id}/settings`, patch)
};
