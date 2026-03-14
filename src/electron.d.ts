import type { ManagedBackendConfig, ManagedBackendLogEntry, ManagedBackendRuntimeState } from "./shared/types/contracts";

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  getPlatform: () => Promise<string>;
  saveFile: (filename: string, base64Data: string) => Promise<{ ok: boolean; canceled: boolean; filePath?: string }>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  listManagedBackends: () => Promise<ManagedBackendRuntimeState[]>;
  startManagedBackend: (config: ManagedBackendConfig) => Promise<ManagedBackendRuntimeState>;
  stopManagedBackend: (backendId: string) => Promise<ManagedBackendRuntimeState | null>;
  stopActiveManagedBackend: () => Promise<{ ok: boolean }>;
  getManagedBackendLogs: (backendId: string) => Promise<ManagedBackendLogEntry[]>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => void;
  onManagedBackendsUpdate: (callback: (states: ManagedBackendRuntimeState[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
