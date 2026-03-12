import type { PluginCatalog, PluginDescriptor } from "../types/contracts";
import { get, patchReq, post, requestBlob } from "./core";

export const pluginClient = {
  pluginsList: () => get<PluginCatalog>("/plugins"),
  pluginsReload: () => post<PluginCatalog>("/plugins/reload"),
  pluginInstallPluginfile: (data: unknown) => post<{ ok: boolean; plugin: PluginDescriptor; catalog: PluginCatalog }>("/plugins/install-pluginfile", { data }),
  pluginSetState: (id: string, enabled: boolean) => patchReq<{ ok: boolean; enabled: boolean; plugin: PluginDescriptor }>(`/plugins/${id}/state`, { enabled }),
  pluginExportPluginfile: (id: string) => requestBlob("GET", `/plugins/${id}/pluginfile`),
  pluginGetPermissions: (id: string) => get<{ requested: string[]; granted: string[]; configured: boolean; grants: Record<string, boolean> }>(`/plugins/${id}/permissions`),
  pluginPatchPermissions: (id: string, grants: Record<string, boolean>) => patchReq<{ ok: boolean; requested: string[]; granted: string[]; configured: boolean; grants: Record<string, boolean> }>(`/plugins/${id}/permissions`, { grants }),
  pluginGetSettings: (id: string) => get<Record<string, unknown>>(`/plugins/${id}/settings`),
  pluginPatchSettings: (id: string, patch: Record<string, unknown>) => patchReq<{ ok: boolean; data: Record<string, unknown> }>(`/plugins/${id}/settings`, patch)
};
