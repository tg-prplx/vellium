import { contextBridge, ipcRenderer } from "electron";
import type { ManagedBackendConfig, ManagedBackendLogEntry, ManagedBackendRuntimeState } from "../src/shared/types/contracts";

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  getPlatform: () => ipcRenderer.invoke("window:getPlatform"),
  saveFile: (filename: string, base64Data: string) => ipcRenderer.invoke("file:save", { filename, base64Data }),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  showDesktopPet: (config?: unknown) => ipcRenderer.invoke("desktop-pet:show", config) as Promise<{ ok: boolean; visible: boolean }>,
  hideDesktopPet: () => ipcRenderer.invoke("desktop-pet:hide") as Promise<{ ok: boolean; visible: boolean }>,
  toggleDesktopPet: (config?: unknown) => ipcRenderer.invoke("desktop-pet:toggle", config) as Promise<{ ok: boolean; visible: boolean }>,
  configureDesktopPet: (config?: unknown) => ipcRenderer.invoke("desktop-pet:configure", config) as Promise<{ ok: boolean; visible: boolean }>,
  isDesktopPetVisible: () => ipcRenderer.invoke("desktop-pet:isVisible") as Promise<boolean>,
  startDesktopPetDrag: (point: { screenX: number; screenY: number }) => ipcRenderer.invoke("desktop-pet:drag-start", point) as Promise<{ ok: boolean }>,
  moveDesktopPetDrag: (point: { screenX: number; screenY: number }) => ipcRenderer.invoke("desktop-pet:drag-move", point) as Promise<{ ok: boolean; placement?: "above" | "below" }>,
  resizeDesktopPetUi: (expanded: boolean) => ipcRenderer.invoke("desktop-pet:ui-expanded", expanded) as Promise<{ ok: boolean; placement?: "above" | "below" }>,
  autonomyDesktopPetStep: (delta: { dx: number; dy: number }) => ipcRenderer.invoke("desktop-pet:autonomy-step", delta) as Promise<{ ok: boolean; placement?: "above" | "below" }>,
  sendDesktopPetMessage: (message: string) => ipcRenderer.invoke("desktop-pet:message", message) as Promise<{ ok: boolean; reply: string; chatId?: string }>,
  listManagedBackends: () => ipcRenderer.invoke("managed-backends:list") as Promise<ManagedBackendRuntimeState[]>,
  startManagedBackend: (config: ManagedBackendConfig) => ipcRenderer.invoke("managed-backends:start", config) as Promise<ManagedBackendRuntimeState>,
  stopManagedBackend: (backendId: string) => ipcRenderer.invoke("managed-backends:stop", backendId) as Promise<ManagedBackendRuntimeState | null>,
  stopActiveManagedBackend: () => ipcRenderer.invoke("managed-backends:stop-active") as Promise<{ ok: boolean }>,
  getManagedBackendLogs: (backendId: string) => ipcRenderer.invoke("managed-backends:logs", backendId) as Promise<ManagedBackendLogEntry[]>,
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on("window:maximized", (_event, maximized: boolean) => {
      callback(maximized);
    });
  },
  onManagedBackendsUpdate: (callback: (states: ManagedBackendRuntimeState[]) => void) => {
    ipcRenderer.on("managed-backends:update", (_event, states: ManagedBackendRuntimeState[]) => {
      callback(states);
    });
  }
});
